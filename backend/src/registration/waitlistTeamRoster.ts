import { eq, inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { WaitlistEntryTypeSqlite } from '../db/drizzle-schema.js';
import { waitlistMemberDisplayName } from './waitlistAudit.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';

export type WaitlistTeamMemberPlacementInput = {
  memberId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId?: number | null;
};

export type WaitlistTeamMemberPlacement = WaitlistTeamMemberPlacementInput & {
  memberName: string;
};

type LeagueFormat = 'teams' | 'doubles' | 'instructional';

function rosterFirstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

export function expectedByotRosterSizeFromFormat(format: string): number | null {
  if (format === 'teams') return 4;
  if (format === 'doubles') return 2;
  return null;
}

export function waitlistRosterEntries(text: string | null | undefined): string[] {
  return (text ?? '')
    .split(/[\n,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function countHybridRoster(input: {
  placements?: WaitlistTeamMemberPlacementInput[] | null;
  pendingRosterText?: string | null;
  teamRosterText?: string | null;
  primaryMemberId?: number | null;
  expectedSize?: number | null;
}): { memberCount: number; pendingCount: number; total: number } {
  const placements = input.placements ?? [];
  const pendingNames = waitlistRosterEntries(input.pendingRosterText);
  if (placements.length > 0) {
    return {
      memberCount: placements.length,
      pendingCount: pendingNames.length,
      total: placements.length + pendingNames.length,
    };
  }
  const legacyNames = waitlistRosterEntries(input.teamRosterText);
  if (legacyNames.length > 0) {
    return { memberCount: legacyNames.length, pendingCount: 0, total: legacyNames.length };
  }
  if (
    input.expectedSize != null &&
    pendingNames.length === input.expectedSize
  ) {
    return { memberCount: pendingNames.length, pendingCount: 0, total: pendingNames.length };
  }
  if (
    input.primaryMemberId != null &&
    input.expectedSize != null &&
    pendingNames.length > 0 &&
    pendingNames.length + 1 === input.expectedSize
  ) {
    return { memberCount: 1, pendingCount: pendingNames.length, total: input.expectedSize };
  }
  return { memberCount: 0, pendingCount: pendingNames.length, total: pendingNames.length };
}

export function parseTeamRosterPlacements(raw: string | null | undefined): WaitlistTeamMemberPlacementInput[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        if (!item || typeof item !== 'object') return null;
        const memberId = Number((item as { memberId?: unknown }).memberId);
        const entryType = (item as { entryType?: unknown }).entryType;
        if (!Number.isFinite(memberId) || (entryType !== 'add' && entryType !== 'replace')) return null;
        const replacesLeagueIdRaw = (item as { replacesLeagueId?: unknown }).replacesLeagueId;
        const replacesLeagueId =
          replacesLeagueIdRaw == null || replacesLeagueIdRaw === ''
            ? null
            : Number.isFinite(Number(replacesLeagueIdRaw))
              ? Number(replacesLeagueIdRaw)
              : null;
        return {
          memberId,
          entryType,
          replacesLeagueId,
        } satisfies WaitlistTeamMemberPlacementInput;
      })
      .filter((item): item is WaitlistTeamMemberPlacementInput => item != null);
  } catch {
    return [];
  }
}

export function serializeTeamRosterPlacements(placements: WaitlistTeamMemberPlacementInput[]): string {
  return JSON.stringify(
    placements.map((placement) => ({
      memberId: placement.memberId,
      entryType: placement.entryType,
      replacesLeagueId: placement.replacesLeagueId ?? null,
    })),
  );
}

export function buildTeamRosterText(memberNames: string[]): string {
  const sorted = [...memberNames].sort((left, right) =>
    rosterFirstName(left).localeCompare(rosterFirstName(right), undefined, { sensitivity: 'base' }),
  );
  return sorted.join('\n');
}

export function derivePrimaryEntryFields(
  primaryMemberId: number,
  placements: WaitlistTeamMemberPlacementInput[],
): { entryType: WaitlistEntryTypeSqlite; replacesLeagueId: number | null } {
  const primary = placements.find((placement) => placement.memberId === primaryMemberId);
  if (!primary) {
    return { entryType: 'add', replacesLeagueId: null };
  }
  return {
    entryType: primary.entryType,
    replacesLeagueId: primary.entryType === 'replace' ? primary.replacesLeagueId ?? null : null,
  };
}

async function loadMemberNames(memberIds: number[]): Promise<Map<number, string>> {
  if (memberIds.length === 0) return new Map();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.members)
    .where(inArray(schema.members.id, memberIds));
  return new Map(
    rows.map((row) => [
      row.id,
      waitlistMemberDisplayName({
        name: row.name,
        first_name: row.firstName,
        last_name: row.lastName,
        email: row.email,
      }),
    ]),
  );
}

export async function enrichTeamRosterPlacements(
  placements: WaitlistTeamMemberPlacementInput[],
): Promise<WaitlistTeamMemberPlacement[]> {
  const names = await loadMemberNames(placements.map((placement) => placement.memberId));
  return placements.map((placement) => ({
    ...placement,
    memberName: names.get(placement.memberId) ?? `Member #${placement.memberId}`,
  }));
}

