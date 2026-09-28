import { asc, eq, gte, inArray, sql } from 'drizzle-orm';
import { isUniqueConstraintViolation } from '../../api/errors.js';
import { getDrizzleDb } from '../../db/drizzle-db.js';
import {
  buildCurlingStoneActivity,
  placementGroupKey,
  type ActivityEntryDto,
  type ActivityPlacementInput,
} from './curlingStoneActivity.js';
import {
  isStoneColor,
  isStoneSheet,
  isStoneSide,
  nextRotationSheet,
  samePosition,
  stonePositionKey,
  stonePositionLabel,
  stonePositionSortValue,
  validateStonePosition,
  type StonePosition,
  type StoneSide,
} from './curlingStonePositions.js';

type DrizzleDb = ReturnType<typeof getDrizzleDb>['db'];
type DrizzleSchema = ReturnType<typeof getDrizzleDb>['schema'];
type DrizzleTx = Parameters<Parameters<DrizzleDb['transaction']>[0]>[0];
type DrizzleExecutor = DrizzleDb | DrizzleTx;
type StoneRow = DrizzleSchema['curlingStones']['$inferSelect'];
type PlacementRow = DrizzleSchema['curlingStonePlacements']['$inferSelect'];
type MaintenanceRow = DrizzleSchema['curlingStoneMaintenance']['$inferSelect'];

export type MaintenanceActivityType = 'texturing' | 'band_narrowing' | 'imprinting';
export type PlacementChangeType = 'added' | 'moved' | 'swapped' | 'rotated' | 'flipped';

export class CurlingStoneError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CurlingStoneError';
  }
}

export type CurrentPlacementDto = StonePosition & { side: StoneSide; effectiveDate: string };

export type StoneSummaryDto = {
  id: number;
  wcfRegistrationNumber: string;
  alSerialNumber: string;
  notes: string | null;
  current: CurrentPlacementDto | null;
  lastMaintenance: {
    texturing: string | null;
    bandNarrowing: string | null;
    imprinting: string | null;
  };
};

export type PlacementDto = StonePosition & {
  id: number;
  side: StoneSide;
  effectiveDate: string;
  changeType: PlacementChangeType;
  relatedStone: { id: number; wcfRegistrationNumber: string } | null;
  notes: string | null;
  /** Number of stones changed by the same action (both stones in a swap, every stone in a rotation). */
  groupSize: number;
  /** Dates the entry can move to without reordering any affected stone's history. */
  dateRange: { min: string | null; max: string | null };
  /** True when this action is still the latest change for every stone it touched. */
  canUndo: boolean;
};

export type MaintenanceDto = {
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
};

export type StoneDetailDto = {
  stone: StoneSummaryDto;
  placements: PlacementDto[];
  maintenance: MaintenanceDto[];
};

function formatDateValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === 'string' ? value.slice(0, 10) : String(value ?? '');
}

function trimOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function placementPosition(row: PlacementRow): StonePosition {
  return {
    sheet: isStoneSheet(row.sheet) ? row.sheet : null,
    color: isStoneColor(row.color) ? row.color : null,
    rockNumber: row.rock_number ?? null,
  };
}

function placementSide(row: PlacementRow): StoneSide {
  return isStoneSide(row.side) ? row.side : 'A';
}

function toCurrentPlacement(row: PlacementRow | undefined): CurrentPlacementDto | null {
  if (!row) return null;
  return {
    ...placementPosition(row),
    side: placementSide(row),
    effectiveDate: formatDateValue(row.effective_date),
  };
}

function toMaintenanceDto(row: MaintenanceRow): MaintenanceDto {
  return {
    id: row.id,
    stoneId: row.stone_id,
    activityType: row.activity_type as MaintenanceActivityType,
    side: isStoneSide(row.side) ? row.side : 'A',
    performedOn: formatDateValue(row.performed_on),
    passes: row.passes ?? null,
    rotations: row.rotations ?? null,
    sandpaperGrit: row.sandpaper_grit ?? null,
    bandWidthsMm:
      row.activity_type === 'imprinting'
        ? [row.band_width_1_mm, row.band_width_2_mm, row.band_width_3_mm, row.band_width_4_mm].map(
            (value) => (value == null ? null : Number(value)),
          )
        : [],
    comments: row.comments ?? null,
  };
}

