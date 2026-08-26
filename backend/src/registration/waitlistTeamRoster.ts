import { inArray } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { waitlistMemberDisplayName } from './waitlistAudit.js';
import { WaitlistStaffValidationError } from './waitlistErrors.js';
import { countPriorityRoster, expectedByotRosterSize, pendingRosterNames } from './leaguePriorityEvaluation.js';
import type { LeagueConfig } from './registrationContext.js';

/**
 * A teammate on a bring-your-own-team roster. Whether joining costs the member
 * another league is derived from their priority list at placement time, so a
 * placement is just an identity.
 */
export type WaitlistTeamMemberPlacementInput = {
  memberId: number;
};

export type WaitlistTeamMemberPlacement = WaitlistTeamMemberPlacementInput & {
  memberName: string;
};

function rosterFirstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

export function expectedByotRosterSizeFromFormat(format: LeagueConfig['format']): number | null {
  return expectedByotRosterSize({ format });
}

export function waitlistRosterEntries(text: string | null | undefined): string[] {
  return pendingRosterNames(text);
}

export function countHybridRoster(input: {
  placements?: WaitlistTeamMemberPlacementInput[] | null;
  pendingRosterText?: string | null;
  teamRosterText?: string | null;
  primaryMemberId?: number | null;
}): { memberCount: number; pendingCount: number; total: number } {
  if ((input.placements?.length ?? 0) === 0 && input.teamRosterText?.trim()) {
    const legacyNames = waitlistRosterEntries(input.teamRosterText);
    return { memberCount: legacyNames.length, pendingCount: 0, total: legacyNames.length };
  }
  return countPriorityRoster(
    { teamRosterPlacements: input.placements ?? null, byotTeammateText: input.pendingRosterText ?? null },
    input.primaryMemberId,
  );
}

/**
 * Registration stores teammates only; the registrant always occupies a roster
 * spot. Waitlist persistence expects the primary member on the placement list,
 * so add them when they were omitted.
 */
export function includePrimaryMemberOnWaitlistRoster(
  placements: WaitlistTeamMemberPlacementInput[],
  primaryMemberId: number,
): WaitlistTeamMemberPlacementInput[] {
  if (placements.some((placement) => placement.memberId === primaryMemberId)) {
    return placements;
  }
  return [{ memberId: primaryMemberId }, ...placements];
}

export function waitlistEntryRosterMemberIds(entry: {
  member_id?: number;
  memberId?: number;
  team_roster_placements?: string | null;
  teamRosterPlacements?: string | null;
}): number[] {
  const primaryMemberId = entry.member_id ?? entry.memberId;
  if (primaryMemberId == null) return [];
  const placements = parseTeamRosterPlacements(entry.team_roster_placements ?? entry.teamRosterPlacements);
  return [...new Set(includePrimaryMemberOnWaitlistRoster(placements, primaryMemberId).map((placement) => placement.memberId))];
}

export function parseTeamRosterPlacements(raw: string | null | undefined): WaitlistTeamMemberPlacementInput[] {
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<number>();
    const placements: WaitlistTeamMemberPlacementInput[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== 'object') continue;
      const memberId = Number((item as { memberId?: unknown }).memberId);
      if (!Number.isFinite(memberId) || seen.has(memberId)) continue;
      seen.add(memberId);
      placements.push({ memberId });
    }
    return placements;
  } catch {
    return [];
  }
}

export function serializeTeamRosterPlacements(placements: WaitlistTeamMemberPlacementInput[]): string {
  return JSON.stringify(placements.map((placement) => ({ memberId: placement.memberId })));
}

