import { describe, expect, test } from 'bun:test';
import { emptyTournamentDraw } from './tournamentDrawBuilders';
import {
  competitorLabelIsActualParticipant,
  fourthPositionLastName,
  printCardShowsFullRouting,
  printCardShowsParticipants,
  printCompetitorDisplayText,
  printGameCardHeight,
  printLoserRouteFromLines,
  sheetBadgeGlyph,
} from './tournamentDrawPrintCard';
import { PRINT_BRACKET_LAYOUT_METRICS } from './tournamentDrawBracketLayout';

const teamsById = new Map([
  [1, { teamName: 'Hammer Time', sortOrder: 0 }],
  [2, { teamName: null, sortOrder: 3 }],
]);

describe('competitorLabelIsActualParticipant', () => {
  test('accepts named teams and byes', () => {
    expect(competitorLabelIsActualParticipant('Hammer Time', teamsById)).toBe(true);
    expect(competitorLabelIsActualParticipant('Team 4', teamsById)).toBe(true);
    expect(competitorLabelIsActualParticipant('Bye', teamsById)).toBe(true);
  });

  test('rejects feeder pipes and empty placeholders', () => {
    expect(competitorLabelIsActualParticipant('W-B6', teamsById)).toBe(false);
    expect(competitorLabelIsActualParticipant('L-A1', teamsById)).toBe(false);
    expect(competitorLabelIsActualParticipant('3rd C1', teamsById)).toBe(false);
    expect(competitorLabelIsActualParticipant('TBD', teamsById)).toBe(false);
    expect(competitorLabelIsActualParticipant('Team…', teamsById)).toBe(false);
  });

  test('does not treat a team named like an ordinal as a pipe label', () => {
    const teams = new Map([[9, { teamName: '1st Street', sortOrder: 0 }]]);
    expect(competitorLabelIsActualParticipant('1st Street', teams)).toBe(true);
  });
});

describe('printCardShowsParticipants', () => {
  test('shows the competitor line when any side is a real participant', () => {
    expect(printCardShowsParticipants([{ text: 'Hammer Time' }, { text: 'W-B6' }], teamsById)).toBe(
      true
    );
  });

  test('hides the competitor line when both sides are pipes', () => {
    expect(printCardShowsParticipants([{ text: 'W-B6' }, { text: 'W-B7' }], teamsById)).toBe(false);
  });
});

describe('fourthPositionLastName', () => {
  test('uses the fourth player last name', () => {
    expect(
      fourthPositionLastName({
        teamName: 'Hammer Time',
        sortOrder: 0,
        roster: [
          { slotCode: 'lead', playerName: 'Pat Lead' },
          { slotCode: 'fourth', playerName: 'Jordan Skipworth' },
        ],
      })
    ).toBe('Skipworth');
  });

  test('falls back to a single given name', () => {
    expect(
      fourthPositionLastName({
        teamName: 'Solo',
        sortOrder: 0,
        roster: [{ slotCode: 'fourth', playerName: 'Cher' }],
      })
    ).toBe('Cher');
  });
});

describe('printCompetitorDisplayText', () => {
  const teams = new Map([
    [
      1,
      {
        teamName: 'Hammer Time',
        sortOrder: 0,
        roster: [{ slotCode: 'fourth', playerName: 'Jordan Skipworth' }],
      },
    ],
  ]);

  test('replaces a team label with the fourth last name', () => {
    expect(printCompetitorDisplayText('Hammer Time', teams)).toBe('Skipworth');
    expect(printCompetitorDisplayText('Hammer Time', teams, 1)).toBe('Skipworth');
  });
});

describe('sheetBadgeGlyph', () => {
  test('strips a Sheet prefix and keeps a short mark', () => {
    expect(sheetBadgeGlyph('Sheet A')).toBe('A');
    expect(sheetBadgeGlyph('A')).toBe('A');
    expect(sheetBadgeGlyph('Sheet 12')).toBe('12');
  });
});

describe('printLoserRouteFromLines', () => {
  test('picks the loser route', () => {
    expect(
      printLoserRouteFromLines([
        { key: 'g-1-next', text: 'W-C1' },
        { key: 'g-2-other', text: 'L-B8' },
      ])
    ).toBe('L-B8');
  });
});

describe('printCardShowsFullRouting', () => {
  test('keeps two-sided games on loser-only print routing', () => {
    expect(printCardShowsFullRouting(2)).toBe(false);
  });

  test('shows every place route on multi-entry games', () => {
    expect(printCardShowsFullRouting(3)).toBe(true);
    expect(printCardShowsFullRouting(4)).toBe(true);
  });
});

describe('printGameCardHeight', () => {
  test('grows the print card when every place route must be listed', () => {
    const draw = emptyTournamentDraw(1);
    const eventId = draw.setup.events[0]!.id;
    const game = {
      id: 'g1',
      eventId,
      label: 'A1',
      depth: 0,
      verticalOrder: 0,
      slots: [
        { sourceType: 'tbd' as const },
        { sourceType: 'tbd' as const },
        { sourceType: 'tbd' as const },
        { sourceType: 'tbd' as const },
      ],
    };
    draw.games.g1 = game;
    draw.connections = [
      { id: 'c1', fromGameId: 'g1', place: 1, toGameId: 'g2', terminalType: 'game' },
      { id: 'c2', fromGameId: 'g1', place: 2, toGameId: 'g3', terminalType: 'game' },
      { id: 'c3', fromGameId: 'g1', place: 3, terminalType: 'out' },
      { id: 'c4', fromGameId: 'g1', place: 4, terminalType: 'out' },
    ];
    expect(printGameCardHeight(draw, game)).toBeGreaterThan(PRINT_BRACKET_LAYOUT_METRICS.cardH);
  });
});