function placementOrder(a: PlacementRow, b: PlacementRow): number {
  const byDate = formatDateValue(a.effective_date).localeCompare(formatDateValue(b.effective_date));
  return byDate !== 0 ? byDate : a.id - b.id;
}

/** Latest placement per stone. History is small (dozens of stones), so ordering in memory is fine. */
async function loadCurrentPlacements(executor: DrizzleExecutor): Promise<Map<number, PlacementRow>> {
  const { schema } = getDrizzleDb();
  const rows = await executor.select().from(schema.curlingStonePlacements);
  const current = new Map<number, PlacementRow>();
  for (const row of [...rows].sort(placementOrder)) {
    current.set(row.stone_id, row);
  }
  return current;
}

function toActivityPlacement(row: PlacementRow): ActivityPlacementInput {
  return {
    ...placementPosition(row),
    id: row.id,
    stoneId: row.stone_id,
    side: placementSide(row),
    effectiveDate: formatDateValue(row.effective_date),
    changeType: row.change_type as PlacementChangeType,
    relatedStoneId: row.related_stone_id ?? null,
    notes: row.notes ?? null,
    createdAt: formatTimestampValue(row.created_at),
  };
}

type PlacementIndex = {
  byStone: Map<number, PlacementRow[]>;
  groups: Map<string, PlacementRow[]>;
  keyById: Map<number, string>;
};

function indexPlacements(rows: PlacementRow[]): PlacementIndex {
  const index: PlacementIndex = { byStone: new Map(), groups: new Map(), keyById: new Map() };
  for (const row of [...rows].sort(placementOrder)) {
    const history = index.byStone.get(row.stone_id) ?? [];
    history.push(row);
    index.byStone.set(row.stone_id, history);
    const key = placementGroupKey(toActivityPlacement(row));
    index.keyById.set(row.id, key);
    index.groups.set(key, [...(index.groups.get(key) ?? []), row]);
  }
  return index;
}

function placementGroup(index: PlacementIndex, placementId: number): PlacementRow[] {
  const key = index.keyById.get(placementId);
  return key ? (index.groups.get(key) ?? []) : [];
}

/** The window between each affected stone's neighboring entries, so editing never reorders history. */
function groupDateRange(index: PlacementIndex, group: PlacementRow[]): PlacementDto['dateRange'] {
  let min: string | null = null;
  let max: string | null = null;
  for (const row of group) {
    const history = index.byStone.get(row.stone_id) ?? [];
    const position = history.findIndex((entry) => entry.id === row.id);
    const previous = history[position - 1];
    const next = history[position + 1];
    if (previous) {
      const date = formatDateValue(previous.effective_date);
      if (min == null || date > min) min = date;
    }
    if (next) {
      const date = formatDateValue(next.effective_date);
      if (max == null || date < max) max = date;
    }
  }
  return { min, max };
}

function groupCanUndo(index: PlacementIndex, group: PlacementRow[]): boolean {
  if (group.length === 0 || group.some((row) => row.change_type === 'added')) return false;
  return group.every((row) => {
    const history = index.byStone.get(row.stone_id) ?? [];
    return history[history.length - 1]?.id === row.id;
  });
}

function occupantsByPosition(current: Map<number, PlacementRow>): Map<string, number> {
  const occupants = new Map<string, number>();
  for (const [stoneId, row] of current) {
    const key = stonePositionKey(placementPosition(row));
    if (key) occupants.set(key, stoneId);
  }
  return occupants;
}

function assertValidPosition(position: StonePosition) {
  const error = validateStonePosition(position);
  if (error) throw new CurlingStoneError(400, error);
}

function assertNotBeforeCurrent(row: PlacementRow | undefined, effectiveDate: string, stoneLabel: string) {
  if (!row) return;
  const currentDate = formatDateValue(row.effective_date);
  if (effectiveDate < currentDate) {
    throw new CurlingStoneError(
      400,
      `Choose a date on or after ${currentDate}, when ${stoneLabel} last changed position.`,
    );
  }
}

