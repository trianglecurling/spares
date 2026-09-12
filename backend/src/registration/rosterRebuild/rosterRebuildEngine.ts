import { leaguesInCategory } from './rosterRebuildLeagues.js';
import { isPriorityPeriodRegistration } from './rosterRebuildPriorityPeriod.js';
import { waitlistOfferPreferenceFromPriorityList, type WaitlistOfferResponsePreference } from '../waitlistOfferPreference.js';
import type {
  LeagueVacancySnapshot,
  RosterDiffRow,
  RosterRebuildEngineOptions,
  RosterRebuildLeague,
  RosterRebuildMember,
  RosterRebuildNote,
  RosterRebuildPlacement,
  RosterRebuildPriority,
  RosterRebuildRegistration,
  RosterRebuildResult,
  RosterRebuildSabbaticalMutation,
  RosterRebuildSnapshot,
  RosterRebuildStage,
  RosterRebuildWaitlistEntry,
  RosterRebuildWaitlistEvent,
  WaitlistEventOutcome,
  WaitlistMutation,
} from './rosterRebuildTypes.js';

const ACTIVE_ROSTER_STATUSES = new Set(['active', 'completed']);
const MAX_WAITLIST_PASSES = 10_000;

export function isCountedRosterStatus(status: string): boolean {
  return ACTIVE_ROSTER_STATUSES.has(status);
}

export function resolveDesiredLeagueCount(value: number | null | undefined): number {
  if (value == null) return 2;
  return Math.max(0, Math.trunc(value));
}

export function protectedLeagueBudget(desiredLeagueCount: number): number {
  return Math.min(2, Math.max(0, desiredLeagueCount));
}

/** Matches registration: a free league has an effective registration fee of 0. */
export function isFreeRebuildLeague(league: Pick<RosterRebuildLeague, 'registrationFeeMinor'>): boolean {
  return league.registrationFeeMinor === 0;
}

/** Paid leagues require ice privileges "League play or instructional programs". Free leagues do not. */
export function registrationMayJoinLeague(
  registration: Pick<RosterRebuildRegistration, 'icePrivilegesChoice'>,
  league: Pick<RosterRebuildLeague, 'registrationFeeMinor'>,
): boolean {
  return isFreeRebuildLeague(league) || registration.icePrivilegesChoice === 'league_play';
}

export function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function rosterKey(leagueId: number, memberId: number): string {
  return `${leagueId}:${memberId}`;
}

export function diffRosters(input: {
  before: Array<{ leagueId: number; memberId: number }>;
  after: Array<{ leagueId: number; memberId: number }>;
  reasons?: Map<string, { reason: string; stage: string | null }>;
}): RosterDiffRow[] {
  const beforeKeys = new Set(input.before.map((row) => rosterKey(row.leagueId, row.memberId)));
  const afterKeys = new Set(input.after.map((row) => rosterKey(row.leagueId, row.memberId)));
  const all = new Set([...beforeKeys, ...afterKeys]);
  const rows: RosterDiffRow[] = [];
  for (const key of [...all].sort()) {
    const [leagueIdRaw, memberIdRaw] = key.split(':');
    const leagueId = Number(leagueIdRaw);
    const memberId = Number(memberIdRaw);
    const inBefore = beforeKeys.has(key);
    const inAfter = afterKeys.has(key);
    const reason = input.reasons?.get(key) ?? null;
    rows.push({
      leagueId,
      memberId,
      change: inBefore && inAfter ? 'unchanged' : inAfter ? 'added' : 'removed',
      reason: reason?.reason ?? null,
      stage: reason?.stage ?? null,
    });
  }
  return rows;
}

export function runRosterRebuildStage(
  snapshot: RosterRebuildSnapshot,
  stage: RosterRebuildStage,
  options: RosterRebuildEngineOptions = {},
): RosterRebuildResult {
  if (stage === 'returning') return runReturningStage(snapshot, options);
  if (stage === 'waitlists') return runWaitlistStage(snapshot, options);
  if (stage === 'open-registration') return runLotteryFillStage(snapshot, 'open-registration', options);
  return runLotteryFillStage(snapshot, 'third-leagues', options);
}

type WorkingRoster = Map<string, { leagueId: number; memberId: number; isTemporary: boolean }>;

type Hold = {
  leagueId: number;
  memberId: number;
  rank: number;
  waitlistEntryId: number | null;
  isRank3PlusReturner: boolean;
  isReturner: boolean;
  sourceRegistrationId: number | null;
  isTemporary: boolean;
  relatedSabbaticalId: number | null;
};

type WaitlistFillMode = 'permanent' | 'temporary';

type WorkingSabbatical = {
  id: number;
  leagueId: number;
  memberId: number;
  sourceRegistrationId: number | null;
  waitlistEntryId: number | null;
  replacedByLeagueId: number;
};

function emptyResult(stage: RosterRebuildStage, seed: number | null = null): RosterRebuildResult {
  return {
    stage,
    placements: [],
    waitlistEvents: [],
    waitlistMutations: [],
    sabbaticalMutations: [],
    notes: [],
    warnings: [],
    haltedLeagueIds: [],
    leagueVacancies: [],
    randomSeed: seed,
  };
}

function runReturningStage(snapshot: RosterRebuildSnapshot, _options: RosterRebuildEngineOptions = {}): RosterRebuildResult {
  const result = emptyResult('returning');
  const leagues = byId(snapshot.leagues);
  const roster = workingRosterFrom(snapshot.currentRosters);
  const predecessorMembers = predecessorMembersByLeague(snapshot);
  const registrationByMember = registrationMap(snapshot);

  result.notes.push(...snapshotPreflightNotes(snapshot));
  placeJuniorPrograms(snapshot, leagues, roster, result, { stage: 'returning' });
  placeDoublesReturns(snapshot, leagues, roster, predecessorMembers, registrationByMember, result);
  placeNormalReturns(snapshot, leagues, roster, predecessorMembers, result);
  result.leagueVacancies = vacancySnapshots(snapshot, roster, new Map());
  return result;
}

function placeJuniorPrograms(
  snapshot: RosterRebuildSnapshot,
  leagues: Map<number, RosterRebuildLeague>,
  roster: WorkingRoster,
  result: RosterRebuildResult,
  filter: { stage: RosterRebuildStage },
): void {
  const juniorRecLeagues = leaguesInCategory(snapshot.leagues, 'junior_rec');
  const juniorAdvLeagues = leaguesInCategory(snapshot.leagues, 'junior_adv');

  for (const registration of snapshot.registrations) {
    const listedJuniorRec = registration.priorities.some((priority) => leagues.get(priority.leagueId)?.category === 'junior_rec');
    const wantsJuniorRec =
      registration.membershipOption === 'junior_recreational' ||
      registration.juniorRecreationalSelection ||
      listedJuniorRec;
    if (wantsJuniorRec) {
      if (juniorRecLeagues.length === 0) {
        result.notes.push({
          code: 'missing_junior_rec_league',
          memberId: registration.memberId,
          detail: 'Junior Recreational placement requested but no junior recreational league is mapped.',
        });
      }
      for (const league of juniorRecLeagues) {
        if (!registrationMayJoinLeague(registration, league)) {
          noteIcePrivilegesBlock(result, snapshot, registration, league);
          continue;
        }
        addPlacement(result, roster, {
          stage: filter.stage,
          pass: null,
          leagueId: league.id,
          memberId: registration.memberId,
          placementType: 'new_placement',
          reason: juniorRecReason(registration, listedJuniorRec),
          sourceRegistrationId: registration.id,
          waitlistEntryId: null,
          isRank3PlusReturner: false,
          isTemporarySabbaticalFill: false,
          relatedSabbaticalId: null,
        });
      }
    }

    const listedAdvIds = new Set(
      registration.priorities.filter((priority) => leagues.get(priority.leagueId)?.category === 'junior_adv').map((p) => p.leagueId),
    );
    if (listedAdvIds.size > 0 && juniorAdvLeagues.length === 0) {
      result.notes.push({
        code: 'missing_junior_adv_league',
        memberId: registration.memberId,
        detail: 'Junior Advanced Commitment is on the priority list but no such league is mapped.',
      });
    }
    for (const league of juniorAdvLeagues) {
      if (!listedAdvIds.has(league.id)) continue;
      if (!registrationMayJoinLeague(registration, league)) {
        noteIcePrivilegesBlock(result, snapshot, registration, league);
        continue;
      }
      addPlacement(result, roster, {
        stage: filter.stage,
        pass: null,
        leagueId: league.id,
        memberId: registration.memberId,
        placementType: 'new_placement',
        reason: 'Listed Junior Advanced Commitment on the registration priority list.',
        sourceRegistrationId: registration.id,
        waitlistEntryId: null,
        isRank3PlusReturner: false,
      });
    }
  }
}

function juniorRecReason(registration: RosterRebuildRegistration, listed: boolean): string {
  const parts: string[] = [];
  if (registration.membershipOption === 'junior_recreational') parts.push('Junior Recreational membership');
  if (registration.juniorRecreationalSelection) parts.push('Junior Recreational selection');
  if (listed) parts.push('listed Junior Recreational on the priority list');
  return `Rostered into Junior Recreational (${parts.join('; ')}).`;
}

