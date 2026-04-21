/**
 * Portable JSON template for bracket structure (export/import from Structure tab).
 * Team slots store team ids; importing onto another event may need slot fixes if team ids differ.
 */
import type { TournamentTeamApi } from '../pages/admin/AdminEventTournamentTeamModal';
import type {
  TournamentConnectionEdge,
  TournamentDrawState,
  TournamentGameNode,
  TournamentSlotSource,
  TournamentTextNode,
} from './tournamentDrawModel';
import { sheetsFromClubSheets, type ClubSheet } from './tournamentDrawSchedule';

export const TOURNAMENT_DRAW_TEMPLATE_KIND = 'trianglecurling.tournament-draw-template' as const;
/** Bump when the JSON envelope or required fields change. */
export const TOURNAMENT_DRAW_TEMPLATE_VERSION = 2 as const;

export type TournamentDrawTemplateSlotSource = TournamentSlotSource;

export type TournamentDrawTemplateGameNode = Omit<TournamentGameNode, 'result' | 'slots'> & {
  slots: TournamentDrawTemplateSlotSource[];
};

export type TournamentDrawTemplateDocument = {
  kind: typeof TOURNAMENT_DRAW_TEMPLATE_KIND;
  version: typeof TOURNAMENT_DRAW_TEMPLATE_VERSION;
  /** Optional label for humans (not validated). */
  title?: string;
  structure: {
    setup: Pick<TournamentDrawState['setup'], 'eventCount' | 'events'>;
    canvas: TournamentDrawState['canvas'];
    games: Record<string, TournamentDrawTemplateGameNode>;
    connections: TournamentConnectionEdge[];
    drawBlocks: TournamentDrawState['drawBlocks'];
    sheets: TournamentDrawState['sheets'];
    textNodes: TournamentTextNode[];
  };
};

function sortedSheetsLikeList(sheets: TournamentDrawState['sheets']) {
  return [...sheets].sort((a, b) => a.order - b.order || a.clubSheetId - b.clubSheetId);
}

function buildClubSheetIdToIndex(sheets: TournamentDrawState['sheets']): Map<number, number> {
  const sorted = sortedSheetsLikeList(sheets);
  return new Map(sorted.map((s, i) => [s.clubSheetId, i]));
}

function templateSlotToLive(s: TournamentDrawTemplateSlotSource): TournamentSlotSource {
  return s;
}

function templateGameToLive(g: TournamentDrawTemplateGameNode): TournamentGameNode {
  return {
    ...g,
    slots: g.slots.map(templateSlotToLive),
  };
}

export function buildTournamentDrawTemplate(
  draw: TournamentDrawState,
  _teams: TournamentTeamApi[],
): TournamentDrawTemplateDocument {
  void _teams;
  const games: Record<string, TournamentDrawTemplateGameNode> = {};
  for (const [id, g] of Object.entries(draw.games)) {
    const { result: _omit, ...rest } = g;
    void _omit;
    games[id] = {
      ...rest,
      slots: g.slots.map((s) => templateSlotToLive(s)),
    };
  }

  return {
    kind: TOURNAMENT_DRAW_TEMPLATE_KIND,
    version: TOURNAMENT_DRAW_TEMPLATE_VERSION,
    structure: {
      setup: {
        eventCount: draw.setup.eventCount,
        events: draw.setup.events,
      },
      canvas: { ...draw.canvas },
      games,
      connections: draw.connections.map((c) => ({ ...c })),
      drawBlocks: draw.drawBlocks.map((b) => ({ ...b })),
      sheets: sortedSheetsLikeList(draw.sheets).map((s) => ({ ...s })),
      textNodes: draw.textNodes.map((t) => ({ ...t })),
    },
  };
}

export function tournamentDrawTemplateFilenameBase(filenameBase: string): string {
  const t = filenameBase.trim() || 'tournament-draw';
  return t.replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'tournament-draw';
}