async function loadStoneOrThrow(executor: DrizzleExecutor, stoneId: number): Promise<StoneRow> {
  const { schema } = getDrizzleDb();
  const rows = await executor
    .select()
    .from(schema.curlingStones)
    .where(eq(schema.curlingStones.id, stoneId))
    .limit(1);
  if (!rows[0]) throw new CurlingStoneError(404, 'Stone not found');
  return rows[0];
}

async function assertIdentifiersAvailable(
  executor: DrizzleExecutor,
  wcfRegistrationNumber: string,
  alSerialNumber: string,
  excludeStoneId?: number,
) {
  const { schema } = getDrizzleDb();
  const rows = await executor
    .select({
      id: schema.curlingStones.id,
      wcf: schema.curlingStones.wcf_registration_number,
      al: schema.curlingStones.al_serial_number,
    })
    .from(schema.curlingStones);
  for (const row of rows) {
    if (row.id === excludeStoneId) continue;
    if (row.wcf === wcfRegistrationNumber) {
      throw new CurlingStoneError(409, `Another stone already has WCF registration number ${wcfRegistrationNumber}.`);
    }
    if (row.al === alSerialNumber) {
      throw new CurlingStoneError(409, `Another stone already has AL serial number ${alSerialNumber}.`);
    }
  }
}

function rethrowUniqueViolation(error: unknown): never {
  if (isUniqueConstraintViolation(error)) {
    throw new CurlingStoneError(409, 'Another stone already uses that WCF registration number or AL serial number.');
  }
  throw error;
}

function sortStones(stones: StoneSummaryDto[]): StoneSummaryDto[] {
  return stones.sort((a, b) => {
    const aPos = a.current ?? { sheet: null, color: null, rockNumber: null };
    const bPos = b.current ?? { sheet: null, color: null, rockNumber: null };
    const byPosition = stonePositionSortValue(aPos) - stonePositionSortValue(bPos);
    if (byPosition !== 0) return byPosition;
    return a.wcfRegistrationNumber.localeCompare(b.wcfRegistrationNumber, undefined, { numeric: true });
  });
}

function latestMaintenanceDates(rows: MaintenanceRow[]): Map<number, StoneSummaryDto['lastMaintenance']> {
  const byStone = new Map<number, StoneSummaryDto['lastMaintenance']>();
  for (const row of rows) {
    const entry = byStone.get(row.stone_id) ?? { texturing: null, bandNarrowing: null, imprinting: null };
    const date = formatDateValue(row.performed_on);
    const key =
      row.activity_type === 'texturing'
        ? 'texturing'
        : row.activity_type === 'band_narrowing'
          ? 'bandNarrowing'
          : 'imprinting';
    const existing = entry[key];
    if (!existing || date > existing) entry[key] = date;
    byStone.set(row.stone_id, entry);
  }
  return byStone;
}

function toSummary(
  stone: StoneRow,
  current: PlacementRow | undefined,
  lastMaintenance: StoneSummaryDto['lastMaintenance'] | undefined,
): StoneSummaryDto {
  return {
    id: stone.id,
    wcfRegistrationNumber: stone.wcf_registration_number,
    alSerialNumber: stone.al_serial_number,
    notes: stone.notes ?? null,
    current: toCurrentPlacement(current),
    lastMaintenance: lastMaintenance ?? { texturing: null, bandNarrowing: null, imprinting: null },
  };
}

export async function listCurlingStones(): Promise<StoneSummaryDto[]> {
  const { db, schema } = getDrizzleDb();
  const [stones, current, maintenance] = await Promise.all([
    db.select().from(schema.curlingStones),
    loadCurrentPlacements(db),
    db.select().from(schema.curlingStoneMaintenance),
  ]);
  const lastMaintenance = latestMaintenanceDates(maintenance);
  return sortStones(
    stones.map((stone) => toSummary(stone, current.get(stone.id), lastMaintenance.get(stone.id))),
  );
}

