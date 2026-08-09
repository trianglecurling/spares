import { describe, expect, test } from 'bun:test';
import {
  addWaitlistPriorityFromOrder,
  buildReplaceableLeagueOptions,
  formatWaitlistPositionSuffix,
  getActiveWaitlistLeagueIds,
  isAddWaitlistSelection,
  joinWaitlistSelection,
  projectedWaitlistPosition,
  updateWaitlistEntryDetails,
  waitlistEntryCountLabel,
  waitlistEntryTypeChoices,
  waitlistEntryTypeFromSelection,
  waitlistJoinOptionDescription,
} from './registrationViewEditShared';

describe('registration waitlist display helpers', () => {
  test('projected position is one more than the active entry count', () => {
    expect(projectedWaitlistPosition(0)).toBe(1);
    expect(projectedWaitlistPosition(4)).toBe(5);
  });

  test('formatWaitlistPositionSuffix uses actual position for existing entries', () => {
    expect(formatWaitlistPositionSuffix({ isExisting: true, position: 3, activeWaitlistEntryCount: 10 })).toBe(
      '(position #3)',
    );
  });

  test('formatWaitlistPositionSuffix uses projected position for new selections', () => {
    expect(formatWaitlistPositionSuffix({ isExisting: false, activeWaitlistEntryCount: 7 })).toBe('(position #8)');
  });

  test('waitlist join option description includes entry count', () => {
    expect(waitlistJoinOptionDescription({ activeWaitlistEntryCount: 1 }, 'Thursday evenings')).toBe(
      'Thursday evenings · 1 entry on waitlist',
    );
    expect(waitlistEntryCountLabel(3)).toBe('3 entries on waitlist');
  });
});

