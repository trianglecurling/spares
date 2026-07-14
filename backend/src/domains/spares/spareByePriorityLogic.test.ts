import { describe, expect, test } from 'bun:test';
import {
  BYE_PRIORITY_WAIT_MS,
} from './spareNotificationConstants.js';
import {
  PUBLIC_LISTING_HIDDEN_UNTIL_BYE_DONE,
  buildPublicSpareRecipientPools,
  buildUnavailableMemberIds,
  computeByeTeamIds,
  decideAfterQueueSend,
  initialPublicListingAt,
  isPublicSpareListable,
  memberIdsForTeams,
} from './spareByePriorityLogic.js';

const identityShuffle = <T>(items: T[]) => [...items];

describe('computeByeTeamIds', () => {
  test('marks teams with no scheduled game that day as on bye', () => {
    expect(
      computeByeTeamIds(
        [1, 2, 3, 4],
        [
          { team1Id: 1, team2Id: 2 },
          { team1Id: 1, team2Id: 3 }, // team 1 early + late still not bye
        ],
      ),
    ).toEqual([4]);
  });

  test('a team playing any draw time that day is not on bye', () => {
    expect(
      computeByeTeamIds(
        [10, 20, 30],
        [{ team1Id: 10, team2Id: 20 }],
      ),
    ).toEqual([30]);
  });

  test('returns all teams when nothing is scheduled', () => {
    expect(computeByeTeamIds([1, 2, 3], [])).toEqual([1, 2, 3]);
  });

  test('returns empty when every team plays', () => {
    expect(
      computeByeTeamIds(
        [1, 2],
        [{ team1Id: 1, team2Id: 2 }],
      ),
    ).toEqual([]);
  });
});

describe('memberIdsForTeams', () => {
  test('collects rostered members for bye teams only', () => {
    const members = memberIdsForTeams(
      [4],
      [
        { teamId: 1, memberId: 100 },
        { teamId: 4, memberId: 400 },
        { teamId: 4, memberId: 401 },
        { teamId: 2, memberId: 200 },
      ],
    );
    expect([...members].sort()).toEqual([400, 401]);
  });

  test('returns empty set when there are no bye teams', () => {
    expect(memberIdsForTeams([], [{ teamId: 1, memberId: 100 }]).size).toBe(0);
  });
});

describe('buildUnavailableMemberIds', () => {
  test('unions people playing the draw and people already sparing that slot', () => {
    const unavailable = buildUnavailableMemberIds({
      playingAtDraw: [1, 2],
      alreadySparingAtDraw: [2, 3],
    });
    expect([...unavailable].sort()).toEqual([1, 2, 3]);
  });
});

describe('buildPublicSpareRecipientPools', () => {
  const available = [{ id: 10 }, { id: 11 }, { id: 12 }];

  test('puts bye recipients first and excludes requester, CCs, and unavailable', () => {
    const pools = buildPublicSpareRecipientPools({
      availableMembers: available,
      byeMemberIds: [20, 11],
      extraByeMembers: [{ id: 20 }],
      requesterId: 1,
      excludeMemberIds: [12],
      unavailableMemberIds: [11],
      shuffle: identityShuffle,
    });

    expect(pools.byeRecipients.map((m) => m.id)).toEqual([20]);
    expect(pools.otherRecipients.map((m) => m.id)).toEqual([10]);
    expect(pools.orderedRecipients.map((m) => ({ id: m.id, bye: m.isByePriority }))).toEqual([
      { id: 20, bye: true },
      { id: 10, bye: false },
    ]);
  });

  test('adds bye players even when they are not in the availability pool', () => {
    const pools = buildPublicSpareRecipientPools({
      availableMembers: [{ id: 10 }],
      byeMemberIds: [20],
      extraByeMembers: [{ id: 20 }],
      requesterId: 1,
      unavailableMemberIds: [],
      shuffle: identityShuffle,
    });

    expect(pools.byeRecipients.map((m) => m.id)).toEqual([20]);
    expect(pools.otherRecipients.map((m) => m.id)).toEqual([10]);
  });

  test('does not duplicate a bye player who is also available', () => {
    const pools = buildPublicSpareRecipientPools({
      availableMembers: [{ id: 20 }, { id: 10 }],
      byeMemberIds: [20],
      requesterId: 1,
      unavailableMemberIds: [],
      shuffle: identityShuffle,
    });

    expect(pools.byeRecipients.map((m) => m.id)).toEqual([20]);
    expect(pools.otherRecipients.map((m) => m.id)).toEqual([10]);
    expect(pools.orderedRecipients).toHaveLength(2);
  });

  test('excludes bye players who already accepted a spare for that draw', () => {
    const pools = buildPublicSpareRecipientPools({
      availableMembers: [{ id: 10 }],
      byeMemberIds: [20],
      extraByeMembers: [{ id: 20 }],
      requesterId: 1,
      unavailableMemberIds: [20],
      shuffle: identityShuffle,
    });

    expect(pools.byeRecipients).toEqual([]);
    expect(pools.otherRecipients.map((m) => m.id)).toEqual([10]);
  });

  test('for skip requests, only includes bye members who can skip (or are already available)', () => {
    const pools = buildPublicSpareRecipientPools({
      availableMembers: [{ id: 10 }],
      byeMemberIds: [20, 21, 22],
      extraByeMembers: [{ id: 20 }, { id: 21 }, { id: 22 }],
      requesterId: 1,
      unavailableMemberIds: [],
      position: 'skip',
      canSkipMemberIds: [20],
      shuffle: identityShuffle,
    });

    // 20 can skip; 21/22 cannot and are not in available pool
    expect(pools.byeRecipients.map((m) => m.id)).toEqual([20]);
  });

  test('for skip requests, available bye members remain even without can_skip row lookup', () => {
    const pools = buildPublicSpareRecipientPools({
      availableMembers: [{ id: 20 }],
      byeMemberIds: [20],
      requesterId: 1,
      unavailableMemberIds: [],
      position: 'skip',
      canSkipMemberIds: [],
      shuffle: identityShuffle,
    });

    expect(pools.byeRecipients.map((m) => m.id)).toEqual([20]);
  });
});

