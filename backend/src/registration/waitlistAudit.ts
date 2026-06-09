import { and, asc, eq } from 'drizzle-orm';
import { getDatabaseConfig } from '../db/config.js';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type {
  WaitlistAuditActionSqlite,
  WaitlistAuditSourceSqlite,
} from '../db/drizzle-schema.js';

type WaitlistAuditDb = ReturnType<typeof getDrizzleDb>['db'];
type WaitlistAuditSelectExecutor = Pick<WaitlistAuditDb, 'select'>;
type WaitlistAuditInsertExecutor = Pick<WaitlistAuditDb, 'insert' | 'select'>;
type WaitlistAuditMutateExecutor = Pick<WaitlistAuditDb, 'insert' | 'delete' | 'select'>;

type MemberNameRow = {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  email?: string | null;
};

type WaitlistEntryRow = {
  id: number;
  member_id: number;
  waitlist_id: number;
  status: string;
  position_sort_key: string;
  joined_at: string | Date;
  entry_type?: string;
  decline_count?: number;
  source_registration_id?: number | null;
};

export type WaitlistAuditInput = {
  waitlistEntryId?: number | null;
  leagueId?: number | null;
  memberId?: number | null;
  actorMemberId?: number | null;
  source: WaitlistAuditSourceSqlite;
  action: WaitlistAuditActionSqlite;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  memberName?: string | null;
  actorMemberName?: string | null;
  summary?: string | null;
  position?: number | null;
  queueTotal?: number | null;
  offerType?: string | null;
};

function dbJson(value: unknown): never {
  return (getDatabaseConfig()?.type === 'postgres' ? value : JSON.stringify(value)) as never;
}

function dbNow(): never {
  return (getDatabaseConfig()?.type === 'postgres' ? new Date() : new Date().toISOString()) as never;
}

export function waitlistMemberDisplayName(row: MemberNameRow | null | undefined): string {
  if (!row) return 'Unknown member';
  const parts = [row.first_name, row.last_name].map((part) => part?.trim()).filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : row.name?.trim() || row.email?.trim() || 'Unknown member';
}

