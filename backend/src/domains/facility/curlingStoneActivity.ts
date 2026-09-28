import type { StonePosition, StoneSide } from './curlingStonePositions.js';

type MaintenanceActivityType = 'texturing' | 'band_narrowing' | 'imprinting';
type PlacementChangeType = 'added' | 'moved' | 'swapped' | 'rotated' | 'flipped';

export type ActivityPlacementInput = StonePosition & {
  id: number;
  stoneId: number;
  side: StoneSide;
  effectiveDate: string;
  changeType: PlacementChangeType;
  relatedStoneId: number | null;
  notes: string | null;
  createdAt: string;
};

export type ActivityMaintenanceInput = {
  id: number;
  stoneId: number;
  activityType: MaintenanceActivityType;
  side: StoneSide;
  performedOn: string;
  passes: number | null;
  rotations: number | null;
  sandpaperGrit: number | null;
  bandWidthsMm: Array<number | null>;
  comments: string | null;
  createdAt: string;
};

export type ActivityStoneDto = {
  id: number;
  wcfRegistrationNumber: string;
  side: StoneSide;
  from: StonePosition | null;
  to: StonePosition | null;
};

export type ActivityEntryDto = {
  id: string;
  date: string;
  kind: PlacementChangeType | 'maintenance';
  activityType: MaintenanceActivityType | null;
  passes: number | null;
  rotations: number | null;
  sandpaperGrit: number | null;
  bandWidthsMm: Array<number | null>;
  notes: string | null;
  stones: ActivityStoneDto[];
};

type Group = { entry: ActivityEntryDto; createdAt: string; maxId: number };

function positionOf(row: StonePosition): StonePosition {
  return { sheet: row.sheet, color: row.color, rockNumber: row.rockNumber };
}

/**
 * Rows written by one action share a date and creation timestamp, so they are shown (and edited) as
 * one change. Moves and flips always stand alone.
 */
export function placementGroupKey(
  row: Pick<ActivityPlacementInput, 'id' | 'stoneId' | 'effectiveDate' | 'changeType' | 'relatedStoneId' | 'notes' | 'createdAt'>,
): string {
  const base = `${row.effectiveDate}|${row.createdAt}`;
  switch (row.changeType) {
    case 'rotated':
      return `rotated|${base}`;
    case 'added':
      return `added|${base}|${row.notes ?? ''}`;
    case 'swapped': {
      const pair = [row.stoneId, row.relatedStoneId ?? 0].sort((a, b) => a - b).join(':');
      return `swapped|${base}|${pair}`;
    }
    default:
      return `placement|${row.id}`;
  }
}

function maintenanceGroupKey(row: ActivityMaintenanceInput): string {
  if (row.activityType === 'imprinting') return `maintenance|${row.id}`;
  return [
    'maintenance',
    row.activityType,
    row.performedOn,
    row.passes ?? '',
    row.rotations ?? '',
    row.sandpaperGrit ?? '',
    row.comments ?? '',
    row.createdAt,
  ].join('|');
}

function addToGroup(
  groups: Map<string, Group>,
  key: string,
  rowId: number,
  createdAt: string,
  create: () => ActivityEntryDto,
  stone: ActivityStoneDto,
) {
  let group = groups.get(key);
  if (!group) {
    group = { entry: create(), createdAt, maxId: rowId };
    groups.set(key, group);
  }
  group.maxId = Math.max(group.maxId, rowId);
  group.entry.stones.push(stone);
}

/**
 * Builds the public change feed for rows dated on or after `since`. `placements` must include each
 * stone's full history so the prior position of a move can be shown.
 */
export function buildCurlingStoneActivity(input: {
  since: string;
  wcfByStoneId: Map<number, string>;
  placements: ActivityPlacementInput[];
  maintenance: ActivityMaintenanceInput[];
}): ActivityEntryDto[] {
  const { since, wcfByStoneId } = input;
  const groups = new Map<string, Group>();

  const ordered = [...input.placements].sort(
    (a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.id - b.id,
  );
  const previousByStone = new Map<number, StonePosition>();
  for (const row of ordered) {
    const from = previousByStone.get(row.stoneId) ?? null;
    previousByStone.set(row.stoneId, positionOf(row));
    const wcf = wcfByStoneId.get(row.stoneId);
    if (row.effectiveDate < since || wcf == null) continue;

    addToGroup(
      groups,
      placementGroupKey(row),
      row.id,
      row.createdAt,
      () => ({
        id: `placement-${row.id}`,
        date: row.effectiveDate,
        kind: row.changeType,
        activityType: null,
        passes: null,
        rotations: null,
        sandpaperGrit: null,
        bandWidthsMm: [],
        notes: row.notes,
        stones: [],
      }),
      {
        id: row.stoneId,
        wcfRegistrationNumber: wcf,
        side: row.side,
        from: row.changeType === 'added' ? null : from,
        to: positionOf(row),
      },
    );
  }

  for (const row of input.maintenance) {
    const wcf = wcfByStoneId.get(row.stoneId);
    if (row.performedOn < since || wcf == null) continue;
    addToGroup(
      groups,
      maintenanceGroupKey(row),
      row.id,
      row.createdAt,
      () => ({
        id: `maintenance-${row.id}`,
        date: row.performedOn,
        kind: 'maintenance',
        activityType: row.activityType,
        passes: row.passes,
        rotations: row.rotations,
        sandpaperGrit: row.sandpaperGrit,
        bandWidthsMm: row.bandWidthsMm,
        notes: row.comments,
        stones: [],
      }),
      { id: row.stoneId, wcfRegistrationNumber: wcf, side: row.side, from: null, to: null },
    );
  }

  const collator = new Intl.Collator(undefined, { numeric: true });
  return [...groups.values()]
    .sort(
      (a, b) =>
        b.entry.date.localeCompare(a.entry.date) || b.createdAt.localeCompare(a.createdAt) || b.maxId - a.maxId,
    )
    .map(({ entry }) => ({
      ...entry,
      stones: entry.stones.sort((a, b) => collator.compare(a.wcfRegistrationNumber, b.wcfRegistrationNumber)),
    }));
}

/** The date one year before `today` (`YYYY-MM-DD`), clamped for Feb 29. */
export function oneYearBefore(today: string): string {
  const [year, month, day] = today.split('-').map(Number);
  const target = new Date(Date.UTC(year - 1, month - 1, day));
  if (target.getUTCMonth() !== month - 1) target.setUTCDate(0);
  return target.toISOString().slice(0, 10);
}