type MemberLeagueHold = {
  leagueId: number;
  leagueName: string;
  format: LeagueFormat;
};

function countsTowardAddWaitlistLimit(format: LeagueFormat): boolean {
  return format !== 'instructional';
}

function countLeaguesForAddLimit(holds: MemberLeagueHold[]): number {
  return holds.filter((hold) => countsTowardAddWaitlistLimit(hold.format)).length;
}

export async function normalizeAndValidateTeamRosterPlacements(input: {
  league: { league_type: string; format: string };
  primaryMemberId: number;
  sessionId: number;
  placements?: WaitlistTeamMemberPlacementInput[] | null;
  fallbackEntryType?: WaitlistEntryTypeSqlite;
  fallbackReplacesLeagueId?: number | null;
  teamRosterText?: string | null;
  pendingRosterText?: string | null;
  enforceMemberPlacementRules: boolean;
}): Promise<{
  placements: WaitlistTeamMemberPlacementInput[];
  teamRosterText: string;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId: number | null;
}> {
  if (input.league.league_type !== 'bring_your_own_team') {
    throw new WaitlistStaffValidationError({
      teamRosterPlacements: 'Team roster placements apply only to bring-your-own-team waitlists.',
    });
  }

  const expectedSize = expectedByotRosterSizeFromFormat(input.league.format);
  let placements = (input.placements ?? []).map((placement) => ({
    memberId: placement.memberId,
    entryType: placement.entryType,
    replacesLeagueId: placement.entryType === 'replace' ? placement.replacesLeagueId ?? null : null,
  }));

  const pendingNames = waitlistRosterEntries(input.pendingRosterText);

  if (placements.length === 0 && input.teamRosterText?.trim()) {
    const names = waitlistRosterEntries(input.teamRosterText);
    const nameRows = await loadMemberNamesByNames(names);
    const fallbackEntryType = input.fallbackEntryType ?? 'add';
    const fallbackReplacesLeagueId =
      fallbackEntryType === 'replace' ? input.fallbackReplacesLeagueId ?? null : null;
    placements = names
      .map((name) => {
        const memberId = nameRows.get(name.trim().toLowerCase());
        if (memberId == null) return null;
        return {
          memberId,
          entryType: fallbackEntryType,
          replacesLeagueId: fallbackReplacesLeagueId,
        };
      })
      .filter((item): item is WaitlistTeamMemberPlacementInput => item != null);
  }

  const rosterCounts = countHybridRoster({
    placements,
    pendingRosterText: placements.length > 0 ? input.pendingRosterText : null,
    teamRosterText: placements.length === 0 ? input.teamRosterText : null,
  });

  if (expectedSize == null || rosterCounts.total !== expectedSize) {
    throw new WaitlistStaffValidationError({
      teamRosterPlacements:
        expectedSize == null
          ? 'BYOT waitlists require a full team roster.'
          : `BYOT waitlists require exactly ${expectedSize} players with placement details.`,
    });
  }

  if (pendingNames.length > 0) {
    if (pendingNames.some((name) => !name.trim())) {
      throw new WaitlistStaffValidationError({
        teamRosterPlacements: 'Each pending teammate must have a name.',
      });
    }
    const pendingLower = pendingNames.map((name) => name.trim().toLowerCase());
    if (new Set(pendingLower).size !== pendingLower.length) {
      throw new WaitlistStaffValidationError({
        teamRosterPlacements: 'Pending teammate names must be unique.',
      });
    }
  }

  const memberIds = placements.map((placement) => placement.memberId);
  if (new Set(memberIds).size !== memberIds.length) {
    throw new WaitlistStaffValidationError({
      teamRosterPlacements: 'Each team member may appear only once on the roster.',
    });
  }

  if (!memberIds.includes(input.primaryMemberId)) {
    throw new WaitlistStaffValidationError({
      teamRosterPlacements: 'The waitlist entry member must be included on the team roster.',
    });
  }

  for (const placement of placements) {
    if (placement.entryType === 'replace' && !placement.replacesLeagueId) {
      throw new WaitlistStaffValidationError({
        teamRosterPlacements: 'Each REPLACE team member must identify a league to replace.',
      });
    }
  }

  if (input.enforceMemberPlacementRules) {
    const { getTeamMemberPlacementOptions } = await import('./memberWaitlistJoinService.js');
    const options = await getTeamMemberPlacementOptions(input.sessionId, memberIds);
    for (const placement of placements) {
      const memberOptions = options[placement.memberId];
      if (!memberOptions) {
        throw new WaitlistStaffValidationError({
          teamRosterPlacements: `Unable to load placement options for member #${placement.memberId}.`,
        });
      }
      if (placement.entryType === 'add' && !memberOptions.addAvailable) {
        throw new WaitlistStaffValidationError({
          teamRosterPlacements:
            memberOptions.addBlockedReason ??
            `${memberOptions.memberName} is not eligible for an ADD waitlist entry.`,
        });
      }
      if (placement.entryType === 'replace') {
        if (!placement.replacesLeagueId) {
          throw new WaitlistStaffValidationError({
            teamRosterPlacements: 'Each REPLACE team member must identify a league to replace.',
          });
        }
        if (!memberOptions.replacementLeagues.some((league) => league.id === placement.replacesLeagueId)) {
          throw new WaitlistStaffValidationError({
            teamRosterPlacements: `${memberOptions.memberName} must select a league they currently hold.`,
          });
        }
        if (memberOptions.activeReplaceWaitlists >= 2) {
          throw new WaitlistStaffValidationError({
            teamRosterPlacements: `${memberOptions.memberName} may have at most two active REPLACE waitlists.`,
          });
        }
      }
    }
  } else {
    const { db, schema } = getDrizzleDb();
    const sessionLeagues = await db
      .select({ id: schema.leagues.id })
      .from(schema.leagues)
      .where(eq(schema.leagues.session_id, input.sessionId));
    const sessionLeagueIds = new Set(sessionLeagues.map((league) => league.id));
    for (const placement of placements) {
      if (
        placement.entryType === 'replace' &&
        placement.replacesLeagueId &&
        !sessionLeagueIds.has(placement.replacesLeagueId)
      ) {
        throw new WaitlistStaffValidationError({
          teamRosterPlacements: 'Replacement leagues must belong to the current session.',
        });
      }
    }
  }

  const memberNames = await loadMemberNames(memberIds);
  const teamRosterText = buildTeamRosterText([
    ...placements
      .map((placement) => memberNames.get(placement.memberId))
      .filter((name): name is string => Boolean(name)),
    ...pendingNames,
  ]);
  const { entryType, replacesLeagueId } = derivePrimaryEntryFields(input.primaryMemberId, placements);

  return {
    placements,
    teamRosterText,
    entryType,
    replacesLeagueId,
  };
}

