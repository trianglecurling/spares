import { and, eq, inArray, ne } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';

/**
 * A priority listing holds a vacancy when it is one of the leagues the
 * registrant actually wants. Backups below the desired count do not reserve
 * space. A missing count still holds, so an unfinished desired-count answer
 * cannot hide demand.
 */
export function priorityListingEarnsVacancyHold(input: {
  priorityRank: number;
  desiredLeagueCount: number | null | undefined;
}): boolean {
  if (input.desiredLeagueCount == null) return true;
  return input.priorityRank <= input.desiredLeagueCount;
}

export function earmarkedDemandHolderKey(input: {
  registrationId: number;
  memberId: number | null;
}): string {
  return input.memberId != null ? `member:${input.memberId}` : `registration:${input.registrationId}`;
}

export type EarmarkedDemandListing = {
  leagueId: number;
  registrationId: number;
  memberId: number | null;
  priorityRank: number;
  desiredLeagueCount: number | null;
};

export type OccupiedVacancyHolders = {
  rosteredMemberIdsByLeagueId: ReadonlyMap<number, ReadonlySet<number>>;
  waitlistedMemberIdsByLeagueId: ReadonlyMap<number, ReadonlySet<number>>;
  waitlistedRegistrationIdsByLeagueId: ReadonlyMap<number, ReadonlySet<number>>;
};

/**
 * Counts people who have already asked for a league but are not on its roster
 * or waitlist. Those listings would otherwise be invisible to vacancy math and
 * make a full program look Available.
 */
export function countEarmarkedRegistrationDemand(
  listings: readonly EarmarkedDemandListing[],
  occupied: OccupiedVacancyHolders,
): Map<number, number> {
  const holdersByLeague = new Map<number, Set<string>>();
  for (const listing of listings) {
    if (!priorityListingEarnsVacancyHold(listing)) continue;
    const rostered = occupied.rosteredMemberIdsByLeagueId.get(listing.leagueId);
    if (listing.memberId != null && rostered?.has(listing.memberId)) continue;
    const waitlistedMembers = occupied.waitlistedMemberIdsByLeagueId.get(listing.leagueId);
    if (listing.memberId != null && waitlistedMembers?.has(listing.memberId)) continue;
    const waitlistedRegistrations = occupied.waitlistedRegistrationIdsByLeagueId.get(listing.leagueId);
    if (waitlistedRegistrations?.has(listing.registrationId)) continue;

    const holders = holdersByLeague.get(listing.leagueId) ?? new Set<string>();
    holders.add(earmarkedDemandHolderKey(listing));
    holdersByLeague.set(listing.leagueId, holders);
  }
  return new Map([...holdersByLeague].map(([leagueId, holders]) => [leagueId, holders.size]));
}

function addToSetMap(map: Map<number, Set<number>>, leagueId: number, value: number | null | undefined): void {
  if (value == null) return;
  const set = map.get(leagueId) ?? new Set<number>();
  set.add(value);
  map.set(leagueId, set);
}

/**
 * Live count of submitted-or-draft demand that is not already represented as a
 * roster row or waitlist entry. The current registration is omitted so adding
 * a league does not immediately mark it full for that registrant.
 */
export async function loadEarmarkedRegistrationDemandByLeagueId(
  leagueIds: number[],
  options?: { excludeRegistrationId?: number | null },
): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (leagueIds.length === 0) return counts;

  const { db, schema } = getDrizzleDb();
  const excludeRegistrationId = options?.excludeRegistrationId ?? null;
  const listingFilters = [
    inArray(schema.registrationLeaguePriorities.league_id, leagueIds),
    ne(schema.curlingRegistrations.status, 'cancelled'),
  ];
  if (excludeRegistrationId != null) {
    listingFilters.push(ne(schema.curlingRegistrations.id, excludeRegistrationId));
  }
  const listingRows = await db
    .select({
      leagueId: schema.registrationLeaguePriorities.league_id,
      registrationId: schema.curlingRegistrations.id,
      memberId: schema.curlingRegistrations.curler_member_id,
      priorityRank: schema.registrationLeaguePriorities.priority_rank,
      desiredLeagueCount: schema.curlingRegistrations.desired_league_count,
    })
    .from(schema.registrationLeaguePriorities)
    .innerJoin(
      schema.curlingRegistrations,
      eq(schema.registrationLeaguePriorities.registration_id, schema.curlingRegistrations.id),
    )
    .where(and(...listingFilters));

  if (listingRows.length === 0) return counts;

  const [rosterRows, waitlistRows] = await Promise.all([
    db
      .select({
        leagueId: schema.leagueRoster.league_id,
        memberId: schema.leagueRoster.member_id,
      })
      .from(schema.leagueRoster)
      .where(and(inArray(schema.leagueRoster.league_id, leagueIds), eq(schema.leagueRoster.status, 'active'))),
    db
      .select({
        leagueId: schema.leagues.id,
        memberId: schema.waitlistEntries.member_id,
        registrationId: schema.waitlistEntries.source_registration_id,
      })
      .from(schema.waitlistEntries)
      .innerJoin(schema.leagues, eq(schema.leagues.waitlist_id, schema.waitlistEntries.waitlist_id))
      .where(and(inArray(schema.leagues.id, leagueIds), eq(schema.waitlistEntries.status, 'active'))),
  ]);

  const rosteredMemberIdsByLeagueId = new Map<number, Set<number>>();
  const waitlistedMemberIdsByLeagueId = new Map<number, Set<number>>();
  const waitlistedRegistrationIdsByLeagueId = new Map<number, Set<number>>();
  for (const row of rosterRows) addToSetMap(rosteredMemberIdsByLeagueId, row.leagueId, row.memberId);
  for (const row of waitlistRows) {
    addToSetMap(waitlistedMemberIdsByLeagueId, row.leagueId, row.memberId);
    addToSetMap(waitlistedRegistrationIdsByLeagueId, row.leagueId, row.registrationId);
  }

  return countEarmarkedRegistrationDemand(listingRows, {
    rosteredMemberIdsByLeagueId,
    waitlistedMemberIdsByLeagueId,
    waitlistedRegistrationIdsByLeagueId,
  });
}