function placeDoublesReturns(
  snapshot: RosterRebuildSnapshot,
  leagues: Map<number, RosterRebuildLeague>,
  roster: WorkingRoster,
  predecessorMembers: Map<number, Set<number>>,
  registrationByMember: Map<number, RosterRebuildRegistration>,
  result: RosterRebuildResult,
): void {
  const placedPairs = new Set<string>();

  for (const league of leaguesInCategory(snapshot.leagues, 'doubles')) {
    const predMembers = league.predecessorLeagueId
      ? (predecessorMembers.get(league.predecessorLeagueId) ?? new Set())
      : new Set<number>();

    for (const registration of snapshot.registrations) {
      const priority = registration.priorities.find((row) => row.leagueId === league.id);
      if (!priority) continue;
      if (!registrationMayJoinLeague(registration, league)) {
        noteIcePrivilegesBlock(result, snapshot, registration, league);
        continue;
      }
      if (priority.rank > 2) {
        result.notes.push({
          code: 'doubles_rank_too_low',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Ranked ${league.name} at #${priority.rank}; doubles return requires rank 1 or 2.`,
        });
        continue;
      }
      if (priority.teammateMemberIds.length === 0) {
        result.notes.push({
          code: 'doubles_partner_text_only',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: priority.teammateText?.trim()
            ? `Partner listed as text only (${priority.teammateText.trim()}); not placed.`
            : 'No doubles partner listed on the priority entry; not placed.',
        });
        continue;
      }
      const partnerId = priority.teammateMemberIds.find((id) => id !== registration.memberId);
      if (partnerId == null) {
        result.notes.push({
          code: 'doubles_partner_missing',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: 'Doubles priority entry does not name a partner member.',
        });
        continue;
      }
      const pairKey = `${league.id}:${[registration.memberId, partnerId].sort((a, b) => a - b).join(':')}`;
      if (placedPairs.has(pairKey)) continue;

      const partnerReg = registrationByMember.get(partnerId);
      const partnerPriority = partnerReg?.priorities.find((row) => row.leagueId === league.id);
      if (!partnerReg || !partnerPriority) {
        result.notes.push({
          code: 'doubles_partner_not_registered',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Partner ${memberLabel(snapshot, partnerId)} does not have a committed registration listing ${league.name}.`,
        });
        continue;
      }
      if (!registrationMayJoinLeague(partnerReg, league)) {
        noteIcePrivilegesBlock(result, snapshot, partnerReg, league);
        continue;
      }
      if (partnerPriority.rank > 2) {
        result.notes.push({
          code: 'doubles_partner_rank_too_low',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Partner ${memberLabel(snapshot, partnerId)} ranked ${league.name} at #${partnerPriority.rank}.`,
        });
        continue;
      }
      if (!partnerPriority.teammateMemberIds.includes(registration.memberId)) {
        result.notes.push({
          code: 'doubles_partner_mismatch',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Partner ${memberLabel(snapshot, partnerId)} does not list this member on their ${league.name} team.`,
        });
        continue;
      }
      if (!predMembers.has(registration.memberId) || !predMembers.has(partnerId)) {
        result.notes.push({
          code: 'doubles_not_both_returning',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Both members must be on the Winter predecessor roster of ${league.name}.`,
        });
        continue;
      }

      const reason = `Returning doubles team on ${league.name} (both ranked #1 or #2 and both played the predecessor).`;
      addPlacement(result, roster, {
        stage: 'returning',
        pass: null,
        leagueId: league.id,
        memberId: registration.memberId,
        placementType: 'guaranteed_return',
        reason,
        sourceRegistrationId: registration.id,
        waitlistEntryId: null,
        isRank3PlusReturner: false,
        isTemporarySabbaticalFill: false,
        relatedSabbaticalId: null,
      });
      addPlacement(result, roster, {
        stage: 'returning',
        pass: null,
        leagueId: league.id,
        memberId: partnerId,
        placementType: 'guaranteed_return',
        reason,
        sourceRegistrationId: partnerReg.id,
        waitlistEntryId: null,
        isRank3PlusReturner: false,
        isTemporarySabbaticalFill: false,
        relatedSabbaticalId: null,
      });
      placedPairs.add(pairKey);
    }
  }
}

