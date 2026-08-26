export type DeveloperSessionInfo = {
  operatorMemberId: number;
  operatorName: string;
  targetMemberId: number;
  targetName: string;
};

export type DeveloperSessionStash = DeveloperSessionInfo & {
  accessToken: string;
  refreshToken: string;
};

export const DEVELOPER_SESSION_STORAGE_KEY = 'tbs.developerSession.v1';

type DeveloperSessionStashV1 = DeveloperSessionStash & { v: 1 };

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export function getDeveloperSessionStorage(): StorageLike | null {
  if (typeof sessionStorage === 'undefined') return null;
  return sessionStorage;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function parseDeveloperSessionStash(raw: string | null): DeveloperSessionStash | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<DeveloperSessionStashV1>;
    if (parsed.v !== 1) return null;
    if (!isNonEmptyString(parsed.accessToken) || !isNonEmptyString(parsed.refreshToken)) return null;
    if (!isPositiveInt(parsed.operatorMemberId) || !isPositiveInt(parsed.targetMemberId)) return null;
    if (!isNonEmptyString(parsed.operatorName) || !isNonEmptyString(parsed.targetName)) return null;
    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      operatorMemberId: parsed.operatorMemberId,
      operatorName: parsed.operatorName,
      targetMemberId: parsed.targetMemberId,
      targetName: parsed.targetName,
    };
  } catch {
    return null;
  }
}

export function toDeveloperSessionInfo(stash: DeveloperSessionStash): DeveloperSessionInfo {
  return {
    operatorMemberId: stash.operatorMemberId,
    operatorName: stash.operatorName,
    targetMemberId: stash.targetMemberId,
    targetName: stash.targetName,
  };
}

export function readDeveloperSessionStash(
  storage: StorageLike | null = getDeveloperSessionStorage()
): DeveloperSessionStash | null {
  if (!storage) return null;
  const stash = parseDeveloperSessionStash(storage.getItem(DEVELOPER_SESSION_STORAGE_KEY));
  if (!stash) {
    storage.removeItem(DEVELOPER_SESSION_STORAGE_KEY);
    return null;
  }
  return stash;
}

export function writeDeveloperSessionStash(
  stash: DeveloperSessionStash,
  storage: StorageLike | null = getDeveloperSessionStorage()
): void {
  if (!storage) return;
  const payload: DeveloperSessionStashV1 = { v: 1, ...stash };
  storage.setItem(DEVELOPER_SESSION_STORAGE_KEY, JSON.stringify(payload));
}

export function clearDeveloperSessionStash(
  storage: StorageLike | null = getDeveloperSessionStorage()
): void {
  storage?.removeItem(DEVELOPER_SESSION_STORAGE_KEY);
}

/**
 * Keep the original operator stash across chained sign-ins. Drop it if the current
 * member is the operator again (real login or a completed return).
 */
export function resolveDeveloperSession(
  currentMemberId: number | null,
  storage: StorageLike | null = getDeveloperSessionStorage()
): DeveloperSessionInfo | null {
  const stash = readDeveloperSessionStash(storage);
  if (!stash || currentMemberId == null) return null;
  if (currentMemberId === stash.operatorMemberId) {
    clearDeveloperSessionStash(storage);
    return null;
  }
  return toDeveloperSessionInfo(stash);
}
