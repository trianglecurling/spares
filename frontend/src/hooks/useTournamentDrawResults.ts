import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import api, { ensureAccessToken, formatApiError } from '../utils/api';
import { useAlert } from '../contexts/AlertContext';
import type { TournamentDrawState, TournamentGameResult } from '../utils/tournamentDrawModel';
import { normalizeDrawState } from '../utils/tournamentDrawRouting';
import { setGameResult } from '../utils/tournamentDrawResultsRows';
import type { TournamentTeamApi } from '../types/tournamentTeam';

export type PersistGamePatch = {
  gameId: string;
  result?: TournamentGameResult | null;
  rockColor1Slot?: 0 | 1 | null;
  /** Override default per-game PATCH debounce (ms). */
  debounceMs?: number;
};

export type UpdateDrawForResults = (
  fn: (d: TournamentDrawState) => TournamentDrawState,
  opts?: {
    persistGameResult?: PersistGamePatch;
  },
) => void;

const RESULT_PATCH_DEBOUNCE_MS = 350;
const DRAW_STREAM_RETRY_MS = 2000;

type PendingGamePatch = {
  result?: TournamentGameResult | null;
  rockColor1Slot?: 0 | 1 | null;
};

/** Keep in-progress local scores when a remote draw arrives. */
function overlayDirtyGames(
  server: TournamentDrawState,
  local: TournamentDrawState,
  dirtyGameIds: ReadonlySet<string>,
): TournamentDrawState {
  if (dirtyGameIds.size === 0) return server;
  const games = { ...server.games };
  for (const gameId of dirtyGameIds) {
    const localGame = local.games[gameId];
    const serverGame = games[gameId];
    if (!localGame || !serverGame) continue;
    games[gameId] = {
      ...serverGame,
      result: localGame.result,
      rockColor1Slot: localGame.rockColor1Slot,
    };
  }
  return { ...server, games };
}

function consumeSseBuffer(buffer: string, onData: (data: string) => void): string {
  const parts = buffer.split('\n\n');
  const rest = parts.pop() ?? '';
  for (const part of parts) {
    const data = part
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart())
      .join('\n');
    if (data) onData(data);
  }
  return rest;
}

