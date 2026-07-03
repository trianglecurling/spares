/** True when the JWT access token exists and is not expired (10s skew). */
export function isAccessTokenUsable(token: string | null | undefined): boolean {
  if (!token || token.trim().length === 0) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    if (typeof payload.exp !== 'number') return false;
    return payload.exp * 1000 > Date.now() + 10_000;
  } catch {
    return false;
  }
}
