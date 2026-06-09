import { describe, expect, test } from 'bun:test';
import { lineageRootLeagueId, resolveLeagueInSession, type LeagueContinuityRow } from './waitlistLineage.js';

function continuity(rows: LeagueContinuityRow[]): Map<number, LeagueContinuityRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

describe('waitlistLineage', () => {
  test('lineageRootLeagueId walks predecessors to the oldest league', () => {
    const map = continuity([
      { id: 10, sessionId: 1, predecessorLeagueId: 5, successorLeagueId: null },
      { id: 5, sessionId: 2, predecessorLeagueId: 1, successorLeagueId: 10 },
      { id: 1, sessionId: 3, predecessorLeagueId: null, successorLeagueId: 5 },
    ]);
    expect(lineageRootLeagueId(10, map)).toBe(1);
  });

  test('resolveLeagueInSession finds the league instance in the target session', () => {
    const map = continuity([
      { id: 10, sessionId: 1, predecessorLeagueId: 5, successorLeagueId: null },
      { id: 5, sessionId: 2, predecessorLeagueId: 1, successorLeagueId: 10 },
      { id: 1, sessionId: 3, predecessorLeagueId: null, successorLeagueId: 5 },
    ]);
    expect(resolveLeagueInSession(1, 1, map)).toBe(10);
    expect(resolveLeagueInSession(1, 2, map)).toBe(5);
    expect(resolveLeagueInSession(1, 3, map)).toBe(1);
  });

  test('resolveLeagueInSession returns null when no instance exists in the session', () => {
    const map = continuity([
      { id: 10, sessionId: 1, predecessorLeagueId: 5, successorLeagueId: null },
      { id: 5, sessionId: 2, predecessorLeagueId: null, successorLeagueId: 10 },
    ]);
    expect(resolveLeagueInSession(5, 99, map)).toBeNull();
  });

  test('copied successor leagues resolve the same lineage seed in the upcoming session', () => {
    const map = continuity([
      { id: 30, sessionId: 4, predecessorLeagueId: 20, successorLeagueId: null },
      { id: 20, sessionId: 3, predecessorLeagueId: 10, successorLeagueId: 30 },
      { id: 10, sessionId: 2, predecessorLeagueId: 1, successorLeagueId: 20 },
      { id: 1, sessionId: 1, predecessorLeagueId: null, successorLeagueId: 10 },
    ]);
    const lineageSeed = 1;
    expect(resolveLeagueInSession(lineageSeed, 4, map)).toBe(30);
    expect(resolveLeagueInSession(lineageSeed, 3, map)).toBe(20);
    expect(lineageRootLeagueId(30, map)).toBe(lineageRootLeagueId(1, map));
  });
});
