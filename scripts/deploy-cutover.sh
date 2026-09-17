#!/usr/bin/env bash
# Swap a staged release into place and restart systemd without stopping the
# running process during the copy. Staging dirs are prepared by the GitHub
# Actions workflow:
#   <app-root>/backend.next   compiled API + node_modules
#   <app-root>/dist.next       frontend build
#
# Persistent state lives in <app-root>/shared/data (db-config, uploads).
# .env stays at <app-root>/backend/.env so existing systemd EnvironmentFile
# paths keep working.
set -euo pipefail

APP_ROOT=""
UNIT=""

usage() {
  echo "Usage: $0 --app-root /srv/tccnc-web-prod --unit tccnc-web-prod" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-root)
      APP_ROOT="${2:-}"
      shift 2
      ;;
    --unit)
      UNIT="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      ;;
  esac
done

if [[ -z "$APP_ROOT" || -z "$UNIT" ]]; then
  usage
fi

if [[ "${DEPLOY_NO_SUDO:-}" == "1" ]]; then
  sudo() { "$@"; }
fi

SYSTEMCTL_BIN="${DEPLOY_SYSTEMCTL_BIN:-systemctl}"
CURL_BIN="${DEPLOY_CURL_BIN:-curl}"
APP_USER="${DEPLOY_APP_USER:-www-data}"

BACKEND="$APP_ROOT/backend"
BACKEND_NEXT="$APP_ROOT/backend.next"
BACKEND_PREV="$APP_ROOT/backend.prev"
BACKEND_FAILED="$APP_ROOT/backend.failed"
DIST="$APP_ROOT/dist"
DIST_NEXT="$APP_ROOT/dist.next"
DIST_PREV="$APP_ROOT/dist.prev"
DIST_FAILED="$APP_ROOT/dist.failed"
SHARED="$APP_ROOT/shared"
SHARED_DATA="$SHARED/data"

log() {
  echo "[deploy-cutover] $*"
}

HEALTH_TIMEOUT_SEC="${DEPLOY_HEALTH_TIMEOUT_SEC:-120}"

