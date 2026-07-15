import path from 'path';
import { fileURLToPath } from 'url';
import { sql } from 'drizzle-orm';
import type { DatabaseConfig } from './config.js';
import { getDrizzleDb } from './drizzle-db.js';
import {
  ensureCurlingRegistrationBootstrap,
  ensureCurlingRegistrationBootstrapSync,
  ensureRegistrationPriceDiscountSettingsTablesExist,
} from './registrationSchemaBootstrap.js';
import { ensureLeagueWaitlistSchema } from './waitlistSchemaMigration.js';
import type { DatabaseAdapter } from './adapter.js';

async function execSQL(db: DatabaseAdapter, statement: string): Promise<void> {
  const result = db.exec(statement);
  if (result instanceof Promise) {
    await result;
  }
}

function execSQLSync(db: DatabaseAdapter, statement: string): void {
  const result = db.exec(statement);
  if (result instanceof Promise) {
    throw new Error('Database operation returned a promise but sync execution was expected');
  }
}

async function seedRbacRolesAndScopes(isPostgres: boolean): Promise<void> {
  const { db } = getDrizzleDb();

  if (isPostgres) {
    await db.execute(sql.raw(`
      INSERT INTO roles (code, name, description, is_system, is_computed, is_assignable)
      VALUES
        ('authenticated_user', 'Authenticated user', 'Base permissions for any signed-in user', 1, 1, 0),
        ('active_member', 'Active member', 'Computed role for members with non-expired membership', 1, 1, 0),
        ('member_with_ice_privileges', 'Member with ice privileges', 'Computed role for members with on-ice access', 1, 1, 0),
        ('general_admin', 'General admin', 'General administrative permissions', 1, 0, 1),
        ('calendar_admin', 'Calendar admin', 'Calendar administration permissions', 1, 0, 1),
        ('content_admin', 'Content admin', 'Content and file administration permissions', 1, 0, 1),
        ('sponsor_admin', 'Sponsor admin', 'Sponsorship administration permissions', 1, 0, 1),
        ('league_admin', 'League admin', 'League administration permissions', 1, 0, 1),
        ('league_manager', 'League manager', 'League management permissions', 1, 0, 1),
        ('volunteer_manager', 'Volunteer manager', 'Volunteer program and credential administration', 1, 0, 1)
      ON CONFLICT (code) DO NOTHING
    `));

    await db.execute(sql.raw(`
      INSERT INTO role_scope_rules (role_id, scope, effect)
      SELECT r.id, v.scope, v.effect
      FROM roles r
      JOIN (
        VALUES
          ('authenticated_user', 'dashboard.read', 'allow'),
          ('authenticated_user', 'profile.manage_self', 'allow'),
          ('authenticated_user', 'members.read', 'allow'),
          ('authenticated_user', 'leagues.read', 'allow'),
          ('authenticated_user', 'calendar.read', 'allow'),
          ('authenticated_user', 'governance.read', 'allow'),
          ('authenticated_user', 'feedback.submit', 'allow'),
          ('authenticated_user', 'spares.read', 'allow'),
          ('authenticated_user', 'spares.respond', 'allow'),
          ('authenticated_user', 'availability.manage_self', 'allow'),
          ('active_member', 'member.active', 'allow'),
          ('member_with_ice_privileges', 'member.ice_privileges', 'allow'),
          ('member_with_ice_privileges', 'spares.request', 'allow'),
          ('member_with_ice_privileges', 'ice_bookings.manage_own', 'allow'),
          ('general_admin', 'admin.manage', 'allow'),
          ('general_admin', 'members.manage', 'allow'),
          ('general_admin', 'governance.manage', 'allow'),
          ('general_admin', 'feedback.manage', 'allow'),
          ('general_admin', 'payments.read', 'allow'),
          ('general_admin', 'payments.manage', 'allow'),
          ('general_admin', 'waitlists.view', 'allow'),
          ('general_admin', 'waitlists.manage', 'allow'),
          ('general_admin', 'registrations.manage', 'allow'),
          ('calendar_admin', 'calendar.manage', 'allow'),
          ('content_admin', 'content.manage', 'allow'),
          ('content_admin', 'files.manage', 'allow'),
          ('sponsor_admin', 'sponsorship.manage', 'allow'),
          ('league_admin', 'leagues.manage', 'allow'),
          ('league_manager', 'leagues.manage', 'allow'),
          ('volunteer_manager', 'volunteering.manage', 'allow')
      ) AS v(role_code, scope, effect)
        ON r.code = v.role_code
      ON CONFLICT (role_id, scope) DO NOTHING
    `));
    return;
  }

  await db.execute(sql.raw(`
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('authenticated_user', 'Authenticated user', 'Base permissions for any signed-in user', 1, 1, 0);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('active_member', 'Active member', 'Computed role for members with non-expired membership', 1, 1, 0);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('member_with_ice_privileges', 'Member with ice privileges', 'Computed role for members with on-ice access', 1, 1, 0);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('general_admin', 'General admin', 'General administrative permissions', 1, 0, 1);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('calendar_admin', 'Calendar admin', 'Calendar administration permissions', 1, 0, 1);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('content_admin', 'Content admin', 'Content and file administration permissions', 1, 0, 1);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('sponsor_admin', 'Sponsor admin', 'Sponsorship administration permissions', 1, 0, 1);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('league_admin', 'League admin', 'League administration permissions', 1, 0, 1);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('league_manager', 'League manager', 'League management permissions', 1, 0, 1);
    INSERT OR IGNORE INTO roles (code, name, description, is_system, is_computed, is_assignable)
    VALUES ('volunteer_manager', 'Volunteer manager', 'Volunteer program and credential administration', 1, 0, 1);
  `));
}

