import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { get } from '../api/client';
import { useAuth } from './AuthContext';

export type SessionLeagueOption = {
  id: number;
  name: string;
  dayOfWeek: number;
  sessionId: number | null;
  format: string;
  allowsDropIns: boolean;
  startDate: string;
  endDate: string;
  drawTimes: string[];
};

type RegistrationWindowPayload = {
  session?: { id?: number } | null;
};

type LeagueOptionsContextValue = {
  leagues: SessionLeagueOption[];
  registrationWindowSessionId: number | null;
  loading: boolean;
  loaded: boolean;
  error: string | null;
  ensureLoaded: () => Promise<SessionLeagueOption[]>;
  refresh: () => Promise<SessionLeagueOption[]>;
};

const LeagueOptionsContext = createContext<LeagueOptionsContextValue | undefined>(undefined);

function mapLeagues(response: unknown): SessionLeagueOption[] {
  if (!Array.isArray(response)) return [];
  return response.map((league) => ({
    id: league.id,
    name: league.name,
    dayOfWeek: league.dayOfWeek,
    sessionId: league.sessionId ?? null,
    format: league.format,
    allowsDropIns: Boolean(league.allowsDropIns),
    startDate: league.startDate,
    endDate: league.endDate,
    drawTimes: Array.isArray(league.drawTimes) ? league.drawTimes : [],
  }));
}

export function LeagueOptionsProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const [leagues, setLeagues] = useState<SessionLeagueOption[]>([]);
  const [registrationWindowSessionId, setRegistrationWindowSessionId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const leaguesRef = useRef<SessionLeagueOption[]>([]);
  const loadedRef = useRef(false);
  const inFlightRef = useRef<Promise<SessionLeagueOption[]> | null>(null);

  const loadLeagues = useCallback(
    (force = false) => {
      if (!member) {
        leaguesRef.current = [];
        loadedRef.current = false;
        setLeagues([]);
        setRegistrationWindowSessionId(null);
        setLoaded(false);
        setError(null);
        return Promise.resolve([]);
      }

      if (!force && loadedRef.current) {
        return Promise.resolve(leaguesRef.current);
      }

      if (inFlightRef.current) {
        return inFlightRef.current;
      }

      setLoading(true);
      setError(null);

      const request = get('/registration/window')
        .catch(() => null)
        .then((windowRes) => {
          const sessionId =
            windowRes &&
            typeof windowRes === 'object' &&
            windowRes !== null &&
            'session' in windowRes &&
            typeof (windowRes as RegistrationWindowPayload).session?.id === 'number'
              ? (windowRes as RegistrationWindowPayload).session!.id!
              : null;
          setRegistrationWindowSessionId(sessionId);
          return get(
            '/leagues',
            sessionId != null
              ? { sessionId, summary: 'true' }
              : { relevantSession: 'true', summary: 'true' },
          );
        })
        .then((response) => {
          const mapped = mapLeagues(response);
          leaguesRef.current = mapped;
          loadedRef.current = true;
          setLeagues(mapped);
          setLoaded(true);
          return mapped;
        })
        .catch((caughtError: unknown) => {
          const message =
            caughtError instanceof Error ? caughtError.message : 'Failed to load leagues.';
          setError(message);
          throw caughtError;
        })
        .finally(() => {
          inFlightRef.current = null;
          setLoading(false);
        });

      inFlightRef.current = request;
      return request;
    },
    [member],
  );

  useEffect(() => {
    if (member) return;
    leaguesRef.current = [];
    loadedRef.current = false;
    setLeagues([]);
    setRegistrationWindowSessionId(null);
    setLoaded(false);
    setError(null);
    inFlightRef.current = null;
  }, [member]);

  const value = useMemo<LeagueOptionsContextValue>(
    () => ({
      leagues,
      registrationWindowSessionId,
      loading,
      loaded,
      error,
      ensureLoaded: () => loadLeagues(false),
      refresh: () => loadLeagues(true),
    }),
    [error, leagues, loadLeagues, loaded, loading, registrationWindowSessionId],
  );

  return <LeagueOptionsContext.Provider value={value}>{children}</LeagueOptionsContext.Provider>;
}

export function useLeagueOptions({ autoLoad = true }: { autoLoad?: boolean } = {}) {
  const context = useContext(LeagueOptionsContext);

  if (!context) {
    throw new Error('useLeagueOptions must be used within a LeagueOptionsProvider');
  }

  const { ensureLoaded, loaded, loading } = context;

  useEffect(() => {
    if (!autoLoad || loaded || loading) return;
    void ensureLoaded().catch(() => {});
  }, [autoLoad, ensureLoaded, loaded, loading]);

  return context;
}