normalize_port() {
  local port="$1"
  port="${port//$'\r'/}"
  port="${port%%#*}"
  port="${port%\"}"
  port="${port#\"}"
  port="${port%\'}"
  port="${port#\'}"
  port="${port#"${port%%[![:space:]]*}"}"
  port="${port%"${port##*[![:space:]]}"}"
  echo "$port"
}

port_from_line() {
  local line="$1"
  line="${line#PORT=}"
  normalize_port "$line"
}

read_port() {
  local envfile="$1"
  local port=""
  local line=""
  if sudo test -f "$envfile"; then
    line="$(sudo grep -E '^PORT=' "$envfile" | tail -n1 || true)"
    if [[ -n "$line" ]]; then
      port="$(port_from_line "$line")"
    fi
  fi
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    port=""
  fi
  echo "$port"
}

read_port_from_service() {
  local pid=""
  local line=""
  local port=""
  pid="$(sudo "$SYSTEMCTL_BIN" show -p MainPID --value "$UNIT" 2>/dev/null || true)"
  if [[ -n "$pid" && "$pid" != "0" ]] && sudo test -r "/proc/${pid}/environ"; then
    line="$(sudo tr '\0' '\n' < "/proc/${pid}/environ" | grep -E '^PORT=' | tail -n1 || true)"
    if [[ -n "$line" ]]; then
      port="$(port_from_line "$line")"
    fi
  fi
  if [[ ! "$port" =~ ^[0-9]+$ ]]; then
    port=""
  fi
  echo "$port"
}

http_health() {
  local url="$1"
  if command -v "$CURL_BIN" >/dev/null 2>&1; then
    "$CURL_BIN" -fsS --max-time 2 "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget -q -O - --timeout=2 "$url"
  else
    python3 - "$url" << 'PY'
import sys, urllib.request
urllib.request.urlopen(sys.argv[1], timeout=2).read()
PY
  fi
}

wait_for_health() {
  local port="$1"
  local url="http://127.0.0.1:${port}/api/health"
  local attempts="$((HEALTH_TIMEOUT_SEC * 2))"
  local i
  local err=""
  log "Waiting up to ${HEALTH_TIMEOUT_SEC}s for $url"
  for i in $(seq 1 "$attempts"); do
    if err="$(http_health "$url" 2>&1)"; then
      log "Health check passed at $url"
      return 0
    fi
    if (( i == 1 || i % 20 == 0 )); then
      log "Still waiting for $url (${i}/${attempts}): ${err:-no response}"
    fi
    sleep 0.5
  done
  log "Health check failed at $url after ${HEALTH_TIMEOUT_SEC}s: ${err:-no response}"
  return 1
}

if [[ ! -d "$BACKEND_NEXT" ]]; then
  echo "Missing staged backend at $BACKEND_NEXT" >&2
  exit 1
fi
if [[ ! -f "$BACKEND_NEXT/index.js" && ! -f "$BACKEND_NEXT/dist/index.js" ]]; then
  echo "Staged backend is missing index.js under $BACKEND_NEXT" >&2
  exit 1
fi
if [[ ! -d "$BACKEND_NEXT/node_modules" ]]; then
  echo "Staged backend is missing node_modules under $BACKEND_NEXT" >&2
  exit 1
fi
if [[ ! -d "$DIST_NEXT" || ! -f "$DIST_NEXT/index.html" ]]; then
  echo "Missing staged frontend at $DIST_NEXT/index.html" >&2
  exit 1
fi

sudo mkdir -p "$SHARED"

# Move live data to a stable shared path while the old process is still running.
# Open files keep working via inode; the symlink covers new opens from cwd/data.
if [[ -d "$BACKEND/data" && ! -L "$BACKEND/data" ]]; then
  if [[ -e "$SHARED_DATA" ]]; then
    log "Replacing leftover $SHARED_DATA with live backend/data"
    sudo rm -rf "$SHARED_DATA"
  fi
  log "Moving live data to $SHARED_DATA"
  sudo mv "$BACKEND/data" "$SHARED_DATA"
  sudo ln -sfn "$SHARED_DATA" "$BACKEND/data"
else
  sudo mkdir -p "$SHARED_DATA"
fi

sudo mkdir -p "$SHARED_DATA"
sudo chown -R "$APP_USER:$APP_USER" "$SHARED_DATA"
sudo chmod 755 "$SHARED_DATA"

if [[ -e "$BACKEND_NEXT/data" && ! -L "$BACKEND_NEXT/data" ]]; then
  sudo rm -rf "$BACKEND_NEXT/data"
fi
sudo ln -sfn "$SHARED_DATA" "$BACKEND_NEXT/data"

if sudo test -f "$BACKEND/.env"; then
  sudo cp -a "$BACKEND/.env" "$BACKEND_NEXT/.env"
  sudo cp -a "$BACKEND/.env" "$SHARED/.env"
elif sudo test -f "$SHARED/.env"; then
  sudo cp -a "$SHARED/.env" "$BACKEND_NEXT/.env"
fi

# www-data must be able to read the new tree; keep deploy-user ownership.
# Do not chmod node_modules: it may be hard-linked to the live tree.
sudo chmod a+rX "$BACKEND_NEXT" "$DIST_NEXT"
sudo chmod -R a+rX "$DIST_NEXT"
shopt -s nullglob
for entry in "$BACKEND_NEXT"/*; do
  if [[ "$(basename "$entry")" != "node_modules" ]]; then
    sudo chmod -R a+rX "$entry"
  fi
done
shopt -u nullglob

if sudo test -f "$BACKEND_NEXT/.env"; then
  sudo chown "$APP_USER:$APP_USER" "$BACKEND_NEXT/.env"
  sudo chmod 600 "$BACKEND_NEXT/.env"
fi

log "Swapping staged backend into $APP_ROOT"
sudo rm -rf "$BACKEND_FAILED" "$BACKEND_PREV"

if [[ -d "$BACKEND" ]]; then
  sudo mv "$BACKEND" "$BACKEND_PREV"
fi
sudo mv "$BACKEND_NEXT" "$BACKEND"

log "Restarting $UNIT"
sudo "$SYSTEMCTL_BIN" restart "$UNIT"

PORT="$(read_port "$BACKEND/.env")"
if [[ -z "$PORT" ]]; then
  PORT="$(read_port_from_service)"
fi
if [[ -z "$PORT" ]]; then
  PORT="3001"
  log "PORT not found in .env or process environment; defaulting to $PORT"
fi

if ! wait_for_health "$PORT"; then
  log "New release failed health checks; rolling back backend"
  sudo "$SYSTEMCTL_BIN" status "$UNIT" --no-pager -l || true
  sudo journalctl -u "$UNIT" -n 80 --no-pager || true

  sudo rm -rf "$BACKEND_FAILED"
  if [[ -d "$BACKEND" ]]; then
    sudo mv "$BACKEND" "$BACKEND_FAILED"
  fi
  if [[ -d "$BACKEND_PREV" ]]; then
    sudo mv "$BACKEND_PREV" "$BACKEND"
  fi
  sudo "$SYSTEMCTL_BIN" restart "$UNIT" || true
  exit 1
fi

log "Swapping staged frontend into $APP_ROOT"
sudo rm -rf "$DIST_FAILED" "$DIST_PREV"
if [[ -d "$DIST" ]]; then
  sudo mv "$DIST" "$DIST_PREV"
fi
sudo mv "$DIST_NEXT" "$DIST"

log "Cutover complete"
exit 0
