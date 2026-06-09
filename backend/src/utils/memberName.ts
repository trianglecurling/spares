export function splitMemberDisplayName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function formatMemberDisplayName(firstName: string, lastName: string): string {
  return `${firstName.trim()} ${lastName.trim()}`.trim();
}

export function memberNameMatchKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`;
}

export function memberNamePartsFromStored(member: {
  name: string;
  first_name?: string | null;
  last_name?: string | null;
}): { firstName: string; lastName: string } {
  const storedFirst = member.first_name?.trim() ?? '';
  const storedLast = member.last_name?.trim() ?? '';
  if (storedFirst || storedLast) {
    return { firstName: storedFirst, lastName: storedLast };
  }
  return splitMemberDisplayName(member.name);
}

export function memberNameMatchKeyFromFullName(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const parts = splitMemberDisplayName(trimmed);
  if (!parts.firstName) return null;
  return memberNameMatchKey(parts.firstName, parts.lastName);
}

export function resolveMemberNameFields(input: {
  firstName?: string;
  lastName?: string;
  name?: string;
}): { name: string; firstName: string; lastName: string } | null {
  const trimmedFirst = input.firstName?.trim() ?? '';
  const trimmedLast = input.lastName?.trim() ?? '';
  if (trimmedFirst && trimmedLast) {
    return {
      firstName: trimmedFirst,
      lastName: trimmedLast,
      name: formatMemberDisplayName(trimmedFirst, trimmedLast),
    };
  }

  const trimmedName = input.name?.trim() ?? '';
  if (!trimmedName) return null;

  const split = splitMemberDisplayName(trimmedName);
  return {
    firstName: split.firstName,
    lastName: split.lastName,
    name: trimmedName,
  };
}
