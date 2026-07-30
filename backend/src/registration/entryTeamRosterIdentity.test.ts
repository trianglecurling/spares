import { describe, expect, test } from 'bun:test';
import {
  entryTeamAccountMemberIdSet,
  sameEntryTeamMemberIdSet,
} from './leagueEntryService.js';

describe('entry team roster identity', () => {
  test('same members in different order are equal', () => {
    const johnFirst = entryTeamAccountMemberIdSet([
      { member_id: 1 },
      { memberId: 2 },
      { member_id: 3 },
      { member_id: 4 },
    ]);
    const benFirst = entryTeamAccountMemberIdSet([
      { member_id: 4 },
      { member_id: 3 },
      { member_id: 1 },
      { member_id: 2 },
    ]);
    expect(sameEntryTeamMemberIdSet(johnFirst, benFirst)).toBe(true);
  });

  test('different membership is not equal', () => {
    const teamA = entryTeamAccountMemberIdSet([{ member_id: 1 }, { member_id: 2 }, { member_id: 3 }, { member_id: 4 }]);
    const teamB = entryTeamAccountMemberIdSet([{ member_id: 1 }, { member_id: 2 }, { member_id: 3 }, { member_id: 5 }]);
    expect(sameEntryTeamMemberIdSet(teamA, teamB)).toBe(false);
  });

  test('empty sets are not treated as matching teams', () => {
    expect(sameEntryTeamMemberIdSet(new Set(), new Set())).toBe(false);
  });
});