describe('initialPublicListingAt / isPublicSpareListable', () => {
  const now = new Date('2026-07-13T12:00:00.000Z');

  test('lists immediately when urgent, even with bye players', () => {
    expect(
      initialPublicListingAt({
        now,
        isLessThan24Hours: true,
        hasByePriority: true,
      }),
    ).toEqual(now);
  });

  test('lists immediately when staggered with no bye players', () => {
    expect(
      initialPublicListingAt({
        now,
        isLessThan24Hours: false,
        hasByePriority: false,
      }),
    ).toEqual(now);
  });

  test('hides listing until bye batch completes for staggered bye requests', () => {
    expect(
      initialPublicListingAt({
        now,
        isLessThan24Hours: false,
        hasByePriority: true,
      }),
    ).toEqual(PUBLIC_LISTING_HIDDEN_UNTIL_BYE_DONE);
  });

  test('dashboard visibility uses public_listing_at threshold', () => {
    expect(isPublicSpareListable({ publicListingAt: null, now })).toBe(true);
    expect(isPublicSpareListable({ publicListingAt: now, now })).toBe(true);
    expect(
      isPublicSpareListable({
        publicListingAt: new Date(now.getTime() + 60_000),
        now,
      }),
    ).toBe(false);
    expect(
      isPublicSpareListable({
        publicListingAt: PUBLIC_LISTING_HIDDEN_UNTIL_BYE_DONE,
        now,
      }),
    ).toBe(false);
  });
});

describe('decideAfterQueueSend', () => {
  test('stops when the request is no longer open', () => {
    expect(
      decideAfterQueueSend({
        requestStillOpen: false,
        remainingQueue: [{ isByePriority: true }],
        processedWasByePriority: true,
        staggerDelaySeconds: 180,
      }),
    ).toEqual({ kind: 'stop_request_closed' });
  });

  test('completes when the queue is empty', () => {
    expect(
      decideAfterQueueSend({
        requestStillOpen: true,
        remainingQueue: [],
        processedWasByePriority: true,
        staggerDelaySeconds: 180,
      }),
    ).toEqual({ kind: 'complete' });
  });

  test('continues bye batch with no delay between bye recipients', () => {
    expect(
      decideAfterQueueSend({
        requestStillOpen: true,
        remainingQueue: [{ isByePriority: true }, { isByePriority: false }],
        processedWasByePriority: true,
        staggerDelaySeconds: 180,
      }),
    ).toEqual({ kind: 'continue_bye_immediately' });
  });

  test('starts the one-hour wait after the last bye notify when others remain', () => {
    expect(
      decideAfterQueueSend({
        requestStillOpen: true,
        remainingQueue: [{ isByePriority: false }, { isByePriority: false }],
        processedWasByePriority: true,
        staggerDelaySeconds: 180,
      }),
    ).toEqual({ kind: 'start_bye_wait', waitMs: BYE_PRIORITY_WAIT_MS });
  });

  test('uses configured stagger delay for the general pool', () => {
    expect(
      decideAfterQueueSend({
        requestStillOpen: true,
        remainingQueue: [{ isByePriority: false }],
        processedWasByePriority: false,
        staggerDelaySeconds: 120,
      }),
    ).toEqual({ kind: 'stagger_delay', delaySeconds: 120 });
  });

  test('bye wait defaults to one hour', () => {
    expect(BYE_PRIORITY_WAIT_MS).toBe(60 * 60 * 1000);
  });
});
