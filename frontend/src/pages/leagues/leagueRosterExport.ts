export type RosterClubTenure = {
  kind: 'new' | 'years';
  years: number | null;
};

export type RosterExportMember = {
  name: string;
  email: string | null;
  parentEmail?: string | null;
  assignedTeamName: string | null;
  totalExperienceYears?: number | null;
  clubTenure?: RosterClubTenure | null;
  previousSessionName?: string | null;
  previousSessionLeagues?: string[];
};

export function toTsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/[\t\r\n]+/g, ' ')
    .trim();
}

export function formatRosterYears(years: number | null | undefined): string {
  if (years == null || !Number.isFinite(years)) return '—';
  return Number.isInteger(years) ? String(years) : years.toFixed(1).replace(/\.0$/, '');
}

export function formatRosterClubTenure(tenure: RosterClubTenure | null | undefined): string {
  if (!tenure) return '—';
  if (tenure.kind === 'new') return 'New';
  return formatRosterYears(tenure.years);
}

export function formatRosterPreviousLeagues(leagues: string[] | null | undefined): string {
  if (!leagues || leagues.length === 0) return '—';
  return leagues.join(', ');
}

export function previousSessionLeaguesColumnLabel(sessionName: string | null | undefined): string {
  const name = sessionName?.trim();
  return name ? `${name} leagues` : 'Previous session leagues';
}

export function buildLeagueRosterTsv(members: RosterExportMember[]): string {
  const previousSessionName = members.find((member) => member.previousSessionName)?.previousSessionName ?? null;
  const header = [
    'name',
    'email',
    'team',
    'totalYearsCurled',
    'clubTenure',
    previousSessionLeaguesColumnLabel(previousSessionName),
  ];

  const rows = members.map((member) =>
    [
      member.name,
      [member.email, member.parentEmail].filter(Boolean).join(' / '),
      member.assignedTeamName || '',
      member.totalExperienceYears == null ? '' : formatRosterYears(member.totalExperienceYears),
      !member.clubTenure ? '' : formatRosterClubTenure(member.clubTenure),
      (member.previousSessionLeagues ?? []).join(', '),
    ].map(toTsvCell),
  );

  return [header.join('\t'), ...rows.map((row) => row.join('\t'))].join('\n');
}