export function downloadTournamentDrawTemplate(doc: TournamentDrawTemplateDocument, filenameBase: string): void {
  const safe = tournamentDrawTemplateFilenameBase(filenameBase);
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${safe}-draw-template.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export function hasExistingDrawStructure(draw: TournamentDrawState | null): boolean {
  if (!draw) return false;
  return Object.keys(draw.games).length > 0;
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x != null && typeof x === 'object' && !Array.isArray(x);
}

export function parseTournamentDrawTemplate(
  raw: unknown,
): { ok: true; doc: TournamentDrawTemplateDocument } | { ok: false; error: string } {
  if (!isRecord(raw)) {
    return { ok: false, error: 'Template must be a JSON object.' };
  }
  const o = raw as Record<string, unknown>;
  if (o.kind !== TOURNAMENT_DRAW_TEMPLATE_KIND) {
    return { ok: false, error: 'Not a tournament draw template file (missing or wrong kind).' };
  }
  const version = o.version;
  if (version !== 1 && version !== TOURNAMENT_DRAW_TEMPLATE_VERSION) {
    return { ok: false, error: `Unsupported template version: ${String(version)}` };
  }
  const structure = o.structure;
  if (!isRecord(structure)) {
    return { ok: false, error: 'Template is missing structure.' };
  }
  const setup = structure.setup;
  if (!isRecord(setup) || typeof setup.eventCount !== 'number' || !Array.isArray(setup.events)) {
    return { ok: false, error: 'Template structure.setup is invalid.' };
  }
  if (!isRecord(structure.games) || !Array.isArray(structure.connections)) {
    return { ok: false, error: 'Template games or connections are invalid.' };
  }
  if (!isRecord(structure.canvas)) {
    return { ok: false, error: 'Template canvas is invalid.' };
  }
  if (!Array.isArray(structure.drawBlocks)) {
    return { ok: false, error: 'Template drawBlocks must be an array.' };
  }
  if (!Array.isArray(structure.sheets)) {
    return { ok: false, error: 'Template sheets must be an array.' };
  }
  if (!Array.isArray(structure.textNodes)) {
    return { ok: false, error: 'Template textNodes must be an array.' };
  }

  const doc: TournamentDrawTemplateDocument = {
    kind: TOURNAMENT_DRAW_TEMPLATE_KIND,
    version: TOURNAMENT_DRAW_TEMPLATE_VERSION,
    title: typeof o.title === 'string' ? o.title : undefined,
    structure: {
      setup: {
        eventCount: setup.eventCount as number,
        events: setup.events as TournamentDrawState['setup']['events'],
      },
      canvas: structure.canvas as TournamentDrawState['canvas'],
      games: structure.games as Record<string, TournamentDrawTemplateGameNode>,
      connections: structure.connections as TournamentConnectionEdge[],
      drawBlocks: structure.drawBlocks as TournamentDrawState['drawBlocks'],
      sheets: structure.sheets as TournamentDrawState['sheets'],
      textNodes: structure.textNodes as TournamentTextNode[],
    },
  };
  return { ok: true, doc };
}

/**
 * Builds a full `TournamentDrawState` from an exported template.
 */
export function tournamentDrawStateFromTemplate(
  doc: TournamentDrawTemplateDocument,
  clubSheets: ClubSheet[],
): TournamentDrawState {
  const { structure: st } = doc;
  const games: Record<string, TournamentGameNode> = {};
  for (const [id, g] of Object.entries(st.games)) {
    games[id] = templateGameToLive(g);
  }

  let sheets: TournamentDrawState['sheets'] = st.sheets.map((s) => ({ ...s }));
  if (sheets.length === 0 && clubSheets.length > 0) {
    sheets = sheetsFromClubSheets(clubSheets);
  } else if (sheets.length > 0 && clubSheets.length > 0) {
    const sortedTemplateSheets = sortedSheetsLikeList(st.sheets);
    const templateIndexByClubId = buildClubSheetIdToIndex(st.sheets);
    const clubSorted = sheetsFromClubSheets(clubSheets);
    const remap = new Map<number, number>();
    for (const sh of clubSorted) {
      const idx = templateIndexByClubId.get(sh.clubSheetId);
      if (idx != null && idx < sortedTemplateSheets.length) {
        remap.set(sortedTemplateSheets[idx]!.clubSheetId, sh.clubSheetId);
      }
    }
    if (remap.size > 0) {
      sheets = sheets.map((row) => {
        const to = remap.get(row.clubSheetId);
        return to != null
          ? {
              ...row,
              clubSheetId: to,
              name: clubSorted.find((s) => s.clubSheetId === to)?.name ?? row.name,
            }
          : row;
      });
      for (const [gid, g] of Object.entries(games)) {
        const sid = g.schedule?.sheetId;
        if (sid == null) continue;
        const to = remap.get(sid);
        if (to != null) {
          games[gid] = {
            ...g,
            schedule: g.schedule ? { ...g.schedule, sheetId: to } : g.schedule,
          };
        }
      }
    }
  }

  return {
    version: 1,
    setup: {
      eventCount: st.setup.eventCount,
      events: st.setup.events.map((e) => ({ ...e })),
    },
    canvas: { ...st.canvas },
    games,
    connections: st.connections.map((c) => ({ ...c })),
    drawBlocks: st.drawBlocks.map((b) => ({ ...b })),
    sheets,
    textNodes: st.textNodes.map((t) => ({ ...t })),
  };
}
