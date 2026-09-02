import { describe, expect, test } from 'bun:test';
import type { TournamentTeamRow } from './eventTournamentTeamsService.js';
import {
  catalogPlayerPositionFromSlot,
  compareCatalogPlayers,
  eventHasConcluded,
  leagueHasConcluded,
  mapLeagueMemberToCatalogPlayer,
  mapTournamentTeamToCatalogTeam,
  resolveCatalogTeamName,
  toDateOnly,
  type CatalogPlayer,
} from './teamCatalogService.js';

function player(overrides: Partial<CatalogPlayer> = {}): CatalogPlayer {
  return {
    firstName: 'Ada',
    lastName: 'Skip',
    homeClub: 'Triangle Curling',
    position: 'fourth',
    isVice: false,
    isSkip: true,
    ...overrides,
  };
}

function tournamentTeam(overrides: Partial<TournamentTeamRow> = {}): TournamentTeamRow {
  return {
    id: 1,
    eventId: 10,
    sortOrder: 0,
    teamName: 'Sweeping Beauties',
    homeClub: 'Super Curling Club',
    viceSlotCode: 'third',
    skipSlotCode: 'fourth',
    roster: [
      {
        slotCode: 'lead',
        playerName: 'Jaclyn Browne',
        email: null,
        notes: null,
        homeClub: 'Super Curling Club',
      },
      {
        slotCode: 'second',
        playerName: 'Pat Jones',
        email: null,
        notes: null,
        homeClub: 'Super Curling Club',
      },
      {
        slotCode: 'third',
        playerName: 'Riley Chen',
        email: null,
        notes: null,
        homeClub: 'Other Club',
      },
      {
        slotCode: 'fourth',
        playerName: 'Sam Skip',
        email: null,
        notes: null,
        homeClub: 'Super Curling Club',
      },
    ],
    ...overrides,
  };
}

