import { describe, expect, test } from 'bun:test';
import { assignAndOptimize } from './assignSlots';
import {
  compareByeFairnessCoverage,
  createByeFairnessContext,
  getByeFairnessCoverage,
} from './byeFairness';
import { generateAllMatchups } from './generateMatchups';
import { buildByeMap, partitionCompactnessScore } from './scoring';
import type {
  GeneratedGame,
  ScheduleByeRequest,
  ScheduleDrawSlot,
  ScheduleStrategy,
  ScheduleTeam,
} from './types';

const silentProgress = () => {};

function makeDrawSlots(dates: string[], sheetCount: number): ScheduleDrawSlot[] {
  return dates.flatMap((date) =>
    ['18:15', '20:30'].map((time) => ({
      date,
      time,
      sheets: Array.from({ length: sheetCount }, (_, index) => ({
        id: index + 1,
        name: String(index + 1),
        isAvailable: true,
      })),
    }))
  );
}

describe('schedule generator objective', () => {
  test("prefers two teams' first P1 honors over one team's second P1 honor", () => {
    const requests: ScheduleByeRequest[] = [
      { teamId: 1, drawDate: '2026-01-02', priority: 1 },
      { teamId: 1, drawDate: '2026-01-09', priority: 1 },
      { teamId: 2, drawDate: '2026-01-16', priority: 1 },
    ];
    const byeMap = buildByeMap(requests);
    const concentratedGames: GeneratedGame[] = [
      {
        team1Id: 2,
        team2Id: 3,
        gameDate: '2026-01-16',
        gameTime: '18:15',
        sheetId: 1,
        strategyLocalId: 'test',
      },
    ];
    const distributedGames: GeneratedGame[] = [
      {
        team1Id: 1,
        team2Id: 3,
        gameDate: '2026-01-02',
        gameTime: '18:15',
        sheetId: 1,
        strategyLocalId: 'test',
      },
    ];

    const concentrated = getByeFairnessCoverage(
      createByeFairnessContext(requests, concentratedGames, byeMap)
    );
    const distributed = getByeFairnessCoverage(
      createByeFairnessContext(requests, distributedGames, byeMap)
    );

    expect(concentrated.p1).toEqual([1, 1]);
    expect(distributed.p1).toEqual([2, 0]);
    expect(compareByeFairnessCoverage(distributed, concentrated)).toBeLessThan(0);
  });

  test('applies first-request P1 coverage during slot assignment', () => {
    const dates = ['2026-01-02', '2026-01-09', '2026-01-16'];
    const drawSlots: ScheduleDrawSlot[] = dates.map((date) => ({
      date,
      time: '18:15',
      sheets: [{ id: 1, name: '1', isAvailable: true }],
    }));
    const strategy: ScheduleStrategy = {
      localId: 'fairness',
      priority: 1,
      pairingMode: 'all',
      divisionId: null,
      gamesPerTeam: 1,
      drawSlotKeys: dates.map((date) => `${date}|18:15`),
    };
    const requests: ScheduleByeRequest[] = [
      { teamId: 1, drawDate: dates[0], priority: 1 },
      { teamId: 1, drawDate: dates[2], priority: 1 },
      { teamId: 2, drawDate: dates[1], priority: 1 },
    ];

    const result = assignAndOptimize(
      [
        {
          matchups: [
            {
              team1Id: 1,
              team2Id: 2,
              strategyLocalId: strategy.localId,
              roundLocalId: 'fairness-round',
            },
          ],
        },
      ],
      drawSlots,
      [strategy],
      requests,
      [1, 2],
      42,
      0,
      silentProgress
    );

    expect(result.games).toHaveLength(1);
    expect(result.games[0].gameDate).not.toBe(dates[1]);
    expect(
      result.teamStats
        .find((stats) => stats.teamId === 2)
        ?.byeConflicts.filter((conflict) => conflict.priority === 1)
    ).toHaveLength(0);
  });

  test('scores compactness once for strategies sharing a calendar phase', () => {
    const games: GeneratedGame[] = [
      {
        team1Id: 1,
        team2Id: 2,
        gameDate: '2026-01-02',
        gameTime: '18:15',
        sheetId: 1,
        strategyLocalId: 'a',
      },
      {
        team1Id: 3,
        team2Id: 4,
        gameDate: '2026-01-02',
        gameTime: '20:30',
        sheetId: 1,
        strategyLocalId: 'a',
      },
      {
        team1Id: 5,
        team2Id: 6,
        gameDate: '2026-01-02',
        gameTime: '18:15',
        sheetId: 2,
        strategyLocalId: 'b',
      },
      {
        team1Id: 7,
        team2Id: 8,
        gameDate: '2026-01-02',
        gameTime: '20:30',
        sheetId: 2,
        strategyLocalId: 'b',
      },
    ];
    const allowed = new Set(['2026-01-02|18:15', '2026-01-02|20:30']);
    const capacities = new Map([
      ['2026-01-02|18:15', 2],
      ['2026-01-02|20:30', 2],
    ]);

    expect(
      partitionCompactnessScore(
        games,
        capacities,
        2,
        new Map([
          ['a', allowed],
          ['b', allowed],
        ])
      )
    ).toBe(0);
  });

  test('uses bye pressure when selecting a heavily capped cross phase', () => {
    const teams: ScheduleTeam[] = Array.from({ length: 8 }, (_, index) => ({
      id: index + 1,
      name: `Team ${index + 1}`,
      divisionId: index < 4 ? 1 : 2,
    }));
    const drawSlots: ScheduleDrawSlot[] = [
      {
        date: '2026-03-20',
        time: '18:15',
        sheets: Array.from({ length: 3 }, (_, index) => ({
          id: index + 1,
          name: String(index + 1),
          isAvailable: true,
        })),
      },
    ];
    const strategies: ScheduleStrategy[] = [
      {
        localId: 'cross',
        priority: 1,
        pairingMode: 'cross',
        divisionId: null,
        gamesPerTeam: 1,
        drawSlotKeys: ['2026-03-20|18:15'],
      },
    ];
    const byeRequests: ScheduleByeRequest[] = [{ teamId: 1, drawDate: '2026-03-20', priority: 1 }];

    const matchups = generateAllMatchups(strategies, teams, drawSlots, byeRequests).flatMap(
      (round) => round.matchups
    );

    expect(matchups).toHaveLength(3);
    expect(matchups.some((matchup) => matchup.team1Id === 1 || matchup.team2Id === 1)).toBe(false);
  });

  test('keeps a complete schedule while optimizing round byes and draw preferences', () => {
    const dates = ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30'];
    const drawSlots = makeDrawSlots(dates, 2);
    const teams: ScheduleTeam[] = Array.from({ length: 10 }, (_, index) => ({
      id: index + 1,
      name: `Team ${index + 1}`,
      divisionId: index < 5 ? 1 : 2,
    }));
    const drawSlotKeys = drawSlots.map((slot) => `${slot.date}|${slot.time}`);
    const strategies: ScheduleStrategy[] = [
      {
        localId: 'division-1',
        priority: 1,
        pairingMode: 'intra',
        divisionId: 1,
        gamesPerTeam: 1,
        drawSlotKeys,
      },
      {
        localId: 'division-2',
        priority: 1,
        pairingMode: 'intra',
        divisionId: 2,
        gamesPerTeam: 1,
        drawSlotKeys,
      },
    ];
    const byeRequests: ScheduleByeRequest[] = teams.map((team, index) => ({
      teamId: team.id,
      drawDate: dates[(dates.length - 1 - (index % 5)) % dates.length],
      priority: 1,
    }));
    const rounds = generateAllMatchups(strategies, teams, drawSlots, byeRequests);

    const result = assignAndOptimize(
      rounds,
      drawSlots,
      strategies,
      byeRequests,
      teams.map((team) => team.id),
      12345,
      500,
      silentProgress,
      [],
      [6],
      [1],
      new Map(teams.map((team) => [team.id, team.name ?? `Team ${team.id}`])),
      0
    );

    expect(result.games).toHaveLength(20);
    expect(result.unschedulable).toHaveLength(0);
    expect(
      result.teamStats.reduce(
        (sum, stats) =>
          sum + stats.byeConflicts.filter((conflict) => conflict.priority === 1).length,
        0
      )
    ).toBe(0);

    const teamWeeks = new Set<string>();
    for (const game of result.games) {
      for (const teamId of [game.team1Id, game.team2Id]) {
        const key = `${teamId}|${game.gameDate}`;
        expect(teamWeeks.has(key)).toBe(false);
        teamWeeks.add(key);
      }
    }

    const preferredCount = (teamId: number, time: string) =>
      result.games.filter(
        (game) => (game.team1Id === teamId || game.team2Id === teamId) && game.gameTime === time
      ).length;
    expect(preferredCount(1, '18:15')).toBeGreaterThanOrEqual(3);
    expect(preferredCount(6, '20:30')).toBeGreaterThanOrEqual(3);
  });
});
