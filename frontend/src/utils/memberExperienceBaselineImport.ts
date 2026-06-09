export type ParsedExperienceBaselineRow = {
  lineNumber: number;
  name: string;
  email: string;
  baselineOtherClubExperienceYears: number;
  baselineClubExperienceYears: number;
  expectedTotalYears: number | null;
  parseError?: string;
  totalMismatchWarning?: string;
};

function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, '-');
}

function splitMemberDisplayName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  if (!trimmed) return { firstName: '', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

export function memberNameMatchKey(firstName: string, lastName: string): string {
  return `${firstName.trim().toLowerCase()}|${lastName.trim().toLowerCase()}`;
}

export function memberNamePartsFromMember(member: {
  name: string;
  firstName?: string | null;
  lastName?: string | null;
}): { firstName: string; lastName: string } {
  const storedFirst = member.firstName?.trim() ?? '';
  const storedLast = member.lastName?.trim() ?? '';
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

function parseExperienceYears(value: string, fieldLabel: string): { value: number } | { error: string } {
  const trimmed = value.trim();
  if (!trimmed) {
    return { error: `${fieldLabel} is required.` };
  }
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return { error: `${fieldLabel} must be a number.` };
  }
  if (parsed < 0 || parsed >= 100) {
    return { error: `${fieldLabel} must be at least 0 and less than 100.` };
  }
  if (Math.round(parsed * 2) !== parsed * 2) {
    return { error: `${fieldLabel} must be a whole number or end in .5.` };
  }
  return { value: parsed };
}

function columnIndex(headers: string[], aliases: string[]): number | null {
  for (const alias of aliases) {
    const index = headers.indexOf(alias);
    if (index >= 0) return index;
  }
  return null;
}

export function parseMemberExperienceBaselineTsv(text: string): {
  rows: ParsedExperienceBaselineRow[];
  fatalError?: string;
} {
  const trimmed = text.trim();
  if (!trimmed) {
    return { rows: [], fatalError: 'Paste your spreadsheet data first.' };
  }

  const lines = trimmed.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    return { rows: [], fatalError: 'Include a header row and at least one member row.' };
  }

  const delimiter = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(delimiter).map(normalizeHeader);

  const emailIndex = columnIndex(headers, ['email']);
  const otherIndex = columnIndex(headers, [
    'other-years',
    'other-years-baseline',
    'baseline-other-club-experience-years',
    'baseline-other-club',
    'other-club-years',
  ]);
  const ourIndex = columnIndex(headers, [
    'our-years',
    'baseline-club-experience-years',
    'baseline-club-years',
    'club-years',
    'our-club-years',
  ]);
  const totalIndex = columnIndex(headers, ['total-years', 'total']);
  const nameIndex = columnIndex(headers, ['name', 'member-name']);

  if (emailIndex == null && nameIndex == null) {
    return { rows: [], fatalError: 'Header row must include an email or name column.' };
  }
  if (otherIndex == null) {
    return { rows: [], fatalError: 'Header row must include an other-years column.' };
  }
  if (ourIndex == null) {
    return { rows: [], fatalError: 'Header row must include an our-years column.' };
  }

  const rows: ParsedExperienceBaselineRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delimiter).map((part) => part.trim());
    const lineNumber = i + 1;
    const email = emailIndex != null ? parts[emailIndex] ?? '' : '';
    const name = nameIndex != null ? parts[nameIndex] ?? '' : '';

    const otherParsed = parseExperienceYears(parts[otherIndex] ?? '', 'Other club years');
    const ourParsed = parseExperienceYears(parts[ourIndex] ?? '', 'Our club years');
    const parseErrors: string[] = [];
    if ('error' in otherParsed) parseErrors.push(otherParsed.error);
    if ('error' in ourParsed) parseErrors.push(ourParsed.error);
    if (!email && !name) {
      parseErrors.push('Email or name is required.');
    }
    if (!email && name && !memberNameMatchKeyFromFullName(name)) {
      parseErrors.push('Name must include a first name for name-based matching.');
    }

    let expectedTotalYears: number | null = null;
    let totalMismatchWarning: string | undefined;
    if (totalIndex != null && parts[totalIndex]?.trim()) {
      const totalParsed = parseExperienceYears(parts[totalIndex], 'Total years');
      if ('error' in totalParsed) {
        parseErrors.push(totalParsed.error);
      } else {
        expectedTotalYears = totalParsed.value;
      }
    }

    const baselineOtherClubExperienceYears = 'value' in otherParsed ? otherParsed.value : 0;
    const baselineClubExperienceYears = 'value' in ourParsed ? ourParsed.value : 0;
    if (expectedTotalYears != null && parseErrors.length === 0) {
      const baselineTotal = baselineOtherClubExperienceYears + baselineClubExperienceYears;
      if (baselineTotal !== expectedTotalYears) {
        totalMismatchWarning = `Spreadsheet total (${expectedTotalYears}) does not match other + our (${baselineTotal}). Baseline import still uses other-years and our-years only.`;
      }
    }

    rows.push({
      lineNumber,
      name,
      email,
      baselineOtherClubExperienceYears,
      baselineClubExperienceYears,
      expectedTotalYears,
      parseError: parseErrors.length > 0 ? parseErrors.join(' ') : undefined,
      totalMismatchWarning,
    });
  }

  return { rows };
}

