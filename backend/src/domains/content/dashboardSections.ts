import { asc, eq, inArray } from 'drizzle-orm';
import { getDatabaseConfig } from '../../db/config.js';
import { getDrizzleDb } from '../../db/drizzle-db.js';

export const DASHBOARD_SECTION_KEYS = [
  'alert',
  'top_row',
  'registration',
  'ice_bookings',
  'upcoming_games',
  'upcoming_volunteering',
  'volunteer_opportunities',
  'my_sparing',
  'my_spare_requests',
  'cc_requests',
  'outstanding_spares',
  'filled_spares',
] as const;

export type DashboardSectionKey = (typeof DASHBOARD_SECTION_KEYS)[number];

export type DashboardSectionConfig = {
  lookAheadDays?: number;
  maxItems?: number;
  maxPrograms?: number;
  maxShiftsPerProgram?: number;
  showWhenEmpty?: boolean;
  defaultExpanded?: boolean;
};

export type DashboardSectionRow = {
  id: number;
  key: DashboardSectionKey;
  label: string;
  sortOrder: number;
  isEnabled: boolean;
  config: DashboardSectionConfig;
  createdAt: string;
  updatedAt: string;
};

export type DashboardAlertPayload = {
  title: string | null;
  body: string | null;
  expiresAt: string | null;
  variant: string | null;
  icon: string | null;
};

export type DashboardLayoutSection = {
  key: DashboardSectionKey;
  label: string;
  enabled: boolean;
  config: DashboardSectionConfig;
  alert?: DashboardAlertPayload;
};

type DefaultSection = {
  key: DashboardSectionKey;
  label: string;
  sortOrder: number;
  config: DashboardSectionConfig;
};

export const DEFAULT_DASHBOARD_SECTIONS: DefaultSection[] = [
  { key: 'alert', label: 'Alert', sortOrder: 0, config: {} },
  { key: 'top_row', label: 'Membership and quick actions', sortOrder: 10, config: {} },
  { key: 'registration', label: 'Registration status', sortOrder: 20, config: {} },
  { key: 'ice_bookings', label: 'My ice bookings', sortOrder: 30, config: { lookAheadDays: 30 } },
  { key: 'upcoming_games', label: 'My upcoming games', sortOrder: 40, config: { lookAheadDays: 7 } },
  {
    key: 'upcoming_volunteering',
    label: 'Upcoming volunteering',
    sortOrder: 45,
    config: { lookAheadDays: 30, showWhenEmpty: false },
  },
  {
    key: 'volunteer_opportunities',
    label: 'Upcoming volunteer opportunities',
    sortOrder: 50,
    config: { lookAheadDays: 30, maxPrograms: 3, maxShiftsPerProgram: 4 },
  },
  { key: 'my_sparing', label: 'My upcoming sparing', sortOrder: 60, config: { showWhenEmpty: false } },
  { key: 'my_spare_requests', label: 'My spare requests', sortOrder: 70, config: { showWhenEmpty: false } },
  { key: 'cc_requests', label: "Requests I've been CC'd on", sortOrder: 80, config: { showWhenEmpty: false } },
  { key: 'outstanding_spares', label: 'Outstanding spare requests', sortOrder: 90, config: { showWhenEmpty: true } },
  {
    key: 'filled_spares',
    label: 'Filled spare requests',
    sortOrder: 100,
    config: { showWhenEmpty: false, defaultExpanded: false },
  },
];

const DEFAULT_BY_KEY = new Map(DEFAULT_DASHBOARD_SECTIONS.map((section) => [section.key, section]));

function isDashboardSectionKey(value: string): value is DashboardSectionKey {
  return (DASHBOARD_SECTION_KEYS as readonly string[]).includes(value);
}

function clampPositiveInt(value: unknown, fallback: number, max = 365): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const rounded = Math.round(value);
  if (rounded < 1) return fallback;
  return Math.min(rounded, max);
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  return fallback;
}

