import { eq, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../../db/drizzle-db.js';

export type SpareSettings = {
  /** Wait between general-pool notifications for non-urgent public requests. */
  notificationDelaySeconds: number;
  /** How long bye players have the request to themselves before everyone else. */
  byePriorityWindowMinutes: number;
  /** Requests for games starting within this many hours notify everyone at once. */
  urgentThresholdHours: number;
  /** How long after the last notifications a requester must wait before re-issuing. */
  reissueCooldownHours: number;
};

export const DEFAULT_SPARE_SETTINGS: SpareSettings = {
  notificationDelaySeconds: 180,
  byePriorityWindowMinutes: 60,
  urgentThresholdHours: 24,
  reissueCooldownHours: 72,
};

export const SPARE_SETTINGS_LIMITS: Record<keyof SpareSettings, { min: number; max: number }> = {
  notificationDelaySeconds: { min: 1, max: 3600 },
  byePriorityWindowMinutes: { min: 0, max: 1440 },
  urgentThresholdHours: { min: 0, max: 168 },
  reissueCooldownHours: { min: 0, max: 720 },
};

const CACHE_TTL_MS = 10_000;
let cached: { value: SpareSettings; at: number } | null = null;

export function invalidateSpareSettingsCache(): void {
  cached = null;
}

function pickNumber(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getSpareSettings(): Promise<SpareSettings> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  const { db, schema } = getDrizzleDb();
  const rows = await db
    .select({
      notification_delay_seconds: schema.serverConfig.notification_delay_seconds,
      spare_bye_priority_window_minutes: schema.serverConfig.spare_bye_priority_window_minutes,
      spare_urgent_threshold_hours: schema.serverConfig.spare_urgent_threshold_hours,
      spare_reissue_cooldown_hours: schema.serverConfig.spare_reissue_cooldown_hours,
    })
    .from(schema.serverConfig)
    .where(eq(schema.serverConfig.id, 1))
    .limit(1);
  const row = rows[0];
  const d = DEFAULT_SPARE_SETTINGS;
  const value: SpareSettings = {
    notificationDelaySeconds: pickNumber(row?.notification_delay_seconds, d.notificationDelaySeconds),
    byePriorityWindowMinutes: pickNumber(row?.spare_bye_priority_window_minutes, d.byePriorityWindowMinutes),
    urgentThresholdHours: pickNumber(row?.spare_urgent_threshold_hours, d.urgentThresholdHours),
    reissueCooldownHours: pickNumber(row?.spare_reissue_cooldown_hours, d.reissueCooldownHours),
  };
  cached = { value, at: Date.now() };
  return value;
}

export async function updateSpareSettings(patch: Partial<SpareSettings>): Promise<SpareSettings> {
  const { db, schema } = getDrizzleDb();
  const set: Record<string, unknown> = {};
  if (patch.notificationDelaySeconds !== undefined) set.notification_delay_seconds = patch.notificationDelaySeconds;
  if (patch.byePriorityWindowMinutes !== undefined) set.spare_bye_priority_window_minutes = patch.byePriorityWindowMinutes;
  if (patch.urgentThresholdHours !== undefined) set.spare_urgent_threshold_hours = patch.urgentThresholdHours;
  if (patch.reissueCooldownHours !== undefined) set.spare_reissue_cooldown_hours = patch.reissueCooldownHours;

  if (Object.keys(set).length > 0) {
    set.updated_at = sql`CURRENT_TIMESTAMP`;
    await db.update(schema.serverConfig).set(set).where(eq(schema.serverConfig.id, 1));
  }
  invalidateSpareSettingsCache();
  return getSpareSettings();
}

export function byePriorityWindowMs(settings: SpareSettings): number {
  return settings.byePriorityWindowMinutes * 60 * 1000;
}
