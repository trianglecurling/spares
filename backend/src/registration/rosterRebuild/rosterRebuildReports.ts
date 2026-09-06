import fs from 'node:fs';
import path from 'node:path';
import { toCsv } from '../registrationStaffExport.js';
import { rosterKey } from './rosterRebuildEngine.js';
import type {
  LeagueVacancySnapshot,
  RosterDiffRow,
  RosterRebuildLeague,
  RosterRebuildMember,
  RosterRebuildNote,
  RosterRebuildPlacement,
  RosterRebuildResult,
  RosterRebuildRosterRow,
  RosterRebuildSabbaticalMutation,
  RosterRebuildWaitlistEvent,
} from './rosterRebuildTypes.js';

export const PLACEMENT_CSV_HEADERS = [
  'sequence',
  'stage',
  'pass',
  'league_id',
  'league_name',
  'member_id',
  'member_name',
  'member_email',
  'placement_type',
  'reason',
  'source_registration_id',
  'waitlist_entry_id',
  'is_temporary_sabbatical_fill',
  'related_sabbatical_id',
];

export const WAITLIST_EVENT_CSV_HEADERS = [
  'pass',
  'league_id',
  'league_name',
  'position',
  'entry_id',
  'member_id',
  'member_name',
  'preference',
  'outcome',
  'decline_count_before',
  'decline_count_after',
  'immune',
  'reason',
];

export const SABBATICAL_CSV_HEADERS = [
  'member_id',
  'member_name',
  'league_id',
  'league_name',
  'replaced_by_league_id',
  'replaced_by_league_name',
  'source_registration_id',
  'waitlist_entry_id',
  'reason',
];

export const PREFLIGHT_CSV_HEADERS = ['kind', 'league_id', 'league_name', 'member_id', 'member_name', 'detail'];

export const EXPORT_CSV_HEADERS = [
  'league_id',
  'league_name',
  'member_id',
  'member_name',
  'member_email',
  'status',
  'placement_type',
  'is_temporary_sabbatical_fill',
  'related_sabbatical_id',
  'source_registration_id',
  'created_at',
];

export const DIFF_CSV_HEADERS = [
  'change',
  'league_id',
  'league_name',
  'member_id',
  'member_name',
  'member_email',
  'stage',
  'reason',
];

