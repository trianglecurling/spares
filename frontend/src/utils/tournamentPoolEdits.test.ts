import { describe, expect, test } from 'bun:test';
import { emptyTournamentDraw } from './tournamentDrawBuilders';
import { poolsForPhase } from './tournamentDrawPhases';
import { addPhaseToDraw } from './tournamentDrawPhaseEdits';
import { addPoolEntry, addPoolToPhase, arrangePoolEntries } from './tournamentPoolEdits';
import type { TournamentDrawState } from './tournamentDrawModel';

function drawWithPools(): { draw: TournamentDrawState; phaseId: string } {
  const added = addPhaseToDraw(emptyTournamentDraw(1), 'pool');
  let draw = addPoolToPhase(added.draw, added.phaseId);
  const [poolA, poolB] = poolsForPhase(draw, added.phaseId);
  draw = addPoolEntry(draw, poolA!.id, { sourceType: 'registration', registrationId: 1 });
  draw = addPoolEntry(draw, poolA!.id, { sourceType: 'registration', registrationId: 2 });
  draw = addPoolEntry(draw, poolB!.id, { sourceType: 'registration', registrationId: 3 });
  return { draw, phaseId: added.phaseId };
}

function ids(draw: TournamentDrawState, phaseId: string): string[][] {
  return poolsForPhase(draw, phaseId).map((pool) => pool.entries.map((entry) => entry.id));
}

describe('arrangePoolEntries', () => {
  test('reorders entries inside a pool and moves an entry into another pool', () => {
    const { draw, phaseId } = drawWithPools();
    const [poolA, poolB] = poolsForPhase(draw, phaseId);
    const [first, second] = poolA!.entries;
    const [third] = poolB!.entries;
    const movedEntry = first!;

    const next = arrangePoolEntries(draw, phaseId, {
      [poolA!.id]: [second!.id],
      [poolB!.id]: [movedEntry.id, third!.id],
    });

    expect(ids(next, phaseId)).toEqual([[second!.id], [movedEntry.id, third!.id]]);
    expect(poolsForPhase(next, phaseId)[1]!.entries[0]).toBe(movedEntry);
    expect(next.games).toBe(draw.games);

    const reordered = arrangePoolEntries(next, phaseId, {
      [poolA!.id]: [second!.id],
      [poolB!.id]: [third!.id, movedEntry.id],
    });
    expect(ids(reordered, phaseId)).toEqual([[second!.id], [third!.id, movedEntry.id]]);
  });

  test('leaves the draw unchanged when an entry is missing or repeated', () => {
    const { draw, phaseId } = drawWithPools();
    const [poolA, poolB] = poolsForPhase(draw, phaseId);
    const [first, second] = poolA!.entries;

    expect(
      arrangePoolEntries(draw, phaseId, {
        [poolA!.id]: [second!.id],
        [poolB!.id]: [first!.id],
      }),
    ).toBe(draw);
    expect(
      arrangePoolEntries(draw, phaseId, {
        [poolA!.id]: [first!.id, first!.id],
        [poolB!.id]: [second!.id, poolB!.entries[0]!.id],
      }),
    ).toBe(draw);
  });
});
