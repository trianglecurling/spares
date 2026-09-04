import { and, eq, inArray, sql } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import type { RegistrationCommunicationMessageTypeSqlite } from '../db/drizzle-schema.js';
import type { Member } from '../types.js';
import { memberCanManageRegistrations } from '../utils/registrationStaffAccess.js';
import { hasLeagueSetupAccess } from '../utils/leagueAccess.js';
import { hasScope } from '../utils/rbac.js';
import { isAdmin, isServerAdmin } from '../utils/auth.js';

const SINGLETON_SCOPE = 'singleton';

export const LEAGUE_PROCESSING_HOLD_REASON =
  'League rosters are currently being processed by the Membership Committee.';

const HELD_MESSAGE_TYPES = new Set<RegistrationCommunicationMessageTypeSqlite>([
  'waitlist_joined',
  'waitlist_offer_permanent',
  'waitlist_offer_temporary_sabbatical_fill',
  'waitlist_offer_accepted',
  'waitlist_offer_declined',
  'deferred_registration_payment_link',
]);

export const BATCH_PAYMENT_STATUSES = ['awaiting_placement', 'awaiting_staff_review', 'awaiting_payment'] as const;

export function registrationStatusHidesPaymentLinkDuringProcessing(status: string): boolean {
  return (BATCH_PAYMENT_STATUSES as readonly string[]).includes(status);
}

type ProcessingSettingsRow = {
  scope: string;
  enabled: number;
  created_at: string | Date;
  updated_at: string | Date;
};

export class LeagueProcessingValidationError extends Error {
  constructor(public details: Record<string, string>) {
    super('League processing validation failed');
  }
}

function normalizeDateTime(value: string | Date | null | undefined): string {
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

export function isHeldLeagueProcessingMessageType(
  messageType: RegistrationCommunicationMessageTypeSqlite | string,
): boolean {
  return HELD_MESSAGE_TYPES.has(messageType as RegistrationCommunicationMessageTypeSqlite);
}

export function canBypassLeagueProcessingHold(member: Member): boolean {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  if (memberCanManageRegistrations(member)) return true;
  if (hasScope(member.authz, 'leagues.manage')) return true;
  for (const rule of member.authz?.scopeRules ?? []) {
    if (rule.effect !== 'allow') continue;
    if (rule.scope !== 'leagues.manage' && rule.scope !== 'leagues.*' && rule.scope !== '*') continue;
    if (rule.resourceType === 'league' && rule.resourceId != null) return true;
  }
  return false;
}

export async function canViewLeaguePlacementDuringProcessing(
  member: Member,
  leagueId?: number | null,
): Promise<boolean> {
  if (isAdmin(member) || isServerAdmin(member)) return true;
  if (memberCanManageRegistrations(member)) return true;
  if (hasScope(member.authz, 'leagues.manage')) return true;
  if (leagueId == null) return false;
  return hasLeagueSetupAccess(member, leagueId);
}

async function loadOrInsertLeagueProcessingSettings(): Promise<ProcessingSettingsRow> {
  const { db, schema } = getDrizzleDb();
  const [existing] = await db
    .select()
    .from(schema.registrationLeagueProcessingSettings)
    .where(eq(schema.registrationLeagueProcessingSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  if (existing) return existing as ProcessingSettingsRow;

  const [created] = await db
    .insert(schema.registrationLeagueProcessingSettings)
    .values({ scope: SINGLETON_SCOPE, enabled: 0 })
    .onConflictDoNothing()
    .returning();
  if (created) return created as ProcessingSettingsRow;

  const [retry] = await db
    .select()
    .from(schema.registrationLeagueProcessingSettings)
    .where(eq(schema.registrationLeagueProcessingSettings.scope, SINGLETON_SCOPE))
    .limit(1);
  return retry as ProcessingSettingsRow;
}

export function mapLeagueProcessingSettingsToAdminResponse(row: ProcessingSettingsRow) {
  return {
    enabled: row.enabled === 1,
    createdAt: normalizeDateTime(row.created_at),
    updatedAt: normalizeDateTime(row.updated_at),
  };
}

export async function getLeagueProcessingAdminSettings() {
  const row = await loadOrInsertLeagueProcessingSettings();
  return mapLeagueProcessingSettingsToAdminResponse(row);
}

export async function isLeagueProcessingActive(): Promise<boolean> {
  const row = await loadOrInsertLeagueProcessingSettings();
  return row.enabled === 1;
}

export async function shouldHoldLeagueProcessingEmail(
  messageType: RegistrationCommunicationMessageTypeSqlite | string,
): Promise<boolean> {
  if (!isHeldLeagueProcessingMessageType(messageType)) return false;
  return isLeagueProcessingActive();
}

export async function updateLeagueProcessingSettings(input: { enabled: boolean }) {
  const row = await loadOrInsertLeagueProcessingSettings();
  const { db, schema } = getDrizzleDb();
  const [updated] = await db
    .update(schema.registrationLeagueProcessingSettings)
    .set({
      enabled: input.enabled ? 1 : 0,
      updated_at: sql`CURRENT_TIMESTAMP`,
    })
    .where(eq(schema.registrationLeagueProcessingSettings.scope, SINGLETON_SCOPE))
    .returning();
  return mapLeagueProcessingSettingsToAdminResponse(
    (updated as ProcessingSettingsRow | undefined) ?? { ...row, enabled: input.enabled ? 1 : 0 },
  );
}

export type PlacementPaymentLinkBatchResult = {
  sent: number;
  skipped: number;
  errors: Array<{ registrationId: number; error: string }>;
};

export async function sendPlacementPaymentLinksBatch(input: {
  actorMemberId: number;
  frontendBaseUrl?: string;
}): Promise<PlacementPaymentLinkBatchResult> {
  if (await isLeagueProcessingActive()) {
    throw new LeagueProcessingValidationError({
      processing: 'Turn off league processing before sending payment links.',
    });
  }

  const { db, schema } = getDrizzleDb();
  const placedRows = await db
    .selectDistinct({ registrationId: schema.leagueRoster.source_registration_id })
    .from(schema.leagueRoster)
    .where(and(eq(schema.leagueRoster.status, 'active')));
  const registrationIds = [
    ...new Set(
      placedRows
        .map((row) => row.registrationId)
        .filter((id): id is number => id != null),
    ),
  ];
  if (registrationIds.length === 0) {
    return { sent: 0, skipped: 0, errors: [] };
  }

  const registrations = await db
    .select({
      id: schema.curlingRegistrations.id,
      status: schema.curlingRegistrations.status,
    })
    .from(schema.curlingRegistrations)
    .where(
      and(
        inArray(schema.curlingRegistrations.id, registrationIds),
        inArray(schema.curlingRegistrations.status, [...BATCH_PAYMENT_STATUSES]),
      ),
    );

  const { triggerDeferredRegistrationPayment } = await import('./registrationMembershipPaymentService.js');
  const result: PlacementPaymentLinkBatchResult = { sent: 0, skipped: 0, errors: [] };
  for (const registration of registrations) {
    try {
      const payment = await triggerDeferredRegistrationPayment({
        registrationId: registration.id,
        actorMemberId: input.actorMemberId,
        frontendBaseUrl: input.frontendBaseUrl,
      });
      if (payment.outcome === 'immediate_payment' && 'checkoutUrl' in payment && payment.checkoutUrl) {
        result.sent += 1;
      } else {
        result.skipped += 1;
      }
    } catch (error) {
      result.errors.push({
        registrationId: registration.id,
        error: error instanceof Error ? error.message : 'Payment trigger failed',
      });
    }
  }
  return result;
}
