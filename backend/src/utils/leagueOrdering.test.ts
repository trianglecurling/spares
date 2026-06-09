import { describe, expect, test } from 'bun:test';
import {
  compareLeaguesByDayThenFirstDraw,
  pickLeagueWithLatestStartDate,
} from './leagueOrdering.js';

describe('leagueOrdering', () => {
  test('pickLeagueWithLatestStartDate chooses the league with the latest start date', () => {
    const picked = pickLeagueWithLatestStartDate([
      { id: 1, startDate: '2025-09-01' },
      { id: 2, startDate: '2026-09-01' },
      { id: 3, startDate: '2024-09-01' },
    ]);
    expect(picked?.id).toBe(2);
  });

  test('compareLeaguesByDayThenFirstDraw orders by day, draw time, then name', () => {
    const draws = new Map<number, string>([
      [1, '18:30'],
      [2, '17:00'],
      [3, '18:30'],
    ]);

    const leagues = [
      { id: 3, name: 'Wednesday Late', dayOfWeek: 3 },
      { id: 2, name: 'Tuesday Early', dayOfWeek: 2 },
      { id: 1, name: 'Tuesday Late', dayOfWeek: 2 },
    ].sort((a, b) => compareLeaguesByDayThenFirstDraw(a, b, draws));

    expect(leagues.map((league) => league.id)).toEqual([2, 1, 3]);
  });
});
