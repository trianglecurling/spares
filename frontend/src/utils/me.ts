export function renderMe(
  name: string | null | undefined,
  currentMemberName: string | null | undefined
): string {
  const n = (name ?? '').trim();
  if (!n) return '';
  const me = (currentMemberName ?? '').trim();
  if (me && n.localeCompare(me, undefined, { sensitivity: 'accent' }) === 0) {
    return 'me';
  }
  return n;
}
