import { useCallback, useMemo } from 'react';
import { useMemberOptions } from '../contexts/MemberOptionsContext';
import { normalizeEmailKey, parentEmailLookupFromMembers } from '../utils/memberParentEmail';

export function useParentEmailLookup() {
  const { options } = useMemberOptions({ autoLoad: true });
  const byEmail = useMemo(() => parentEmailLookupFromMembers(options), [options]);

  const parentEmailFor = useCallback(
    (email: string | null | undefined) => {
      const key = normalizeEmailKey(email);
      if (!key) return null;
      return byEmail.get(key) ?? null;
    },
    [byEmail],
  );

  return { parentEmailFor };
}