function cell(value: string | number | boolean | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

function leagueName(leagues: RosterRebuildLeague[], leagueId: number | undefined): string {
  if (leagueId == null) return '';
  return leagues.find((league) => league.id === leagueId)?.name ?? '';
}

function memberInfo(
  members: Map<number, RosterRebuildMember>,
  memberId: number | undefined,
): { name: string; email: string } {
  if (memberId == null) return { name: '', email: '' };
  const member = members.get(memberId);
  return { name: member?.name ?? '', email: member?.email ?? '' };
}

export function placementsToCsv(
  placements: RosterRebuildPlacement[],
  leagues: RosterRebuildLeague[],
  members: Map<number, RosterRebuildMember>,
): string {
  return toCsv(
    PLACEMENT_CSV_HEADERS,
    placements.map((row) => {
      const member = memberInfo(members, row.memberId);
      return [
        cell(row.sequence),
        cell(row.stage),
        cell(row.pass),
        cell(row.leagueId),
        leagueName(leagues, row.leagueId),
        cell(row.memberId),
        member.name,
        member.email,
        cell(row.placementType),
        row.reason,
        cell(row.sourceRegistrationId),
        cell(row.waitlistEntryId),
        cell(row.isTemporarySabbaticalFill),
        cell(row.relatedSabbaticalId),
      ];
    }),
  );
}

export function waitlistEventsToCsv(
  events: RosterRebuildWaitlistEvent[],
  leagues: RosterRebuildLeague[],
  members: Map<number, RosterRebuildMember>,
): string {
  return toCsv(
    WAITLIST_EVENT_CSV_HEADERS,
    events.map((row) => {
      const member = memberInfo(members, row.memberId);
      return [
        cell(row.pass),
        cell(row.leagueId),
        leagueName(leagues, row.leagueId),
        cell(row.position),
        cell(row.entryId),
        cell(row.memberId),
        member.name,
        cell(row.preference),
        cell(row.outcome),
        cell(row.declineCountBefore),
        cell(row.declineCountAfter),
        cell(row.immune),
        row.reason,
      ];
    }),
  );
}

export function sabbaticalsToCsv(
  mutations: RosterRebuildSabbaticalMutation[],
  leagues: RosterRebuildLeague[],
  members: Map<number, RosterRebuildMember>,
): string {
  return toCsv(
    SABBATICAL_CSV_HEADERS,
    mutations.map((row) => {
      const member = memberInfo(members, row.memberId);
      return [
        cell(row.memberId),
        member.name,
        cell(row.leagueId),
        leagueName(leagues, row.leagueId),
        cell(row.replacedByLeagueId),
        leagueName(leagues, row.replacedByLeagueId),
        cell(row.sourceRegistrationId),
        cell(row.waitlistEntryId),
        row.reason,
      ];
    }),
  );
}

export function preflightToCsv(
  notes: RosterRebuildNote[],
  leagues: RosterRebuildLeague[],
  members: Map<number, RosterRebuildMember>,
): string {
  return toCsv(
    PREFLIGHT_CSV_HEADERS,
    notes.map((row) => [
      cell(row.code),
      cell(row.leagueId),
      leagueName(leagues, row.leagueId),
      cell(row.memberId),
      memberInfo(members, row.memberId).name,
      row.detail,
    ]),
  );
}

export function rosterExportToCsv(
  rows: Array<
    RosterRebuildRosterRow & {
      leagueName: string;
      memberName: string;
      memberEmail: string;
    }
  >,
): string {
  const sorted = [...rows].sort((a, b) => a.leagueId - b.leagueId || a.memberId - b.memberId);
  return toCsv(
    EXPORT_CSV_HEADERS,
    sorted.map((row) => [
      cell(row.leagueId),
      row.leagueName,
      cell(row.memberId),
      row.memberName,
      row.memberEmail,
      cell(row.status),
      cell(row.placementType),
      cell(row.isTemporarySabbaticalFill),
      cell(row.relatedSabbaticalId),
      cell(row.sourceRegistrationId),
      cell(row.createdAt),
    ]),
  );
}

export function rosterDiffToCsv(
  rows: RosterDiffRow[],
  leagues: RosterRebuildLeague[],
  members: Map<number, RosterRebuildMember>,
): string {
  return toCsv(
    DIFF_CSV_HEADERS,
    rows.map((row) => {
      const member = memberInfo(members, row.memberId);
      return [
        cell(row.change),
        cell(row.leagueId),
        leagueName(leagues, row.leagueId),
        cell(row.memberId),
        member.name,
        member.email,
        cell(row.stage),
        row.reason ?? '',
      ];
    }),
  );
}

export function buildSummaryMarkdown(input: {
  command: string;
  sessionName: string;
  applied: boolean;
  leagues: RosterRebuildLeague[];
  result?: RosterRebuildResult | null;
  vacancies?: LeagueVacancySnapshot[];
  extraLines?: string[];
}): string {
  const lines: string[] = [
    `# Roster rebuild ${input.command}`,
    '',
    `- Session: ${input.sessionName}`,
    `- Applied: ${input.applied ? 'yes' : 'no (dry run)'}`,
  ];
  if (input.result?.randomSeed != null) lines.push(`- Random seed: ${input.result.randomSeed}`);
  if (input.result) {
    lines.push(`- Placements: ${input.result.placements.length}`);
    lines.push(`- Waitlist events: ${input.result.waitlistEvents.length}`);
    lines.push(`- Fallback sabbaticals: ${input.result.sabbaticalMutations.length}`);
    lines.push(`- Halted leagues: ${input.result.haltedLeagueIds.join(', ') || '(none)'}`);
  }
  lines.push('', '## Leagues', '');
  lines.push('| id | name | category | capacity | waitlist | predecessor |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const league of input.leagues) {
    lines.push(
      `| ${league.id} | ${league.name} | ${league.category} | ${league.capacityValue} | ${league.waitlistId ?? ''} | ${league.predecessorName ?? league.predecessorLeagueId ?? ''} |`,
    );
  }
  const vacancies = input.vacancies ?? input.result?.leagueVacancies ?? [];
  if (vacancies.length > 0) {
    lines.push('', '## Vacancies', '');
    lines.push('| league | capacity | rostered | holds | sabbaticals | permanent | temporary | vacancy |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const row of vacancies) {
      const league = input.leagues.find((item) => item.id === row.leagueId);
      lines.push(
        `| ${league?.name ?? row.leagueId} | ${row.capacity} | ${row.rostered} | ${row.holds} | ${row.sabbaticals} | ${row.permanentVacancy} | ${row.temporaryVacancy} | ${row.vacancy} |`,
      );
    }
  }
  if (input.result?.sabbaticalMutations.length) {
    lines.push('', '## Fallback sabbaticals', '');
    for (const row of input.result.sabbaticalMutations) {
      const fromLeague = input.leagues.find((item) => item.id === row.leagueId);
      const toLeague = input.leagues.find((item) => item.id === row.replacedByLeagueId);
      lines.push(
        `- Member ${row.memberId}: sabbatical on ${fromLeague?.name ?? row.leagueId} after taking temporary ${toLeague?.name ?? row.replacedByLeagueId}.`,
      );
    }
  }
  if (input.result?.notes.length) {
    lines.push('', '## Notes', '');
    for (const note of input.result.notes) {
      lines.push(`- \`${note.code}\`${note.leagueId != null ? ` league ${note.leagueId}` : ''}${note.memberId != null ? ` member ${note.memberId}` : ''}: ${note.detail}`);
    }
  }
  if (input.extraLines?.length) {
    lines.push('', '## Other', '');
    for (const line of input.extraLines) lines.push(`- ${line}`);
  }
  lines.push('');
  return lines.join('\n');
}

export function writeTextFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, 'utf8');
}