function placeNormalReturns(
  snapshot: RosterRebuildSnapshot,
  leagues: Map<number, RosterRebuildLeague>,
  roster: WorkingRoster,
  predecessorMembers: Map<number, Set<number>>,
  result: RosterRebuildResult,
): void {
  for (const registration of snapshot.registrations) {
    const desired = resolveDesiredLeagueCount(registration.desiredLeagueCount);
    const existingCount = occupiedLeagueCount(snapshot, roster, registration.memberId);
    const budget = Math.max(0, protectedLeagueBudget(desired) - existingCount);
    const returning: RosterRebuildPriority[] = [];
    const rank3Plus: RosterRebuildPriority[] = [];

    for (const priority of [...registration.priorities].sort((a, b) => a.rank - b.rank)) {
      const league = leagues.get(priority.leagueId);
      if (!league || league.category !== 'normal') continue;
      const predId = league.predecessorLeagueId;
      if (predId == null) continue;
      if (!(predecessorMembers.get(predId)?.has(registration.memberId) ?? false)) continue;
      if (!registrationMayJoinLeague(registration, league)) {
        noteIcePrivilegesBlock(result, snapshot, registration, league);
        continue;
      }
      if (memberHasSabbatical(snapshot, registration.memberId, league.id)) {
        result.notes.push({
          code: 'returner_on_sabbatical',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Winter 2026 returner listed ${league.name} as a sabbatical; the seat is a temporary vacancy, not a returning placement.`,
        });
        continue;
      }
      if (priority.rank <= 2) returning.push(priority);
      else rank3Plus.push(priority);
    }

    for (const priority of returning.slice(0, budget)) {
      const league = leagues.get(priority.leagueId);
      if (!league) continue;
      addPlacement(result, roster, {
        stage: 'returning',
        pass: null,
        leagueId: league.id,
        memberId: registration.memberId,
        placementType: 'guaranteed_return',
        reason: `Winter 2026 returner ranked ${league.name} at #${priority.rank}.`,
        sourceRegistrationId: registration.id,
        waitlistEntryId: null,
        isRank3PlusReturner: false,
        isTemporarySabbaticalFill: false,
        relatedSabbaticalId: null,
      });
    }
    for (const priority of returning.slice(budget)) {
      const league = leagues.get(priority.leagueId);
      result.notes.push({
        code: 'returner_exceeds_desired',
        leagueId: league?.id,
        memberId: registration.memberId,
        detail: `Returning ${league?.name ?? priority.leagueId} at rank #${priority.rank} exceeds min(2, desired=${desired}) after existing roster count ${existingCount}.`,
      });
    }
    for (const priority of rank3Plus) {
      const league = leagues.get(priority.leagueId);
      result.notes.push({
        code: 'returner_rank_3_plus',
        leagueId: league?.id,
        memberId: registration.memberId,
        detail: `Winter 2026 returner ranked ${league?.name ?? priority.leagueId} at #${priority.rank}; reserved-seat hold is created in the waitlist stage.`,
      });
    }
  }
}

function runWaitlistStage(snapshot: RosterRebuildSnapshot, _options: RosterRebuildEngineOptions = {}): RosterRebuildResult {
  const result = emptyResult('waitlists');
  const leagues = byId(snapshot.leagues);
  const roster = workingRosterFrom(snapshot.currentRosters);
  const registrationByMember = registrationMap(snapshot);
  const predecessorMembers = predecessorMembersByLeague(snapshot);
  const holds = new Map<string, Hold>();
  const reached = new Set<string>();
  const declinedEntries = new Map<number, WaitlistMutation>();
  const createdSabbaticals: WorkingSabbatical[] = [];

  result.notes.push(...snapshotPreflightNotes(snapshot));
  seedRank3PlusHolds(snapshot, leagues, roster, predecessorMembers, holds, declinedEntries, result);

  let pass = 0;
  let changed = true;
  while (changed) {
    pass += 1;
    if (pass > MAX_WAITLIST_PASSES) {
      throw new Error(`Waitlist processing did not terminate after ${MAX_WAITLIST_PASSES} passes.`);
    }
    changed = runWaitlistPass({
      snapshot,
      roster,
      registrationByMember,
      holds,
      reached,
      declinedEntries,
      createdSabbaticals,
      predecessorMembers,
      result,
      pass,
      mode: 'permanent',
    });
  }

  changed = true;
  while (changed) {
    pass += 1;
    if (pass > MAX_WAITLIST_PASSES) {
      throw new Error(`Waitlist processing did not terminate after ${MAX_WAITLIST_PASSES} passes.`);
    }
    changed = runWaitlistPass({
      snapshot,
      roster,
      registrationByMember,
      holds,
      reached,
      declinedEntries,
      createdSabbaticals,
      predecessorMembers,
      result,
      pass,
      mode: 'temporary',
    });
  }

  commitHolds(snapshot, leagues, roster, holds, declinedEntries, createdSabbaticals, result);
  for (const mutation of [...declinedEntries.values()].sort((a, b) => a.entryId - b.entryId)) {
    if (result.waitlistMutations.some((row) => row.entryId === mutation.entryId && (row.kind === 'placed' || row.kind === 'temporary_fill'))) {
      continue;
    }
    result.waitlistMutations.push(mutation);
  }
  result.leagueVacancies = vacancySnapshots(snapshot, roster, holds, createdSabbaticals);
  return result;
}

function seedRank3PlusHolds(
  snapshot: RosterRebuildSnapshot,
  leagues: Map<number, RosterRebuildLeague>,
  roster: WorkingRoster,
  predecessorMembers: Map<number, Set<number>>,
  holds: Map<string, Hold>,
  declinedEntries: Map<number, WaitlistMutation>,
  result: RosterRebuildResult,
): void {
  for (const registration of snapshot.registrations) {
    const desired = resolveDesiredLeagueCount(registration.desiredLeagueCount);
    const committed = occupiedLeagueCount(snapshot, roster, registration.memberId);
    let remaining = Math.max(0, protectedLeagueBudget(desired) - committed);
    const candidates: RosterRebuildPriority[] = [];
    for (const priority of [...registration.priorities].sort((a, b) => a.rank - b.rank)) {
      const league = leagues.get(priority.leagueId);
      if (!league || league.category !== 'normal') continue;
      if (priority.rank <= 2) continue;
      const predId = league.predecessorLeagueId;
      if (predId == null) continue;
      if (!(predecessorMembers.get(predId)?.has(registration.memberId) ?? false)) continue;
      if (rosterHas(roster, league.id, registration.memberId)) continue;
      if (!registrationMayJoinLeague(registration, league)) {
        noteIcePrivilegesBlock(result, snapshot, registration, league);
        continue;
      }
      if (memberHasSabbatical(snapshot, registration.memberId, league.id)) {
        result.notes.push({
          code: 'returner_on_sabbatical',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Rank #${priority.rank} Winter 2026 returner listed ${league.name} as a sabbatical; no reserved-seat hold.`,
        });
        continue;
      }
      candidates.push(priority);
    }
    for (const priority of candidates) {
      const league = leagues.get(priority.leagueId);
      if (!league) continue;
      const entry = waitlistEntryFor(snapshot, league, registration.memberId);
      if (remaining <= 0) {
        result.notes.push({
          code: 'returner_rank_3_plus_no_allowance',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Rank #${priority.rank} returner hold for ${league.name} dropped because allowance is 0 (${committed} occupied, including play-in / unmanaged leagues).`,
        });
        if (entry) {
          recordDecline({
            snapshot,
            result,
            pass: 0,
            league,
            entry,
            outcome: 'skipped_allowance',
            reason: `Rank #${priority.rank} returner hold for ${league.name} exceeds remaining allowance.`,
            declinedEntries,
          });
        }
        continue;
      }
      holds.set(rosterKey(league.id, registration.memberId), {
        leagueId: league.id,
        memberId: registration.memberId,
        rank: priority.rank,
        waitlistEntryId: entry?.id ?? null,
        isRank3PlusReturner: true,
        isReturner: true,
        sourceRegistrationId: registration.id,
        isTemporary: false,
        relatedSabbaticalId: null,
      });
      remaining -= 1;
      if (vacancyLeft(snapshot, league, roster, holds, 'permanent') < 0) {
        result.notes.push({
          code: 'over_capacity_returner_hold',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `Rank #${priority.rank} returner hold for ${league.name} reserves a seat over capacity.`,
        });
      }
      emitWaitlistEvent(result, {
        pass: 0,
        leagueId: league.id,
        position: entry?.position ?? null,
        entryId: entry?.id ?? null,
        memberId: registration.memberId,
        preference: waitlistPreference(snapshot, registration.memberId, league.id),
        outcome: 'held',
        declineCountBefore: entry?.declineCount ?? null,
        declineCountAfter: entry?.declineCount ?? null,
        immune: false,
        reason: `Initial reserved-seat hold: Winter 2026 returner ranked ${league.name} at #${priority.rank}.`,
      });
    }
  }
}

function runWaitlistPass(input: {
  snapshot: RosterRebuildSnapshot;
  roster: WorkingRoster;
  registrationByMember: Map<number, RosterRebuildRegistration>;
  holds: Map<string, Hold>;
  reached: Set<string>;
  declinedEntries: Map<number, WaitlistMutation>;
  createdSabbaticals: WorkingSabbatical[];
  predecessorMembers: Map<number, Set<number>>;
  result: RosterRebuildResult;
  pass: number;
  mode: WaitlistFillMode;
}): boolean {
  let changed = false;
  const normalLeagues = leaguesInCategory(input.snapshot.leagues, 'normal').sort((a, b) => a.id - b.id);

  for (const league of normalLeagues) {
    if (!league.waitlistId) {
      if (input.pass === 1 && input.mode === 'permanent') {
        input.result.notes.push({
          code: 'league_missing_waitlist',
          leagueId: league.id,
          detail: `${league.name} has no waitlist attached.`,
        });
      }
      continue;
    }
    const entries = input.snapshot.waitlistEntriesByWaitlistId.get(league.waitlistId) ?? [];

    for (const entry of entries) {
      if (vacancyLeft(input.snapshot, league, input.roster, input.holds, input.mode, input.createdSabbaticals) <= 0) break;
      const reachedKey = `${league.id}:${entry.id}`;
      if (input.reached.has(reachedKey)) continue;
      const preference = waitlistPreference(input.snapshot, entry.memberId, league.id);
      if (rosterHas(input.roster, league.id, entry.memberId)) {
        input.reached.add(reachedKey);
        emitWaitlistEvent(input.result, {
          pass: input.pass,
          leagueId: league.id,
          position: entry.position,
          entryId: entry.id,
          memberId: entry.memberId,
          preference,
          outcome: 'already_rostered',
          declineCountBefore: entry.declineCount,
          declineCountAfter: entry.declineCount,
          immune: false,
          reason: `Already on the ${league.name} roster; skipped.`,
        });
        continue;
      }
      if (memberHasSabbatical(input.snapshot, entry.memberId, league.id, input.createdSabbaticals)) {
        input.reached.add(reachedKey);
        emitWaitlistEvent(input.result, {
          pass: input.pass,
          leagueId: league.id,
          position: entry.position,
          entryId: entry.id,
          memberId: entry.memberId,
          preference,
          outcome: 'already_rostered',
          declineCountBefore: entry.declineCount,
          declineCountAfter: entry.declineCount,
          immune: false,
          reason: `On sabbatical from ${league.name}; skipped.`,
        });
        continue;
      }
      if (input.holds.has(rosterKey(league.id, entry.memberId))) {
        input.reached.add(reachedKey);
        continue;
      }

      const registration = input.registrationByMember.get(entry.memberId);
      if (registration && !registrationMayJoinLeague(registration, league)) {
        input.reached.add(reachedKey);
        emitWaitlistEvent(input.result, {
          pass: input.pass,
          leagueId: league.id,
          position: entry.position,
          entryId: entry.id,
          memberId: entry.memberId,
          preference,
          outcome: 'skipped_ice_privileges',
          declineCountBefore: entry.declineCount,
          declineCountAfter: entry.declineCount,
          immune: false,
          reason: `Ice privileges are not league play; deferred paid league ${league.name}.`,
        });
        continue;
      }

      if (preference === 'auto_decline') {
        input.reached.add(reachedKey);
        recordDecline({
          snapshot: input.snapshot,
          result: input.result,
          pass: input.pass,
          league,
          entry,
          outcome: 'auto_declined',
          reason: `League is not on the registration priority list; auto-declined ${league.name}.`,
          declinedEntries: input.declinedEntries,
        });
        continue;
      }

      const decision = holdDecision({
        snapshot: input.snapshot,
        registrationByMember: input.registrationByMember,
        roster: input.roster,
        holds: input.holds,
        memberId: entry.memberId,
        league,
        mode: input.mode,
      });

      if (decision.kind === 'decline') {
        input.reached.add(reachedKey);
        recordDecline({
          snapshot: input.snapshot,
          result: input.result,
          pass: input.pass,
          league,
          entry,
          outcome: decision.outcome,
          reason: decision.reason,
          declinedEntries: input.declinedEntries,
        });
        continue;
      }

      input.reached.add(reachedKey);
      if (decision.kind === 'sabbatical_swap') {
        convertHoldToFallbackSabbatical({
          holds: input.holds,
          snapshot: input.snapshot,
          createdSabbaticals: input.createdSabbaticals,
          result: input.result,
          pass: input.pass,
          hold: decision.release,
          replacedByLeague: league,
        });
      } else if (decision.kind === 'swap') {
        releaseHold(
          input.holds,
          decision.release,
          input.snapshot,
          input.result,
          input.pass,
          input.declinedEntries,
          input.reached,
        );
      }
      // Waitlist priority_rank is often compacted among leagues the member actually joined
      // (returns and fallbacks typically have no waitlist entry). Registration rank is the
      // source of truth; snapshot rank is only a fallback when the registration list has no rank.
      const rank = registrationRank(registration, league.id) ?? entry.priorityRankSnapshot ?? 99;
      input.holds.set(rosterKey(league.id, entry.memberId), {
        leagueId: league.id,
        memberId: entry.memberId,
        rank,
        waitlistEntryId: entry.id,
        isRank3PlusReturner: false,
        isReturner: isPredecessorReturner(league, entry.memberId, input.predecessorMembers),
        sourceRegistrationId: registration?.id ?? null,
        isTemporary: input.mode === 'temporary',
        relatedSabbaticalId: null,
      });
      const movedBySabbatical = decision.kind === 'sabbatical_swap';
      emitWaitlistEvent(input.result, {
        pass: input.pass,
        leagueId: league.id,
        position: entry.position,
        entryId: entry.id,
        memberId: entry.memberId,
        preference,
        outcome: decision.kind === 'swap' || movedBySabbatical ? 'moved_up' : 'held',
        declineCountBefore: entry.declineCount,
        declineCountAfter: entry.declineCount,
        immune: false,
        reason: movedBySabbatical
          ? `Moved up to temporary sabbatical-fill on ${league.name} (rank #${rank}); converted the lower permanent hold to a fallback sabbatical.`
          : decision.kind === 'swap'
            ? `Moved up to ${league.name} (rank #${rank}); released lower hold.`
            : input.mode === 'temporary'
              ? `Tentative temporary sabbatical-fill hold on ${league.name} (rank #${rank}, waitlist position ${entry.position}).`
              : `Tentative hold on ${league.name} (rank #${rank}, waitlist position ${entry.position}).`,
      });
      changed = true;
    }
  }
  return changed;
}

function holdDecision(input: {
  snapshot: RosterRebuildSnapshot;
  registrationByMember: Map<number, RosterRebuildRegistration>;
  roster: WorkingRoster;
  holds: Map<string, Hold>;
  memberId: number;
  league: RosterRebuildLeague;
  mode: WaitlistFillMode;
}):
  | { kind: 'accept' }
  | { kind: 'swap'; release: Hold }
  | { kind: 'sabbatical_swap'; release: Hold }
  | { kind: 'decline'; outcome: WaitlistEventOutcome; reason: string } {
  const registration = input.registrationByMember.get(input.memberId);
  const desired = resolveDesiredLeagueCount(registration?.desiredLeagueCount);
  const committed = occupiedLeagueCount(input.snapshot, input.roster, input.memberId);
  const allowance = Math.max(0, protectedLeagueBudget(desired) - committed);
  const memberHolds = [...input.holds.values()]
    .filter((hold) => hold.memberId === input.memberId)
    .sort((a, b) => a.rank - b.rank);
  const proposedRank = registrationRank(registration, input.league.id) ?? 99;
  const temporaryLabel = input.mode === 'temporary' ? 'temporary sabbatical-fill on ' : '';

  if (memberHolds.length < allowance) return { kind: 'accept' };
  const worst = memberHolds[memberHolds.length - 1];
  if (worst && proposedRank < worst.rank) {
    if (input.mode === 'temporary' && !worst.isTemporary && worst.isReturner) {
      return { kind: 'sabbatical_swap', release: worst };
    }
    return { kind: 'swap', release: worst };
  }
  if (allowance <= 0 && memberHolds.length === 0) {
    return {
      kind: 'decline',
      outcome: 'skipped_allowance',
      reason: `Already rostered in ${committed} league(s); allowance is ${allowance} (desired ${desired}).`,
    };
  }
  return {
    kind: 'decline',
    outcome: 'declined',
    reason: `${temporaryLabel}${input.league.name} (rank #${proposedRank}) does not outrank current holds and allowance is full.`,
  };
}

function clearReachedForLeague(reached: Set<string>, leagueId: number): void {
  for (const key of [...reached]) {
    if (key.startsWith(`${leagueId}:`)) reached.delete(key);
  }
}

function releaseHold(
  holds: Map<string, Hold>,
  hold: Hold,
  snapshot: RosterRebuildSnapshot,
  result: RosterRebuildResult,
  pass: number,
  declinedEntries: Map<number, WaitlistMutation>,
  reached: Set<string>,
): void {
  holds.delete(rosterKey(hold.leagueId, hold.memberId));
  clearReachedForLeague(reached, hold.leagueId);
  const league = snapshot.leagues.find((row) => row.id === hold.leagueId);
  const entry =
    hold.waitlistEntryId != null
      ? waitlistEntryById(snapshot, hold.waitlistEntryId)
      : league
        ? waitlistEntryFor(snapshot, league, hold.memberId)
        : undefined;
  emitWaitlistEvent(result, {
    pass,
    leagueId: hold.leagueId,
    position: entry?.position ?? null,
    entryId: entry?.id ?? hold.waitlistEntryId,
    memberId: hold.memberId,
    preference: waitlistPreference(snapshot, hold.memberId, hold.leagueId),
    outcome: 'released',
    declineCountBefore: entry?.declineCount ?? null,
    declineCountAfter: entry?.declineCount ?? null,
    immune: false,
    reason: `Released tentative hold on ${league?.name ?? hold.leagueId} (rank #${hold.rank}).`,
  });
  if (entry && league && !hold.isTemporary) {
    recordDecline({
      snapshot,
      result,
      pass,
      league,
      entry,
      outcome: 'declined',
      reason: `Released hold on ${league.name} did not become a placement.`,
      declinedEntries,
      emitEvent: false,
    });
  }
}

function convertHoldToFallbackSabbatical(input: {
  holds: Map<string, Hold>;
  snapshot: RosterRebuildSnapshot;
  createdSabbaticals: WorkingSabbatical[];
  result: RosterRebuildResult;
  pass: number;
  hold: Hold;
  replacedByLeague: RosterRebuildLeague;
}): void {
  input.holds.delete(rosterKey(input.hold.leagueId, input.hold.memberId));
  const league = input.snapshot.leagues.find((row) => row.id === input.hold.leagueId);
  const entry =
    input.hold.waitlistEntryId != null
      ? waitlistEntryById(input.snapshot, input.hold.waitlistEntryId)
      : league
        ? waitlistEntryFor(input.snapshot, league, input.hold.memberId)
        : undefined;
  const created: WorkingSabbatical = {
    id: -(input.createdSabbaticals.length + 1),
    leagueId: input.hold.leagueId,
    memberId: input.hold.memberId,
    sourceRegistrationId: input.hold.sourceRegistrationId,
    waitlistEntryId: entry?.id ?? input.hold.waitlistEntryId,
    replacedByLeagueId: input.replacedByLeague.id,
  };
  input.createdSabbaticals.push(created);
  const reason = `Converted permanent hold on ${league?.name ?? input.hold.leagueId} to a fallback sabbatical after taking a higher-ranked temporary fill on ${input.replacedByLeague.name}.`;
  const mutation: RosterRebuildSabbaticalMutation = {
    syntheticId: created.id,
    memberId: created.memberId,
    leagueId: created.leagueId,
    sourceRegistrationId: created.sourceRegistrationId,
    waitlistEntryId: created.waitlistEntryId,
    replacedByLeagueId: created.replacedByLeagueId,
    reason,
  };
  input.result.sabbaticalMutations.push(mutation);
  emitWaitlistEvent(input.result, {
    pass: input.pass,
    leagueId: input.hold.leagueId,
    position: entry?.position ?? null,
    entryId: entry?.id ?? input.hold.waitlistEntryId,
    memberId: input.hold.memberId,
    preference: waitlistPreference(input.snapshot, input.hold.memberId, input.hold.leagueId),
    outcome: 'sabbatical_fallback',
    declineCountBefore: entry?.declineCount ?? null,
    declineCountAfter: entry?.declineCount ?? null,
    immune: false,
    reason,
  });
}

function commitHolds(
  snapshot: RosterRebuildSnapshot,
  leagues: Map<number, RosterRebuildLeague>,
  roster: WorkingRoster,
  holds: Map<string, Hold>,
  declinedEntries: Map<number, WaitlistMutation>,
  createdSabbaticals: WorkingSabbatical[],
  result: RosterRebuildResult,
): void {
  const usedSabbaticalIds = usedRelatedSabbaticalIds(snapshot, roster);
  const ordered = [...holds.values()].sort((a, b) => a.leagueId - b.leagueId || a.memberId - b.memberId);
  for (const hold of ordered) {
    const league = leagues.get(hold.leagueId);
    const relatedSabbaticalId = hold.isTemporary
      ? nextRelatedSabbaticalId(snapshot, hold.leagueId, usedSabbaticalIds, createdSabbaticals)
      : null;
    const fallback = createdSabbaticals.find((row) => row.memberId === hold.memberId);
    const fallbackLeague = fallback ? leagues.get(fallback.leagueId) : undefined;
    const placementType: RosterRebuildPlacement['placementType'] = hold.isTemporary
      ? 'temporary_sabbatical_fill'
      : hold.isRank3PlusReturner
        ? 'guaranteed_return'
        : 'waitlist';
    const reason = hold.isTemporary
      ? fallbackLeague
        ? `Temporary sabbatical-fill on ${league?.name ?? hold.leagueId} (rank #${hold.rank}); remains on the waitlist for a permanent seat. Fallback sabbatical on ${fallbackLeague.name} offsets the fill discount.`
        : `Temporary sabbatical-fill on ${league?.name ?? hold.leagueId} (rank #${hold.rank}); remains on the waitlist for a permanent seat.`
      : hold.isRank3PlusReturner
        ? `Rank #${hold.rank} Winter 2026 returner hold committed on ${league?.name ?? hold.leagueId}.`
        : `Waitlist placement on ${league?.name ?? hold.leagueId} (rank #${hold.rank}).`;
    const added = addPlacement(result, roster, {
      stage: 'waitlists',
      pass: null,
      leagueId: hold.leagueId,
      memberId: hold.memberId,
      placementType,
      reason,
      sourceRegistrationId: hold.sourceRegistrationId,
      waitlistEntryId: hold.waitlistEntryId,
      isRank3PlusReturner: hold.isRank3PlusReturner,
      isTemporarySabbaticalFill: hold.isTemporary,
      relatedSabbaticalId,
    });
    if (!added) continue;
    const entry =
      hold.waitlistEntryId != null
        ? waitlistEntryById(snapshot, hold.waitlistEntryId)
        : league
          ? waitlistEntryFor(snapshot, league, hold.memberId)
          : undefined;
    if (entry) {
      declinedEntries.delete(entry.id);
      result.waitlistMutations.push({
        entryId: entry.id,
        memberId: hold.memberId,
        leagueId: hold.leagueId,
        kind: hold.isTemporary ? 'temporary_fill' : 'placed',
        immune: false,
        declineCountBefore: entry.declineCount,
        declineCountAfter: entry.declineCount,
      });
      emitWaitlistEvent(result, {
        pass: 0,
        leagueId: hold.leagueId,
        position: entry.position,
        entryId: entry.id,
        memberId: hold.memberId,
        preference: waitlistPreference(snapshot, hold.memberId, hold.leagueId),
        outcome: hold.isTemporary ? 'placed_temporary' : 'placed',
        declineCountBefore: entry.declineCount,
        declineCountAfter: entry.declineCount,
        immune: false,
        reason,
      });
    }
  }
}

function recordDecline(input: {
  snapshot: RosterRebuildSnapshot;
  result: RosterRebuildResult;
  pass: number;
  league: Pick<RosterRebuildLeague, 'id' | 'name'>;
  entry: RosterRebuildWaitlistEntry;
  outcome: WaitlistEventOutcome;
  reason: string;
  declinedEntries: Map<number, WaitlistMutation>;
  emitEvent?: boolean;
}): void {
  if (input.declinedEntries.has(input.entry.id)) return;
  const immune = hasDeclineImmunity(input.snapshot, input.entry.memberId, input.league.id);
  const before = input.entry.declineCount;
  const after = immune ? before : before + 1;
  const outcome: WaitlistEventOutcome =
    immune && input.outcome !== 'auto_declined' ? 'declined_immune' : input.outcome;
  if (input.emitEvent !== false) {
    emitWaitlistEvent(input.result, {
      pass: input.pass,
      leagueId: input.league.id,
      position: input.entry.position,
      entryId: input.entry.id,
      memberId: input.entry.memberId,
      preference: waitlistPreference(input.snapshot, input.entry.memberId, input.league.id),
      outcome,
      declineCountBefore: before,
      declineCountAfter: after,
      immune,
      reason: immune ? `${input.reason} Decline immunity applied.` : input.reason,
    });
  }
  input.declinedEntries.set(input.entry.id, {
    entryId: input.entry.id,
    memberId: input.entry.memberId,
    leagueId: input.league.id,
    kind: 'declined',
    immune,
    declineCountBefore: before,
    declineCountAfter: after,
  });
}

function runLotteryFillStage(
  snapshot: RosterRebuildSnapshot,
  stage: 'open-registration' | 'third-leagues',
  options: RosterRebuildEngineOptions,
): RosterRebuildResult {
  const seed = options.randomSeed ?? 1;
  const result = emptyResult(stage, seed);
  const roster = workingRosterFrom(snapshot.currentRosters);
  const leagues = byId(snapshot.leagues);
  const registrationByMember = registrationMap(snapshot);
  const rng = mulberry32(seed);
  const randomKey = new Map<number, number>();
  for (const member of snapshot.members.values()) randomKey.set(member.memberId, rng());

  result.notes.push(...snapshotPreflightNotes(snapshot));
  if (stage === 'open-registration') {
    placeJuniorPrograms(snapshot, leagues, roster, result, { stage: 'open-registration' });
  }

  const normalLeagues = leaguesInCategory(snapshot.leagues, 'normal').sort((a, b) => a.id - b.id);
  const eligibility = new Map<number, 'eligible' | 'not_exhausted' | 'no_vacancy'>();

  const refreshEligibility = (): void => {
    for (const league of normalLeagues) {
      const permanent = vacancyLeft(snapshot, league, roster, new Map(), 'permanent');
      const temporary = vacancyLeft(snapshot, league, roster, new Map(), 'temporary');
      if (permanent <= 0 && temporary <= 0) {
        eligibility.set(league.id, 'no_vacancy');
        continue;
      }
      eligibility.set(
        league.id,
        waitlistFirstSecondEligibility(snapshot, league, roster, registrationByMember).status,
      );
    }
  };

  fillPriorityWaitlistLeftovers(snapshot, normalLeagues, roster, registrationByMember, result, stage);
  refreshEligibility();
  for (const league of normalLeagues) {
    const status = eligibility.get(league.id);
    if (status === 'not_exhausted') {
      const leftover = waitlistFirstSecondEligibility(snapshot, league, roster, registrationByMember);
      const who =
        leftover.memberIds.length > 0
          ? ` (${leftover.memberIds.map((memberId) => memberLabel(snapshot, memberId)).join(', ')})`
          : '';
      result.notes.push({
        code: 'waitlist_not_exhausted',
        leagueId: league.id,
        detail:
          stage === 'open-registration'
            ? `${league.name} waitlist still has auto-accept entries who could take a 1st/2nd league${who}; open-registration assignment skipped.`
            : `${league.name} waitlist still has auto-accept entries who could take a 1st/2nd league${who}; 3rd+ assignment skipped.`,
      });
    }
  }

  type Candidate = {
    league: RosterRebuildLeague;
    memberId: number;
    rank: number;
    tenure: number;
    experience: number;
    random: number;
    registration: RosterRebuildRegistration;
  };

  const eligibleForFill = (registration: RosterRebuildRegistration, count: number, desired: number): boolean => {
    if (stage === 'open-registration') {
      return count < protectedLeagueBudget(desired);
    }
    return count >= 2 && desired > count;
  };

  const fillUntilSettled = (mode: WaitlistFillMode): void => {
    let placed = true;
    while (placed) {
      placed = false;
      fillPass += 1;
      refreshEligibility();
      const candidates: Candidate[] = [];
      for (const league of normalLeagues) {
        if (eligibility.get(league.id) !== 'eligible') continue;
        if (vacancyLeft(snapshot, league, roster, new Map(), mode) <= 0) continue;
        for (const registration of snapshot.registrations) {
          if (rosterHas(roster, league.id, registration.memberId)) continue;
          const desired = resolveDesiredLeagueCount(registration.desiredLeagueCount);
          const count = occupiedLeagueCount(snapshot, roster, registration.memberId);
          if (!eligibleForFill(registration, count, desired)) continue;
          const next = nextUnfilledPriority(registration, leagues, roster, registration.memberId, ['normal'], {
            isAvailable: (candidate) =>
              !memberHasSabbatical(snapshot, registration.memberId, candidate.id) &&
              vacancyLeft(snapshot, candidate, roster, new Map(), mode) > 0 &&
              eligibility.get(candidate.id) === 'eligible',
          });
          if (next?.leagueId !== league.id) continue;
          const member = snapshot.members.get(registration.memberId);
          candidates.push({
            league,
            memberId: registration.memberId,
            rank: next.rank,
            tenure: member?.clubTenureYears ?? 0,
            experience: member?.totalExperienceYears ?? 0,
            random: randomKey.get(registration.memberId) ?? 0,
            registration,
          });
        }
      }
      if (candidates.length === 0) break;
      candidates.sort((a, b) => {
        if (b.tenure !== a.tenure) return b.tenure - a.tenure;
        if (b.experience !== a.experience) return b.experience - a.experience;
        if (b.random !== a.random) return b.random - a.random;
        return a.memberId - b.memberId || a.league.id - b.league.id;
      });
      const winner = candidates[0];
      if (!winner) break;
      const relatedSabbaticalId =
        mode === 'temporary' ? nextRelatedSabbaticalId(snapshot, winner.league.id, usedSabbaticalIds) : null;
      const isTemporary = mode === 'temporary';
      const stageLabel = stage === 'open-registration' ? 'Open-registration' : '3rd+';
      addPlacement(result, roster, {
        stage,
        pass: fillPass,
        leagueId: winner.league.id,
        memberId: winner.memberId,
        placementType: isTemporary ? 'temporary_sabbatical_fill' : 'new_placement',
        reason: isTemporary
          ? `${stageLabel} temporary sabbatical-fill on ${winner.league.name} (next on priority list at #${winner.rank}; tenure ${winner.tenure}, experience ${winner.experience}).`
          : `${stageLabel} assignment to ${winner.league.name} (next on priority list at #${winner.rank}; tenure ${winner.tenure}, experience ${winner.experience}).`,
        sourceRegistrationId: winner.registration.id,
        waitlistEntryId: waitlistEntryFor(snapshot, winner.league, winner.memberId)?.id ?? null,
        isRank3PlusReturner: false,
        isTemporarySabbaticalFill: isTemporary,
        relatedSabbaticalId,
      });
      if (isTemporary) {
        const entry = waitlistEntryFor(snapshot, winner.league, winner.memberId);
        if (entry) {
          result.waitlistMutations.push({
            entryId: entry.id,
            memberId: winner.memberId,
            leagueId: winner.league.id,
            kind: 'temporary_fill',
            immune: false,
            declineCountBefore: entry.declineCount,
            declineCountAfter: entry.declineCount,
          });
        }
      }
      placed = true;
    }
  };

  const usedSabbaticalIds = usedRelatedSabbaticalIds(snapshot, roster);
  let fillPass = 0;
  fillUntilSettled('permanent');
  fillUntilSettled('temporary');

  refreshEligibility();
  for (const league of normalLeagues) {
    if (eligibility.get(league.id) !== 'eligible') continue;
    if (
      vacancyLeft(snapshot, league, roster, new Map(), 'permanent') <= 0 &&
      vacancyLeft(snapshot, league, roster, new Map(), 'temporary') <= 0
    ) {
      continue;
    }
    for (const registration of snapshot.registrations) {
      if (rosterHas(roster, league.id, registration.memberId)) continue;
      const desired = resolveDesiredLeagueCount(registration.desiredLeagueCount);
      const count = occupiedLeagueCount(snapshot, roster, registration.memberId);
      if (!eligibleForFill(registration, count, desired)) continue;
      const priority = registration.priorities.find((row) => row.leagueId === league.id);
      if (!priority) continue;
      const next = nextUnfilledPriority(registration, leagues, roster, registration.memberId, ['normal'], {
        isAvailable: (candidate) =>
          !memberHasSabbatical(snapshot, registration.memberId, candidate.id) &&
          eligibility.get(candidate.id) === 'eligible' &&
          (vacancyLeft(snapshot, candidate, roster, new Map(), 'permanent') > 0 ||
            vacancyLeft(snapshot, candidate, roster, new Map(), 'temporary') > 0),
      });
      if (next != null && next.leagueId !== league.id) {
        result.notes.push({
          code: stage === 'open-registration' ? 'open_registration_not_next' : 'third_league_not_next',
          leagueId: league.id,
          memberId: registration.memberId,
          detail: `${memberLabel(snapshot, registration.memberId)} still wants another league and listed ${league.name} at #${priority.rank}, but it is not their next assignable priority.`,
        });
      }
    }
  }

  if (stage === 'third-leagues') placeDayLeagues(snapshot, leagues, roster, result, randomKey);
  result.leagueVacancies = vacancySnapshots(snapshot, roster, new Map());
  result.notes.push({
    code: 'random_seed',
    detail:
      stage === 'open-registration'
        ? `Open-registration tie-break random seed is ${seed}.`
        : `3rd-league tie-break random seed is ${seed}.`,
  });
  return result;
}

function waitlistEntryWouldTakeFirstSecond(
  snapshot: RosterRebuildSnapshot,
  league: RosterRebuildLeague,
  roster: WorkingRoster,
  registrationByMember: Map<number, RosterRebuildRegistration>,
  entry: RosterRebuildWaitlistEntry,
): boolean {
  if (entry.status !== 'active') return false;
  if (rosterHas(roster, league.id, entry.memberId)) return false;
  if (memberHasSabbatical(snapshot, entry.memberId, league.id)) return false;
  const preference = waitlistPreference(snapshot, entry.memberId, league.id);
  if (preference !== 'auto_accept') return false;
  const registration = registrationByMember.get(entry.memberId);
  if (!registration) return false;
  if (!registrationMayJoinLeague(registration, league)) return false;
  const desired = resolveDesiredLeagueCount(registration.desiredLeagueCount);
  return occupiedLeagueCount(snapshot, roster, entry.memberId) < protectedLeagueBudget(desired);
}

function waitlistFirstSecondEligibility(
  snapshot: RosterRebuildSnapshot,
  league: RosterRebuildLeague,
  roster: WorkingRoster,
  registrationByMember: Map<number, RosterRebuildRegistration>,
): { status: 'eligible' | 'not_exhausted'; memberIds: number[] } {
  if (!league.waitlistId) return { status: 'eligible', memberIds: [] };
  const memberIds: number[] = [];
  for (const entry of snapshot.waitlistEntriesByWaitlistId.get(league.waitlistId) ?? []) {
    if (waitlistEntryWouldTakeFirstSecond(snapshot, league, roster, registrationByMember, entry)) {
      memberIds.push(entry.memberId);
    }
  }
  return memberIds.length > 0 ? { status: 'not_exhausted', memberIds } : { status: 'eligible', memberIds };
}

function fillPriorityWaitlistLeftovers(
  snapshot: RosterRebuildSnapshot,
  normalLeagues: RosterRebuildLeague[],
  roster: WorkingRoster,
  registrationByMember: Map<number, RosterRebuildRegistration>,
  result: RosterRebuildResult,
  stage: 'open-registration' | 'third-leagues',
): void {
  const usedSabbaticalIds = usedRelatedSabbaticalIds(snapshot, roster);
  const modes: WaitlistFillMode[] = ['permanent', 'temporary'];
  for (const mode of modes) {
    for (const league of normalLeagues) {
      if (!league.waitlistId) continue;
      const entries = snapshot.waitlistEntriesByWaitlistId.get(league.waitlistId) ?? [];
      for (const entry of entries) {
        if (vacancyLeft(snapshot, league, roster, new Map(), mode) <= 0) break;
        if (!waitlistEntryWouldTakeFirstSecond(snapshot, league, roster, registrationByMember, entry)) continue;
        const registration = registrationByMember.get(entry.memberId);
        if (!registration) continue;
        const rank = registrationRank(registration, league.id) ?? entry.priorityRankSnapshot ?? 99;
        const isTemporary = mode === 'temporary';
        const relatedSabbaticalId = isTemporary ? nextRelatedSabbaticalId(snapshot, league.id, usedSabbaticalIds) : null;
        addPlacement(result, roster, {
          stage,
          pass: null,
          leagueId: league.id,
          memberId: entry.memberId,
          placementType: isTemporary ? 'temporary_sabbatical_fill' : 'waitlist',
          reason: isTemporary
            ? `Leftover 1st/2nd temporary sabbatical-fill on ${league.name} (rank #${rank}; waitlist still had 1st/2nd-league room).`
            : `Leftover 1st/2nd waitlist assignment to ${league.name} (rank #${rank}; waitlist still had 1st/2nd-league room).`,
          sourceRegistrationId: registration.id,
          waitlistEntryId: entry.id,
          isRank3PlusReturner: false,
          isTemporarySabbaticalFill: isTemporary,
          relatedSabbaticalId,
        });
        result.waitlistMutations.push({
          entryId: entry.id,
          memberId: entry.memberId,
          leagueId: league.id,
          kind: isTemporary ? 'temporary_fill' : 'placed',
          immune: false,
          declineCountBefore: entry.declineCount,
          declineCountAfter: entry.declineCount,
        });
      }
    }
  }
}

function placeDayLeagues(
  snapshot: RosterRebuildSnapshot,
  leagues: Map<number, RosterRebuildLeague>,
  roster: WorkingRoster,
  result: RosterRebuildResult,
  randomKey: Map<number, number>,
): void {
  const dayLeagues = leaguesInCategory(snapshot.leagues, 'day_league');
  if (dayLeagues.length === 0) return;
  const iceNoted = new Set<string>();
  type DayCandidate = {
    registration: RosterRebuildRegistration;
    league: RosterRebuildLeague;
    rank: number;
    count: number;
    desired: number;
    fillingFirstOrSecond: boolean;
    tenure: number;
    experience: number;
    random: number;
  };
  const nextCandidate = (registration: RosterRebuildRegistration): DayCandidate | null => {
    const desired = resolveDesiredLeagueCount(registration.desiredLeagueCount);
    const count = occupiedLeagueCount(snapshot, roster, registration.memberId);
    if (count >= desired) return null;
    for (const priority of [...registration.priorities].sort((a, b) => a.rank - b.rank)) {
      const league = leagues.get(priority.leagueId);
      if (!league || league.category !== 'day_league') continue;
      if (rosterHas(roster, league.id, registration.memberId)) continue;
      if (!registrationMayJoinLeague(registration, league)) {
        const key = rosterKey(league.id, registration.memberId);
        if (!iceNoted.has(key)) {
          iceNoted.add(key);
          noteIcePrivilegesBlock(result, snapshot, registration, league);
        }
        continue;
      }
      if (vacancyLeft(snapshot, league, roster, new Map(), 'permanent') <= 0) continue;
      const member = snapshot.members.get(registration.memberId);
      return {
        registration,
        league,
        rank: priority.rank,
        count,
        desired,
        fillingFirstOrSecond: count < 2,
        tenure: member?.clubTenureYears ?? 0,
        experience: member?.totalExperienceYears ?? 0,
        random: randomKey.get(registration.memberId) ?? 0,
      };
    }
    return null;
  };
  let placed = true;
  while (placed) {
    placed = false;
    const candidates: DayCandidate[] = [];
    for (const registration of snapshot.registrations) {
      const candidate = nextCandidate(registration);
      if (candidate) candidates.push(candidate);
    }
    if (candidates.length === 0) break;
    candidates.sort((a, b) => {
      if (a.fillingFirstOrSecond !== b.fillingFirstOrSecond) return a.fillingFirstOrSecond ? -1 : 1;
      if (b.tenure !== a.tenure) return b.tenure - a.tenure;
      if (b.experience !== a.experience) return b.experience - a.experience;
      if (b.random !== a.random) return b.random - a.random;
      return a.registration.memberId - b.registration.memberId || a.league.id - b.league.id;
    });
    const winner = candidates[0];
    if (!winner) break;
    const slot = winner.fillingFirstOrSecond ? '1st/2nd' : '3rd+';
    addPlacement(result, roster, {
      stage: 'third-leagues',
      pass: null,
      leagueId: winner.league.id,
      memberId: winner.registration.memberId,
      placementType: 'new_placement',
      reason: `Day league auto-grant of ${winner.league.name} as ${slot} league (rank #${winner.rank}); requested ${winner.desired}, currently ${winner.count}.`,
      sourceRegistrationId: winner.registration.id,
      waitlistEntryId: null,
      isRank3PlusReturner: false,
    });
    placed = true;
  }
  for (const registration of snapshot.registrations) {
    const desired = resolveDesiredLeagueCount(registration.desiredLeagueCount);
    const count = occupiedLeagueCount(snapshot, roster, registration.memberId);
    if (count >= desired) continue;
    for (const priority of [...registration.priorities].sort((a, b) => a.rank - b.rank)) {
      const league = leagues.get(priority.leagueId);
      if (!league || league.category !== 'day_league') continue;
      if (rosterHas(roster, league.id, registration.memberId)) continue;
      if (!registrationMayJoinLeague(registration, league)) continue;
      if (vacancyLeft(snapshot, league, roster, new Map(), 'permanent') > 0) continue;
      result.notes.push({
        code: 'day_league_no_vacancy',
        leagueId: league.id,
        memberId: registration.memberId,
        detail: `${memberLabel(snapshot, registration.memberId)} listed ${league.name} at #${priority.rank}, but the league is at capacity.`,
      });
    }
  }
}

function nextUnfilledPriority(
  registration: RosterRebuildRegistration,
  leagues: Map<number, RosterRebuildLeague>,
  roster: WorkingRoster,
  memberId: number,
  categories: Array<RosterRebuildLeague['category']>,
  options: { isAvailable?: (league: RosterRebuildLeague) => boolean } = {},
): RosterRebuildPriority | null {
  const allowed = new Set(categories);
  for (const priority of [...registration.priorities].sort((a, b) => a.rank - b.rank)) {
    const league = leagues.get(priority.leagueId);
    if (!league || !allowed.has(league.category)) continue;
    if (!registrationMayJoinLeague(registration, league)) continue;
    if (rosterHas(roster, league.id, memberId)) continue;
    if (options.isAvailable && !options.isAvailable(league)) continue;
    return priority;
  }
  return null;
}

function addPlacement(
  result: RosterRebuildResult,
  roster: WorkingRoster,
  placement: Omit<RosterRebuildPlacement, 'sequence' | 'isTemporarySabbaticalFill' | 'relatedSabbaticalId'> & {
    isTemporarySabbaticalFill?: boolean;
    relatedSabbaticalId?: number | null;
  },
): boolean {
  const key = rosterKey(placement.leagueId, placement.memberId);
  if (roster.has(key)) {
    result.notes.push({
      code: 'already_rostered',
      leagueId: placement.leagueId,
      memberId: placement.memberId,
      detail: `Already on league ${placement.leagueId}; skipped.`,
    });
    return false;
  }
  const isTemporarySabbaticalFill = placement.isTemporarySabbaticalFill ?? false;
  const relatedSabbaticalId = placement.relatedSabbaticalId ?? null;
  roster.set(key, { leagueId: placement.leagueId, memberId: placement.memberId, isTemporary: isTemporarySabbaticalFill });
  result.placements.push({
    sequence: result.placements.length + 1,
    ...placement,
    placementType: isTemporarySabbaticalFill ? 'temporary_sabbatical_fill' : placement.placementType,
    isTemporarySabbaticalFill,
    relatedSabbaticalId,
  });
  return true;
}

function emitWaitlistEvent(result: RosterRebuildResult, event: RosterRebuildWaitlistEvent): void {
  result.waitlistEvents.push(event);
}

function snapshotPreflightNotes(snapshot: RosterRebuildSnapshot): RosterRebuildNote[] {
  const notes: RosterRebuildNote[] = [];
  const cutoffIntro =
    snapshot.priorityPeriodEndSource === 'open_transition'
      ? `Priority registration ended at ${snapshot.priorityPeriodEndAt} (session open transition).`
      : `No open-registration transition found; using fallback cutoff ${snapshot.priorityPeriodEndAt} (12:01am September 4, 2026 EDT).`;
  notes.push({
    code: 'priority_period_cutoff',
    detail: `${cutoffIntro} Roster rebuild treats all committed registrations the same.`,
  });
  const priorityCount = snapshot.registrations.filter((row) => isPriorityPeriodRegistration(row)).length;
  const openCount = snapshot.registrations.length - priorityCount;
  notes.push({
    code: 'priority_period_counts',
    detail: `${priorityCount} committed registration(s) during the priority period; ${openCount} after it.`,
  });
  const sabbaticalKeys = new Set(
    snapshot.activeSabbaticals.map((row) => rosterKey(row.leagueId, row.memberId)),
  );
  for (const sabbatical of snapshot.activeSabbaticals) {
    notes.push({
      code: 'active_sabbatical',
      leagueId: sabbatical.leagueId,
      memberId: sabbatical.memberId,
      detail: `Active sabbatical ${sabbatical.id} occupies a seat on league ${sabbatical.leagueId}.`,
    });
  }
  for (const registration of snapshot.registrations) {
    for (const leagueId of registration.sabbaticalLeagueIds) {
      if (sabbaticalKeys.has(rosterKey(leagueId, registration.memberId))) continue;
      notes.push({
        code: 'sabbatical_selection_without_row',
        leagueId,
        memberId: registration.memberId,
        detail: `Registration ${registration.id} lists a sabbatical on league ${leagueId} but no active sabbatical row exists; the seat is still treated as a temporary vacancy.`,
      });
    }
  }
  for (const offer of snapshot.pendingOffers) {
    notes.push({
      code: 'pending_waitlist_offer',
      leagueId: offer.leagueId,
      memberId: offer.memberId,
      detail: `Pending waitlist offer ${offer.id} on league ${offer.leagueId} (entry ${offer.waitlistEntryId}) was left untouched.`,
    });
  }
  for (const memberId of snapshot.duplicateRegistrationMemberIds) {
    notes.push({
      code: 'duplicate_registration',
      memberId,
      detail: `Member ${memberId} has more than one committed registration in this session; the highest id was used.`,
    });
  }
  return notes;
}

function hasDeclineImmunity(snapshot: RosterRebuildSnapshot, memberId: number, leagueId: number): boolean {
  const member = snapshot.members.get(memberId);
  if (member?.isLifetimeMember) return true;
  if (!snapshot.tuesdayEveningRosterMemberIds.has(memberId)) return false;
  const registration = snapshot.registrations.find((row) => row.memberId === memberId);
  return registrationRank(registration, leagueId) === 1;
}

function registrationRank(
  registration: RosterRebuildRegistration | undefined,
  leagueId: number,
): number | null {
  return registration?.priorities.find((row) => row.leagueId === leagueId)?.rank ?? null;
}

function waitlistPreference(
  snapshot: RosterRebuildSnapshot,
  memberId: number,
  leagueId: number,
): WaitlistOfferResponsePreference {
  const registration = snapshot.registrations.find((row) => row.memberId === memberId);
  return waitlistOfferPreferenceFromPriorityList({
    leagueId,
    priorityLeagueIds: (registration?.priorities ?? []).map((row) => row.leagueId),
  });
}

function waitlistEntryFor(
  snapshot: RosterRebuildSnapshot,
  league: RosterRebuildLeague,
  memberId: number,
): RosterRebuildWaitlistEntry | undefined {
  if (!league.waitlistId) return undefined;
  return (snapshot.waitlistEntriesByWaitlistId.get(league.waitlistId) ?? []).find(
    (entry) => entry.memberId === memberId && entry.status === 'active',
  );
}

function waitlistEntryById(
  snapshot: RosterRebuildSnapshot,
  entryId: number,
): RosterRebuildWaitlistEntry | undefined {
  for (const entries of snapshot.waitlistEntriesByWaitlistId.values()) {
    const match = entries.find((entry) => entry.id === entryId);
    if (match) return match;
  }
  return undefined;
}

function workingRosterFrom(rows: RosterRebuildSnapshot['currentRosters']): WorkingRoster {
  const roster: WorkingRoster = new Map();
  for (const row of rows) {
    if (!isCountedRosterStatus(row.status)) continue;
    roster.set(rosterKey(row.leagueId, row.memberId), {
      leagueId: row.leagueId,
      memberId: row.memberId,
      isTemporary: row.isTemporarySabbaticalFill,
    });
  }
  return roster;
}

function rosterHas(roster: WorkingRoster, leagueId: number, memberId: number): boolean {
  return roster.has(rosterKey(leagueId, memberId));
}

function rosteredLeagueCount(roster: WorkingRoster, memberId: number): number {
  let count = 0;
  for (const row of roster.values()) {
    if (row.memberId === memberId) count += 1;
  }
  return count;
}

/** Active roster seats plus still-live play-in / Tuesday assignments the rebuild does not manage. */
function occupiedLeagueCount(snapshot: RosterRebuildSnapshot, roster: WorkingRoster, memberId: number): number {
  const ids = new Set<number>();
  for (const row of roster.values()) {
    if (row.memberId === memberId) ids.add(row.leagueId);
  }
  for (const key of snapshot.unmanagedOccupiedKeys) {
    const [leagueIdRaw, memberIdRaw] = key.split(':');
    if (Number(memberIdRaw) !== memberId) continue;
    ids.add(Number(leagueIdRaw));
  }
  return ids.size;
}

function predecessorMembersByLeague(snapshot: RosterRebuildSnapshot): Map<number, Set<number>> {
  const map = new Map<number, Set<number>>();
  for (const row of snapshot.predecessorRosters) {
    if (!isCountedRosterStatus(row.status)) continue;
    const set = map.get(row.leagueId) ?? new Set<number>();
    set.add(row.memberId);
    map.set(row.leagueId, set);
  }
  return map;
}

function isPredecessorReturner(
  league: RosterRebuildLeague,
  memberId: number,
  predecessorMembers: Map<number, Set<number>>,
): boolean {
  if (league.predecessorLeagueId == null) return false;
  return predecessorMembers.get(league.predecessorLeagueId)?.has(memberId) ?? false;
}

function registrationMap(snapshot: RosterRebuildSnapshot): Map<number, RosterRebuildRegistration> {
  const map = new Map<number, RosterRebuildRegistration>();
  for (const registration of snapshot.registrations) {
    const existing = map.get(registration.memberId);
    if (!existing || existing.id < registration.id) map.set(registration.memberId, registration);
  }
  return map;
}

function byId(leagues: RosterRebuildLeague[]): Map<number, RosterRebuildLeague> {
  return new Map(leagues.map((league) => [league.id, league]));
}

function memberLabel(snapshot: RosterRebuildSnapshot, memberId: number): string {
  const member: RosterRebuildMember | undefined = snapshot.members.get(memberId);
  return member ? `${member.name} (#${memberId})` : `#${memberId}`;
}

function noteIcePrivilegesBlock(
  result: RosterRebuildResult,
  snapshot: RosterRebuildSnapshot,
  registration: RosterRebuildRegistration,
  league: RosterRebuildLeague,
): void {
  const choice =
    registration.icePrivilegesChoice === 'basic_ice'
      ? 'basic ice privileges'
      : registration.icePrivilegesChoice === 'none'
        ? 'no ice privileges'
        : `ice privileges "${registration.icePrivilegesChoice}"`;
  result.notes.push({
    code: 'ice_privileges_blocks_paid_league',
    leagueId: league.id,
    memberId: registration.memberId,
    detail: `${memberLabel(snapshot, registration.memberId)} selected ${choice}; paid league ${league.name} requires League play or instructional programs.`,
  });
}

function memberHasSabbatical(
  snapshot: RosterRebuildSnapshot,
  memberId: number,
  leagueId: number,
  extra: readonly Pick<WorkingSabbatical, 'leagueId' | 'memberId'>[] = [],
): boolean {
  if (snapshot.activeSabbaticals.some((row) => row.memberId === memberId && row.leagueId === leagueId)) return true;
  if (extra.some((row) => row.memberId === memberId && row.leagueId === leagueId)) return true;
  return snapshot.registrations.some(
    (registration) => registration.memberId === memberId && registration.sabbaticalLeagueIds.includes(leagueId),
  );
}

function leagueSabbaticalCount(
  snapshot: RosterRebuildSnapshot,
  leagueId: number,
  extra: readonly Pick<WorkingSabbatical, 'leagueId' | 'memberId'>[] = [],
): number {
  const members = new Set<number>();
  for (const row of snapshot.activeSabbaticals) {
    if (row.leagueId === leagueId) members.add(row.memberId);
  }
  for (const row of extra) {
    if (row.leagueId === leagueId) members.add(row.memberId);
  }
  for (const registration of snapshot.registrations) {
    if (registration.sabbaticalLeagueIds.includes(leagueId)) members.add(registration.memberId);
  }
  return members.size;
}

function usedRelatedSabbaticalIds(snapshot: RosterRebuildSnapshot, roster: WorkingRoster): Set<number> {
  const used = new Set<number>();
  for (const row of snapshot.currentRosters) {
    if (!isCountedRosterStatus(row.status)) continue;
    if (!rosterHas(roster, row.leagueId, row.memberId)) continue;
    if (row.relatedSabbaticalId != null) used.add(row.relatedSabbaticalId);
  }
  return used;
}

function nextRelatedSabbaticalId(
  snapshot: RosterRebuildSnapshot,
  leagueId: number,
  used: Set<number>,
  extra: readonly Pick<WorkingSabbatical, 'id' | 'leagueId'>[] = [],
): number | null {
  const ids = [
    ...snapshot.activeSabbaticals.filter((row) => row.leagueId === leagueId).map((row) => row.id),
    ...extra.filter((row) => row.leagueId === leagueId).map((row) => row.id),
  ].sort((a, b) => {
    if (a > 0 && b > 0) return a - b;
    if (a > 0) return -1;
    if (b > 0) return 1;
    return b - a;
  });
  for (const id of ids) {
    if (used.has(id)) continue;
    used.add(id);
    return id;
  }
  return null;
}

function rosterKindCount(roster: WorkingRoster, leagueId: number): { permanent: number; temporary: number } {
  let permanent = 0;
  let temporary = 0;
  for (const row of roster.values()) {
    if (row.leagueId !== leagueId) continue;
    if (row.isTemporary) temporary += 1;
    else permanent += 1;
  }
  return { permanent, temporary };
}

function holdKindCount(holds: Map<string, Hold>, leagueId: number): { permanent: number; temporary: number } {
  let permanent = 0;
  let temporary = 0;
  for (const hold of holds.values()) {
    if (hold.leagueId !== leagueId) continue;
    if (hold.isTemporary) temporary += 1;
    else permanent += 1;
  }
  return { permanent, temporary };
}

function vacancyLeft(
  snapshot: RosterRebuildSnapshot,
  league: RosterRebuildLeague,
  roster: WorkingRoster,
  holds: Map<string, Hold>,
  mode: WaitlistFillMode,
  extra: readonly Pick<WorkingSabbatical, 'leagueId' | 'memberId'>[] = [],
): number {
  const sabbaticals = leagueSabbaticalCount(snapshot, league.id, extra);
  const rostered = rosterKindCount(roster, league.id);
  const held = holdKindCount(holds, league.id);
  if (mode === 'permanent') {
    return league.capacityValue - rostered.permanent - held.permanent - sabbaticals;
  }
  return sabbaticals - rostered.temporary - held.temporary;
}

function vacancySnapshots(
  snapshot: RosterRebuildSnapshot,
  roster: WorkingRoster,
  holds: Map<string, Hold>,
  extra: readonly Pick<WorkingSabbatical, 'leagueId' | 'memberId'>[] = [],
): LeagueVacancySnapshot[] {
  return snapshot.leagues.map((league) => {
    const rostered = rosterKindCount(roster, league.id);
    const held = holdKindCount(holds, league.id);
    const sabbaticals = leagueSabbaticalCount(snapshot, league.id, extra);
    const permanentVacancy = Math.max(0, league.capacityValue - rostered.permanent - held.permanent - sabbaticals);
    const temporaryVacancy = Math.max(0, sabbaticals - rostered.temporary - held.temporary);
    return {
      leagueId: league.id,
      capacity: league.capacityValue,
      rostered: rostered.permanent + rostered.temporary,
      holds: held.permanent + held.temporary,
      sabbaticals,
      vacancy: permanentVacancy + temporaryVacancy,
      permanentVacancy,
      temporaryVacancy,
    };
  });
}
