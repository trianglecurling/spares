const MEMBER_DISPLAY_NAME_KEY = 'memberDisplayName';

export function getCachedMemberDisplayName(): string | null {
  const value = localStorage.getItem(MEMBER_DISPLAY_NAME_KEY);
  return value?.trim() ? value : null;
}

export function storeCachedMemberDisplayName(name: string): void {
  const trimmed = name.trim();
  if (trimmed) {
    localStorage.setItem(MEMBER_DISPLAY_NAME_KEY, trimmed);
  }
}

export function clearCachedMemberDisplayName(): void {
  localStorage.removeItem(MEMBER_DISPLAY_NAME_KEY);
}

export function memberDisplayInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