export function waitlistRosterEntries(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function formatWaitlistTeamRosterDisplay(text: string | null | undefined): string | null {
  const names = waitlistRosterEntries(text);
  return names.length > 0 ? names.join(', ') : null;
}

function teamRosterTextFromAuditState(before?: unknown, after?: unknown): string | null {
  const extract = (value: unknown): string | null => {
    if (!value || typeof value !== 'object') return null;
    const text = (value as { team_roster_text?: string | null }).team_roster_text;
    return typeof text === 'string' && text.trim() ? text.trim() : null;
  };
  return extract(after) ?? extract(before) ?? null;
}

function teamRosterSummarySuffix(teamRosterText: string | null | undefined): string {
  const display = formatWaitlistTeamRosterDisplay(teamRosterText);
  return display ? ` · Team: ${display}` : '';
}

export function parseWaitlistAuditMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function formatWaitlistAuditSummary(input: {
  action: WaitlistAuditActionSqlite;
  memberName?: string | null;
  actorMemberName?: string | null;
  position?: number | null;
  queueTotal?: number | null;
  offerType?: string | null;
  movedToBottom?: boolean;
  teamRosterText?: string | null;
}): string | null {
  const memberName = input.memberName?.trim() || 'Unknown member';
  const actorName = input.actorMemberName?.trim() || null;
  const positionText =
    input.position != null && input.queueTotal != null
      ? ` (position #${input.position} of ${input.queueTotal})`
      : input.position != null
        ? ` (position #${input.position})`
        : '';
  const teamSuffix = teamRosterSummarySuffix(input.teamRosterText);

  switch (input.action) {
    case 'entry_removed':
      return `${memberName}${positionText} removed from waitlist${teamSuffix}`;
    case 'entry_created':
      return `${memberName}${positionText} added to waitlist${teamSuffix}`;
    case 'entry_reordered':
      return input.position != null
        ? `${memberName} moved to position #${input.position} on the waitlist${teamSuffix}`
        : `${memberName} reordered on the waitlist${teamSuffix}`;
    case 'entry_moved_to_bottom':
      return `${memberName} moved to the bottom of the waitlist${teamSuffix}`;
    case 'decline_count_changed':
      return `${memberName} declined a waitlist offer and kept their position${teamSuffix}`;
    case 'offer_sent': {
      const offerLabel =
        input.offerType === 'temporary_sabbatical_fill' ? 'temporary sabbatical-fill' : 'permanent';
      return `${offerLabel} waitlist offer sent to ${memberName}${teamSuffix}`;
    }
    case 'offer_accepted':
      return `${memberName} accepted a waitlist offer${teamSuffix}`;
    case 'entry_preference_skipped':
      return `${memberName} skipped because a higher-priority waitlist spot was accepted${teamSuffix}`;
    case 'offer_declined':
      return `${memberName} declined a waitlist offer${teamSuffix}`;
    case 'offer_expired_accepted':
      return `${memberName} auto-accepted a waitlist offer after 24 hours${teamSuffix}`;
    case 'offer_cancelled':
      return actorName
        ? `${actorName} cancelled a waitlist offer to ${memberName}${teamSuffix}`
        : `Waitlist offer to ${memberName} cancelled${teamSuffix}`;
    case 'entry_placed':
      return `${memberName} placed from the waitlist${teamSuffix}`;
    case 'entry_converted_add_to_replace':
      return `${memberName} waitlist entry converted from ADD to REPLACE${teamSuffix}`;
    case 'entry_converted_replace_to_add':
      return `${memberName} waitlist entry converted from REPLACE to ADD${teamSuffix}`;
    case 'replacement_league_changed':
      return `${memberName} replacement league updated on waitlist entry${teamSuffix}`;
    case 'entry_rolled_over':
      return `${memberName} waitlist entry rolled over to a successor league${teamSuffix}`;
    case 'staff_correction':
      return actorName
        ? `${actorName} corrected ${memberName}'s waitlist entry${teamSuffix}`
        : `${memberName}'s waitlist entry corrected${teamSuffix}`;
    default:
      return null;
  }
}

async function loadMemberName(tx: WaitlistAuditSelectExecutor, memberId: number | null | undefined): Promise<string | null> {
  if (memberId == null) return null;
  const { schema } = getDrizzleDb();
  const [member] = await tx
    .select({
      name: schema.members.name,
      first_name: schema.members.first_name,
      last_name: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.members)
    .where(eq(schema.members.id, memberId))
    .limit(1);
  return member ? waitlistMemberDisplayName(member) : null;
}

export async function getWaitlistQueuePosition(
  tx: WaitlistAuditSelectExecutor,
  waitlistId: number,
  entryId: number
): Promise<{ position: number; total: number } | null> {
  const { schema } = getDrizzleDb();
  const activeEntries = await tx
    .select({
      id: schema.waitlistEntries.id,
    })
    .from(schema.waitlistEntries)
    .where(and(eq(schema.waitlistEntries.waitlist_id, waitlistId), eq(schema.waitlistEntries.status, 'active')))
    .orderBy(
      asc(schema.waitlistEntries.position_sort_key),
      asc(schema.waitlistEntries.joined_at),
      asc(schema.waitlistEntries.id)
    );
  const index = activeEntries.findIndex((entry: { id: number }) => entry.id === entryId);
  if (index < 0) return null;
  return { position: index + 1, total: activeEntries.length };
}

export async function insertWaitlistAuditEvent(
  tx: WaitlistAuditInsertExecutor,
  input: WaitlistAuditInput
): Promise<void> {
  const { schema } = getDrizzleDb();
  const canResolveNames = typeof tx.select === 'function';
  const memberName =
    input.memberName?.trim() ||
    (canResolveNames && input.memberId != null ? await loadMemberName(tx, input.memberId) : null);
  const actorMemberName =
    input.actorMemberName?.trim() ||
    (canResolveNames && input.actorMemberId != null
      ? await loadMemberName(tx, input.actorMemberId)
      : null);

  const teamRosterText = teamRosterTextFromAuditState(input.before, input.after);
  const metadata: Record<string, unknown> = {
    ...(input.metadata ?? {}),
    ...(memberName ? { memberName } : {}),
    ...(actorMemberName ? { actorMemberName } : {}),
    ...(input.position != null ? { position: input.position } : {}),
    ...(input.queueTotal != null ? { queueTotal: input.queueTotal } : {}),
    ...(input.offerType ? { offerType: input.offerType } : {}),
    ...(teamRosterText ? { teamRosterText } : {}),
  };

  const summary =
    input.summary?.trim() ||
    formatWaitlistAuditSummary({
      action: input.action,
      memberName,
      actorMemberName,
      position: input.position,
      queueTotal: input.queueTotal,
      offerType: input.offerType,
      movedToBottom: input.metadata?.movedToBottom === true,
      teamRosterText,
    });

  if (summary) {
    metadata.summary = summary;
  }

  await tx.insert(schema.waitlistAuditEvents).values({
    waitlist_entry_id: input.waitlistEntryId ?? null,
    league_id: input.leagueId ?? null,
    member_id: input.memberId ?? null,
    actor_member_id: input.actorMemberId ?? null,
    source: input.source,
    action: input.action,
    reason: input.reason ?? null,
    before_json: dbJson(input.before ?? null),
    after_json: dbJson(input.after ?? null),
    metadata_json: dbJson(Object.keys(metadata).length > 0 ? metadata : null),
    created_at: dbNow(),
  });
}

export async function recordAndDeleteWaitlistEntry(
  tx: WaitlistAuditMutateExecutor,
  input: {
    entry: WaitlistEntryRow;
    leagueId?: number | null;
    actorMemberId?: number | null;
    source: WaitlistAuditSourceSqlite;
    reason: string;
    metadata?: Record<string, unknown>;
    memberName?: string | null;
    actorMemberName?: string | null;
  }
): Promise<void> {
  const { schema } = getDrizzleDb();
  const queuePosition = await getWaitlistQueuePosition(tx, input.entry.waitlist_id, input.entry.id);

  await insertWaitlistAuditEvent(tx, {
    waitlistEntryId: input.entry.id,
    leagueId: input.leagueId ?? null,
    memberId: input.entry.member_id,
    actorMemberId: input.actorMemberId ?? null,
    source: input.source,
    action: 'entry_removed',
    reason: input.reason,
    before: input.entry,
    after: null,
    metadata: {
      ...(input.metadata ?? {}),
      deletedEntryId: input.entry.id,
    },
    memberName: input.memberName,
    actorMemberName: input.actorMemberName,
    position: queuePosition?.position ?? null,
    queueTotal: queuePosition?.total ?? null,
  });

  await tx.delete(schema.waitlistEntries).where(eq(schema.waitlistEntries.id, input.entry.id));
}

function parseWaitlistAuditJson(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') return value as Record<string, unknown>;
  if (typeof value !== 'string') return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function serializeWaitlistAuditEvent(row: Record<string, unknown>) {
  const metadata = parseWaitlistAuditMetadata(row.metadata_json);
  const before = parseWaitlistAuditJson(row.before_json);
  const after = parseWaitlistAuditJson(row.after_json);
  const teamRosterText =
    (typeof metadata?.teamRosterText === 'string' ? metadata.teamRosterText : null) ??
    teamRosterTextFromAuditState(before, after);
  const storedSummary = typeof metadata?.summary === 'string' ? metadata.summary : null;
  let summary =
    storedSummary ??
    formatWaitlistAuditSummary({
      action: row.action as WaitlistAuditActionSqlite,
      memberName: typeof metadata?.memberName === 'string' ? metadata.memberName : null,
      actorMemberName: typeof metadata?.actorMemberName === 'string' ? metadata.actorMemberName : null,
      position: typeof metadata?.position === 'number' ? metadata.position : null,
      queueTotal: typeof metadata?.queueTotal === 'number' ? metadata.queueTotal : null,
      offerType: typeof metadata?.offerType === 'string' ? metadata.offerType : null,
      teamRosterText,
    });
  const teamSuffix = teamRosterSummarySuffix(teamRosterText);
  if (summary && teamSuffix && !summary.includes(' · Team: ')) {
    summary = `${summary}${teamSuffix}`;
  }
  return {
    id: row.id,
    action: row.action,
    reason: row.reason,
    created_at: row.created_at,
    summary,
    memberName: typeof metadata?.memberName === 'string' ? metadata.memberName : null,
    actorMemberName: typeof metadata?.actorMemberName === 'string' ? metadata.actorMemberName : null,
    teamRosterText,
    teamRosterDisplay: formatWaitlistTeamRosterDisplay(teamRosterText),
    metadata,
  };
}