async function seedMemberRoleAssignmentsFromLegacyFlags(isPostgres: boolean): Promise<void> {
  const { db } = getDrizzleDb();
  const suffix = isPostgres ? 'ON CONFLICT DO NOTHING' : '';
  const insertPrefix = isPostgres ? 'INSERT INTO' : 'INSERT OR IGNORE INTO';

  await db.execute(sql.raw(`
    ${insertPrefix} member_role_assignments (member_id, role_id, resource_type, resource_id)
    SELECT m.id, r.id, NULL, NULL
    FROM members m
    JOIN roles r ON r.code = 'calendar_admin'
    WHERE COALESCE(m.is_calendar_admin, 0) = 1
      AND NOT EXISTS (
        SELECT 1 FROM member_role_assignments a
        WHERE a.member_id = m.id AND a.role_id = r.id
          AND a.resource_type IS NULL AND a.resource_id IS NULL
      ) ${suffix};

    ${insertPrefix} member_role_assignments (member_id, role_id, resource_type, resource_id)
    SELECT m.id, r.id, NULL, NULL
    FROM members m
    JOIN roles r ON r.code = 'content_admin'
    WHERE COALESCE(m.is_content_admin, 0) = 1
      AND NOT EXISTS (
        SELECT 1 FROM member_role_assignments a
        WHERE a.member_id = m.id AND a.role_id = r.id
          AND a.resource_type IS NULL AND a.resource_id IS NULL
      ) ${suffix};

    ${insertPrefix} member_role_assignments (member_id, role_id, resource_type, resource_id)
    SELECT m.id, r.id, NULL, NULL
    FROM members m
    JOIN roles r ON r.code = 'sponsor_admin'
    WHERE COALESCE(m.is_sponsor_admin, 0) = 1
      AND NOT EXISTS (
        SELECT 1 FROM member_role_assignments a
        WHERE a.member_id = m.id AND a.role_id = r.id
          AND a.resource_type IS NULL AND a.resource_id IS NULL
      ) ${suffix};

    ${insertPrefix} member_role_assignments (member_id, role_id, resource_type, resource_id)
    SELECT lmr.member_id, r.id, 'league', lmr.league_id
    FROM league_member_roles lmr
    JOIN roles r ON r.code = 'league_manager'
    WHERE lmr.role = 'league_manager'
      AND NOT EXISTS (
        SELECT 1 FROM member_role_assignments a
        WHERE a.member_id = lmr.member_id AND a.role_id = r.id
          AND COALESCE(a.resource_type, '') = 'league'
          AND COALESCE(a.resource_id, -1) = COALESCE(lmr.league_id, -1)
      ) ${suffix};

    ${insertPrefix} member_role_assignments (member_id, role_id, resource_type, resource_id)
    SELECT lmr.member_id, r.id, 'league', lmr.league_id
    FROM league_member_roles lmr
    JOIN roles r ON r.code = 'league_admin'
    WHERE lmr.role = 'league_administrator'
      AND NOT EXISTS (
        SELECT 1 FROM member_role_assignments a
        WHERE a.member_id = lmr.member_id AND a.role_id = r.id
          AND COALESCE(a.resource_type, '') = 'league'
          AND COALESCE(a.resource_id, -1) = COALESCE(lmr.league_id, -1)
      ) ${suffix}
  `));
}