export function buildTeamRosterText(memberNames: string[]): string {
  const sorted = [...memberNames].sort((left, right) =>
    rosterFirstName(left).localeCompare(rosterFirstName(right), undefined, { sensitivity: 'base' }),
  );
  return sorted.join('\n');
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

export async function normalizeAndValidateTeamRosterPlacements(input: {
  league: { league_type: string; format: LeagueConfig['format'] };
  primaryMemberId: number;
  sessionId: number;
  placements?: WaitlistTeamMemberPlacementInput[] | null;
  teamRosterText?: string | null;
  pendingRosterText?: string | null;
}): Promise<{
  placements: WaitlistTeamMemberPlacementInput[];
  teamRosterText: string;
}> {
  if (input.league.league_type !== 'bring_your_own_team') {
    throw new WaitlistStaffValidationError({
      teamRosterPlacements: 'Team roster placements apply only to bring-your-own-team waitlists.',
    });
  }

  const expectedSize = expectedByotRosterSizeFromFormat(input.league.format);
  let placements: WaitlistTeamMemberPlacementInput[] = (input.placements ?? []).map((placement) => ({
    memberId: placement.memberId,
  }));

  const pendingNames = waitlistRosterEntries(input.pendingRosterText);

  if (placements.length === 0 && input.teamRosterText?.trim()) {
    const names = waitlistRosterEntries(input.teamRosterText);
    const nameRows = await loadMemberNamesByNames(names);
    placements = names
      .map((name): WaitlistTeamMemberPlacementInput | null => {
        const memberId = nameRows.get(name.trim().toLowerCase());
        return memberId == null ? null : { memberId };
      })
      .filter((item): item is WaitlistTeamMemberPlacementInput => item != null);
  }

  if (placements.length > 0 || pendingNames.length > 0) {
    placements = includePrimaryMemberOnWaitlistRoster(placements, input.primaryMemberId);
  }

  const rosterCounts = countHybridRoster({
    placements,
    pendingRosterText: placements.length > 0 ? input.pendingRosterText : null,
    teamRosterText: placements.length === 0 ? input.teamRosterText : null,
    primaryMemberId: input.primaryMemberId,
  });

  if (expectedSize == null || rosterCounts.total !== expectedSize) {
    throw new WaitlistStaffValidationError({
      teamRosterPlacements:
        expectedSize == null
          ? 'Bring-your-own-team waitlists require a full team roster.'
          : `Bring-your-own-team waitlists require exactly ${expectedSize} players with placement details.`,
    });
  }

  if (pendingNames.length > 0) {
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

  const { db, schema } = getDrizzleDb();
  const sessionMembers = await db
    .select({ id: schema.members.id })
    .from(schema.members)
    .where(inArray(schema.members.id, memberIds));
  if (sessionMembers.length !== memberIds.length) {
    throw new WaitlistStaffValidationError({
      teamRosterPlacements: 'One or more selected teammates could not be found.',
    });
  }

  const memberNames = await loadMemberNames(memberIds);
  const teamRosterText = buildTeamRosterText([
    ...placements
      .map((placement) => memberNames.get(placement.memberId))
      .filter((name): name is string => Boolean(name)),
    ...pendingNames,
  ]);

  return { placements, teamRosterText };
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
  teamRosterPlacementsJson: string | null | undefined;
  teamRosterText: string | null | undefined;
}): Promise<WaitlistTeamMemberPlacement[]> {
  const parsed = parseTeamRosterPlacements(input.teamRosterPlacementsJson);
  if (parsed.length > 0) {
    return enrichTeamRosterPlacements(includePrimaryMemberOnWaitlistRoster(parsed, input.primaryMemberId));
  }

  const names = waitlistRosterEntries(input.teamRosterText);
  if (names.length === 0) return [];
  const nameRows = await loadMemberNamesByNames(names);
  const fallbackPlacements = names
    .map((name): WaitlistTeamMemberPlacementInput | null => {
      const memberId = nameRows.get(name.trim().toLowerCase());
      return memberId == null ? null : { memberId };
    })
    .filter((item): item is WaitlistTeamMemberPlacementInput => item != null);

  return enrichTeamRosterPlacements(
    includePrimaryMemberOnWaitlistRoster(fallbackPlacements, input.primaryMemberId),
  );
}

export function formatTeamRosterPlacementsDisplay(placements: WaitlistTeamMemberPlacement[]): string | null {
  if (placements.length === 0) return null;
  return [...placements]
    .sort((left, right) =>
      rosterFirstName(left.memberName).localeCompare(rosterFirstName(right.memberName), undefined, {
        sensitivity: 'base',
      }),
    )
    .map((placement) => placement.memberName)
    .join(', ');
}