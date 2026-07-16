import { sql } from 'drizzle-orm';
import { getDrizzleDb } from './drizzle-db.js';

type DrawSlot = {
  sourceType?: string;
  teamId?: number | null;
  registrationId?: number | null;
  [key: string]: unknown;
};

type DrawGame = {
  slots?: DrawSlot[];
  [key: string]: unknown;
};

type DrawJson = {
  games?: Record<string, DrawGame>;
  [key: string]: unknown;
};

/**
 * SQLite path: remap draw team slots → registration slots and migrate calendar
 * types before drizzle-kit push drops tournament team tables / tournament_format.
 */
export async function migrateTournamentTeamsToRegistrationsSqlite(): Promise<void> {
  const { db } = getDrizzleDb();

  const teamsTable = await db.execute(
    sql.raw(`
      SELECT 1
      FROM sqlite_master
      WHERE type = 'table' AND name = 'event_tournament_teams'
      LIMIT 1
    `)
  );
  const teamsRows = (teamsTable as { rows?: unknown[] }).rows ?? teamsTable;
  const hasTeamsTable = Array.isArray(teamsRows) && teamsRows.length > 0;

  if (hasTeamsTable) {
    const teamMapResult = await db.execute(
      sql.raw(`SELECT id, registration_id FROM event_tournament_teams`)
    );
    const teamMapRows =
      ((teamMapResult as { rows?: Array<{ id?: number; registration_id?: number | null }> }).rows ??
        teamMapResult) as Array<{ id?: number; registration_id?: number | null }>;
    const teamIdToRegistrationId = new Map<number, number>();
    if (Array.isArray(teamMapRows)) {
      for (const row of teamMapRows) {
        if (row.id != null && row.registration_id != null) {
          teamIdToRegistrationId.set(Number(row.id), Number(row.registration_id));
        }
      }
    }

    const eventsResult = await db.execute(
      sql.raw(`
        SELECT id, tournament_draw_json
        FROM events
        WHERE tournament_draw_json IS NOT NULL AND trim(tournament_draw_json) <> ''
      `)
    );
    const eventRows =
      ((eventsResult as { rows?: Array<{ id?: number; tournament_draw_json?: string | null }> }).rows ??
        eventsResult) as Array<{ id?: number; tournament_draw_json?: string | null }>;

    if (Array.isArray(eventRows)) {
      for (const ev of eventRows) {
        if (ev.id == null || !ev.tournament_draw_json) continue;
        let draw: DrawJson;
        try {
          draw = JSON.parse(ev.tournament_draw_json) as DrawJson;
        } catch {
          continue;
        }
        if (!draw.games || typeof draw.games !== 'object') continue;

        let changed = false;
        for (const game of Object.values(draw.games)) {
          if (!game || !Array.isArray(game.slots)) continue;
          game.slots = game.slots.map((slot) => {
            if (!slot || slot.sourceType !== 'team') return slot;
            changed = true;
            const teamId = typeof slot.teamId === 'number' ? slot.teamId : null;
            const registrationId = teamId != null ? teamIdToRegistrationId.get(teamId) : undefined;
            if (registrationId != null) {
              return { sourceType: 'registration', registrationId };
            }
            return { sourceType: 'tbd' };
          });
        }

        if (changed) {
          const escaped = JSON.stringify(draw).replace(/'/g, "''");
          await db.execute(
            sql.raw(`UPDATE events SET tournament_draw_json = '${escaped}' WHERE id = ${Number(ev.id)}`)
          );
        }
      }
    }
  }

  const eventsCols = await db.execute(sql.raw(`PRAGMA table_info(events)`));
  const colRows = (eventsCols as { rows?: Array<{ name?: string | null }> }).rows ?? eventsCols;
  const hasTournamentFormat =
    Array.isArray(colRows) && colRows.some((c) => c.name === 'tournament_format');

  if (hasTournamentFormat) {
    await db.execute(
      sql.raw(`
        UPDATE events
        SET calendar_type_id = 'bonspiel-doubles'
        WHERE calendar_type_id = 'bonspiel' AND tournament_format = 'doubles'
      `)
    );
    await db.execute(
      sql.raw(`
        UPDATE events
        SET calendar_type_id = 'bonspiel-fours'
        WHERE calendar_type_id = 'bonspiel'
      `)
    );
  } else {
    await db.execute(
      sql.raw(`
        UPDATE events
        SET calendar_type_id = 'bonspiel-fours'
        WHERE calendar_type_id = 'bonspiel'
      `)
    );
  }
}