export async function getCurlingStoneDetail(stoneId: number): Promise<StoneDetailDto> {
  const { db, schema } = getDrizzleDb();
  const stone = await loadStoneOrThrow(db, stoneId);
  const [allPlacementRows, maintenanceRows, allStones] = await Promise.all([
    db.select().from(schema.curlingStonePlacements),
    db
      .select()
      .from(schema.curlingStoneMaintenance)
      .where(eq(schema.curlingStoneMaintenance.stone_id, stoneId))
      .orderBy(asc(schema.curlingStoneMaintenance.performed_on), asc(schema.curlingStoneMaintenance.id)),
    db
      .select({ id: schema.curlingStones.id, wcf: schema.curlingStones.wcf_registration_number })
      .from(schema.curlingStones),
  ]);
  const wcfById = new Map(allStones.map((row) => [row.id, row.wcf]));
  const index = indexPlacements(allPlacementRows);
  const orderedPlacements = index.byStone.get(stoneId) ?? [];

  const placements: PlacementDto[] = orderedPlacements
    .map((row) => {
      const relatedWcf = row.related_stone_id != null ? wcfById.get(row.related_stone_id) : undefined;
      const group = placementGroup(index, row.id);
      return {
        id: row.id,
        ...placementPosition(row),
        side: placementSide(row),
        effectiveDate: formatDateValue(row.effective_date),
        changeType: row.change_type as PlacementChangeType,
        relatedStone:
          row.related_stone_id != null && relatedWcf != null
            ? { id: row.related_stone_id, wcfRegistrationNumber: relatedWcf }
            : null,
        notes: row.notes ?? null,
        groupSize: group.length,
        dateRange: groupDateRange(index, group),
        canUndo: groupCanUndo(index, group),
      };
    })
    .reverse();

  const maintenance = maintenanceRows.map(toMaintenanceDto).reverse();

  return {
    stone: toSummary(
      stone,
      orderedPlacements[orderedPlacements.length - 1],
      latestMaintenanceDates(maintenanceRows).get(stoneId),
    ),
    placements,
    maintenance,
  };
}

function formatTimestampValue(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : String(value ?? '');
}

/** Grouped position and maintenance changes dated on or after `since` (`YYYY-MM-DD`), newest first. */
export async function listCurlingStoneActivity(since: string): Promise<ActivityEntryDto[]> {
  const { db, schema } = getDrizzleDb();
  const [stones, placementRows, maintenanceRows] = await Promise.all([
    db
      .select({ id: schema.curlingStones.id, wcf: schema.curlingStones.wcf_registration_number })
      .from(schema.curlingStones),
    db.select().from(schema.curlingStonePlacements),
    db
      .select()
      .from(schema.curlingStoneMaintenance)
      .where(gte(schema.curlingStoneMaintenance.performed_on, since)),
  ]);

  return buildCurlingStoneActivity({
    since,
    wcfByStoneId: new Map(stones.map((row) => [row.id, row.wcf])),
    placements: placementRows.map(toActivityPlacement),
    maintenance: maintenanceRows.map((row) => ({
      ...toMaintenanceDto(row),
      createdAt: formatTimestampValue(row.created_at),
    })),
  });
}

export type CreateStoneInput = StonePosition & {
  wcfRegistrationNumber: string;
  alSerialNumber: string;
  notes?: string | null;
  side: StoneSide;
  effectiveDate: string;
};

export async function createCurlingStone(input: CreateStoneInput, memberId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const position: StonePosition = { sheet: input.sheet, color: input.color, rockNumber: input.rockNumber };
  assertValidPosition(position);
  const wcf = input.wcfRegistrationNumber.trim();
  const al = input.alSerialNumber.trim();

  try {
    return await db.transaction(async (tx) => {
      await assertIdentifiersAvailable(tx, wcf, al);
      const key = stonePositionKey(position);
      if (key) {
        const occupants = occupantsByPosition(await loadCurrentPlacements(tx));
        if (occupants.has(key)) {
          throw new CurlingStoneError(
            409,
            `${stonePositionLabel(position)} already has a stone. Move that stone first or add this one as unassigned.`,
          );
        }
      }
      const inserted = await tx
        .insert(schema.curlingStones)
        .values({ wcf_registration_number: wcf, al_serial_number: al, notes: trimOrNull(input.notes) })
        .returning({ id: schema.curlingStones.id });
      const stoneId = inserted[0].id;
      await tx.insert(schema.curlingStonePlacements).values({
        stone_id: stoneId,
        sheet: position.sheet,
        color: position.color,
        rock_number: position.rockNumber,
        side: input.side,
        effective_date: input.effectiveDate,
        change_type: 'added',
        created_by_member_id: memberId,
      });
      return stoneId;
    });
  } catch (error) {
    if (error instanceof CurlingStoneError) throw error;
    rethrowUniqueViolation(error);
  }
}

