import { z } from 'zod';

function migrateSlotSourceRow(s: unknown): unknown {
  if (s == null || typeof s !== 'object') return { sourceType: 'tbd' };
  const x = s as Record<string, unknown>;
  const st = x.sourceType;
  if (st === 'game_winner') {
    return { sourceType: 'game_place', gameId: x.gameId ?? null, place: 1 };
  }
  if (st === 'game_loser') {
    return { sourceType: 'game_place', gameId: x.gameId ?? null, place: 2 };
  }
  if (st === 'game_place') {
    const p = typeof x.place === 'number' && Number.isFinite(x.place) ? x.place : 1;
    return { sourceType: 'game_place', gameId: x.gameId ?? null, place: p };
  }
  // Legacy team slots (pre registrations-as-teams). Prefer DB migration; fall back to TBD.
  if (st === 'team') {
    if (typeof x.registrationId === 'number' && Number.isFinite(x.registrationId) && x.registrationId > 0) {
      return { sourceType: 'registration', registrationId: x.registrationId };
    }
    return { sourceType: 'tbd' };
  }
  return s;
}

function migrateGameNode(raw: unknown): unknown {
  if (raw == null || typeof raw !== 'object') return raw;
  const g = raw as Record<string, unknown>;
  const { slot1: _a, slot2: _b, ...restBase } = g;
  void _a;
  void _b;
  if (Array.isArray(g.slots) && g.slots.length >= 2) {
    return {
      ...restBase,
      slots: g.slots.map(migrateSlotSourceRow),
    };
  }
  const s1 = migrateSlotSourceRow(g.slot1 ?? { sourceType: 'tbd' });
  const s2 = migrateSlotSourceRow(g.slot2 ?? { sourceType: 'tbd' });
  return {
    ...restBase,
    slots: [s1, s2],
  };
}

function migrateConnectionRow(raw: unknown): unknown {
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

/** Migrate legacy tournament sheets `{ id: string, name, order }` → `{ clubSheetId, name, order }`. */
function normalizeSheetsInDrawInput(data: unknown): unknown {
  if (data == null || typeof data !== 'object') return data;
  const d = data as Record<string, unknown>;
  const sheetsRaw = d.sheets;
  if (!Array.isArray(sheetsRaw)) return data;
  const migrated = sheetsRaw
    .map((item: unknown, index: number) => {
      if (!item || typeof item !== 'object') return null;
      const s = item as Record<string, unknown>;
      if (typeof s.clubSheetId === 'number' && Number.isFinite(s.clubSheetId)) {
        return {
          clubSheetId: s.clubSheetId,
          name: typeof s.name === 'string' && s.name.trim() ? s.name : 'Sheet',
          order: typeof s.order === 'number' ? s.order : index,
          ...(typeof s.stoneColor1 === 'string' && s.stoneColor1.trim()
            ? { stoneColor1: s.stoneColor1.trim() }
            : {}),
          ...(typeof s.stoneColor2 === 'string' && s.stoneColor2.trim()
            ? { stoneColor2: s.stoneColor2.trim() }
            : {}),
        };
      }
      const idRaw = s.id;
      const idStr = idRaw === undefined || idRaw === null ? '' : String(idRaw);
      if (/^\d+$/.test(idStr)) {
        const n = Number.parseInt(idStr, 10);
        return {
          clubSheetId: n,
          name: typeof s.name === 'string' && s.name.trim() ? s.name : `Sheet ${n}`,
          order: typeof s.order === 'number' ? s.order : index,
          ...(typeof s.stoneColor1 === 'string' && s.stoneColor1.trim()
            ? { stoneColor1: s.stoneColor1.trim() }
            : {}),
          ...(typeof s.stoneColor2 === 'string' && s.stoneColor2.trim()
            ? { stoneColor2: s.stoneColor2.trim() }
            : {}),
        };
      }
      return null;
    })
    .filter((x): x is NonNullable<typeof x> => x != null);
  return { ...d, sheets: migrated };
}

function stripSetupToCore(data: Record<string, unknown>): Record<string, unknown> {
  const setup = data.setup;
  if (!setup || typeof setup !== 'object') return data;
  const s = setup as Record<string, unknown>;
  if (typeof s.eventCount !== 'number' || !Array.isArray(s.events)) return data;
  return { ...data, setup: { eventCount: s.eventCount, events: s.events } };
}

function stripCanvasViewMode(data: Record<string, unknown>): Record<string, unknown> {
  const canvas = data.canvas;
  if (!canvas || typeof canvas !== 'object') return data;
  const c = canvas as Record<string, unknown>;
  if (!('viewMode' in c)) return data;
  const { viewMode: _vm, ...rest } = c;
  void _vm;
  return { ...data, canvas: rest };
}

function normalizeTournamentDrawStateInput(data: unknown): unknown {
  if (data == null || typeof data !== 'object') return data;
  let d = stripCanvasViewMode(stripSetupToCore(data as Record<string, unknown>));

  const gamesRaw = d.games;
  if (gamesRaw && typeof gamesRaw === 'object' && !Array.isArray(gamesRaw)) {
    const games: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(gamesRaw)) {
      games[k] = migrateGameNode(v);
    }
    d = { ...d, games };
  }

  if (Array.isArray(d.connections)) {
    d = { ...d, connections: d.connections.map(migrateConnectionRow) };
  }

  if (!Array.isArray(d.textNodes)) {
    d = { ...d, textNodes: [] };
  }

  return normalizeSheetsInDrawInput(d);
}

