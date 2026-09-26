const TOKEN_KEY = 'registrationSpecialLinkToken';
const SNAPSHOT_KEY = 'registrationSpecialLinkSnapshot';

export type RegistrationSpecialLinkSnapshot = {
  token: string;
  email: string;
  allowLeagueRegistration: boolean;
  allowedLeagueIds: number[] | null;
  requiresLogin: boolean;
  seasonId: number;
  sessionId: number;
  seasonName: string;
  sessionName: string;
};

function readStorage(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  sessionStorage.setItem(key, value);
}

function removeStorage(key: string): void {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Ignore storage failures in private browsing.
  }
}

export function getRegistrationSpecialLinkToken(): string | null {
  const stored = readStorage(TOKEN_KEY)?.trim();
  return stored || null;
}

export function storeRegistrationSpecialLinkToken(token: string): void {
  writeStorage(TOKEN_KEY, token);
}

export function storeRegistrationSpecialLinkSnapshot(snapshot: RegistrationSpecialLinkSnapshot): void {
  writeStorage(TOKEN_KEY, snapshot.token);
  writeStorage(SNAPSHOT_KEY, JSON.stringify(snapshot));
}

export function getRegistrationSpecialLinkSnapshot(): RegistrationSpecialLinkSnapshot | null {
  const raw = readStorage(SNAPSHOT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as RegistrationSpecialLinkSnapshot;
    if (!parsed?.token || !parsed.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearRegistrationSpecialLink(): void {
  removeStorage(TOKEN_KEY);
  removeStorage(SNAPSHOT_KEY);
}

export function specialLinkTokenFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const token = params.get('slk')?.trim();
  return token || null;
}

export function emailsMatchForSpecialLink(expected: string, actual: string | null | undefined): boolean {
  if (!actual?.trim()) return false;
  return expected.trim().toLowerCase() === actual.trim().toLowerCase();
}

export function specialLinkLoginSearch(token: string): string {
  return `?slk=${encodeURIComponent(token)}`;
}