export type ImportStonesInput = {
  effectiveDate: string;
  side: StoneSide;
  rows: Array<StonePosition & { wcfRegistrationNumber: string; alSerialNumber: string }>;
};

export type ImportRowError = { row: number; message: string };

/** All-or-nothing: any invalid row rejects the whole batch with per-row details. */
export async function importCurlingStones(input: ImportStonesInput, memberId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();

  try {
    return await db.transaction(async (tx) => {
      const existing = await tx
        .select({
          wcf: schema.curlingStones.wcf_registration_number,
          al: schema.curlingStones.al_serial_number,
        })
        .from(schema.curlingStones);
      const usedWcf = new Set(existing.map((row) => row.wcf));
      const usedAl = new Set(existing.map((row) => row.al));
      const occupied = occupantsByPosition(await loadCurrentPlacements(tx));
      const claimedPositions = new Set<string>();
      const errors: ImportRowError[] = [];

      const rows = input.rows.map((row, index) => {
        const rowNumber = index + 1;
        const wcf = row.wcfRegistrationNumber.trim();
        const al = row.alSerialNumber.trim();
        const position: StonePosition = { sheet: row.sheet, color: row.color, rockNumber: row.rockNumber };
        const positionError = validateStonePosition(position);
        if (!wcf) errors.push({ row: rowNumber, message: 'WCF registration number is required.' });
        else if (usedWcf.has(wcf)) errors.push({ row: rowNumber, message: `WCF registration number ${wcf} is already in use.` });
        if (!al) errors.push({ row: rowNumber, message: 'AL serial number is required.' });
        else if (usedAl.has(al)) errors.push({ row: rowNumber, message: `AL serial number ${al} is already in use.` });
        if (positionError) {
          errors.push({ row: rowNumber, message: positionError });
        } else {
          const key = stonePositionKey(position);
          if (key && (occupied.has(key) || claimedPositions.has(key))) {
            errors.push({ row: rowNumber, message: `${stonePositionLabel(position)} already has a stone.` });
          }
          if (key) claimedPositions.add(key);
        }
        usedWcf.add(wcf);
        usedAl.add(al);
        return { wcf, al, position };
      });

      if (errors.length > 0) {
        throw new CurlingStoneError(400, 'Some rows could not be imported. Fix them and try again.', { rows: errors });
      }

      for (const row of rows) {
        const inserted = await tx
          .insert(schema.curlingStones)
          .values({ wcf_registration_number: row.wcf, al_serial_number: row.al })
          .returning({ id: schema.curlingStones.id });
        await tx.insert(schema.curlingStonePlacements).values({
          stone_id: inserted[0].id,
          sheet: row.position.sheet,
          color: row.position.color,
          rock_number: row.position.rockNumber,
          side: input.side,
          effective_date: input.effectiveDate,
          change_type: 'added',
          created_by_member_id: memberId,
        });
      }
      return rows.length;
    });
  } catch (error) {
    if (error instanceof CurlingStoneError) throw error;
    rethrowUniqueViolation(error);
  }
}

export type UpdateStoneInput = {
  wcfRegistrationNumber: string;
  alSerialNumber: string;
  notes: string | null;
};

export async function updateCurlingStone(stoneId: number, input: UpdateStoneInput): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const wcf = input.wcfRegistrationNumber.trim();
  const al = input.alSerialNumber.trim();
  try {
    await db.transaction(async (tx) => {
      await loadStoneOrThrow(tx, stoneId);
      await assertIdentifiersAvailable(tx, wcf, al, stoneId);
      await tx
        .update(schema.curlingStones)
        .set({
          wcf_registration_number: wcf,
          al_serial_number: al,
          notes: trimOrNull(input.notes),
          updated_at: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(schema.curlingStones.id, stoneId));
    });
  } catch (error) {
    if (error instanceof CurlingStoneError) throw error;
    rethrowUniqueViolation(error);
  }
}

