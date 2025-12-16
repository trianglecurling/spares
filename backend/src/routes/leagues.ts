import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, sql, asc } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { isAdmin } from '../utils/auth.js';
import { Member, League, LeagueDrawTime } from '../types.js';

const createLeagueSchema = z.object({
  name: z.string().min(1),
  dayOfWeek: z.number().min(0).max(6),
  format: z.enum(['teams', 'doubles']),
  startDate: z.string(),
  endDate: z.string(),
  drawTimes: z.array(z.string()),
  exceptions: z.array(z.string()).optional(),
});

const updateLeagueSchema = z.object({
  name: z.string().min(1).optional(),
  dayOfWeek: z.number().min(0).max(6).optional(),
  format: z.enum(['teams', 'doubles']).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  drawTimes: z.array(z.string()).optional(),
  exceptions: z.array(z.string()).optional(),
});

function normalizeDateString(value: any): string {
  if (typeof value === 'string') return value;
  if (value instanceof Date) return value.toISOString().split('T')[0];
  return String(value);
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => v.trim()).filter(Boolean)));
}

export async function leagueRoutes(fastify: FastifyInstance) {
  // Get all leagues
  fastify.get('/leagues', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const leagues = await db
      .select()
      .from(schema.leagues)
      .orderBy(schema.leagues.day_of_week, schema.leagues.name) as League[];

    const result = await Promise.all(leagues.map(async (league) => {
      const drawTimes = await db
        .select({ draw_time: schema.leagueDrawTimes.draw_time })
        .from(schema.leagueDrawTimes)
        .where(eq(schema.leagueDrawTimes.league_id, league.id))
        .orderBy(asc(schema.leagueDrawTimes.draw_time));

      const exceptions = await db
        .select({ exception_date: schema.leagueExceptions.exception_date })
        .from(schema.leagueExceptions)
        .where(eq(schema.leagueExceptions.league_id, league.id))
        .orderBy(asc(schema.leagueExceptions.exception_date));

      return {
        id: league.id,
        name: league.name,
        dayOfWeek: league.day_of_week,
        format: league.format,
        startDate: league.start_date,
        endDate: league.end_date,
        drawTimes: drawTimes.map((dt: any) => dt.draw_time),
        exceptions: exceptions.map((ex: any) => normalizeDateString(ex.exception_date)),
      };
    }));

    return result;
  });

  // Get upcoming games for a league
  fastify.get('/leagues/:id/upcoming-games', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    
    const league = leagues[0] as League | undefined;
    if (!league) {
      return reply.code(404).send({ error: 'League not found' });
    }

    const drawTimes = await db
      .select({ draw_time: schema.leagueDrawTimes.draw_time })
      .from(schema.leagueDrawTimes)
      .where(eq(schema.leagueDrawTimes.league_id, leagueId))
      .orderBy(asc(schema.leagueDrawTimes.draw_time));

    const exceptionsRows = await db
      .select({ exception_date: schema.leagueExceptions.exception_date })
      .from(schema.leagueExceptions)
      .where(eq(schema.leagueExceptions.league_id, leagueId));
    const exceptions = new Set(exceptionsRows.map((ex: any) => normalizeDateString(ex.exception_date)));

    const games: { date: string; time: string }[] = [];
    
    // Parse dates carefully to avoid timezone issues
    // We assume the date strings are "YYYY-MM-DD" and should be treated as local dates
    // Or better yet, just work with the string components for comparison?
    // For date math, using UTC for "midnight" usually works best to avoid DST issues
    
    // Create date objects at UTC midnight
    const startDate = new Date(league.start_date + 'T00:00:00Z');
    const endDate = new Date(league.end_date + 'T00:00:00Z');
    
    const today = new Date();
    // Set today to UTC midnight for comparison
    const todayMidnight = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

    // Find the first game date on or after start date (and today) matching the day of week
    let currentDate = new Date(Math.max(startDate.getTime(), todayMidnight.getTime()));
    
    // Adjust to next occurrence of dayOfWeek
    const targetDay = league.day_of_week; // 0=Sun, 6=Sat
    const currentDay = currentDate.getUTCDay();
    let daysUntilTarget = (targetDay - currentDay + 7) % 7;
    
    currentDate.setUTCDate(currentDate.getUTCDate() + daysUntilTarget);

    // Loop while current date is <= end date
    // Using <= works correctly if dates are normalized to UTC midnight
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];

      // Skip dates where the league does not run (holiday / off week / etc.)
      if (exceptions.has(dateStr)) {
        currentDate.setUTCDate(currentDate.getUTCDate() + 7);
        continue;
      }
      
      for (const dt of drawTimes) {
        // If the game is today, check if the time has passed
        // We need to compare current local time vs game time
        if (currentDate.getTime() === todayMidnight.getTime()) {
           const [hours, minutes] = dt.draw_time.split(':').map(Number);
           const gameTime = new Date(); // Current local time
           gameTime.setHours(hours, minutes, 0, 0);
           
           // If game time is in the past (relative to now), skip it
           if (gameTime < new Date()) continue;
        }

        games.push({
          date: dateStr,
          time: dt.draw_time,
        });
      }
      
      // Move to next week
      currentDate.setUTCDate(currentDate.getUTCDate() + 7);
    }

    return games;
  });

  // Admin: Create league
  fastify.post('/leagues', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = createLeagueSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();
    const exceptions = uniqueStrings(body.exceptions ?? []);

    const result = await db
      .insert(schema.leagues)
      .values({
        name: body.name,
        day_of_week: body.dayOfWeek,
        format: body.format,
        start_date: body.startDate,
        end_date: body.endDate,
      })
      .returning();

    const leagueId = result[0].id;

    // Insert draw times
    if (body.drawTimes.length > 0) {
      await db.insert(schema.leagueDrawTimes).values(
        body.drawTimes.map(drawTime => ({
          league_id: leagueId,
          draw_time: drawTime,
        }))
      );
    }

    // Insert exceptions
    if (exceptions.length > 0) {
      await db.insert(schema.leagueExceptions).values(
        exceptions.map((d) => ({
          league_id: leagueId,
          exception_date: d,
        }))
      );
    }

    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    
    const league = leagues[0] as League;
    
    const drawTimes = await db
      .select({ draw_time: schema.leagueDrawTimes.draw_time })
      .from(schema.leagueDrawTimes)
      .where(eq(schema.leagueDrawTimes.league_id, leagueId))
      .orderBy(asc(schema.leagueDrawTimes.draw_time));

    const exceptionRows = await db
      .select({ exception_date: schema.leagueExceptions.exception_date })
      .from(schema.leagueExceptions)
      .where(eq(schema.leagueExceptions.league_id, leagueId))
      .orderBy(asc(schema.leagueExceptions.exception_date));

    return {
      id: league.id,
      name: league.name,
      dayOfWeek: league.day_of_week,
      format: league.format,
      startDate: league.start_date,
      endDate: league.end_date,
      drawTimes: drawTimes.map((dt: any) => dt.draw_time),
      exceptions: exceptionRows.map((ex: any) => normalizeDateString(ex.exception_date)),
    };
  });

  // Admin: Update league
  fastify.patch('/leagues/:id', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const body = updateLeagueSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const updateData: any = {};

    if (body.name !== undefined) {
      updateData.name = body.name;
    }
    if (body.dayOfWeek !== undefined) {
      updateData.day_of_week = body.dayOfWeek;
    }
    if (body.format !== undefined) {
      updateData.format = body.format;
    }
    if (body.startDate !== undefined) {
      updateData.start_date = body.startDate;
    }
    if (body.endDate !== undefined) {
      updateData.end_date = body.endDate;
    }

    if (Object.keys(updateData).length > 0) {
      updateData.updated_at = sql`CURRENT_TIMESTAMP`;
      await db
        .update(schema.leagues)
        .set(updateData)
        .where(eq(schema.leagues.id, leagueId));
    }

    // Update draw times if provided
    if (body.drawTimes !== undefined) {
      await db
        .delete(schema.leagueDrawTimes)
        .where(eq(schema.leagueDrawTimes.league_id, leagueId));

      if (body.drawTimes.length > 0) {
        await db.insert(schema.leagueDrawTimes).values(
          body.drawTimes.map(drawTime => ({
            league_id: leagueId,
            draw_time: drawTime,
          }))
        );
      }
    }

    // Update exceptions if provided
    if (body.exceptions !== undefined) {
      const exceptions = uniqueStrings(body.exceptions);
      await db
        .delete(schema.leagueExceptions)
        .where(eq(schema.leagueExceptions.league_id, leagueId));

      if (exceptions.length > 0) {
        await db.insert(schema.leagueExceptions).values(
          exceptions.map((d) => ({
            league_id: leagueId,
            exception_date: d,
          }))
        );
      }
    }

    const leagues = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, leagueId))
      .limit(1);
    
    const league = leagues[0] as League;
    
    const drawTimes = await db
      .select({ draw_time: schema.leagueDrawTimes.draw_time })
      .from(schema.leagueDrawTimes)
      .where(eq(schema.leagueDrawTimes.league_id, leagueId))
      .orderBy(asc(schema.leagueDrawTimes.draw_time));

    const exceptionRows = await db
      .select({ exception_date: schema.leagueExceptions.exception_date })
      .from(schema.leagueExceptions)
      .where(eq(schema.leagueExceptions.league_id, leagueId))
      .orderBy(asc(schema.leagueExceptions.exception_date));

    return {
      id: league.id,
      name: league.name,
      dayOfWeek: league.day_of_week,
      format: league.format,
      startDate: league.start_date,
      endDate: league.end_date,
      drawTimes: drawTimes.map((dt: any) => dt.draw_time),
      exceptions: exceptionRows.map((ex: any) => normalizeDateString(ex.exception_date)),
    };
  });

  // Admin: Delete league
  fastify.delete('/leagues/:id', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { id } = request.params as { id: string };
    const leagueId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    await db
      .delete(schema.leagues)
      .where(eq(schema.leagues.id, leagueId));

    return { success: true };
  });

  // Admin: Export leagues
  fastify.get('/leagues/export', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const { db, schema } = getDrizzleDb();
    const leagues = await db
      .select()
      .from(schema.leagues)
      .orderBy(schema.leagues.day_of_week, schema.leagues.name) as League[];

    const result = await Promise.all(leagues.map(async (league) => {
      const drawTimes = await db
        .select({ draw_time: schema.leagueDrawTimes.draw_time })
        .from(schema.leagueDrawTimes)
        .where(eq(schema.leagueDrawTimes.league_id, league.id))
        .orderBy(asc(schema.leagueDrawTimes.draw_time));

      const exceptions = await db
        .select({ exception_date: schema.leagueExceptions.exception_date })
        .from(schema.leagueExceptions)
        .where(eq(schema.leagueExceptions.league_id, league.id))
        .orderBy(asc(schema.leagueExceptions.exception_date));

      return {
        name: league.name,
        dayOfWeek: league.day_of_week,
        format: league.format,
        startDate: league.start_date,
        endDate: league.end_date,
        drawTimes: drawTimes.map((dt: any) => dt.draw_time),
        exceptions: exceptions.map((ex: any) => normalizeDateString(ex.exception_date)),
      };
    }));

    return { leagues: result };
  });

  // Admin: Import leagues
  const importLeaguesSchema = z.object({
    leagues: z.array(z.object({
      name: z.string().min(1),
      dayOfWeek: z.number().min(0).max(6),
      format: z.enum(['teams', 'doubles']),
      startDate: z.string(),
      endDate: z.string(),
      drawTimes: z.array(z.string()),
      exceptions: z.array(z.string()).optional(),
    })),
  });

  fastify.post('/leagues/import', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member || !isAdmin(member)) {
      return reply.code(403).send({ error: 'Forbidden' });
    }

    const body = importLeaguesSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    const importedLeagues = [];

    for (const leagueData of body.leagues) {
      // Check if a league with the same name already exists
      const existingLeagues = await db
        .select()
        .from(schema.leagues)
        .where(eq(schema.leagues.name, leagueData.name))
        .limit(1);

      let leagueId: number;

      if (existingLeagues.length > 0) {
        // Update existing league
        const existingLeague = existingLeagues[0] as League;
        leagueId = existingLeague.id;

        await db
          .update(schema.leagues)
          .set({
            day_of_week: leagueData.dayOfWeek,
            format: leagueData.format,
            start_date: leagueData.startDate,
            end_date: leagueData.endDate,
            updated_at: sql`CURRENT_TIMESTAMP`,
          })
          .where(eq(schema.leagues.id, leagueId));

        // Delete existing draw times
        await db
          .delete(schema.leagueDrawTimes)
          .where(eq(schema.leagueDrawTimes.league_id, leagueId));
        // Delete existing exceptions
        await db
          .delete(schema.leagueExceptions)
          .where(eq(schema.leagueExceptions.league_id, leagueId));
      } else {
        // Create new league
        const result = await db
          .insert(schema.leagues)
          .values({
            name: leagueData.name,
            day_of_week: leagueData.dayOfWeek,
            format: leagueData.format,
            start_date: leagueData.startDate,
            end_date: leagueData.endDate,
          })
          .returning();

        leagueId = result[0].id;
      }

      // Insert draw times
      if (leagueData.drawTimes.length > 0) {
        await db.insert(schema.leagueDrawTimes).values(
          leagueData.drawTimes.map(drawTime => ({
            league_id: leagueId,
            draw_time: drawTime,
          }))
        );
      }

      // Insert exceptions
      const exceptions = uniqueStrings(leagueData.exceptions ?? []);
      if (exceptions.length > 0) {
        await db.insert(schema.leagueExceptions).values(
          exceptions.map((d) => ({
            league_id: leagueId,
            exception_date: d,
          }))
        );
      }

      importedLeagues.push({
        id: leagueId,
        name: leagueData.name,
        dayOfWeek: leagueData.dayOfWeek,
        format: leagueData.format,
        startDate: leagueData.startDate,
        endDate: leagueData.endDate,
        drawTimes: leagueData.drawTimes,
        exceptions,
      });
    }

    return {
      success: true,
      imported: importedLeagues.length,
      leagues: importedLeagues,
    };
  });
}
