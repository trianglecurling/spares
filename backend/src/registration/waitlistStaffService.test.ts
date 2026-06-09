import { describe, expect, test } from 'bun:test';
import { calculateWaitlistVacancies, resolveWaitlistDecline } from './waitlistStaffService.js';
import { sortAddEntriesByPriority } from './waitlistOfferCoordination.js';

describe('Phase 8 staff waitlist helpers', () => {
  test('vacancy calculation separates permanent vacancies from temporary sabbatical-fill vacancies', () => {
    expect(
      calculateWaitlistVacancies({
        capacity: 32,
        permanentPlacements: 28,
        temporaryPlacements: 1,
        activeSabbaticals: 2,
      })
    ).toEqual({
      permanentVacancies: 2,
      temporarySabbaticalFillVacancies: 1,
    });
  });

  test('vacancy calculation never returns negative vacancy counts', () => {
    expect(
      calculateWaitlistVacancies({
        capacity: 8,
        permanentPlacements: 10,
        temporaryPlacements: 3,
        activeSabbaticals: 1,
      })
    ).toEqual({
      permanentVacancies: 0,
      temporarySabbaticalFillVacancies: 0,
    });
  });

  test('first decline preserves position and increments decline count', () => {
    expect(
      resolveWaitlistDecline({
        declineCount: 0,
        positionSortKey: '001:first',
        nextPositionSortKey: '999:bottom',
      })
    ).toEqual({
      declineCount: 1,
      positionSortKey: '001:first',
      movedToBottom: false,
    });
  });

  test('sortAddEntriesByPriority orders by rank then entry id', () => {
    const sorted = sortAddEntriesByPriority([
      {
        id: 20,
        member_id: 1,
        waitlist_id: 1,
        source_registration_id: 5,
        entry_type: 'add',
        desired_add_waitlist_league_count: 1,
        add_waitlist_priority_rank: 2,
        status: 'active',
      },
      {
        id: 10,
        member_id: 1,
        waitlist_id: 2,
        source_registration_id: 5,
        entry_type: 'add',
        desired_add_waitlist_league_count: 1,
        add_waitlist_priority_rank: 1,
        status: 'active',
      },
    ]);
    expect(sorted.map((entry) => entry.id)).toEqual([10, 20]);
  });

  test('second decline moves the member to the bottom and resets decline count', () => {
    expect(
      resolveWaitlistDecline({
        declineCount: 1,
        positionSortKey: '001:first',
        nextPositionSortKey: '999:bottom',
      })
    ).toEqual({
      declineCount: 0,
      positionSortKey: '999:bottom',
      movedToBottom: true,
    });
  });
});