async function seedPublicContactRecipients(): Promise<void> {
  const { seedPublicContactRecipientsIfNeeded } = await import('../domains/content/publicContactRecipients.js');
  await seedPublicContactRecipientsIfNeeded();
}

async function seedMailingLists(): Promise<void> {
  const { seedMailingListsIfNeeded } = await import('../domains/content/mailingLists.js');
  await seedMailingListsIfNeeded();
}

async function seedCoreRows(isPostgres: boolean): Promise<void> {
  const { db } = getDrizzleDb();

  if (isPostgres) {
    await db.execute(sql.raw(`INSERT INTO server_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING`));
    await db.execute(sql.raw(`
      INSERT INTO governance_settings (id, fiscal_year_start_mmdd, board_turnover_mmdd)
      VALUES (1, '09-01', '09-01')
      ON CONFLICT (id) DO NOTHING
    `));
  } else {
    await db.execute(sql.raw(`INSERT OR IGNORE INTO server_config (id) VALUES (1)`));
    await db.execute(sql.raw(`
      INSERT OR IGNORE INTO governance_settings (id, fiscal_year_start_mmdd, board_turnover_mmdd)
      VALUES (1, '09-01', '09-01')
    `));
  }

  await db.execute(sql.raw(`
    INSERT INTO league_divisions (league_id, name, sort_order, is_default)
    SELECT l.id, 'Default', 0, 1
    FROM leagues l
    LEFT JOIN league_divisions d ON d.league_id = l.id
    WHERE d.id IS NULL
  `));
}

async function ensurePaymentOrdersCurlingRegistrationSubjectType(): Promise<void> {
  const { db } = getDrizzleDb();
  await db.execute(sql.raw('ALTER TABLE payment_orders DROP CONSTRAINT IF EXISTS payment_orders_subject_type_check'));
  await db.execute(sql.raw(`
    ALTER TABLE payment_orders ADD CONSTRAINT payment_orders_subject_type_check
    CHECK (subject_type IN ('donation', 'membership', 'event_registration', 'curling_registration'))
  `));
}

async function runRegistrationBootstrap(adapter: DatabaseAdapter): Promise<void> {
  if (adapter.isAsync()) {
    await ensureCurlingRegistrationBootstrap(adapter, execSQL);
    await ensureLeagueWaitlistSchema(adapter, execSQL);
    await ensurePaymentOrdersCurlingRegistrationSubjectType();
    return;
  }

  ensureCurlingRegistrationBootstrapSync(adapter, execSQLSync);
  await ensureLeagueWaitlistSchema(adapter, execSQL);
}

/** Idempotent seeds and additive registration helpers after Drizzle migrations. */
export async function runDatabaseBootstrap(config: DatabaseConfig): Promise<void> {
  const isPostgres = config.type === 'postgres';

  await seedRbacRolesAndScopes(isPostgres);
  await seedMemberRoleAssignmentsFromLegacyFlags(isPostgres);
  await seedCoreRows(isPostgres);
  await seedPublicContactRecipients();
  await seedMailingLists();
  await ensureRegistrationPriceDiscountSettingsTablesExist();

  if (config.type === 'sqlite') {
    const { SQLiteAdapter } = await import('./sqlite-adapter.js');
    const dbPath = config.sqlite?.path || path.join(path.dirname(fileURLToPath(import.meta.url)), '../data/spares.sqlite');
    const adapter = new SQLiteAdapter(dbPath);
    await runRegistrationBootstrap(adapter);
    adapter.close();
    return;
  }

  if (!config.postgres) {
    throw new Error('PostgreSQL configuration missing');
  }

  const { PostgresAdapter } = await import('./postgres-adapter.js');
  const adapter = new PostgresAdapter(config.postgres);
  await runRegistrationBootstrap(adapter);
  await adapter.close();
}