export async function deleteCurlingStone(stoneId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await loadStoneOrThrow(db, stoneId);
  await db.delete(schema.curlingStones).where(eq(schema.curlingStones.id, stoneId));
}

export type MoveStoneInput = StonePosition & { effectiveDate: string; notes?: string | null };

/**
 * Moves a stone to a new position. If another stone occupies the target, the two stones
 * trade places (the occupant becomes unassigned when the moving stone was unassigned).
 */
export async function moveCurlingStone(stoneId: number, input: MoveStoneInput, memberId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const target: StonePosition = { sheet: input.sheet, color: input.color, rockNumber: input.rockNumber };
  assertValidPosition(target);

  await db.transaction(async (tx) => {
    const stone = await loadStoneOrThrow(tx, stoneId);
    const current = await loadCurrentPlacements(tx);
    const moving = current.get(stoneId);
    const origin: StonePosition = moving
      ? placementPosition(moving)
      : { sheet: null, color: null, rockNumber: null };
    if (samePosition(origin, target)) {
      throw new CurlingStoneError(400, `This stone is already at ${stonePositionLabel(target)}.`);
    }
    assertNotBeforeCurrent(moving, input.effectiveDate, 'this stone');

    const targetKey = stonePositionKey(target);
    const occupantId = targetKey ? occupantsByPosition(current).get(targetKey) : undefined;
    const occupant = occupantId != null ? current.get(occupantId) : undefined;
    if (occupant) {
      assertNotBeforeCurrent(occupant, input.effectiveDate, `the stone at ${stonePositionLabel(target)}`);
    }

    const notes = trimOrNull(input.notes);
    await tx.insert(schema.curlingStonePlacements).values({
      stone_id: stone.id,
      sheet: target.sheet,
      color: target.color,
      rock_number: target.rockNumber,
      side: moving ? placementSide(moving) : 'A',
      effective_date: input.effectiveDate,
      change_type: occupant ? 'swapped' : 'moved',
      related_stone_id: occupant ? occupant.stone_id : null,
      notes,
      created_by_member_id: memberId,
    });

    if (occupant) {
      await tx.insert(schema.curlingStonePlacements).values({
        stone_id: occupant.stone_id,
        sheet: origin.sheet,
        color: origin.color,
        rock_number: origin.rockNumber,
        side: placementSide(occupant),
        effective_date: input.effectiveDate,
        change_type: 'swapped',
        related_stone_id: stone.id,
        notes,
        created_by_member_id: memberId,
      });
    }
  });
}

export async function flipCurlingStone(
  stoneId: number,
  input: { effectiveDate: string; notes?: string | null },
  memberId: number,
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    await loadStoneOrThrow(tx, stoneId);
    const current = (await loadCurrentPlacements(tx)).get(stoneId);
    assertNotBeforeCurrent(current, input.effectiveDate, 'this stone');
    const position = current ? placementPosition(current) : { sheet: null, color: null, rockNumber: null };
    const side: StoneSide = current && placementSide(current) === 'A' ? 'B' : 'A';
    await tx.insert(schema.curlingStonePlacements).values({
      stone_id: stoneId,
      sheet: position.sheet,
      color: position.color,
      rock_number: position.rockNumber,
      side,
      effective_date: input.effectiveDate,
      change_type: 'flipped',
      notes: trimOrNull(input.notes),
      created_by_member_id: memberId,
    });
  });
}

