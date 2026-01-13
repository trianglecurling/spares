# Database Migrations with Drizzle

## Schema Definition

The database schema is defined in `src/db/drizzle-schema.ts`. This is the single source of truth for your database structure.

## Migration Workflow

Drizzle Kit provides several commands for managing migrations:

## Initializing a Fresh Database

If you're starting with an empty database (e.g. a new `spares_test` Postgres DB), initialize the schema using the backend's built-in schema creator:

```bash
cd backend
npm run db:init
```

This:
- Creates all tables (SQLite or Postgres, based on `data/db-config.json`)
- Seeds the required `server_config` row
- Creates initial server-admin members if the members table is empty (using `SERVER_ADMINS` and/or `adminEmails` in `data/db-config.json`)

### 1. Generate Migration Files

When you change the schema in `drizzle-schema.ts`, generate migration files:

```bash
npm run db:generate
```

This will:
- Compare your schema to the current database state
- Generate SQL migration files in the `./drizzle` directory
- Create migration files with timestamps (e.g., `0000_add_disable_email_sms.sql`)

### 2. Review Generated Migrations

Check the generated SQL files in `./drizzle/` to ensure they're correct before applying.

### 3. Apply Migrations

Run the migrations against your database:

```bash
npm run db:migrate
```

This will execute all pending migrations.

### 4. Development: Push Schema Directly (Alternative)

For development, you can push schema changes directly without generating migration files:

```bash
npm run db:push
```

**Note:** `db:push` is great for development but should NOT be used in production. Always use `db:generate` + `db:migrate` for production.

## Adding the New Columns

For the `disable_email` and `disable_sms` columns we just added:

1. **Generate the migration:**
   ```bash
   cd backend
   npm run db:generate
   ```

2. **Review the generated SQL** in `./drizzle/` directory

3. **Apply the migration:**
   ```bash
   npm run db:migrate
   ```

## Migration Files Location

- Generated migrations: `./drizzle/` (relative to backend directory)
- Migration files are SQL files that can be version controlled
- Drizzle tracks which migrations have been applied

## Important Notes

- Always review generated migrations before applying
- Commit migration files to version control
- Run migrations in the same order across environments
- For production, use `db:generate` + `db:migrate`, not `db:push`