async function loadMemberNamesByNames(names: string[]): Promise<Map<string, number>> {
  if (names.length === 0) return new Map();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      id: schema.members.id,
      name: schema.members.name,
      firstName: schema.members.first_name,
      lastName: schema.members.last_name,
      email: schema.members.email,
    })
    .from(schema.members);
  const byName = new Map<string, number>();
  for (const row of rows) {
    const displayName = waitlistMemberDisplayName({
      name: row.name,
      first_name: row.firstName,
      last_name: row.lastName,
      email: row.email,
    });
    byName.set(displayName.trim().toLowerCase(), row.id);
  }
  return byName;
}

export async function hydrateTeamRosterPlacementsForEntry(input: {
  primaryMemberId: number;
  entryType: WaitlistEntryTypeSqlite;
  replacesLeagueId: number | null;
  teamRosterPlacementsJson: string | null | undefined;
  teamRosterText: string | null | undefined;
}): Promise<WaitlistTeamMemberPlacement[]> {
  const parsed = parseTeamRosterPlacements(input.teamRosterPlacementsJson);
  if (parsed.length > 0) {
    return enrichTeamRosterPlacements(parsed);
  }

  const names = waitlistRosterEntries(input.teamRosterText);
  if (names.length === 0) return [];
  const nameRows = await loadMemberNamesByNames(names);
  const fallbackPlacements = names
    .map((name) => {
      const memberId = nameRows.get(name.trim().toLowerCase());
      if (memberId == null) return null;
      return {
        memberId,
        entryType: input.entryType,
        replacesLeagueId: input.entryType === 'replace' ? input.replacesLeagueId : null,
      } satisfies WaitlistTeamMemberPlacementInput;
    })
    .filter((item): item is WaitlistTeamMemberPlacementInput => item != null);

  if (!fallbackPlacements.some((placement) => placement.memberId === input.primaryMemberId) && names.length > 0) {
    const primaryName = names.find((name) => nameRows.get(name.trim().toLowerCase()) === input.primaryMemberId);
    if (primaryName) {
      // already included via name match
    } else {
      fallbackPlacements.unshift({
        memberId: input.primaryMemberId,
        entryType: input.entryType,
        replacesLeagueId: input.entryType === 'replace' ? input.replacesLeagueId : null,
      });
    }
  }

  return enrichTeamRosterPlacements(fallbackPlacements);
}

export function formatTeamRosterPlacementsDisplay(placements: WaitlistTeamMemberPlacement[]): string | null {
  if (placements.length === 0) return null;
  const sorted = [...placements].sort((left, right) =>
    rosterFirstName(left.memberName).localeCompare(rosterFirstName(right.memberName), undefined, {
      sensitivity: 'base',
    }),
  );
  return sorted
    .map((placement) => {
      const typeLabel = placement.entryType === 'replace' ? 'REPLACE' : 'ADD';
      const leagueSuffix =
        placement.entryType === 'replace' && placement.replacesLeagueId != null
          ? ` (#${placement.replacesLeagueId})`
          : '';
      return `${placement.memberName} (${typeLabel}${leagueSuffix})`;
    })
    .join(', ');
}
