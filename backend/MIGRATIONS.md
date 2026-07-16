# Database Migrations

Schema is defined in `src/db/drizzle-schema.ts`. SQL migrations live in `drizzle/`.

## Apply migrations (preview / agent workflow)

From the **repository root**:

```bash
bun run db:migrate:preview
```

This uses `DB_CONFIG_PROFILE=preview` (`data/db-config.preview.json`) and runs `backend/src/scripts/init-db.ts`, which:

1. Applies pending Drizzle SQL migrations from `drizzle/` via `src/db/migrate-runner.ts` (Postgres) or `drizzle-kit push` (SQLite)
2. Baselines existing databases that predate Drizzle tracking (marks `0000` as applied when `members` exists but `public.__drizzle_migrations` is empty)
3. Runs idempotent bootstrap seeds (RBAC roles/scopes, `server_config`, default league divisions, registration additive helpers)

SQLite local databases use `drizzle-kit push` instead of migrate, then the same bootstrap step.

**Agents must use `db:migrate:preview` only.** Do not run `bun run db:migrate` (production / `db-config.json`) from agent workflows. Migrate production manually after preview testing.

## Apply migrations (production)

After verifying on preview:

```bash
bun run db:migrate
```

## Generate a new migration

After editing `src/db/drizzle-schema.ts`:

```bash
cd backend
bun run db:generate
```

Review the SQL in `drizzle/`, then run `bun run db:migrate:preview` from the repo root.

## Notes

- Do not use `drizzle-kit migrate` directly on Postgres unless debugging; the runner avoids `CREATE SCHEMA` (required on Azure) and uses `public.__drizzle_migrations`. Root `db:migrate:preview` (agents) or `db:migrate` (production) are the supported entry points.
- `db:push` is for emergency local SQLite sync only, not the normal workflow.
- Fresh installs and existing databases both use the same root commands.
