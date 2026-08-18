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
import type { MemberPickerOption } from '../types/memberPicker';
import { useAuth } from './AuthContext';

type MemberOptionsContextValue = {
  options: MemberPickerOption[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  ensureLoaded: () => Promise<MemberPickerOption[]>;
  refresh: () => Promise<MemberPickerOption[]>;
};

const MemberOptionsContext = createContext<MemberOptionsContextValue | undefined>(undefined);

const EMPTY_OPTIONS: MemberPickerOption[] = [];

function mapMemberOptions(
  members: Array<{ id: number; name: string; email?: string | null }>
): MemberPickerOption[] {
  return members.map((member) => ({
    id: member.id,
    name: member.name,
    email: member.email ?? null,
  }));
}

export function MemberOptionsProvider({ children }: { children: ReactNode }) {
  const { member } = useAuth();
  const memberId = member?.id ?? null;
  const [options, setOptions] = useState<MemberPickerOption[]>(EMPTY_OPTIONS);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef<MemberPickerOption[]>(EMPTY_OPTIONS);
  const loadedRef = useRef(false);
  const inFlightRef = useRef<Promise<MemberPickerOption[]> | null>(null);

  const loadMembers = useCallback((force = false) => {
    if (memberId == null) {
      loadedRef.current = true;
      setLoaded(true);
      setLoading(false);
      return Promise.resolve(EMPTY_OPTIONS);
    }

    if (!force && loadedRef.current) {
      return Promise.resolve(optionsRef.current);
    }

    if (inFlightRef.current) {
      return inFlightRef.current;
    }

    setLoading(true);
    setError(null);

    const request = get('/members')
      .then((response) => {
        const mapped = mapMemberOptions(response);
        optionsRef.current = mapped;
        loadedRef.current = true;
        setOptions(mapped);
        setLoaded(true);
        return mapped;
      })
      .catch((caughtError: unknown) => {
        const message =
          caughtError instanceof Error ? caughtError.message : 'Failed to load members.';
        setError(message);
        throw caughtError;
      })
      .finally(() => {
        inFlightRef.current = null;
        setLoading(false);
      });

    inFlightRef.current = request;
    return request;
  }, [memberId]);

  useEffect(() => {
    optionsRef.current = EMPTY_OPTIONS;
    inFlightRef.current = null;
    setOptions((prev) => (prev.length === 0 ? prev : EMPTY_OPTIONS));
    setError(null);
    setLoading(false);

    if (memberId == null) {
      loadedRef.current = true;
      setLoaded(true);
      return;
    }

    loadedRef.current = false;
    setLoaded(false);
  }, [memberId]);

  const ensureLoaded = useCallback(() => loadMembers(false), [loadMembers]);
  const refresh = useCallback(() => loadMembers(true), [loadMembers]);

  const value = useMemo<MemberOptionsContextValue>(
    () => ({
      options,
      loading,
      loaded,
      error,
      ensureLoaded,
      refresh,
    }),
    [ensureLoaded, error, loaded, loading, options, refresh]
  );

  return <MemberOptionsContext.Provider value={value}>{children}</MemberOptionsContext.Provider>;
}

export function useMemberOptions({ autoLoad = true }: { autoLoad?: boolean } = {}) {
  const context = useContext(MemberOptionsContext);

  if (!context) {
    throw new Error('useMemberOptions must be used within a MemberOptionsProvider');
  }

  const { ensureLoaded, loaded, loading, error } = context;

  useEffect(() => {
    if (!autoLoad || loaded || loading || error) return;
    void ensureLoaded().catch(() => {});
  }, [autoLoad, ensureLoaded, error, loaded, loading]);

  return context;
}
