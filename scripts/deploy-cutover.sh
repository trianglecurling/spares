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

read_port() {
  local envfile="$1"
  local port="3001"
  local line=""
  if sudo test -f "$envfile"; then
    line="$(sudo grep -E '^PORT=' "$envfile" | tail -n1 || true)"
    if [[ -n "$line" ]]; then
      port="${line#PORT=}"
      port="${port%\"}"
      port="${port#\"}"
      port="${port%\'}"
      port="${port#\'}"
    fi
  fi
  echo "$port"
}

wait_for_health() {
  local port="$1"
  local url="http://127.0.0.1:${port}/api/health"
  local i
  for i in $(seq 1 60); do
    if "$CURL_BIN" -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      log "Health check passed at $url"
      return 0
    fi
    sleep 0.5
  done
  log "Health check failed at $url after 30s"
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
sudo chmod -R a+rX "$BACKEND_NEXT" "$DIST_NEXT"

if sudo test -f "$BACKEND_NEXT/.env"; then
  sudo chown "$APP_USER:$APP_USER" "$BACKEND_NEXT/.env"
  sudo chmod 600 "$BACKEND_NEXT/.env"
fi

log "Swapping staged release into $APP_ROOT"
sudo rm -rf "$BACKEND_FAILED" "$DIST_FAILED" "$BACKEND_PREV" "$DIST_PREV"

if [[ -d "$BACKEND" ]]; then
  sudo mv "$BACKEND" "$BACKEND_PREV"
fi
sudo mv "$BACKEND_NEXT" "$BACKEND"

if [[ -d "$DIST" ]]; then
  sudo mv "$DIST" "$DIST_PREV"
fi
sudo mv "$DIST_NEXT" "$DIST"

log "Restarting $UNIT"
sudo "$SYSTEMCTL_BIN" restart "$UNIT"

PORT="$(read_port "$BACKEND/.env")"
if ! wait_for_health "$PORT"; then
  log "New release failed health checks; rolling back"
  sudo "$SYSTEMCTL_BIN" status "$UNIT" --no-pager -l || true
  sudo journalctl -u "$UNIT" -n 80 --no-pager || true

  sudo rm -rf "$BACKEND_FAILED" "$DIST_FAILED"
  if [[ -d "$BACKEND" ]]; then
    sudo mv "$BACKEND" "$BACKEND_FAILED"
  fi
  if [[ -d "$BACKEND_PREV" ]]; then
    sudo mv "$BACKEND_PREV" "$BACKEND"
  fi
  if [[ -d "$DIST" ]]; then
    sudo mv "$DIST" "$DIST_FAILED"
  fi
  if [[ -d "$DIST_PREV" ]]; then
    sudo mv "$DIST_PREV" "$DIST"
  fi
  sudo "$SYSTEMCTL_BIN" restart "$UNIT" || true
  exit 1
fi

log "Cutover complete"
exit 0
