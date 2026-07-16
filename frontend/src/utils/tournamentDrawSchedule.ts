import type { TournamentDrawState, TournamentGameNode, TournamentSheet } from './tournamentDrawModel';

export type ClubSheet = {
  id: number;
  name: string;
  sortOrder: number;
  isActive?: boolean;
  stoneColor1?: string;
  stoneColor2?: string;
};

/** Build tournament sheet list from club “Manage sheets” data (active sheets only). */
export function sheetsFromClubSheets(club: ClubSheet[]): TournamentSheet[] {
  return [...club]
    .filter((s) => s.isActive !== false)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((s, order) => ({
      clubSheetId: s.id,
      name: s.name,
      order,
      ...(s.stoneColor1 ? { stoneColor1: s.stoneColor1 } : {}),
      ...(s.stoneColor2 ? { stoneColor2: s.stoneColor2 } : {}),
    }));
}

/**
 * Next id for a tournament-only sheet. Club sheets use positive ids (real club sheet rows);
 * ad-hoc sheets use negative integers so they never collide with club ids.
 */
export function nextAdHocTournamentSheetId(sheets: TournamentSheet[]): number {
  let minNonPositive = 0;
  for (const s of sheets) {
    if (s.clubSheetId <= minNonPositive) minNonPositive = s.clubSheetId;
  }
  return minNonPositive - 1;
}

/** Migrate legacy `{ id: string, name, order }` rows to `{ clubSheetId, name, order }`. */
export function migrateSheetsArray(raw: unknown): TournamentSheet[] {
  if (!Array.isArray(raw)) return [];
  const out: TournamentSheet[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    if (typeof s.clubSheetId === 'number' && Number.isFinite(s.clubSheetId)) {
      out.push({
        clubSheetId: s.clubSheetId,
        name: typeof s.name === 'string' && s.name.trim() ? s.name : 'Sheet',
        order: typeof s.order === 'number' ? s.order : i,
        ...(typeof s.stoneColor1 === 'string' && s.stoneColor1.trim()
          ? { stoneColor1: s.stoneColor1.trim() }
          : {}),
        ...(typeof s.stoneColor2 === 'string' && s.stoneColor2.trim()
          ? { stoneColor2: s.stoneColor2.trim() }
          : {}),
      });
      continue;
    }
    const idStr = s.id === undefined || s.id === null ? '' : String(s.id);
    if (/^\d+$/.test(idStr)) {
      const n = Number.parseInt(idStr, 10);
      out.push({
        clubSheetId: n,
        name: typeof s.name === 'string' && s.name.trim() ? s.name : `Sheet ${n}`,
        order: typeof s.order === 'number' ? s.order : i,
        ...(typeof s.stoneColor1 === 'string' && s.stoneColor1.trim()
          ? { stoneColor1: s.stoneColor1.trim() }
          : {}),
        ...(typeof s.stoneColor2 === 'string' && s.stoneColor2.trim()
          ? { stoneColor2: s.stoneColor2.trim() }
          : {}),
      });
    }
  }
  return out.sort((a, b) => a.order - b.order || a.clubSheetId - b.clubSheetId);
}

export function formatDrawBlockOptionLabel(b: { name: string; startTime?: string | null }): string {
  const t = b.startTime?.trim();
  if (t) {
    try {
      const d = new Date(t);
      if (!Number.isNaN(d.getTime())) {
        return `${b.name || 'Draw'} · ${d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}`;
      }
    } catch {
      /* fall through */
    }
    return `${b.name || 'Draw'} · ${t}`;
  }
  return b.name || 'Draw';
}

/** Draw name, weekday (e.g. Fri), and time — used on bracket game cards (not inspector dropdowns). */
function formatDrawBlockLineForGameCard(b: { name: string; startTime?: string | null }): string {
  const name = b.name?.trim() || 'Draw';
  const t = b.startTime?.trim();
  if (!t) return name;
  try {
    const d = new Date(t);
    if (Number.isNaN(d.getTime())) {
      return `${name} · ${t}`;
    }
    let weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
    weekday = weekday.replace(/\.$/, '');
    const timeOnly = d.toLocaleTimeString(undefined, { timeStyle: 'short' });
    return `${name} · ${weekday}, ${timeOnly}`;
  } catch {
    return `${name} · ${t}`;
  }
}

export function formatGameScheduleSummary(
  draw: TournamentDrawState,
  g: TournamentGameNode,
): string | null {
  const sch = g.schedule;
  if (!sch) return null;
  const parts: string[] = [];
  if (sch.drawBlockId) {
    const b = draw.drawBlocks.find((x) => x.id === sch.drawBlockId);
    if (b) parts.push(formatDrawBlockLineForGameCard(b));
    else parts.push('Draw');
  }
  if (sch.sheetId != null) {
    const sh = draw.sheets.find((s) => s.clubSheetId === sch.sheetId);
    const name = sh?.name ?? String(sch.sheetId);
    parts.push(`Sheet ${name}`);
  }
  if (parts.length === 0) return null;
  return parts.join(' · ');
}