/** Bonspiel draw graph (versioned JSON stored on `events.tournament_draw_json`). */
export const tournamentSlotSourceSchema = z.union([
  z.object({ sourceType: z.literal('tbd') }),
  z.object({ sourceType: z.literal('bye') }),
  z.object({
    sourceType: z.literal('registration'),
    registrationId: z.number().int().positive().nullable().optional(),
  }),
  z.object({
    sourceType: z.literal('game_place'),
    gameId: z.union([z.string().min(1).max(80), z.null()]).optional(),
    place: z.number().int().min(1).max(32),
  }),
]);

export const tournamentBracketEventSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  code: z.string().min(1).max(8),
  order: z.number().int().min(0).max(99),
  color: z.string().min(1).max(32),
});

export const tournamentGameResultSchema = z.discriminatedUnion('entryKind', [
  z.object({
    entryKind: z.literal('pick_winner'),
    winnerSlot: z.union([z.literal(0), z.literal(1)]),
  }),
  z.object({
    entryKind: z.literal('final_score'),
    finalScores: z.tuple([z.number().finite(), z.number().finite()]),
  }),
  z.object({
    entryKind: z.literal('ends'),
    ends: z
      .object({
        side0: z.array(z.number().int().min(0).max(99)).max(24),
        side1: z.array(z.number().int().min(0).max(99)).max(24),
      })
      .refine((e) => e.side0.length === e.side1.length, {
        message: 'ends.side0 and ends.side1 must have the same length',
      }),
    /** When false, end scores are in progress. Omitted or true = game finished. */
    complete: z.boolean().optional(),
    /** Side (0 or 1) with last stone (hammer) in the first end. */
    firstEndHammerSlot: z.union([z.literal(0), z.literal(1)]).optional(),
    /**
     * Doubles only: 1-based end number where each side used their power play.
     * Null / omitted = not used. Extra ends (after regulation) are not allowed.
     */
    powerPlayEndBySlot: z
      .object({
        side0: z.number().int().min(1).max(8).nullable().optional(),
        side1: z.number().int().min(1).max(8).nullable().optional(),
      })
      .optional(),
  }),
  /** One total score per competitor slot; 1st place = highest (ties break by lower slot index). */
  z.object({
    entryKind: z.literal('multi_score'),
    scores: z.array(z.number().finite()).min(3).max(32),
  }),
]);

export const tournamentGameSchema = z.object({
  id: z.string().min(1).max(80),
  eventId: z.string().min(1).max(64),
  label: z.string().min(1).max(32),
  depth: z.number().int().min(0).max(64),
  verticalOrder: z.number().int().min(0).max(500),
  slots: z.array(tournamentSlotSourceSchema).min(2).max(32),
  notes: z.string().max(5000).optional(),
  schedule: z
    .object({
      drawBlockId: z.string().max(64).nullable().optional(),
      startTime: z.string().max(80).nullable().optional(),
      endTime: z.string().max(80).nullable().optional(),
      sheetId: z.number().int().positive().nullable().optional(),
      sheetLabel: z.string().max(80).nullable().optional(),
    })
    .optional(),
  layout: z
    .object({
      x: z.number().optional(),
      y: z.number().optional(),
    })
    .optional(),
  result: tournamentGameResultSchema.optional(),
  /**
   * Which competitor slot throws the sheet’s first stone color (`stoneColor1`).
   * The other two-sided slot gets `stoneColor2`. Omitted = unset.
   */
  rockColor1Slot: z.union([z.literal(0), z.literal(1)]).optional(),
});

export const tournamentConnectionSchema = z.object({
  id: z.string().min(1).max(80),
  fromGameId: z.string().min(1).max(80),
  place: z.number().int().min(1).max(32),
  toGameId: z.string().max(80).nullable().optional(),
  toSlotPosition: z.union([z.literal(1), z.literal(2)]).nullable().optional(),
  terminalType: z.enum(['game', 'out', 'tbd']),
});

export const tournamentDrawBlockSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  startTime: z.string().max(80).nullable().optional(),
  endTime: z.string().max(80).nullable().optional(),
  order: z.number().int().min(0).max(9999),
});

const tournamentSheetStoneColorSchema = z.string().min(1).max(32);

