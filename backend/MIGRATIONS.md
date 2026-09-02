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

## Copy production onto preview

To replace the preview/test database with a full copy of production (schema + data):

```bash
bun run db:copy-to-preview -- --dry-run
bun run db:copy-to-preview -- --yes
```

This reads `backend/data/db-config.json` (source) and `backend/data/db-config.preview.json` (destination). Before overwrite, the destination is dumped to `backend/data/db-dumps/<profile>-<timestamp>.dump` (gitignored). After copy, destination `server_config` enables test mode and bypass login verification (the `/admin/config` flags), then the preview application tier is restarted (`sudo systemctl restart tccnc-web-preview` by default, or `DB_COPY_APP_RESTART_CMD` / `--restart-cmd`) so in-memory caches reload. Use `--no-restart` to skip. It will not write to the default/production profile. Requires `pg_dump` and `pg_restore` 18+ for a Postgres 18 server (`sudo apt install postgresql-client-18` from the PGDG repo).

Other profiles:

```bash
bun run db:copy -- --from default --to preview --yes
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
