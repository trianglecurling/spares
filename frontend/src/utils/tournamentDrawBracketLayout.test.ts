import { describe, expect, test } from 'bun:test';
import { emptyTournamentDraw } from './tournamentDrawBuilders';
import type { TournamentGameNode } from './tournamentDrawModel';
import {
  PRINT_BRACKET_LAYOUT_METRICS,
  layoutDraw,
  packLanesSideBySide,
} from './tournamentDrawBracketLayout';

describe('packLanesSideBySide', () => {
  test('places a short later event beside an earlier leftover instead of after a wider neighbor', () => {
    const packed = packLanesSideBySide(
      [
        { eventId: 'b', width: 768, height: 500, order: 0 },
        { eventId: 'c', width: 954, height: 500, order: 1 },
        { eventId: 'd', width: 210, height: 80, order: 2 },
      ],
      992
    );
    const byId = Object.fromEntries(packed.map((lane) => [lane.eventId, lane]));
    expect(byId.d?.top).toBe(byId.b?.top);
    expect(byId.d?.left).toBeGreaterThan(0);
    expect(byId.c?.top).not.toBe(byId.b?.top);
  });
});

function stubGame(
  id: string,
  eventId: string,
  label: string,
  depth: number,
  slotCount = 2
): TournamentGameNode {
  return {
    id,
    eventId,
    label,
    depth,
    verticalOrder: 0,
    slots: Array.from({ length: slotCount }, () => ({ sourceType: 'tbd' as const })),
  };
}

describe('layoutDraw print packing', () => {
  test('can put D beside B even when C is listed between them', () => {
    const draw = emptyTournamentDraw(4);
    const b = draw.setup.events[1]!;
    const c = draw.setup.events[2]!;
    const d = draw.setup.events[3]!;
    for (const depth of [0, 1, 2, 3]) {
      const id = `${b.id}-${depth}`;
      draw.games[id] = stubGame(id, b.id, `B${depth}`, depth);
    }
    for (const depth of [0, 1, 2, 3, 4]) {
      const id = `${c.id}-${depth}`;
      draw.games[id] = stubGame(id, c.id, `C${depth}`, depth);
    }
    draw.games[`${d.id}-0`] = stubGame(`${d.id}-0`, d.id, 'D1', 0);

    const layout = layoutDraw(draw, PRINT_BRACKET_LAYOUT_METRICS, { packRowWidth: 992 });
    const bLane = layout.lanes.find((lane) => lane.eventId === b.id);
    const cLane = layout.lanes.find((lane) => lane.eventId === c.id);
    const dLane = layout.lanes.find((lane) => lane.eventId === d.id);
    expect(dLane?.top).toBe(bLane?.top);
    expect(dLane?.left).toBeGreaterThan(0);
    expect(cLane?.top).not.toBe(bLane?.top);
  });
});
