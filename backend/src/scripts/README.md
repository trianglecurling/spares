# Backend scripts

Product operations that ship with the app live in this folder.

One-off servicing jobs live in a **separate repo**, cloned here so they can still import the live backend:

```text
backend/src/scripts/servicing/   # gitignored clone of trianglecurling/thebroomstack-servicing
```

## Product scripts (this repo)

Run from `backend/` unless noted.

| Script | npm script |
|---|---|
| `init-db.ts` | `db:init`, `db:migrate`, `db:migrate:preview` |
| `copy-db.ts`, `dump-db.ts`, `dbDumpShared.ts` | `db:copy`, `db:copy-to-preview`, `db:dump` |
| `snapshot-waitlists.ts`, `restore-waitlists.ts`, `waitlistSnapshot.ts` | `db:snapshot-waitlists`, `db:restore-waitlists` |
| `rebuild-league-rosters.ts` | `db:rebuild-league-rosters` |
| `seed-test-members.ts`, `seed-bye-requests.ts`, `generate-teams.ts` | matching `db:seed-*` / `db:generate-teams` |

## Servicing clone

On machines that need one-off jobs:

```bash
git clone git@github.com:trianglecurling/thebroomstack-servicing.git backend/src/scripts/servicing
```

Always run servicing scripts from `backend/` so `data/db-config.json` resolves. Prefer preview first:

```bash
cd backend
DB_CONFIG_PROFILE=preview bun run src/scripts/servicing/<script>.ts --dry-run
```

New one-offs go in the servicing clone and are committed there, not in this repo. If a job becomes a real product operation, move it up into this folder and add an npm script.