export const tournamentSheetSchema = z.object({
  /** Positive = club sheet id; negative = ad-hoc sheet for this tournament only. */
  clubSheetId: z.number().int(),
  name: z.string().min(1).max(80),
  order: z.number().int().min(0).max(9999),
  /** Copied from club sheet for public/bracket display. */
  stoneColor1: tournamentSheetStoneColorSchema.optional(),
  stoneColor2: tournamentSheetStoneColorSchema.optional(),
});

export const tournamentTextNodeSchema = z
  .object({
    id: z.string().min(1).max(80),
    text: z.string().max(8000),
    width: z.number().min(20).max(2000),
    height: z.number().min(16).max(2000),
    x: z.number().min(-50000).max(50000),
    y: z.number().min(-50000).max(50000),
    anchorKind: z.enum(['none', 'game', 'virtual']),
    anchorGameId: z.union([z.string().min(1).max(80), z.null()]).optional(),
    anchorConnectionId: z.union([z.string().min(1).max(80), z.null()]).optional(),
    offsetX: z.number().min(-50000).max(50000),
    offsetY: z.number().min(-50000).max(50000),
    showConnector: z.boolean(),
    connectorLineStyle: z.enum(['solid', 'dashed']),
    connectorColor: z.string().min(1).max(32).optional(),
  })
  .strict();

export const tournamentDrawStateSchema = z.preprocess(
  normalizeTournamentDrawStateInput,
  z
    .object({
      version: z.literal(1),
      setup: z.object({
        eventCount: z.number().int().min(1).max(16),
        events: z.array(tournamentBracketEventSchema).max(16),
      }),
      canvas: z.object({
        zoom: z.number().min(0.25).max(4),
        panX: z.number().min(-20000).max(20000),
        panY: z.number().min(-20000).max(20000),
      }),
      games: z.record(z.string(), tournamentGameSchema),
      connections: z.array(tournamentConnectionSchema).max(4000),
      drawBlocks: z.array(tournamentDrawBlockSchema).max(500),
      sheets: z.array(tournamentSheetSchema).max(200),
      textNodes: z.array(tournamentTextNodeSchema).max(500),
      /** How two-sided games are scored in the scorekeeper. Omitted → pick. */
      resultType: z.enum(['pick', 'score', 'ends']).optional(),
      /** How rock colors are assigned. Omitted → manual. */
      rockColorMode: z.enum(['manual', 'randomized']).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      for (const [key, g] of Object.entries(data.games)) {
        if (key !== g.id) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `games map key must match game id (got key ${key}, id ${g.id})`,
            path: ['games', key],
          });
        }
      }
      if (data.setup.events.length !== data.setup.eventCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'setup.eventCount must match number of setup.events',
          path: ['setup', 'eventCount'],
        });
      }
      const gameIds = new Set(Object.keys(data.games));
      const connById = new Map(data.connections.map((c) => [c.id, c]));
      for (let i = 0; i < data.textNodes.length; i++) {
        const tn = data.textNodes[i]!;
        if (tn.anchorKind === 'none') continue;
        if (tn.anchorKind === 'game') {
          const gid = tn.anchorGameId;
          if (!gid || !gameIds.has(gid)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'text node anchored to game requires a valid anchorGameId',
              path: ['textNodes', i, 'anchorGameId'],
            });
          }
        } else if (tn.anchorKind === 'virtual') {
          const cid = tn.anchorConnectionId;
          const c = cid ? connById.get(cid) : undefined;
          if (!cid || !c) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'text node anchored to virtual feeder requires a valid anchorConnectionId',
              path: ['textNodes', i, 'anchorConnectionId'],
            });
            continue;
          }
          if (c.terminalType !== 'game' || !c.toGameId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'virtual text anchor must reference a game-routing connection',
              path: ['textNodes', i, 'anchorConnectionId'],
            });
            continue;
          }
          const fromG = data.games[c.fromGameId];
          const toG = data.games[c.toGameId];
          if (!fromG || !toG) continue;
          if (fromG.eventId === toG.eventId || toG.depth <= fromG.depth || toG.depth <= 0) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: 'virtual text anchor must be a cross-event feeder connection',
              path: ['textNodes', i, 'anchorConnectionId'],
            });
          }
        }
      }
    }),
);

export type TournamentDrawState = z.infer<typeof tournamentDrawStateSchema>;
export type TournamentGameNode = z.infer<typeof tournamentGameSchema>;
export type TournamentConnectionEdge = z.infer<typeof tournamentConnectionSchema>;
export type TournamentBracketEvent = z.infer<typeof tournamentBracketEventSchema>;
export type TournamentSlotSource = z.infer<typeof tournamentSlotSourceSchema>;
export type TournamentTextNode = z.infer<typeof tournamentTextNodeSchema>;

const MAX_GAMES = 600;

export function assertDrawStateLimits(draw: TournamentDrawState): void {
  const n = Object.keys(draw.games).length;
  if (n > MAX_GAMES) {
    throw new Error(`Draw may have at most ${MAX_GAMES} games`);
  }
}
