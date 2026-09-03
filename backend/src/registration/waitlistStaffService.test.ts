import { describe, expect, test } from 'bun:test';
import { calculateWaitlistVacancies, resolveWaitlistDecline } from './waitlistStaffService.js';
import {
  filterEntriesForBatchOffers,
  sortEntriesByPriority,
  type WaitlistEntryCoordinationRow,
} from './waitlistOfferCoordination.js';

function entry(overrides: Partial<WaitlistEntryCoordinationRow> & Pick<WaitlistEntryCoordinationRow, 'id'>): WaitlistEntryCoordinationRow {
  return {
    member_id: 1,
    waitlist_id: overrides.id,
    source_registration_id: 5,
    priority_rank: 1,
    desired_league_count: 1,
    status: 'active',
    ...overrides,
  };
}

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

  test('earmarked registration demand reduces permanent vacancies', () => {
    expect(
      calculateWaitlistVacancies({
        capacity: 24,
        permanentPlacements: 0,
        temporaryPlacements: 0,
        activeSabbaticals: 0,
        earmarkedDemand: 33,
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

  test('sortEntriesByPriority orders by priority rank then entry id', () => {
    const sorted = sortEntriesByPriority([
      entry({ id: 20, priority_rank: 2 }),
      entry({ id: 10, priority_rank: 1 }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual([10, 20]);
  });

  test('sortEntriesByPriority puts entries without a rank last', () => {
    const sorted = sortEntriesByPriority([
      entry({ id: 20, priority_rank: null }),
      entry({ id: 10, priority_rank: 3 }),
    ]);
    expect(sorted.map((row) => row.id)).toEqual([10, 20]);
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

describe('batch offers follow the priority list', () => {
  test('a member wanting one league is only offered their highest-ranked entry', () => {
    const filtered = filterEntriesForBatchOffers(
      [
        entry({ id: 1, priority_rank: 2, desired_league_count: 1 }),
        entry({ id: 2, priority_rank: 1, desired_league_count: 1 }),
      ],
      new Set(),
    );
    expect(filtered.map((row) => row.id)).toEqual([2]);
  });

  test('a member wanting two leagues is offered their top two', () => {
    const filtered = filterEntriesForBatchOffers(
      [
        entry({ id: 1, priority_rank: 3, desired_league_count: 2 }),
        entry({ id: 2, priority_rank: 1, desired_league_count: 2 }),
        entry({ id: 3, priority_rank: 2, desired_league_count: 2 }),
      ],
      new Set(),
    );
    expect(filtered.map((row) => row.id).sort()).toEqual([2, 3]);
  });

  test('members are limited independently of one another', () => {
    const filtered = filterEntriesForBatchOffers(
      [
        entry({ id: 1, member_id: 1, source_registration_id: 5, priority_rank: 1, desired_league_count: 1 }),
        entry({ id: 2, member_id: 1, source_registration_id: 5, priority_rank: 2, desired_league_count: 1 }),
        entry({ id: 3, member_id: 2, source_registration_id: 6, priority_rank: 1, desired_league_count: 1 }),
      ],
      new Set(),
    );
    expect(filtered.map((row) => row.id)).toEqual([1, 3]);
  });

  test('an entry with no stated count is never held back', () => {
    const filtered = filterEntriesForBatchOffers(
      [
        entry({ id: 1, priority_rank: null, desired_league_count: null }),
        entry({ id: 2, priority_rank: null, desired_league_count: null }),
      ],
      new Set(),
    );
    expect(filtered.map((row) => row.id)).toEqual([1, 2]);
  });
});
