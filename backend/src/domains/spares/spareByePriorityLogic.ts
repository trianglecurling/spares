import { BYE_PRIORITY_WAIT_MS } from './spareNotificationConstants.js';

/** Far-future placeholder until the bye batch finishes and sets the real listing time. */
export const PUBLIC_LISTING_HIDDEN_UNTIL_BYE_DONE = new Date('2099-01-01T00:00:00.000Z');

/**
 * Teams on bye for a league day: every league team with no scheduled game
 * on that date at any draw time.
 */
export function computeByeTeamIds(
  allTeamIds: number[],
  scheduledGamesOnDate: Array<{ team1Id: number; team2Id: number }>,
): number[] {
  const playingTeamIds = new Set(
    scheduledGamesOnDate.flatMap((game) => [game.team1Id, game.team2Id]),
  );
  return allTeamIds.filter((id) => !playingTeamIds.has(id));
}

/** Collect rostered member IDs for the given team IDs. */
export function memberIdsForTeams(
  teamIds: number[],
  teamMembers: Array<{ teamId: number; memberId: number }>,
): Set<number> {
  if (teamIds.length === 0) return new Set();
  const teamIdSet = new Set(teamIds);
  const memberIds = new Set<number>();
  for (const row of teamMembers) {
    if (teamIdSet.has(row.teamId)) {
      memberIds.add(row.memberId);
    }
  }
  return memberIds;
}

/** People we know cannot take this spare slot. */
export function buildUnavailableMemberIds(params: {
  playingAtDraw: Iterable<number>;
  alreadySparingAtDraw: Iterable<number>;
}): Set<number> {
  return new Set([...params.playingAtDraw, ...params.alreadySparingAtDraw]);
}

function defaultShuffle<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

/**
 * Build bye-first / randomized-other public notification pools from already-loaded inputs.
 * DB filtering for subscribed/non-social happens before calling this.
 */
export function buildPublicSpareRecipientPools<T extends { id: number }>(params: {
  availableMembers: T[];
  byeMemberIds: Iterable<number>;
  /** Bye members not already present in availableMembers (must be pre-filtered for notify eligibility). */
  extraByeMembers?: T[];
  requesterId: number;
  excludeMemberIds?: Iterable<number>;
  unavailableMemberIds: Iterable<number>;
  position?: string | null;
  /** Required when position is skip: bye members must be able to skip unless already in availableMembers. */
  canSkipMemberIds?: Iterable<number>;
  shuffle?: <U>(items: U[]) => U[];
}): {
  byeRecipients: T[];
  otherRecipients: T[];
  orderedRecipients: Array<T & { isByePriority: boolean }>;
} {
  const shuffle = params.shuffle ?? defaultShuffle;
  const exclude = new Set<number>([params.requesterId, ...(params.excludeMemberIds ?? [])]);
  const unavailable = new Set(params.unavailableMemberIds);
  const availableById = new Map(params.availableMembers.map((row) => [row.id, row]));
  const canSkip = new Set(params.canSkipMemberIds ?? []);

  let byeCandidateIds = [...params.byeMemberIds].filter(
    (id) => !exclude.has(id) && !unavailable.has(id),
  );

  if (params.position === 'skip') {
    byeCandidateIds = byeCandidateIds.filter((id) => canSkip.has(id) || availableById.has(id));
  }

  const memberById = new Map<number, T>(availableById);
  for (const row of params.extraByeMembers ?? []) {
    memberById.set(row.id, row);
  }

  const byeRecipients = shuffle(
    byeCandidateIds.map((id) => memberById.get(id)).filter((m): m is T => Boolean(m)),
  );
  const byeIdSet = new Set(byeRecipients.map((m) => m.id));

  const otherRecipients = shuffle(
    params.availableMembers.filter(
      (row) => !exclude.has(row.id) && !unavailable.has(row.id) && !byeIdSet.has(row.id),
    ),
  );

  const orderedRecipients = [
    ...byeRecipients.map((m) => ({ ...m, isByePriority: true as const })),
    ...otherRecipients.map((m) => ({ ...m, isByePriority: false as const })),
  ];

  return { byeRecipients, otherRecipients, orderedRecipients };
}

/**
 * Initial dashboard listing timestamp when a public notification run starts.
 * Staggered requests with bye players stay hidden until the bye batch completes.
 */
export function initialPublicListingAt(params: {
  now: Date;
  isLessThan24Hours: boolean;
  hasByePriority: boolean;
}): Date {
  if (!params.isLessThan24Hours && params.hasByePriority) {
    return PUBLIC_LISTING_HIDDEN_UNTIL_BYE_DONE;
  }
  return params.now;
}

/** Whether a public spare should appear on member dashboards. */
export function isPublicSpareListable(params: {
  publicListingAt: Date | string | null | undefined;
  now: Date;
}): boolean {
  if (params.publicListingAt == null) {
    // Legacy rows without a listing timestamp remain visible.
    return true;
  }
  const listingAt =
    params.publicListingAt instanceof Date
      ? params.publicListingAt
      : new Date(params.publicListingAt);
  if (Number.isNaN(listingAt.getTime())) {
    return true;
  }
  return listingAt.getTime() <= params.now.getTime();
}

export type AfterQueueSendDecision =
  | { kind: 'stop_request_closed' }
  | { kind: 'complete' }
  | { kind: 'continue_bye_immediately' }
  | { kind: 'start_bye_wait'; waitMs: number }
  | { kind: 'stagger_delay'; delaySeconds: number };

/**
 * Decide what happens after one queue notification is processed.
 */
export function decideAfterQueueSend(params: {
  requestStillOpen: boolean;
  remainingQueue: Array<{ isByePriority: boolean }>;
  processedWasByePriority: boolean;
  staggerDelaySeconds: number;
  byeWaitMs?: number;
}): AfterQueueSendDecision {
  if (!params.requestStillOpen) {
    return { kind: 'stop_request_closed' };
  }

  if (params.remainingQueue.length === 0) {
    return { kind: 'complete' };
  }

  const remainingBye = params.remainingQueue.some((row) => row.isByePriority);
  const byeWaitMs = params.byeWaitMs ?? BYE_PRIORITY_WAIT_MS;

  if (params.processedWasByePriority && !remainingBye) {
    return { kind: 'start_bye_wait', waitMs: byeWaitMs };
  }

  if (remainingBye || params.processedWasByePriority) {
    return { kind: 'continue_bye_immediately' };
  }

  return {
    kind: 'stagger_delay',
    delaySeconds: params.staggerDelaySeconds,
  };
}
