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

type MemberOptionsContextValue = {
  options: MemberPickerOption[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  ensureLoaded: () => Promise<MemberPickerOption[]>;
  refresh: () => Promise<MemberPickerOption[]>;
};

const MemberOptionsContext = createContext<MemberOptionsContextValue | undefined>(undefined);

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
  const [options, setOptions] = useState<MemberPickerOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const optionsRef = useRef<MemberPickerOption[]>([]);
  const loadedRef = useRef(false);
  const inFlightRef = useRef<Promise<MemberPickerOption[]> | null>(null);

  const loadMembers = useCallback((force = false) => {
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
  }, []);

  const value = useMemo<MemberOptionsContextValue>(
    () => ({
      options,
      loading,
      loaded,
      error,
      ensureLoaded: () => loadMembers(false),
      refresh: () => loadMembers(true),
    }),
    [error, loadMembers, loaded, loading, options]
  );

  return <MemberOptionsContext.Provider value={value}>{children}</MemberOptionsContext.Provider>;
}

export function useMemberOptions({ autoLoad = true }: { autoLoad?: boolean } = {}) {
  const context = useContext(MemberOptionsContext);

  if (!context) {
    throw new Error('useMemberOptions must be used within a MemberOptionsProvider');
  }

  const { ensureLoaded, loaded, loading } = context;

  useEffect(() => {
    if (!autoLoad || loaded || loading) return;
    void ensureLoaded().catch(() => {});
  }, [autoLoad, ensureLoaded, loaded, loading]);

  return context;
}