export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows: string[][] = [];
  let current: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i += 1) {
    const ch = normalized[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (normalized[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      continue;
    }
    if (ch === ',') {
      current.push(field);
      field = '';
      continue;
    }
    if (ch === '\n') {
      current.push(field);
      field = '';
      if (current.some((cellValue) => cellValue.length > 0)) rows.push(current);
      current = [];
      continue;
    }
    field += ch;
  }
  if (field.length > 0 || current.length > 0) {
    current.push(field);
    if (current.some((cellValue) => cellValue.length > 0)) rows.push(current);
  }
  const headers = rows.shift() ?? [];
  return { headers, rows };
}

export function parseRosterExportCsv(text: string): Array<{
  leagueId: number;
  memberId: number;
  leagueName: string;
  memberName: string;
  memberEmail: string;
  status: string;
}> {
  const { headers, rows } = parseCsv(text);
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  return rows.map((row) => ({
    leagueId: Number(row[index.league_id] ?? 0),
    memberId: Number(row[index.member_id] ?? 0),
    leagueName: row[index.league_name] ?? '',
    memberName: row[index.member_name] ?? '',
    memberEmail: row[index.member_email] ?? '',
    status: row[index.status] ?? '',
  }));
}

export function parsePlacementReasonsCsv(text: string): Map<string, { reason: string; stage: string | null }> {
  const { headers, rows } = parseCsv(text);
  const index = Object.fromEntries(headers.map((header, i) => [header, i]));
  const map = new Map<string, { reason: string; stage: string | null }>();
  for (const row of rows) {
    const leagueId = Number(row[index.league_id] ?? 0);
    const memberId = Number(row[index.member_id] ?? 0);
    if (!leagueId || !memberId) continue;
    map.set(rosterKey(leagueId, memberId), {
      reason: row[index.reason] ?? '',
      stage: row[index.stage] ?? null,
    });
  }
  return map;
}

export function collectPlacementReasons(runRoot: string): Map<string, { reason: string; stage: string | null }> {
  const combined = new Map<string, { reason: string; stage: string | null }>();
  if (!fs.existsSync(runRoot)) return combined;
  const entries = fs.readdirSync(runRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(runRoot, entry.name, 'placements.csv');
    if (!fs.existsSync(filePath)) continue;
    const reasons = parsePlacementReasonsCsv(fs.readFileSync(filePath, 'utf8'));
    for (const [key, value] of reasons) combined.set(key, value);
  }
  return combined;
}

export function findLatestRosterExport(runRoot: string): string | null {
  if (!fs.existsSync(runRoot)) return null;
  const matches: Array<{ path: string; mtime: number }> = [];
  for (const entry of fs.readdirSync(runRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(runRoot, entry.name, 'rosters-export.csv');
    if (!fs.existsSync(filePath)) continue;
    matches.push({ path: filePath, mtime: fs.statSync(filePath).mtimeMs });
  }
  matches.sort((a, b) => b.mtime - a.mtime);
  return matches[0]?.path ?? null;
}
