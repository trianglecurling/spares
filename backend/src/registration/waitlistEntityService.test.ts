import { describe, expect, test } from 'bun:test';
import {
  findSessionWaitlistAttachmentConflict,
  leagueAllowsWaitlist,
} from './waitlistEntityService.js';

describe('waitlistEntityService', () => {
  test('leagueAllowsWaitlist is true only when waitlist_id is set', () => {
    expect(leagueAllowsWaitlist({ waitlist_id: 3 })).toBe(true);
    expect(leagueAllowsWaitlist({ waitlist_id: null })).toBe(false);
    expect(leagueAllowsWaitlist({ allows_waitlist: 1 })).toBe(false);
  });

  test('findSessionWaitlistAttachmentConflict blocks a second league in the same session', () => {
    const leagues = [
      { id: 10, sessionId: 1, waitlistId: 5 },
      { id: 11, sessionId: 1, waitlistId: 5 },
      { id: 20, sessionId: 2, waitlistId: 5 },
    ];
    expect(findSessionWaitlistAttachmentConflict(leagues, 11, 1, 5)).toBe(10);
    expect(findSessionWaitlistAttachmentConflict(leagues, 10, 1, 5)).toBe(11);
    expect(findSessionWaitlistAttachmentConflict(leagues, 20, 2, 5)).toBeNull();
    expect(findSessionWaitlistAttachmentConflict(leagues, 10, 1, 99)).toBeNull();
  });
});
