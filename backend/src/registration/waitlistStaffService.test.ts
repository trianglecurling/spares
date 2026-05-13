import { describe, expect, test } from 'bun:test';
import { calculateWaitlistVacancies, resolveWaitlistDecline } from './waitlistStaffService.js';

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