describe('team catalog mapping', () => {
  test('accepts fours and doubles slots and rejects unknown positions', () => {
    expect(catalogPlayerPositionFromSlot('lead')).toBe('lead');
    expect(catalogPlayerPositionFromSlot('player2')).toBe('player2');
    expect(catalogPlayerPositionFromSlot('alternate')).toBeNull();
  });

  test('maps a bonspiel roster into named players with vice and skip flags', () => {
    const team = mapTournamentTeamToCatalogTeam(tournamentTeam());
    expect(team.teamName).toBe('Sweeping Beauties');
    expect(team.players.map((p) => p.position)).toEqual(['lead', 'second', 'third', 'fourth']);
    expect(team.players[0]).toEqual({
      firstName: 'Jaclyn',
      lastName: 'Browne',
      homeClub: 'Super Curling Club',
      position: 'lead',
      isVice: false,
      isSkip: false,
    });
    expect(team.players.find((p) => p.position === 'third')?.isVice).toBe(true);
    expect(team.players.find((p) => p.position === 'fourth')?.isSkip).toBe(true);
  });

  test('omits empty bonspiel roster slots', () => {
    const team = mapTournamentTeamToCatalogTeam(
      tournamentTeam({
        roster: [
          { slotCode: 'lead', playerName: '  ', email: null, notes: null, homeClub: null },
          { slotCode: 'second', playerName: 'Pat Jones', email: null, notes: null, homeClub: null },
          { slotCode: 'third', playerName: null, email: null, notes: null, homeClub: null },
          { slotCode: 'fourth', playerName: null, email: null, notes: null, homeClub: null },
        ],
      }),
    );
    expect(team.players).toHaveLength(1);
    expect(team.players[0]?.firstName).toBe('Pat');
    expect(team.players[0]?.homeClub).toBe('');
  });

  test('maps doubles vice and skip from slot codes', () => {
    const team = mapTournamentTeamToCatalogTeam(
      tournamentTeam({
        teamName: 'Doubles Duo',
        viceSlotCode: 'player1',
        skipSlotCode: 'player2',
        roster: [
          { slotCode: 'player1', playerName: 'Alex Vice', email: null, notes: null, homeClub: 'Home' },
          { slotCode: 'player2', playerName: 'Blake Skip', email: null, notes: null, homeClub: 'Away' },
        ],
      }),
    );
    expect(team.players).toEqual([
      {
        firstName: 'Alex',
        lastName: 'Vice',
        homeClub: 'Home',
        position: 'player1',
        isVice: true,
        isSkip: false,
      },
      {
        firstName: 'Blake',
        lastName: 'Skip',
        homeClub: 'Away',
        position: 'player2',
        isVice: false,
        isSkip: true,
      },
    ]);
  });

  test('maps league members from stored first and last names', () => {
    expect(
      mapLeagueMemberToCatalogPlayer({
        firstName: 'Jaclyn',
        lastName: 'Browne',
        name: 'Jaclyn Browne',
        role: 'lead',
        isSkip: false,
        isVice: false,
        homeClub: 'Triangle Curling',
      }),
    ).toEqual({
      firstName: 'Jaclyn',
      lastName: 'Browne',
      homeClub: 'Triangle Curling',
      position: 'lead',
      isVice: false,
      isSkip: false,
    });
  });

  test('falls back to splitting the display name when first/last are empty', () => {
    expect(
      mapLeagueMemberToCatalogPlayer({
        firstName: null,
        lastName: null,
        name: 'Pat Jones',
        role: 'second',
        isSkip: false,
        isVice: true,
        homeClub: 'Triangle Curling',
      }),
    ).toMatchObject({
      firstName: 'Pat',
      lastName: 'Jones',
      position: 'second',
      isVice: true,
    });
  });

  test('sorts players in throwing order', () => {
    const sorted = [
      player({ position: 'fourth', firstName: 'D', lastName: 'Four' }),
      player({ position: 'lead', firstName: 'A', lastName: 'One' }),
      player({ position: 'player1', firstName: 'E', lastName: 'Double' }),
      player({ position: 'third', firstName: 'C', lastName: 'Three' }),
    ].sort(compareCatalogPlayers);
    expect(sorted.map((p) => p.position)).toEqual(['lead', 'third', 'fourth', 'player1']);
  });

  test('uses skip last name when a league team has no stored name', () => {
    expect(resolveCatalogTeamName(null, [player({ lastName: 'Browne' })])).toBe('Team Browne');
    expect(resolveCatalogTeamName('  ', [])).toBe('Unnamed team');
    expect(resolveCatalogTeamName(' Hammer Time ', [player()])).toBe('Hammer Time');
  });
});

describe('team catalog concluded filters', () => {
  test('reads YYYY-MM-DD from strings and dates', () => {
    expect(toDateOnly('2026-09-02')).toBe('2026-09-02');
    expect(toDateOnly('2026-09-02T18:00:00.000Z')).toBe('2026-09-02');
    expect(toDateOnly(new Date('2026-09-02T00:00:00.000Z'))).toBe('2026-09-02');
    expect(toDateOnly(null)).toBeNull();
  });

  test('treats a league as current through its last day of play', () => {
    expect(
      leagueHasConcluded({ lastDayOfPlay: '2026-09-02', endDate: '2026-08-01' }, '2026-09-02'),
    ).toBe(false);
    expect(
      leagueHasConcluded({ lastDayOfPlay: '2026-09-01', endDate: '2026-09-30' }, '2026-09-02'),
    ).toBe(true);
    expect(leagueHasConcluded({ lastDayOfPlay: null, endDate: '2026-09-02' }, '2026-09-02')).toBe(false);
    expect(leagueHasConcluded({ lastDayOfPlay: null, endDate: null }, '2026-09-02')).toBe(true);
  });

  test('treats an event as current until its latest timespan ends', () => {
    const now = Date.parse('2026-09-02T12:00:00.000Z');
    expect(eventHasConcluded(Date.parse('2026-09-02T12:00:00.000Z'), now)).toBe(false);
    expect(eventHasConcluded(Date.parse('2026-09-02T11:59:59.000Z'), now)).toBe(true);
  });
});