/** Moves every stone on a sheet to the next sheet (A to B, B to C, C to D, D to A). Spares stay put. */
export async function rotateCurlingStones(input: { effectiveDate: string }, memberId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  return db.transaction(async (tx) => {
    const current = await loadCurrentPlacements(tx);
    const onSheets = [...current.values()].filter((row) => isStoneSheet(row.sheet));
    if (onSheets.length === 0) {
      throw new CurlingStoneError(400, 'No stones are assigned to sheets yet.');
    }
    const latest = onSheets.reduce(
      (max, row) => {
        const date = formatDateValue(row.effective_date);
        return date > max ? date : max;
      },
      '',
    );
    if (input.effectiveDate < latest) {
      throw new CurlingStoneError(
        400,
        `Choose a date on or after ${latest}, when a stone on the ice last changed position.`,
      );
    }
    await tx.insert(schema.curlingStonePlacements).values(
      onSheets.map((row) => ({
        stone_id: row.stone_id,
        sheet: nextRotationSheet(row.sheet as NonNullable<StonePosition['sheet']>),
        color: row.color,
        rock_number: row.rock_number,
        side: placementSide(row),
        effective_date: input.effectiveDate,
        change_type: 'rotated',
        created_by_member_id: memberId,
      })),
    );
    return onSheets.length;
  });
}

async function loadPlacementGroupOrThrow(executor: DrizzleExecutor, placementId: number) {
  const { schema } = getDrizzleDb();
  const index = indexPlacements(await executor.select().from(schema.curlingStonePlacements));
  const group = placementGroup(index, placementId);
  if (group.length === 0) throw new CurlingStoneError(404, 'Position history entry not found');
  return { index, group };
}

function formatRangeMessage(range: PlacementDto['dateRange']): string {
  if (range.min && range.max) return `Choose a date from ${range.min} to ${range.max}`;
  if (range.min) return `Choose a date on or after ${range.min}`;
  return `Choose a date on or before ${range.max}`;
}

/**
 * Changes the date and notes of a position change. Every row written by the same action (both stones
 * in a swap, every stone in a rotation or import) is updated together so the change stays whole.
 */
export async function updateCurlingStonePlacement(
  placementId: number,
  input: { effectiveDate: string; notes?: string | null },
): Promise<number> {
  const { db, schema } = getDrizzleDb();
  return db.transaction(async (tx) => {
    const { index, group } = await loadPlacementGroupOrThrow(tx, placementId);
    const range = groupDateRange(index, group);
    if ((range.min && input.effectiveDate < range.min) || (range.max && input.effectiveDate > range.max)) {
      throw new CurlingStoneError(
        400,
        `${formatRangeMessage(range)} so this change stays in order with the other position changes for ${
          group.length === 1 ? 'this stone' : 'these stones'
        }.`,
      );
    }
    await tx
      .update(schema.curlingStonePlacements)
      .set({ effective_date: input.effectiveDate, notes: trimOrNull(input.notes) })
      .where(
        inArray(
          schema.curlingStonePlacements.id,
          group.map((row) => row.id),
        ),
      );
    return group.length;
  });
}

/** Removes the latest position change for every stone it touched, returning them to where they were. */
export async function undoCurlingStonePlacement(placementId: number): Promise<number> {
  const { db, schema } = getDrizzleDb();
  return db.transaction(async (tx) => {
    const { index, group } = await loadPlacementGroupOrThrow(tx, placementId);
    if (group.some((row) => row.change_type === 'added')) {
      throw new CurlingStoneError(400, 'The first entry for a stone can’t be undone. Delete the stone instead.');
    }
    if (!groupCanUndo(index, group)) {
      throw new CurlingStoneError(
        409,
        'Only the most recent change can be undone. A later change affects one of these stones.',
      );
    }
    await tx.delete(schema.curlingStonePlacements).where(
      inArray(
        schema.curlingStonePlacements.id,
        group.map((row) => row.id),
      ),
    );

    const seen = new Set<string>();
    for (const row of (await loadCurrentPlacements(tx)).values()) {
      const key = stonePositionKey(placementPosition(row));
      if (!key) continue;
      if (seen.has(key)) {
        throw new CurlingStoneError(
          409,
          `Undoing this would put two stones at ${stonePositionLabel(placementPosition(row))}. Move the other stone first.`,
        );
      }
      seen.add(key);
    }
    return group.length;
  });
}

export type MaintenanceFieldsInput = {
  activityType: MaintenanceActivityType;
  performedOn: string;
  passes?: number | null;
  rotations?: number | null;
  sandpaperGrit?: number | null;
  bandWidthsMm?: Array<number | null> | null;
  comments?: string | null;
};

