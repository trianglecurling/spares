const STORAGE_KEY = 'registrationEarlyAccessUnlockToken';

export function getRegistrationEarlyAccessUnlockToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function storeRegistrationEarlyAccessUnlockToken(token: string): void {
  localStorage.setItem(STORAGE_KEY, token);
}

export function clearRegistrationEarlyAccessUnlockToken(): void {
  localStorage.removeItem(STORAGE_KEY);
}