export function parseDashboardSectionConfig(
  key: DashboardSectionKey,
  raw: unknown,
): DashboardSectionConfig {
  const defaults = DEFAULT_BY_KEY.get(key)?.config ?? {};
  const source =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const config: DashboardSectionConfig = {};

  if (
    key === 'ice_bookings' ||
    key === 'upcoming_games' ||
    key === 'upcoming_volunteering' ||
    key === 'volunteer_opportunities'
  ) {
    config.lookAheadDays = clampPositiveInt(
      source.lookAheadDays,
      defaults.lookAheadDays ?? (key === 'upcoming_games' ? 7 : 30),
    );
  }

  if (key === 'volunteer_opportunities') {
    config.maxPrograms = clampPositiveInt(source.maxPrograms, defaults.maxPrograms ?? 3, 50);
    config.maxShiftsPerProgram = clampPositiveInt(
      source.maxShiftsPerProgram,
      defaults.maxShiftsPerProgram ?? 4,
      50,
    );
  }

  if (
    key === 'upcoming_volunteering' ||
    key === 'my_sparing' ||
    key === 'my_spare_requests' ||
    key === 'cc_requests' ||
    key === 'outstanding_spares' ||
    key === 'filled_spares'
  ) {
    config.showWhenEmpty = asBoolean(source.showWhenEmpty, defaults.showWhenEmpty ?? false);
  }

  if (key === 'filled_spares') {
    config.defaultExpanded = asBoolean(source.defaultExpanded, defaults.defaultExpanded ?? false);
  }

  return config;
}

function serializeConfig(config: DashboardSectionConfig): never {
  return (
    getDatabaseConfig()?.type === 'postgres' ? config : JSON.stringify(config)
  ) as never;
}