/** Keeps only the fields that apply to the activity and enforces the ones it requires. */
function normalizeMaintenanceFields(input: MaintenanceFieldsInput) {
  const fieldErrors: Record<string, string> = {};
  const base = {
    activity_type: input.activityType,
    performed_on: input.performedOn,
    passes: null as number | null,
    rotations: null as number | null,
    sandpaper_grit: null as number | null,
    band_width_1_mm: null as number | null,
    band_width_2_mm: null as number | null,
    band_width_3_mm: null as number | null,
    band_width_4_mm: null as number | null,
    comments: trimOrNull(input.comments),
  };

  if (input.activityType === 'texturing' || input.activityType === 'band_narrowing') {
    if (input.sandpaperGrit == null) fieldErrors.sandpaperGrit = 'Enter the sandpaper grit.';
    base.sandpaper_grit = input.sandpaperGrit ?? null;
    if (input.activityType === 'texturing') {
      if (input.passes == null) fieldErrors.passes = 'Enter the number of passes.';
      base.passes = input.passes ?? null;
    } else {
      if (input.rotations == null) fieldErrors.rotations = 'Enter the number of rotations.';
      base.rotations = input.rotations ?? null;
    }
  } else {
    const widths = input.bandWidthsMm ?? [];
    if (widths.length !== 4 || widths.some((value) => value == null || !Number.isFinite(value))) {
      fieldErrors.bandWidthsMm = 'Enter all four running band widths.';
    } else {
      [base.band_width_1_mm, base.band_width_2_mm, base.band_width_3_mm, base.band_width_4_mm] = widths as number[];
    }
  }

  if (Object.keys(fieldErrors).length > 0) {
    throw new CurlingStoneError(400, 'Some maintenance details are missing.', { fieldErrors });
  }
  return base;
}

export type CreateMaintenanceInput = MaintenanceFieldsInput & {
  stoneIds: number[];
  side: StoneSide | 'current';
};

export async function createCurlingStoneMaintenance(
  input: CreateMaintenanceInput,
  memberId: number,
): Promise<number> {
  const { db, schema } = getDrizzleDb();
  const stoneIds = [...new Set(input.stoneIds)];
  if (input.activityType === 'imprinting' && stoneIds.length > 1) {
    throw new CurlingStoneError(400, 'Record imprinting one stone at a time, since each stone has its own band widths.');
  }
  const fields = normalizeMaintenanceFields(input);

  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: schema.curlingStones.id })
      .from(schema.curlingStones)
      .where(inArray(schema.curlingStones.id, stoneIds));
    if (found.length !== stoneIds.length) {
      throw new CurlingStoneError(404, 'One or more stones were not found.');
    }
    const current = input.side === 'current' ? await loadCurrentPlacements(tx) : null;
    await tx.insert(schema.curlingStoneMaintenance).values(
      stoneIds.map((stoneId) => {
        const placement = current?.get(stoneId);
        const side: StoneSide =
          input.side === 'current' ? (placement ? placementSide(placement) : 'A') : input.side;
        return { ...fields, stone_id: stoneId, side, created_by_member_id: memberId };
      }),
    );
    return stoneIds.length;
  });
}

export async function updateCurlingStoneMaintenance(
  maintenanceId: number,
  input: MaintenanceFieldsInput & { side: StoneSide },
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const fields = normalizeMaintenanceFields(input);
  const updated = await db
    .update(schema.curlingStoneMaintenance)
    .set({ ...fields, side: input.side, updated_at: sql`CURRENT_TIMESTAMP` })
    .where(eq(schema.curlingStoneMaintenance.id, maintenanceId))
    .returning({ id: schema.curlingStoneMaintenance.id });
  if (!updated[0]) throw new CurlingStoneError(404, 'Maintenance record not found');
}

export async function deleteCurlingStoneMaintenance(maintenanceId: number): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const deleted = await db
    .delete(schema.curlingStoneMaintenance)
    .where(eq(schema.curlingStoneMaintenance.id, maintenanceId))
    .returning({ id: schema.curlingStoneMaintenance.id });
  if (!deleted[0]) throw new CurlingStoneError(404, 'Maintenance record not found');
}