/** Debounced per-game result PATCH for an editor that already owns draw state. */
export function useTournamentGameResultPersist(
  eventId: number,
  setDraw: Dispatch<SetStateAction<TournamentDrawState | null>>,
  options?: { onPatchFailure?: () => void },
): {
  updateDrawForResults: UpdateDrawForResults;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  replaceDrawAndPersist: (next: TournamentDrawState) => Promise<void>;
  applyRemoteDraw: (serverDraw: TournamentDrawState) => void;
} {
  const { showAlert } = useAlert();
  const resultPatchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingPatchesRef = useRef<Record<string, PendingGamePatch>>({});
  /** Games with a pending or in-flight score save. Remote updates must not replace these. */
  const dirtyGameIdsRef = useRef<Set<string>>(new Set());
  const drawRef = useRef<TournamentDrawState | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const onPatchFailure = options?.onPatchFailure;

  useEffect(() => {
    return () => {
      for (const t of Object.values(resultPatchTimersRef.current)) {
        clearTimeout(t);
      }
      resultPatchTimersRef.current = {};
      pendingPatchesRef.current = {};
      dirtyGameIdsRef.current.clear();
    };
  }, []);

  const releaseDirtyGame = useCallback((gameId: string) => {
    if (pendingPatchesRef.current[gameId] || resultPatchTimersRef.current[gameId]) return;
    dirtyGameIdsRef.current.delete(gameId);
  }, []);

  const flushGamePatch = useCallback(
    async (gameId: string, patch: PendingGamePatch) => {
      if (patch.result === undefined && patch.rockColor1Slot === undefined) {
        releaseDirtyGame(gameId);
        return;
      }
      setSaveStatus('saving');
      try {
        const body: Record<string, unknown> = {};
        if (patch.result !== undefined) body.result = patch.result;
        if (patch.rockColor1Slot !== undefined) body.rockColor1Slot = patch.rockColor1Slot;
        await api.patch(
          `/events/${eventId}/tournament-draw/games/${encodeURIComponent(gameId)}/result`,
          body,
        );
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error');
        onPatchFailure?.();
        showAlert(formatApiError(err, 'Failed to save game result'), 'error');
      } finally {
        releaseDirtyGame(gameId);
      }
    },
    [eventId, onPatchFailure, releaseDirtyGame, showAlert],
  );

  const updateDrawForResults = useCallback<UpdateDrawForResults>(
    (fn, opts) => {
      setDraw((d) => {
        if (!d) return d;
        const next = fn(d);
        drawRef.current = next;
        return next;
      });
      const patch = opts?.persistGameResult;
      if (!patch) return;
      const { gameId, result, rockColor1Slot, debounceMs } = patch;
      dirtyGameIdsRef.current.add(gameId);
      const delay = debounceMs ?? RESULT_PATCH_DEBOUNCE_MS;
      const pending = pendingPatchesRef.current[gameId] ?? {};
      if (result !== undefined) pending.result = result;
      if (rockColor1Slot !== undefined) pending.rockColor1Slot = rockColor1Slot;
      pendingPatchesRef.current[gameId] = pending;
      const timers = resultPatchTimersRef.current;
      if (timers[gameId]) {
        clearTimeout(timers[gameId]);
      }
      timers[gameId] = setTimeout(() => {
        delete timers[gameId];
        const toFlush = pendingPatchesRef.current[gameId];
        delete pendingPatchesRef.current[gameId];
        if (toFlush) void flushGamePatch(gameId, toFlush);
      }, delay);
    },
    [flushGamePatch, setDraw],
  );

  const replaceDrawAndPersist = useCallback(
    async (next: TournamentDrawState) => {
      for (const t of Object.values(resultPatchTimersRef.current)) {
        clearTimeout(t);
      }
      resultPatchTimersRef.current = {};
      pendingPatchesRef.current = {};
      dirtyGameIdsRef.current.clear();
      setSaveStatus('saving');
      try {
        await api.put(`/events/${eventId}/tournament-draw`, next);
        setDraw(next);
        drawRef.current = next;
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('error');
        onPatchFailure?.();
        showAlert(formatApiError(err, 'Failed to save scorekeeping settings'), 'error');
        throw err;
      }
    },
    [eventId, onPatchFailure, setDraw, showAlert],
  );

  const applyRemoteDraw = useCallback(
    (serverDraw: TournamentDrawState) => {
      const normalized = normalizeDrawState(serverDraw);
      setDraw((current) => {
        const next = current
          ? overlayDirtyGames(normalized, current, dirtyGameIdsRef.current)
          : normalized;
        drawRef.current = next;
        return next;
      });
    },
    [setDraw],
  );

  return { updateDrawForResults, saveStatus, replaceDrawAndPersist, applyRemoteDraw };
}

