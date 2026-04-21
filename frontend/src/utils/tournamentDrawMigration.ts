/**
 * Migrates legacy tournament draw JSON (slot1/slot2, winner/loser connections, game_winner/game_loser)
 * to the current shape: `games[].slots[]`, `connections[].place`, `game_place` slot sources.
 */

function migrateSlotSource(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') return { sourceType: 'tbd' };
  const s = raw as Record<string, unknown>;
  const st = s.sourceType;
  if (st === 'game_winner') {
    return { sourceType: 'game_place', gameId: s.gameId ?? null, place: 1 };
  }
  if (st === 'game_loser') {
    return { sourceType: 'game_place', gameId: s.gameId ?? null, place: 2 };
  }
  if (st === 'game_place') {
    const p = typeof s.place === 'number' && Number.isFinite(s.place) ? s.place : 1;
    return { sourceType: 'game_place', gameId: s.gameId ?? null, place: p };
  }
  return raw;
}

function migrateGame(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') return raw;
  const g = raw as Record<string, unknown>;
  const { slot1: _s1, slot2: _s2, ...restBase } = g;
  void _s1;
  void _s2;
  if (Array.isArray(g.slots) && g.slots.length >= 2) {
    return {
      ...restBase,
      slots: g.slots.map(migrateSlotSource),
    };
  }
  const s1 = migrateSlotSource(g.slot1 ?? { sourceType: 'tbd' });
  const s2 = migrateSlotSource(g.slot2 ?? { sourceType: 'tbd' });
  return {
    ...restBase,
    slots: [s1, s2],
  };
}

function migrateConnection(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') return raw;
  const c = raw as Record<string, unknown>;
  if (typeof c.place === 'number' && Number.isFinite(c.place)) {
    const { outcomeType: _o, ...rest } = c;
    void _o;
    return rest;
  }
  const ot = c.outcomeType;
  let place = 1;
  if (ot === 'loser') place = 2;
  else if (ot === 'winner') place = 1;
  const { outcomeType: _ot, ...rest } = c;
  void _ot;
  return { ...rest, place };
}

function stripSetupToCore(obj: Record<string, unknown>): Record<string, unknown> {
  const setup = obj.setup;
  if (!setup || typeof setup !== 'object') return obj;
  const s = setup as Record<string, unknown>;
  if (typeof s.eventCount !== 'number' || !Array.isArray(s.events)) return obj;
  return { ...obj, setup: { eventCount: s.eventCount, events: s.events } };
}

function stripCanvasViewMode(obj: Record<string, unknown>): Record<string, unknown> {
  const canvas = obj.canvas;
  if (!canvas || typeof canvas !== 'object') return obj;
  const c = canvas as Record<string, unknown>;
  if (!('viewMode' in c)) return obj;
  const { viewMode: _vm, ...rest } = c;
  void _vm;
  return { ...obj, canvas: rest };
}

function stripDrawLegacyFields(obj: Record<string, unknown>): Record<string, unknown> {
  return stripCanvasViewMode(stripSetupToCore(obj));
}

/** Deep migrate parsed JSON before Zod / UI (idempotent on already-migrated data). */
export function migrateTournamentDrawJson(data: unknown): unknown {
  if (data == null || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  const gamesRaw = d.games;
  if (!gamesRaw || typeof gamesRaw !== 'object') {
    const textNodes = Array.isArray(d.textNodes) ? d.textNodes : [];
    return stripDrawLegacyFields({ ...d, textNodes });
  }
  const games: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(gamesRaw)) {
    games[k] = migrateGame(v);
  }
  const connectionsRaw = d.connections;
  const connections = Array.isArray(connectionsRaw)
    ? connectionsRaw.map(migrateConnection)
    : connectionsRaw;
  const textNodes = Array.isArray(d.textNodes) ? d.textNodes : [];
  return stripDrawLegacyFields({ ...d, games, connections, textNodes });
}
