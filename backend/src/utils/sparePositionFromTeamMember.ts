export type SparePosition = 'lead' | 'second' | 'vice' | 'skip';

export type TeamMemberPositionInput = {
  role: string | null | undefined;
  isSkip?: boolean | null;
  isVice?: boolean | null;
  is_skip?: number | boolean | null;
  is_vice?: number | boolean | null;
};

function toFlag(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

/**
 * Map team roster role/flags onto the spare-request position vocabulary.
 * Skip/vice flags win over role. Doubles roles have no spare position.
 */
export function sparePositionFromTeamMember(
  entry: TeamMemberPositionInput,
): SparePosition | null {
  if (toFlag(entry.isSkip ?? entry.is_skip)) return 'skip';
  if (toFlag(entry.isVice ?? entry.is_vice)) return 'vice';

  const role = (entry.role || '').toLowerCase();
  if (role === 'lead') return 'lead';
  if (role === 'second') return 'second';
  if (role === 'third') return 'vice';
  if (role === 'fourth') return 'skip';
  return null;
}