export function memberEmailLookup<T extends { email?: string | null }>(members: T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const member of members) {
    const email = member.email?.trim().toLowerCase();
    if (!email) continue;
    const bucket = map.get(email) ?? [];
    bucket.push(member);
    map.set(email, bucket);
  }
  return map;
}

export function memberNameLookup<T extends { name: string; firstName?: string | null; lastName?: string | null }>(
  members: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const member of members) {
    const parts = memberNamePartsFromMember(member);
    const key = memberNameMatchKey(parts.firstName, parts.lastName);
    const bucket = map.get(key) ?? [];
    bucket.push(member);
    map.set(key, bucket);
  }
  return map;
}

export type ExperienceBaselineMemberMatchStatus =
  | 'matched'
  | 'not_found'
  | 'ambiguous_email'
  | 'ambiguous_name';

export function resolveExperienceBaselineMemberMatch<
  T extends { id?: number; name: string; email?: string | null; firstName?: string | null; lastName?: string | null },
>(
  row: Pick<ParsedExperienceBaselineRow, 'email' | 'name'>,
  membersByEmail: Map<string, T[]>,
  membersByName: Map<string, T[]>,
): { member?: T; issue?: string; status: ExperienceBaselineMemberMatchStatus } {
  const emailKey = row.email.trim().toLowerCase();
  if (emailKey) {
    const matches = membersByEmail.get(emailKey) ?? [];
    if (matches.length === 1) {
      return { member: matches[0], status: 'matched' };
    }
    if (matches.length > 1) {
      const rowNameKey = memberNameMatchKeyFromFullName(row.name);
      if (rowNameKey) {
        const narrowed = matches.filter((member) => {
          const parts = memberNamePartsFromMember(member);
          return memberNameMatchKey(parts.firstName, parts.lastName) === rowNameKey;
        });
        if (narrowed.length === 1) {
          return { member: narrowed[0], status: 'matched' };
        }
        if (narrowed.length > 1) {
          return {
            issue: `Multiple members share this email and first and last name (${narrowed.length} matches).`,
            status: 'ambiguous_name',
          };
        }
        return {
          issue: 'No member with this email matches the provided name.',
          status: 'not_found',
        };
      }
      return {
        issue: `Multiple members share this email (${matches.length} matches). Add a name to disambiguate.`,
        status: 'ambiguous_email',
      };
    }
    return {
      issue: 'No member in the app matches this email.',
      status: 'not_found',
    };
  }

  const nameKey = memberNameMatchKeyFromFullName(row.name);
  if (!nameKey) {
    return {
      issue: 'Name must include a first name for name-based matching.',
      status: 'not_found',
    };
  }
  const matches = membersByName.get(nameKey) ?? [];
  if (matches.length === 0) {
    return {
      issue: 'No member in the app matches this first and last name.',
      status: 'not_found',
    };
  }
  if (matches.length > 1) {
    return {
      issue: `Multiple members share this first and last name (${matches.length} matches).`,
      status: 'ambiguous_name',
    };
  }
  return { member: matches[0], status: 'matched' };
}

export function summarizeExperienceBaselineImportCoverage<
  TMember extends { id: number; name: string; email?: string | null },
  TRow extends Pick<ParsedExperienceBaselineRow, 'lineNumber' | 'name' | 'email'> & {
    matchedMemberId?: number;
    matchStatus?: ExperienceBaselineMemberMatchStatus;
    parseError?: string;
  },
>(previewRows: TRow[], members: TMember[]) {
  const matchedMemberIds = new Set<number>();
  for (const row of previewRows) {
    if (row.matchStatus === 'matched' && row.matchedMemberId != null) {
      matchedMemberIds.add(row.matchedMemberId);
    }
  }

  const notFoundRows = previewRows.filter((row) => !row.parseError && row.matchStatus === 'not_found');
  const membersNotInImport = members
    .filter((member) => !matchedMemberIds.has(member.id))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { matchedMemberIds, notFoundRows, membersNotInImport };
}