function parseStoredConfigJson(raw: unknown): unknown {
  if (raw == null) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  return raw;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(row: {
  id: number;
  key: string;
  label: string;
  sort_order: number;
  is_enabled: number;
  config_json: unknown;
  created_at: string | Date;
  updated_at: string | Date;
}): DashboardSectionRow | null {
  if (!isDashboardSectionKey(row.key)) return null;
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    sortOrder: row.sort_order,
    isEnabled: row.is_enabled === 1,
    config: parseDashboardSectionConfig(row.key, parseStoredConfigJson(row.config_json)),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function seedDashboardSectionsIfNeeded(): Promise<void> {
  const { db, schema } = getDrizzleDb();
  const existing = await db
    .select({ key: schema.dashboardSections.key })
    .from(schema.dashboardSections);
  const existingKeys = new Set(existing.map((row) => row.key));
  const missing = DEFAULT_DASHBOARD_SECTIONS.filter((section) => !existingKeys.has(section.key));
  if (missing.length === 0) return;

  await db.insert(schema.dashboardSections).values(
    missing.map((section) => ({
      key: section.key,
      label: section.label,
      sort_order: section.sortOrder,
      is_enabled: 1,
      config_json: serializeConfig(section.config),
    })),
  );
}

export async function listDashboardSections(): Promise<DashboardSectionRow[]> {
  await seedDashboardSectionsIfNeeded();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.dashboardSections)
    .orderBy(asc(schema.dashboardSections.sort_order), asc(schema.dashboardSections.id));

  return rows
    .map(mapRow)
    .filter((row): row is DashboardSectionRow => row != null)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
}

export async function getDashboardSectionById(id: number): Promise<DashboardSectionRow | null> {
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.dashboardSections)
    .where(eq(schema.dashboardSections.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapRow(row);
}

export async function getDashboardSectionByKey(
  key: DashboardSectionKey,
): Promise<DashboardSectionRow | null> {
  await seedDashboardSectionsIfNeeded();
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select()
    .from(schema.dashboardSections)
    .where(eq(schema.dashboardSections.key, key))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return mapRow(row);
}

export async function getDashboardSectionConfig(
  key: DashboardSectionKey,
): Promise<DashboardSectionConfig> {
  const section = await getDashboardSectionByKey(key);
  if (!section) {
    return parseDashboardSectionConfig(key, DEFAULT_BY_KEY.get(key)?.config ?? {});
  }
  return section.config;
}

export async function reorderDashboardSections(
  updates: Array<{ id: number; sortOrder: number }>,
): Promise<void> {
  const { db, schema } = getDrizzleDb();
  await db.transaction(async (tx) => {
    for (const { id, sortOrder } of updates) {
      await tx
        .update(schema.dashboardSections)
        .set({ sort_order: sortOrder, updated_at: new Date() })
        .where(eq(schema.dashboardSections.id, id));
    }
  });
}

export async function updateDashboardSection(
  id: number,
  updates: { isEnabled?: boolean; config?: DashboardSectionConfig },
): Promise<DashboardSectionRow | null> {
  const existing = await getDashboardSectionById(id);
  if (!existing) return null;

  const nextConfig =
    updates.config !== undefined
      ? parseDashboardSectionConfig(existing.key, updates.config)
      : existing.config;

  const { db, schema } = getDrizzleDb();
  const setValues: Record<string, unknown> = { updated_at: new Date() };

  if (updates.isEnabled !== undefined) {
    setValues.is_enabled = updates.isEnabled ? 1 : 0;
  }
  if (updates.config !== undefined) {
    setValues.config_json = serializeConfig(nextConfig);
  }

  const [row] = await db
    .update(schema.dashboardSections)
    .set(setValues as never)
    .where(eq(schema.dashboardSections.id, id))
    .returning();

  if (!row) return null;
  return mapRow(row);
}

function normalizeAlertTimestamp(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? trimmed : parsed.toISOString();
}

export async function getDashboardAlertFromServerConfig(): Promise<DashboardAlertPayload> {
  const { db, schema } = getDrizzleDb();
  const rows = await db.select().from(schema.serverConfig).where(eq(schema.serverConfig.id, 1)).limit(1);
  const config = rows[0];
  if (!config) {
    return { title: null, body: null, expiresAt: null, variant: null, icon: null };
  }
  return {
    title: config.dashboard_alert_title ?? null,
    body: config.dashboard_alert_body ?? null,
    expiresAt: normalizeAlertTimestamp(config.dashboard_alert_expires_at),
    variant: config.dashboard_alert_variant ?? null,
    icon: config.dashboard_alert_icon ?? null,
  };
}

export async function updateDashboardAlertOnServerConfig(alert: {
  title?: string | null;
  body?: string | null;
  expiresAt?: string | null;
  variant?: string | null;
  icon?: string | null;
}): Promise<DashboardAlertPayload> {
  const { db, schema } = getDrizzleDb();
  const updateData: Record<string, unknown> = {};

  if (alert.title !== undefined) updateData.dashboard_alert_title = alert.title || null;
  if (alert.body !== undefined) updateData.dashboard_alert_body = alert.body || null;
  if (alert.expiresAt !== undefined) {
    updateData.dashboard_alert_expires_at = alert.expiresAt ? new Date(alert.expiresAt) : null;
  }
  if (alert.variant !== undefined) updateData.dashboard_alert_variant = alert.variant || null;
  if (alert.icon !== undefined) updateData.dashboard_alert_icon = alert.icon || null;

  if (Object.keys(updateData).length > 0) {
    await db.update(schema.serverConfig).set(updateData).where(eq(schema.serverConfig.id, 1));
  }

  return getDashboardAlertFromServerConfig();
}

export async function getDashboardLayout(): Promise<DashboardLayoutSection[]> {
  const sections = await listDashboardSections();
  const alert = await getDashboardAlertFromServerConfig();

  return sections.map((section) => {
    const layout: DashboardLayoutSection = {
      key: section.key,
      label: section.label,
      enabled: section.isEnabled,
      config: section.config,
    };
    if (section.key === 'alert') {
      layout.alert = alert;
    }
    return layout;
  });
}

/** Ensure reorder only touches known section ids. */
export async function assertDashboardSectionIdsExist(ids: number[]): Promise<boolean> {
  if (ids.length === 0) return true;
  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({ id: schema.dashboardSections.id })
    .from(schema.dashboardSections)
    .where(inArray(schema.dashboardSections.id, ids));
  return rows.length === ids.length;
}
