import { describe, expect, test } from 'bun:test';
import {
  isPrimaryWaitlistEntryMember,
  memberParticipationOnWaitlistEntry,
  waitlistEntryIncludesMember,
  waitlistTeammateContactMessage,
} from './waitlistMemberMembership.js';

describe('waitlistMemberMembership', () => {
  test('treats primary and roster members as on the waitlist entry', () => {
    const entry = {
      memberId: 10,
      teamRosterPlacements: JSON.stringify([
        { memberId: 10, entryType: 'add' },
        { memberId: 20, entryType: 'replace', replacesLeagueId: 5 },
      ]),
    };

    expect(waitlistEntryIncludesMember(10, entry)).toBe(true);
    expect(waitlistEntryIncludesMember(20, entry)).toBe(true);
    expect(waitlistEntryIncludesMember(30, entry)).toBe(false);
  });

  test('identifies primary members and builds teammate contact copy', () => {
    expect(isPrimaryWaitlistEntryMember({ memberId: 10 }, 10)).toBe(true);
    expect(isPrimaryWaitlistEntryMember({ memberId: 10 }, 20)).toBe(false);
    expect(waitlistTeammateContactMessage('Alice Example')).toBe(
      'You are on this waitlist because you were listed as a team member by Alice Example. If you need to leave this waitlist or change your entry, please contact Alice Example.',
    );
  });

  test('uses each member placement for participation details', () => {
    const entry = {
      memberId: 10,
      entryType: 'add' as const,
      replacesLineageStartLeagueId: null,
      originalReplacesLeagueId: null,
      teamRosterPlacements: JSON.stringify([
        { memberId: 10, entryType: 'add' },
        { memberId: 20, entryType: 'replace', replacesLeagueId: 5 },
      ]),
    };

    expect(memberParticipationOnWaitlistEntry(20, entry)).toEqual({
      entryType: 'replace',
      replacesLeagueId: 5,
    });
  });
});
