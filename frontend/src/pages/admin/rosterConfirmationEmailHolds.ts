import { useCallback, useEffect, useMemo, useState } from 'react';

const STORAGE_PREFIX = 'roster-confirmation-email-holds:';

export function rosterConfirmationEmailHoldsStorageKey(sessionId: number): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function parseRosterConfirmationEmailHolds(raw: string | null): number[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return [
      ...new Set(
        parsed.filter((value): value is number => Number.isInteger(value) && Number(value) > 0),
      ),
    ];
  } catch {
    return [];
  }
}

export function loadRosterConfirmationEmailHolds(sessionId: number): number[] {
  if (!sessionId || typeof localStorage === 'undefined') return [];
  return parseRosterConfirmationEmailHolds(localStorage.getItem(rosterConfirmationEmailHoldsStorageKey(sessionId)));
}

export function saveRosterConfirmationEmailHolds(sessionId: number, memberIds: number[]): void {
  if (!sessionId || typeof localStorage === 'undefined') return;
  localStorage.setItem(
    rosterConfirmationEmailHoldsStorageKey(sessionId),
    JSON.stringify([...new Set(memberIds.filter((id) => Number.isInteger(id) && id > 0))]),
  );
}

export function canHoldRosterConfirmationEmail(row: {
  canSend: boolean;
  alreadySent: boolean;
}): boolean {
  return row.canSend && !row.alreadySent;
}

export function rosterConfirmationSendAllMemberIds(
  recipients: Array<{ memberId: number; canSend: boolean; alreadySent: boolean }>,
  heldIds: ReadonlySet<number>,
): number[] {
  return recipients
    .filter((row) => canHoldRosterConfirmationEmail(row) && !heldIds.has(row.memberId))
    .map((row) => row.memberId);
}

export function useRosterConfirmationEmailHolds(sessionId: number | null) {
  const [heldIds, setHeldIds] = useState<number[]>(() =>
    sessionId ? loadRosterConfirmationEmailHolds(sessionId) : [],
  );

  useEffect(() => {
    setHeldIds(sessionId ? loadRosterConfirmationEmailHolds(sessionId) : []);
  }, [sessionId]);

  const heldSet = useMemo(() => new Set(heldIds), [heldIds]);

  const setHeld = useCallback(
    (memberId: number, held: boolean) => {
      setHeldIds((current) => {
        const next = held
          ? Array.from(new Set([...current, memberId]))
          : current.filter((id) => id !== memberId);
        if (sessionId) saveRosterConfirmationEmailHolds(sessionId, next);
        return next;
      });
    },
    [sessionId],
  );

  const setHeldMany = useCallback(
    (memberIds: number[], held: boolean) => {
      setHeldIds((current) => {
        const next = held
          ? Array.from(new Set([...current, ...memberIds]))
          : current.filter((id) => !memberIds.includes(id));
        if (sessionId) saveRosterConfirmationEmailHolds(sessionId, next);
        return next;
      });
    },
    [sessionId],
  );

  return { heldIds, heldSet, setHeld, setHeldMany };
}
