import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from 'react';
import api, { formatApiError } from '../utils/api';
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

type PendingGamePatch = {
  result?: TournamentGameResult | null;
  rockColor1Slot?: 0 | 1 | null;
};

/** Debounced per-game result PATCH for an editor that already owns draw state. */
export function useTournamentGameResultPersist(
  eventId: number,
  setDraw: Dispatch<SetStateAction<TournamentDrawState | null>>,
  options?: { onPatchFailure?: () => void },
): {
  updateDrawForResults: UpdateDrawForResults;
  saveStatus: 'idle' | 'saving' | 'saved' | 'error';
  replaceDrawAndPersist: (next: TournamentDrawState) => Promise<void>;
} {
  const { showAlert } = useAlert();
  const resultPatchTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const pendingPatchesRef = useRef<Record<string, PendingGamePatch>>({});
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
    };
  }, []);

  const flushGamePatch = useCallback(
    async (gameId: string, patch: PendingGamePatch) => {
      if (patch.result === undefined && patch.rockColor1Slot === undefined) return;
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
      }
    },
    [eventId, onPatchFailure, showAlert],
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

  return { updateDrawForResults, saveStatus, replaceDrawAndPersist };
}

/** Standalone load + persist for the dedicated scorekeeper page. */
export function useTournamentDrawResults(eventId: number) {
  const { showAlert } = useAlert();
  const [draw, setDraw] = useState<TournamentDrawState | null>(null);
  const [teams, setTeams] = useState<TournamentTeamApi[]>([]);
  const [eventTitle, setEventTitle] = useState('');
  const [tournamentFormat, setTournamentFormat] = useState<'fours' | 'doubles' | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const { updateDrawForResults, saveStatus, replaceDrawAndPersist } = useTournamentGameResultPersist(
    eventId,
    setDraw,
  );

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
      api.get<{ title: string; tournamentFormat?: 'fours' | 'doubles' | null }>(`/events/${eventId}`),
    ])
      .then(([drawRes, teamsRes, eventRes]) => {
        if (cancelled) return;
        const raw = drawRes.data?.draw ?? null;
        setDraw(raw ? normalizeDrawState(raw) : null);
        setTeams(teamsRes.data.teams ?? []);
        setEventTitle(eventRes.data.title ?? '');
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
