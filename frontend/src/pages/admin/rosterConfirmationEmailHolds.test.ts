import { describe, expect, test } from 'bun:test';
import {
  canHoldRosterConfirmationEmail,
  parseRosterConfirmationEmailHolds,
  rosterConfirmationSendAllMemberIds,
} from './rosterConfirmationEmailHolds';

describe('roster confirmation email holds', () => {
  test('parses stored member ids and ignores junk', () => {
    expect(parseRosterConfirmationEmailHolds(null)).toEqual([]);
    expect(parseRosterConfirmationEmailHolds('{"no":true}')).toEqual([]);
    expect(parseRosterConfirmationEmailHolds('[12, 12, "x", 0, 15]')).toEqual([12, 15]);
  });

  test('send all skips held, sent, and unsendable members', () => {
    expect(
      rosterConfirmationSendAllMemberIds(
        [
          { memberId: 1, canSend: true, alreadySent: false },
          { memberId: 2, canSend: true, alreadySent: false },
          { memberId: 3, canSend: true, alreadySent: true },
          { memberId: 4, canSend: false, alreadySent: false },
        ],
        new Set([2]),
      ),
    ).toEqual([1]);
  });

  test('only unsent sendable emails can be held', () => {
    expect(canHoldRosterConfirmationEmail({ canSend: true, alreadySent: false })).toBe(true);
    expect(canHoldRosterConfirmationEmail({ canSend: true, alreadySent: true })).toBe(false);
    expect(canHoldRosterConfirmationEmail({ canSend: false, alreadySent: false })).toBe(false);
  });
});
