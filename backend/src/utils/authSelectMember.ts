/** Parse `temp:{contact}` stored on multi-member selection auth codes. */
export function parseTempAuthContact(storedContact: string): string | null {
  if (!storedContact.startsWith('temp:')) return null;
  const bound = storedContact.slice('temp:'.length).trim();
  return bound.length > 0 ? bound : null;
}

/** True when the chosen member is in the set verified for the temp token's contact. */
export function isMemberIdBoundToContact(memberId: number, allowedMemberIds: Iterable<number>): boolean {
  for (const id of allowedMemberIds) {
    if (id === memberId) return true;
  }
  return false;
}