describe('registration waitlist entry type helpers', () => {
  test('treats keep selections with a replace target as REPLACE', () => {
    expect(
      waitlistEntryTypeFromSelection({
        selectionType: 'waitlist_keep_auto_accept',
        leagueId: 3,
        replacesLeagueId: 1,
      }),
    ).toBe('replace');
    expect(
      isAddWaitlistSelection({
        selectionType: 'waitlist_keep_auto_accept',
        leagueId: 3,
        replacesLeagueId: 1,
      }),
    ).toBe(false);
  });

  test('offers only ADD when there are no replaceable leagues', () => {
    expect(
      waitlistEntryTypeChoices({
        activeLeagueIds: [],
        selections: [],
        leagueId: 10,
        replaceOptions: [],
      }),
    ).toEqual(['add']);
  });

  test('offers only REPLACE when two leagues are already scheduled', () => {
    expect(
      waitlistEntryTypeChoices({
        activeLeagueIds: [],
        selections: [
          { selectionType: 'guaranteed_return', leagueId: 1 },
          { selectionType: 'guaranteed_return', leagueId: 2 },
        ],
        leagueId: 10,
        replaceOptions: [{ value: 1 }, { value: 2 }],
      }),
    ).toEqual(['replace']);
  });

  test('joins as ADD immediately when that is the only choice', () => {
    const result = joinWaitlistSelection([], 10, {
      activeLeagueIds: [],
      replaceOptions: [],
    });
    expect(result.pendingReplacePick).toBe(false);
    expect(result.selections).toEqual([
      {
        selectionType: 'waitlist_add',
        leagueId: 10,
        replacesLeagueId: null,
        rank: null,
        byotTeammateText: null,
        teamRosterPlacements: null,
      },
    ]);
  });

  test('joins as REPLACE with the sole replaceable league when ADD is unavailable', () => {
    const result = joinWaitlistSelection(
      [
        { selectionType: 'guaranteed_return', leagueId: 1 },
        { selectionType: 'guaranteed_return', leagueId: 2 },
      ],
      10,
      {
        activeLeagueIds: [],
        replaceOptions: [{ value: 2 }],
      },
    );
    expect(result.pendingReplacePick).toBe(false);
    expect(result.selections.find((selection) => selection.leagueId === 10)).toMatchObject({
      selectionType: 'waitlist_replace',
      replacesLeagueId: 2,
    });
  });

  test('preserves auto-decline preference when editing entry type', () => {
    const next = updateWaitlistEntryDetails(
      [
        {
          selectionType: 'waitlist_add_auto_decline',
          leagueId: 10,
          rank: 1,
        },
      ],
      10,
      {
        entryType: 'replace',
        replacesLeagueId: 1,
      },
    );
    expect(next).toEqual([
      {
        selectionType: 'waitlist_replace_auto_decline',
        leagueId: 10,
        replacesLeagueId: 1,
        rank: null,
        byotTeammateText: null,
        teamRosterPlacements: null,
      },
    ]);
  });

  test('unified waitlist order includes ADD and REPLACE and stays stable when preferred order is provided', () => {
    expect(
      getActiveWaitlistLeagueIds({
        selections: [
          { selectionType: 'waitlist_replace', leagueId: 3, replacesLeagueId: 9 },
          { selectionType: 'waitlist_add', leagueId: 1 },
        ],
        existingEntries: [{ leagueId: 2, entryType: 'add', status: 'active' }],
        orderLeagueIds: [3, 2, 1],
      }),
    ).toEqual([3, 2, 1]);
  });

  test('ADD fulfillment priority is derived from unified order without reshuffling', () => {
    expect(
      addWaitlistPriorityFromOrder({
        orderLeagueIds: [3, 1, 2],
        selections: [
          { selectionType: 'waitlist_replace', leagueId: 3, replacesLeagueId: 9 },
          { selectionType: 'waitlist_add', leagueId: 1 },
          { selectionType: 'waitlist_add', leagueId: 2 },
        ],
      }),
    ).toEqual([1, 2]);
  });

  test('replaceable leagues include existing REPLACE targets even when roster active ids are empty', () => {
    const options = buildReplaceableLeagueOptions({
      activeLeagueIds: [],
      selections: [{ selectionType: 'waitlist_add', leagueId: 10 }],
      leagueName: (leagueId) => `League ${leagueId}`,
      existingEntries: [{ leagueId: 4, entryType: 'replace', replacesLeagueId: 7, status: 'active' }],
    });
    expect(options.map((option) => option.value)).toEqual([7]);
    expect(
      waitlistEntryTypeChoices({
        activeLeagueIds: [],
        selections: [{ selectionType: 'waitlist_add', leagueId: 10 }],
        existingEntries: [{ leagueId: 4, entryType: 'replace', replacesLeagueId: 7, status: 'active' }],
        leagueId: 10,
        replaceOptions: options,
      }),
    ).toEqual(['add', 'replace']);
  });

  test('replaceable leagues exclude play-in leagues', () => {
    const options = buildReplaceableLeagueOptions({
      activeLeagueIds: [1, 2],
      selections: [
        { selectionType: 'guaranteed_return', leagueId: 1 },
        { selectionType: 'play_in_request', leagueId: 2 },
      ],
      leagueName: (leagueId) => `League ${leagueId}`,
      excludedLeagueIds: [2],
    });
    expect(options.map((option) => option.value)).toEqual([1]);
  });

  test('two-REPLACE cap is skipped while ADD remains available', () => {
    expect(
      waitlistEntryTypeChoices({
        activeLeagueIds: [1],
        selections: [
          { selectionType: 'waitlist_replace', leagueId: 10, replacesLeagueId: 1 },
          { selectionType: 'waitlist_replace', leagueId: 11, replacesLeagueId: 1 },
        ],
        leagueId: 12,
        replaceOptions: [{ value: 1 }],
      }),
    ).toEqual(['add', 'replace']);
  });

  test('two-REPLACE cap applies when ADD is unavailable', () => {
    expect(
      waitlistEntryTypeChoices({
        activeLeagueIds: [1, 2],
        selections: [
          { selectionType: 'guaranteed_return', leagueId: 1 },
          { selectionType: 'guaranteed_return', leagueId: 2 },
          { selectionType: 'waitlist_replace', leagueId: 10, replacesLeagueId: 1 },
          { selectionType: 'waitlist_replace', leagueId: 11, replacesLeagueId: 2 },
        ],
        leagueId: 12,
        replaceOptions: [{ value: 1 }, { value: 2 }],
      }),
    ).toEqual([]);
  });
});