/** Standalone load + persist for the dedicated scorekeeper page. */
export function useTournamentDrawResults(eventId: number) {
  const { showAlert } = useAlert();
  const [draw, setDraw] = useState<TournamentDrawState | null>(null);
  const [teams, setTeams] = useState<TournamentTeamApi[]>([]);
  const [eventTitle, setEventTitle] = useState('');
  const [eventTimespans, setEventTimespans] = useState<
    Array<{ start_dt: string; end_dt?: string; sort_order?: number }>
  >([]);
  const [tournamentFormat, setTournamentFormat] = useState<'fours' | 'doubles' | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { updateDrawForResults, saveStatus, replaceDrawAndPersist, applyRemoteDraw } =
    useTournamentGameResultPersist(eventId, setDraw);

  useEffect(() => {
    if (!Number.isFinite(eventId) || eventId <= 0) {
      setLoading(false);
      setLoadError('Invalid event id');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    Promise.all([
      api.get<{ draw: TournamentDrawState | null }>(`/events/${eventId}/tournament-draw`),
      api.get<{ teams: TournamentTeamApi[] }>(`/events/${eventId}/tournament-teams`),
      api.get<{
        title: string;
        tournamentFormat?: 'fours' | 'doubles' | null;
        timespans?: Array<{ start_dt: string; end_dt?: string; sort_order?: number }>;
      }>(`/events/${eventId}`),
    ])
      .then(([drawRes, teamsRes, eventRes]) => {
        if (cancelled) return;
        const raw = drawRes.data?.draw ?? null;
        setDraw(raw ? normalizeDrawState(raw) : null);
        setTeams(teamsRes.data.teams ?? []);
        setEventTitle(eventRes.data.title ?? '');
        setEventTimespans(eventRes.data.timespans ?? []);
        setTournamentFormat(
          eventRes.data.tournamentFormat === 'doubles' || eventRes.data.tournamentFormat === 'fours'
            ? eventRes.data.tournamentFormat
            : 'fours',
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(formatApiError(err, 'Failed to load tournament draw'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [eventId]);

  useEffect(() => {
    if (!Number.isFinite(eventId) || eventId <= 0) return;

    let cancelled = false;
    let abort: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let refetching = false;
    let refetchQueued = false;

    const refetchDraw = () => {
      if (cancelled) return;
      if (refetching) {
        refetchQueued = true;
        return;
      }
      refetching = true;
      api
        .get<{ draw: TournamentDrawState | null }>(`/events/${eventId}/tournament-draw`)
        .then((res) => {
          if (cancelled) return;
          const raw = res.data?.draw ?? null;
          if (raw) applyRemoteDraw(raw);
        })
        .catch(() => {
          // Keep the draw on screen; the stream will retry.
        })
        .finally(() => {
          refetching = false;
          if (refetchQueued && !cancelled) {
            refetchQueued = false;
            refetchDraw();
          }
        });
    };

    const scheduleRetry = () => {
      if (cancelled || retryTimer) return;
      retryTimer = setTimeout(() => {
        retryTimer = undefined;
        void connect();
      }, DRAW_STREAM_RETRY_MS);
    };

    const connect = async () => {
      if (cancelled) return;
      const token = await ensureAccessToken();
      if (cancelled || !token) {
        scheduleRetry();
        return;
      }
      abort = new AbortController();
      const signal = abort.signal;
      let buffer = '';
      try {
        const res = await fetch(`/api/events/${eventId}/tournament-draw/stream`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'text/event-stream',
          },
          signal,
        });
        if (!res.ok || !res.body) {
          if (res.status !== 403) scheduleRetry();
          return;
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (!cancelled) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer = consumeSseBuffer(buffer + decoder.decode(value, { stream: true }), (data) => {
            try {
              const msg = JSON.parse(data) as { type?: string };
              if (msg.type === 'tournament_draw_updated') refetchDraw();
            } catch {
              // Ignore malformed SSE payloads.
            }
          });
        }
        if (!cancelled) scheduleRetry();
      } catch (err) {
        if (cancelled || signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
          return;
        }
        scheduleRetry();
      }
    };

    void connect();

    return () => {
      cancelled = true;
      abort?.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [applyRemoteDraw, eventId]);

  const updateGameResult = useCallback(
    (gameId: string, result: TournamentGameResult | null, debounceMs?: number) => {
      updateDrawForResults((d) => setGameResult(d, gameId, result), {
        persistGameResult: { gameId, result, debounceMs },
      });
    },
    [updateDrawForResults],
  );

  return {
    draw,
    teams,
    eventTitle,
    eventTimespans,
    tournamentFormat,
    loading,
    loadError,
    saveStatus,
    updateDrawForResults,
    updateGameResult,
    replaceDrawAndPersist,
    showAlert,
  };
}
