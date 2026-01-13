import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, and, or, sql, asc, desc, isNull, isNotNull, inArray, gte, ne } from 'drizzle-orm';
import { getDrizzleDb } from '../db/drizzle-db.js';
import { Member, SpareRequest, League } from '../types.js';
import {
  sendSpareRequestEmail,
  sendSpareRequestCreatedEmail,
  sendSpareRequestCcCreatedEmail,
  sendSpareRequestCcFilledEmail,
  sendSpareRequestCcCancellationEmail,
  sendSpareResponseEmail,
  sendSpareCancellationEmail,
  sendSpareOfferConfirmationEmail,
  sendSpareOfferCancellationConfirmationEmail,
} from '../services/email.js';
import { sendSpareRequestSMS, sendSpareFilledSMS, sendSpareCancellationSMS } from '../services/sms.js';
import { generateToken, generateEmailLinkToken } from '../utils/auth.js';
import { getCurrentTimeAsync, getCurrentDateStringAsync } from '../utils/time.js';
import { logEvent } from '../services/observability.js';

const createSpareRequestSchema = z.object({
  leagueId: z.number(),
  requestedForName: z.string().min(1),
  gameDate: z.string(),
  gameTime: z.string(),
  position: z.enum(['lead', 'second', 'vice', 'skip']).optional(),
  message: z.string().optional(),
  requestType: z.enum(['public', 'private']),
  invitedMemberIds: z.array(z.number()).optional(),
  ccMemberIds: z.array(z.number()).max(4).optional(),
});

const respondToSpareRequestSchema = z.object({
  comment: z.string().optional(),
});

const cancelSparingSchema = z.object({
  comment: z.string().min(1, 'Comment is required'),
});

const reissueSpareRequestSchema = z.object({
  message: z.string().optional(),
});

export async function spareRoutes(fastify: FastifyInstance) {
  async function getCcMembersForRequest(requestId: number): Promise<Member[]> {
    const { db, schema } = getDrizzleDb();
    const rows = await db
      .select({
        id: schema.members.id,
        name: schema.members.name,
        email: schema.members.email,
        phone: schema.members.phone,
        is_admin: schema.members.is_admin,
        is_server_admin: schema.members.is_server_admin,
        email_subscribed: schema.members.email_subscribed,
      })
      .from(schema.spareRequestCcs)
      .innerJoin(schema.members, eq(schema.spareRequestCcs.member_id, schema.members.id))
      .where(eq(schema.spareRequestCcs.spare_request_id, requestId));

    return rows as unknown as Member[];
  }

  // Get all public spare requests
  fastify.get('/spares', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const today = await getCurrentDateStringAsync();
    
    // Check if member can skip
    const memberAvailability = await db
      .select({ can_skip: schema.memberAvailability.can_skip })
      .from(schema.memberAvailability)
      .where(eq(schema.memberAvailability.member_id, member.id))
      .limit(1);
    const canSkip = memberAvailability[0]?.can_skip === 1;
    
    // Get all open public spare requests
    let publicConditions = [
      eq(schema.spareRequests.status, 'open'),
      eq(schema.spareRequests.request_type, 'public'),
      gte(schema.spareRequests.game_date, today),
      ne(schema.spareRequests.requester_id, member.id),
    ];
    
    // Filter out skip requests if member can't skip
    if (!canSkip) {
      publicConditions.push(
        or(
          isNull(schema.spareRequests.position),
          ne(schema.spareRequests.position, 'skip')
        )!
      );
    }
    
    const publicRequests = await db
      .select({
        id: schema.spareRequests.id,
        league_name: schema.leagues.name,
        requester_name: schema.members.name,
        requester_email: schema.members.email,
        requester_phone: schema.members.phone,
        requested_for_name: schema.spareRequests.requested_for_name,
        game_date: schema.spareRequests.game_date,
        game_time: schema.spareRequests.game_time,
        position: schema.spareRequests.position,
        message: schema.spareRequests.message,
        request_type: schema.spareRequests.request_type,
        created_at: schema.spareRequests.created_at,
      })
      .from(schema.spareRequests)
      .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
      .leftJoin(schema.leagues, eq((schema.spareRequests as any).league_id, schema.leagues.id))
      .where(and(...publicConditions))
      .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

    // Get private requests the member was invited to
    let privateConditions = [
      eq(schema.spareRequests.status, 'open'),
      eq(schema.spareRequests.request_type, 'private'),
      eq(schema.spareRequestInvitations.member_id, member.id),
      gte(schema.spareRequests.game_date, today),
      ne(schema.spareRequests.requester_id, member.id),
    ];
    
    // Filter out skip requests if member can't skip
    if (!canSkip) {
      privateConditions.push(
        or(
          isNull(schema.spareRequests.position),
          ne(schema.spareRequests.position, 'skip')
        )!
      );
    }
    
    const privateRequests = await db
      .select({
        id: schema.spareRequests.id,
        league_name: schema.leagues.name,
        requester_name: schema.members.name,
        requester_email: schema.members.email,
        requester_phone: schema.members.phone,
        requested_for_name: schema.spareRequests.requested_for_name,
        game_date: schema.spareRequests.game_date,
        game_time: schema.spareRequests.game_time,
        position: schema.spareRequests.position,
        message: schema.spareRequests.message,
        request_type: schema.spareRequests.request_type,
        created_at: schema.spareRequests.created_at,
      })
      .from(schema.spareRequests)
      .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
      .innerJoin(schema.spareRequestInvitations, eq(schema.spareRequests.id, schema.spareRequestInvitations.spare_request_id))
      .leftJoin(schema.leagues, eq((schema.spareRequests as any).league_id, schema.leagues.id))
      .where(and(...privateConditions))
      .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

    const allRequests = [...publicRequests, ...privateRequests];

    return allRequests.map((req: any) => ({
      id: req.id,
      requesterName: req.requester_name,
      requestedForName: req.requested_for_name,
      gameDate: req.game_date,
      gameTime: req.game_time,
      leagueName: req.league_name || null,
      position: req.position,
      message: req.message,
      requestType: req.request_type,
      createdAt: req.created_at,
    }));
  });

  // Get member's own spare requests
  fastify.get('/spares/my-requests', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const today = await getCurrentDateStringAsync();
    
    const requests = await db
      .select({
        id: schema.spareRequests.id,
        league_name: schema.leagues.name,
        requested_for_name: schema.spareRequests.requested_for_name,
        game_date: schema.spareRequests.game_date,
        game_time: schema.spareRequests.game_time,
        position: schema.spareRequests.position,
        message: schema.spareRequests.message,
        request_type: schema.spareRequests.request_type,
        status: schema.spareRequests.status,
        filled_by_name: schema.members.name,
        filled_by_email: schema.members.email,
        filled_by_phone: schema.members.phone,
        filled_at: schema.spareRequests.filled_at,
        notifications_sent_at: schema.spareRequests.notifications_sent_at,
        had_cancellation: schema.spareRequests.had_cancellation,
        created_at: schema.spareRequests.created_at,
        sparer_comment: schema.spareResponses.comment,
      })
      .from(schema.spareRequests)
      .leftJoin(schema.members, eq(schema.spareRequests.filled_by_member_id, schema.members.id))
      .leftJoin(schema.leagues, eq((schema.spareRequests as any).league_id, schema.leagues.id))
      .leftJoin(
        schema.spareResponses,
        eq(schema.spareRequests.id, schema.spareResponses.spare_request_id)
      )
      .where(
        and(
          eq(schema.spareRequests.requester_id, member.id),
          gte(schema.spareRequests.game_date, today)
        )
      )
      .orderBy(
        sql`CASE 
          WHEN ${schema.spareRequests.status} = 'open' THEN 1
          WHEN ${schema.spareRequests.status} = 'filled' THEN 2
          WHEN ${schema.spareRequests.status} = 'cancelled' THEN 3
          ELSE 4
        END`,
        asc(schema.spareRequests.game_date),
        asc(schema.spareRequests.game_time)
      );

    return requests.map((req: any) => {
      return {
        id: req.id,
        requestedForName: req.requested_for_name,
        gameDate: req.game_date,
        gameTime: req.game_time,
        leagueName: req.league_name || null,
        position: req.position,
        message: req.message,
        requestType: req.request_type,
        status: req.status,
        filledByName: req.filled_by_name,
        filledByEmail: req.filled_by_email,
        filledByPhone: req.filled_by_phone,
        filledAt: req.filled_at,
        sparerComment: req.sparer_comment,
        notificationsSentAt: req.notifications_sent_at,
        hadCancellation: req.had_cancellation === 1,
        createdAt: req.created_at,
      };
    });
  });

  // Get member's past spare requests (read-only, includes filled or unfilled)
  fastify.get('/spares/my-requests/past', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const today = await getCurrentDateStringAsync();
    const now = await getCurrentTimeAsync();
    const nowTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const requests = await db
      .select({
        id: schema.spareRequests.id,
        requested_for_name: schema.spareRequests.requested_for_name,
        game_date: schema.spareRequests.game_date,
        game_time: schema.spareRequests.game_time,
        position: schema.spareRequests.position,
        message: schema.spareRequests.message,
        request_type: schema.spareRequests.request_type,
        status: schema.spareRequests.status,
        filled_by_name: schema.members.name,
        filled_by_email: schema.members.email,
        filled_by_phone: schema.members.phone,
        filled_at: schema.spareRequests.filled_at,
        notifications_sent_at: schema.spareRequests.notifications_sent_at,
        had_cancellation: schema.spareRequests.had_cancellation,
        created_at: schema.spareRequests.created_at,
        sparer_comment: schema.spareResponses.comment,
      })
      .from(schema.spareRequests)
      .leftJoin(schema.members, eq(schema.spareRequests.filled_by_member_id, schema.members.id))
      .leftJoin(
        schema.spareResponses,
        eq(schema.spareRequests.id, schema.spareResponses.spare_request_id)
      )
      .where(
        and(
          eq(schema.spareRequests.requester_id, member.id),
          or(
            sql`${schema.spareRequests.game_date} < ${today}`,
            and(
              eq(schema.spareRequests.game_date, today),
              sql`${schema.spareRequests.game_time} < ${nowTime}`
            )
          )
        )
      )
      .orderBy(desc(schema.spareRequests.game_date), desc(schema.spareRequests.game_time));

    return requests.map((req: any) => {
      return {
        id: req.id,
        requestedForName: req.requested_for_name,
        gameDate: req.game_date,
        gameTime: req.game_time,
        position: req.position,
        message: req.message,
        requestType: req.request_type,
        status: req.status,
        filledByName: req.filled_by_name,
        filledByEmail: req.filled_by_email,
        filledByPhone: req.filled_by_phone,
        filledAt: req.filled_at,
        sparerComment: req.sparer_comment,
        notificationsSentAt: req.notifications_sent_at,
        hadCancellation: req.had_cancellation === 1,
        createdAt: req.created_at,
      };
    });
  });

  // Get spare requests the user has signed up to fill (upcoming)
  fastify.get('/spares/my-sparing', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const today = await getCurrentDateStringAsync();
    
    const requests = await db
      .select({
        id: schema.spareRequests.id,
        league_name: schema.leagues.name,
        requester_name: schema.members.name,
        requester_email: schema.members.email,
        requester_phone: schema.members.phone,
        requested_for_name: schema.spareRequests.requested_for_name,
        game_date: schema.spareRequests.game_date,
        game_time: schema.spareRequests.game_time,
        position: schema.spareRequests.position,
        message: schema.spareRequests.message,
        request_type: schema.spareRequests.request_type,
        created_at: schema.spareRequests.created_at,
      })
      .from(schema.spareRequests)
      .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
      .leftJoin(schema.leagues, eq((schema.spareRequests as any).league_id, schema.leagues.id))
      .where(
        and(
          eq(schema.spareRequests.filled_by_member_id, member.id),
          eq(schema.spareRequests.status, 'filled'),
          gte(schema.spareRequests.game_date, today)
        )
      )
      .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));

    return requests.map((req: any) => ({
      id: req.id,
      requesterName: req.requester_name,
      requesterEmail: req.requester_email,
      requesterPhone: req.requester_phone,
      requestedForName: req.requested_for_name,
      gameDate: req.game_date,
      gameTime: req.game_time,
      leagueName: req.league_name || null,
      position: req.position,
      message: req.message,
      requestType: req.request_type,
      createdAt: req.created_at,
    }));
  });

  // Get filled spare requests (for expandable section)
  fastify.get('/spares/filled-upcoming', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { db, schema } = getDrizzleDb();
    const today = await getCurrentDateStringAsync();
    
    // Get filled requests that are upcoming, excluding ones the user filled
    // Use a subquery approach since we need to join members twice
    const requestsRaw = await db
      .select({
        id: schema.spareRequests.id,
        league_name: schema.leagues.name,
        requester_name: schema.members.name,
        filled_by_member_id: schema.spareRequests.filled_by_member_id,
        requested_for_name: schema.spareRequests.requested_for_name,
        game_date: schema.spareRequests.game_date,
        game_time: schema.spareRequests.game_time,
        position: schema.spareRequests.position,
        message: schema.spareRequests.message,
        request_type: schema.spareRequests.request_type,
        filled_at: schema.spareRequests.filled_at,
        created_at: schema.spareRequests.created_at,
      })
      .from(schema.spareRequests)
      .innerJoin(schema.members, eq(schema.spareRequests.requester_id, schema.members.id))
      .leftJoin(schema.leagues, eq((schema.spareRequests as any).league_id, schema.leagues.id))
      .where(
        and(
          eq(schema.spareRequests.status, 'filled'),
          eq(schema.spareRequests.request_type, 'public'),
          gte(schema.spareRequests.game_date, today),
          // Exclude any requests the user is involved with (requester or sparer)
          ne(schema.spareRequests.requester_id, member.id),
          ne(schema.spareRequests.filled_by_member_id, member.id),
          // Also exclude private requests where the user was invited
          sql`NOT EXISTS (
            SELECT 1
            FROM ${schema.spareRequestInvitations}
            WHERE ${schema.spareRequestInvitations.spare_request_id} = ${schema.spareRequests.id}
              AND ${schema.spareRequestInvitations.member_id} = ${member.id}
          )`
        )
      )
      .orderBy(asc(schema.spareRequests.game_date), asc(schema.spareRequests.game_time));
    
    // Get filled_by names separately
    const filledByIds = requestsRaw
      .map((r: any) => r.filled_by_member_id)
      .filter((id: any): id is number => id !== null);
    
    const filledByMembers = filledByIds.length > 0
      ? await db
          .select({ id: schema.members.id, name: schema.members.name })
          .from(schema.members)
          .where(inArray(schema.members.id, filledByIds))
      : [];
    
    const filledByNameMap = new Map(filledByMembers.map((m: any) => [m.id, m.name]));
    
    const requests = requestsRaw.map((req: any) => ({
      ...req,
      filled_by_name: req.filled_by_member_id ? filledByNameMap.get(req.filled_by_member_id) || null : null,
    }));

    return requests.map((req: any) => ({
      id: req.id,
      requesterName: req.requester_name,
      requestedForName: req.requested_for_name,
      gameDate: req.game_date,
      gameTime: req.game_time,
      leagueName: req.league_name || null,
      position: req.position,
      message: req.message,
      requestType: req.request_type,
      filledByName: req.filled_by_name,
      filledAt: req.filled_at,
      createdAt: req.created_at,
    }));
  });

  // Create spare request
  fastify.post('/spares', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if ((member as any).spare_only === 1) {
      return reply.code(403).send({ error: 'Spare-only members cannot request a spare' });
    }

    const body = createSpareRequestSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Validate league (used for display in UI/emails, and for public-request filtering).
    // Also prevents malformed/forged requests from referencing a non-existent league.
    const leagueRows = await db
      .select()
      .from(schema.leagues)
      .where(eq(schema.leagues.id, body.leagueId))
      .limit(1) as League[];
    const league = leagueRows[0];
    if (!league) {
      return reply.code(400).send({ error: 'Invalid league' });
    }
    const leagueName = league.name;

    // Create the spare request
    const result = await db
      .insert(schema.spareRequests)
      .values({
        requester_id: member.id,
        league_id: body.leagueId,
        requested_for_name: body.requestedForName,
        game_date: body.gameDate,
        game_time: body.gameTime,
        position: body.position || null,
        message: body.message || null,
        request_type: body.requestType,
        status: 'open',
        had_cancellation: 0,
        notification_paused: 0,
      })
      .returning();

    const requestId = result[0].id;

    // Best-effort analytics (do not block)
    logEvent({
      eventType: 'spare.request.created',
      memberId: member.id,
      relatedId: requestId,
      meta: { requestType: body.requestType, leagueId: body.leagueId },
    }).catch(() => {});

    // Store CCs (up to 4, members only, no self)
    const ccIds = Array.from(new Set((body.ccMemberIds || []).filter((id) => id !== member.id))).slice(0, 4);
    if (ccIds.length > 0) {
      const ccMembersExist = await db
        .select({ id: schema.members.id })
        .from(schema.members)
        .where(inArray(schema.members.id, ccIds));
      if (ccMembersExist.length !== ccIds.length) {
        return reply.code(400).send({ error: 'Invalid CC members' });
      }

      await db.insert(schema.spareRequestCcs).values(
        ccIds.map((ccId) => ({
          spare_request_id: requestId,
          member_id: ccId,
        }))
      );
    }

    // Send confirmation email to creator + CC recipients (separately, no email-level CC)
    try {
      if (member.email && (member as any).email_subscribed === 1) {
        const requesterToken = generateToken(member);
        sendSpareRequestCreatedEmail(
          member.email,
          member.name,
          {
            leagueName,
            requestedForName: body.requestedForName,
            gameDate: body.gameDate,
            gameTime: body.gameTime,
            position: body.position,
            message: body.message,
          },
          requesterToken
        ).catch((error) => {
          console.error('Error sending spare request created email:', error);
        });
      }

      if (ccIds.length > 0) {
        const ccMembers = await db
          .select()
          .from(schema.members)
          .where(inArray(schema.members.id, ccIds)) as Member[];

        for (const ccMember of ccMembers) {
          if (!ccMember.email || ccMember.email_subscribed !== 1) continue;
          const ccToken = generateToken(ccMember);
          sendSpareRequestCcCreatedEmail(
            ccMember.email,
            ccMember.name,
            member.name,
            {
              leagueName,
              requestedForName: body.requestedForName,
              gameDate: body.gameDate,
              gameTime: body.gameTime,
              position: body.position,
              message: body.message,
            },
            ccToken
          ).catch((error) => {
            console.error('Error sending spare request CC created email:', error);
          });
        }
      }
    } catch (error) {
      console.error('Error scheduling spare request confirmation/CC emails:', error);
    }

    // Determine who to notify
    let recipientMembers: Member[] = [];

    if (body.requestType === 'private' && body.invitedMemberIds) {
      // Private requests: send immediately to all invited members
      if (body.invitedMemberIds.length > 0) {
        await db.insert(schema.spareRequestInvitations).values(
          body.invitedMemberIds.map(memberId => ({
            spare_request_id: requestId,
            member_id: memberId,
          }))
        );
      }

      // Get invited members
      recipientMembers = await db
        .select()
        .from(schema.members)
        .where(
          and(
            inArray(schema.members.id, body.invitedMemberIds),
            eq(schema.members.email_subscribed, 1)
          )
        ) as Member[];

      // Get list of all invited member names for the email
      const invitedMemberNames = recipientMembers.map(m => m.name).sort();

      // Send notifications asynchronously (fire-and-forget) to avoid blocking the response
      for (const recipient of recipientMembers) {
        if (recipient.email) {
          const acceptToken = generateEmailLinkToken(recipient);
          
          // Don't await - send in background
          sendSpareRequestEmail(
            recipient.email,
            recipient.name,
            member.name,
            {
              leagueName,
              requestedForName: body.requestedForName,
              gameDate: body.gameDate,
              gameTime: body.gameTime,
              position: body.position,
              message: body.message,
              invitedMemberNames: invitedMemberNames,
            },
            acceptToken,
            requestId
          ).catch((error) => {
            console.error('Error sending spare request email:', error);
          });
        }

        if (recipient.phone && recipient.opted_in_sms === 1) {
          // Don't await - send in background
          sendSpareRequestSMS(
            recipient.phone,
            member.name,
            body.gameDate,
            body.gameTime
          ).catch((error) => {
            console.error('Error sending spare request SMS:', error);
          });
        }
      }

      // Update notifications_sent_at timestamp and set notification_status
      if (recipientMembers.length > 0) {
        await db
          .update(schema.spareRequests)
          .set({
            notifications_sent_at: await getCurrentTimeAsync(),
            notification_status: 'completed',
          })
          .where(eq(schema.spareRequests.id, requestId));
      }

      return {
        id: requestId,
        success: true,
        notificationsSent: recipientMembers.length,
      };
    } else {
      // Public requests: check if less than 24 hours before game time
      // Parse date/time as local to avoid timezone issues
      const [gameYear, gameMonth, gameDay] = body.gameDate.split('-').map(Number);
      const [gameHours, gameMinutes] = body.gameTime.split(':').map(Number);
      const gameDateTime = new Date(gameYear, gameMonth - 1, gameDay, gameHours, gameMinutes);
      const currentTime = await getCurrentTimeAsync();
      const hoursUntilGame = (gameDateTime.getTime() - currentTime.getTime()) / (1000 * 60 * 60);
      const isLessThan24Hours = hoursUntilGame < 24;

      // Find matching available members for public requests
      // Match based on the selected leagueId (previously inferred by day-of-week, which was too broad)
      // Parse date string as local date to avoid timezone issues
      const gameDateObj = new Date(gameYear, gameMonth - 1, gameDay); // month is 0-indexed
      const dayOfWeek = gameDateObj.getDay();

      // Validate league exists + matches this date/day
      if (league.day_of_week !== dayOfWeek) {
        return reply.code(400).send({ error: 'Selected league does not run on that day' });
      }
      // Active range check
      const inRangeRows = await db
        .select({ ok: sql<number>`1` })
        .from(schema.leagues)
        .where(
          and(
            eq(schema.leagues.id, body.leagueId),
            sql`date(${schema.leagues.start_date}) <= date(${body.gameDate})`,
            sql`date(${schema.leagues.end_date}) >= date(${body.gameDate})`
          )
        )
        .limit(1);
      if (inRangeRows.length === 0) {
        return reply.code(400).send({ error: 'Selected league is not active on that date' });
      }
      // Exception date check
      const exceptionRows = await db
        .select({ id: schema.leagueExceptions.id })
        .from(schema.leagueExceptions)
        .where(and(eq(schema.leagueExceptions.league_id, body.leagueId), eq(schema.leagueExceptions.exception_date, body.gameDate)))
        .limit(1);
      if (exceptionRows.length > 0) {
        return reply.code(400).send({ error: 'Selected league does not run on that date' });
      }

      // Get members who are available for this league
      const conditions = [
        eq(schema.memberAvailability.league_id, body.leagueId),
        eq(schema.memberAvailability.available, 1),
        eq(schema.members.email_subscribed, 1),
        ne(schema.members.id, member.id),
      ];
      // If position is skip, only notify those who can skip
      if (body.position === 'skip') {
        conditions.push(eq(schema.memberAvailability.can_skip, 1));
      }

      recipientMembers = await db
        .selectDistinct({
          id: schema.members.id,
          name: schema.members.name,
          email: schema.members.email,
          phone: schema.members.phone,
          is_admin: schema.members.is_admin,
          opted_in_sms: schema.members.opted_in_sms,
          email_subscribed: schema.members.email_subscribed,
          first_login_completed: schema.members.first_login_completed,
          email_visible: schema.members.email_visible,
          phone_visible: schema.members.phone_visible,
          created_at: schema.members.created_at,
          updated_at: schema.members.updated_at,
        })
        .from(schema.members)
        .innerJoin(
          schema.memberAvailability,
          eq(schema.members.id, schema.memberAvailability.member_id)
        )
        .where(and(...conditions)) as Member[];
      console.log(`[Spare Request] Found ${recipientMembers.length} matching members for league ${body.leagueId}`);

      if (isLessThan24Hours) {
        // Less than 24 hours: send notifications immediately to all matching members
        for (const recipient of recipientMembers) {
          if (recipient.email) {
            const acceptToken = generateEmailLinkToken(recipient);
            
            try {
              await sendSpareRequestEmail(
                recipient.email,
                recipient.name,
                member.name,
                {
                  leagueName,
                  requestedForName: body.requestedForName,
                  gameDate: body.gameDate,
                  gameTime: body.gameTime,
                  position: body.position,
                  message: body.message,
                },
                acceptToken,
                requestId
              );
            } catch (error) {
              console.error('Error sending spare request email:', error);
            }
          }

          if (recipient.phone && recipient.opted_in_sms === 1) {
            try {
              await sendSpareRequestSMS(
                recipient.phone,
                member.name,
                body.gameDate,
                body.gameTime
              );
            } catch (error) {
              console.error('Error sending spare request SMS:', error);
            }
          }
        }

        // Update notifications_sent_at timestamp
        if (recipientMembers.length > 0) {
          await db
            .update(schema.spareRequests)
            .set({
              notifications_sent_at: await getCurrentTimeAsync(),
              notification_status: 'completed',
            })
            .where(eq(schema.spareRequests.id, requestId));
        }

        return {
          id: requestId,
          success: true,
          notificationsSent: recipientMembers.length,
        };
      } else {
        // More than 24 hours: set up staggered notification queue
        if (recipientMembers.length === 0) {
          // No matching members found - mark as completed with 0 notifications
          await db
            .update(schema.spareRequests)
            .set({
              notification_status: 'completed',
              next_notification_at: null,
            })
            .where(eq(schema.spareRequests.id, requestId));

          return {
            id: requestId,
            success: true,
            notificationsQueued: 0,
            notificationStatus: 'completed',
            message: 'No matching members found for this request',
          };
        }

        // Shuffle the list randomly
        const shuffled = [...recipientMembers].sort(() => Math.random() - 0.5);

        // Create notification queue entries
        if (shuffled.length > 0) {
          await db.insert(schema.spareRequestNotificationQueue).values(
            shuffled.map((recipient, index) => ({
              spare_request_id: requestId,
              member_id: recipient.id,
              queue_order: index,
            }))
          );
        }

        console.log(`[Spare Request] Created notification queue with ${shuffled.length} members for request ${requestId}`);

        // Mark notification status as 'in_progress' and set next_notification_at to now
        // Clear paused flag when starting notifications
        // This will trigger the notification processor to send the first notification immediately
        // After the first notification, it will wait for the configured delay before sending the next one
        await db
          .update(schema.spareRequests)
          .set({
            notification_status: 'in_progress',
            next_notification_at: await getCurrentTimeAsync(),
            notification_paused: 0,
          })
          .where(eq(schema.spareRequests.id, requestId));

        return {
          id: requestId,
          success: true,
          notificationsQueued: shuffled.length,
          notificationStatus: 'in_progress',
        };
      }
    }
  });

  // Respond to spare request
  fastify.post('/spares/:id/respond', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const requestId = parseInt(id, 10);
    const body = respondToSpareRequestSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Get the spare request
    const spareRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(eq(schema.spareRequests.id, requestId))
      .limit(1);
    
    const spareRequest = spareRequests[0] as SpareRequest | undefined;

    if (!spareRequest) {
      return reply.code(404).send({ error: 'Spare request not found' });
    }

    if (spareRequest.status !== 'open') {
      return reply.code(400).send({ error: 'This spare request is no longer open' });
    }

    // Check if user has already responded to this request
    const existingResponses = await db
      .select()
      .from(schema.spareResponses)
      .where(
        and(
          eq(schema.spareResponses.spare_request_id, requestId),
          eq(schema.spareResponses.member_id, member.id)
        )
      )
      .limit(1);

    if (existingResponses.length > 0) {
      return reply.code(400).send({ error: 'You are already signed up for this spare request.' });
    }

    // Create response
    await db.insert(schema.spareResponses).values({
      spare_request_id: requestId,
      member_id: member.id,
      comment: body.comment || null,
    });

    // Mark request as filled, clear cancellation flag, and stop notifications
    await db
      .update(schema.spareRequests)
      .set({
        status: 'filled',
        filled_by_member_id: member.id,
        filled_at: await getCurrentTimeAsync(),
        had_cancellation: 0,
        notification_status: 'stopped',
        next_notification_at: null,
      })
      .where(eq(schema.spareRequests.id, requestId));

    // Best-effort analytics (do not block)
    logEvent({ eventType: 'spare.request.filled', memberId: member.id, relatedId: requestId }).catch(() => {});

    // Get requester info
    const requesters = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, spareRequest.requester_id))
      .limit(1);
    
    const requester = requesters[0] as Member;

    // Get CC recipients for this request
    const ccMembers = await getCcMembersForRequest(requestId);

    // Send notifications asynchronously (fire-and-forget) to avoid blocking the response
    // The user experience is more important than waiting for external API calls
    if (requester.email && requester.email_subscribed === 1) {
      const requesterToken = generateToken(requester);
      
      // Don't await - send in background
      sendSpareResponseEmail(
        requester.email,
        requester.name,
        member.name,
        {
          requestedForName: spareRequest.requested_for_name,
          gameDate: spareRequest.game_date,
          gameTime: spareRequest.game_time,
          position: spareRequest.position || undefined,
        },
        body.comment,
        requesterToken
      ).catch((error) => {
        console.error('Error sending spare response email:', error);
      });
    }

    // Confirmation email to the responder (the member who signed up to spare)
    if (member.email && member.email_subscribed === 1) {
      const responderToken = generateToken(member);
      sendSpareOfferConfirmationEmail(
        member.email,
        member.name,
        requester.name,
        {
          requestedForName: spareRequest.requested_for_name,
          gameDate: spareRequest.game_date,
          gameTime: spareRequest.game_time,
          position: spareRequest.position || undefined,
        },
        body.comment,
        responderToken
      ).catch((error) => {
        console.error('Error sending spare offer confirmation email:', error);
      });
    }

    for (const ccMember of ccMembers) {
      if (!ccMember.email || (ccMember as any).email_subscribed !== 1) continue;
      const ccToken = generateToken(ccMember);
      sendSpareRequestCcFilledEmail(
        ccMember.email,
        ccMember.name,
        requester.name,
        member.name,
        {
          requestedForName: spareRequest.requested_for_name,
          gameDate: spareRequest.game_date,
          gameTime: spareRequest.game_time,
          position: spareRequest.position || undefined,
        },
        body.comment,
        ccToken
      ).catch((error) => {
        console.error('Error sending spare request CC filled email:', error);
      });
    }

    if (requester.phone && requester.opted_in_sms === 1) {
      // Don't await - send in background
      sendSpareFilledSMS(
        requester.phone,
        member.name,
        spareRequest.game_date,
        spareRequest.game_time
      ).catch((error) => {
        console.error('Error sending spare filled SMS:', error);
      });
    }

    return { success: true };
  });

  // Cancel spare request
  fastify.post('/spares/:id/cancel', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const requestId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    const spareRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(eq(schema.spareRequests.id, requestId))
      .limit(1);
    
    const spareRequest = spareRequests[0] as SpareRequest | undefined;

    if (!spareRequest) {
      return reply.code(404).send({ error: 'Spare request not found' });
    }

    if (spareRequest.requester_id !== member.id) {
      return reply.code(403).send({ error: 'You can only cancel your own requests' });
    }

    await db
      .update(schema.spareRequests)
      .set({ status: 'cancelled' })
      .where(eq(schema.spareRequests.id, requestId));

    // Best-effort analytics (do not block)
    logEvent({ eventType: 'spare.request.cancelled', memberId: member.id, relatedId: requestId }).catch(() => {});

    return { success: true };
  });

  // Cancel sparing (cancel a spare response)
  fastify.post('/spares/:id/cancel-sparing', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const requestId = parseInt(id, 10);
    const body = cancelSparingSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Get the spare request
    const spareRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(eq(schema.spareRequests.id, requestId))
      .limit(1);
    
    const spareRequest = spareRequests[0] as SpareRequest | undefined;

    if (!spareRequest) {
      return reply.code(404).send({ error: 'Spare request not found' });
    }

    // Verify the member is the one who filled this request
    if (spareRequest.filled_by_member_id !== member.id) {
      return reply.code(403).send({ error: 'You can only cancel sparing that you committed to' });
    }

    if (spareRequest.status !== 'filled') {
      return reply.code(400).send({ error: 'This spare request is not currently filled' });
    }

    // Delete the response to allow re-responses
    await db
      .delete(schema.spareResponses)
      .where(
        and(
          eq(schema.spareResponses.spare_request_id, requestId),
          eq(schema.spareResponses.member_id, member.id)
        )
      );
    
    // Mark request as open again and set a flag to track that there was a cancellation
    await db
      .update(schema.spareRequests)
      .set({
        status: 'open',
        filled_by_member_id: null,
        filled_at: null,
        had_cancellation: 1,
      })
      .where(eq(schema.spareRequests.id, requestId));

    // Best-effort analytics (do not block)
    logEvent({ eventType: 'spare.offer.cancelled', memberId: member.id, relatedId: requestId }).catch(() => {});

    // Get requester info
    const requesters = await db
      .select()
      .from(schema.members)
      .where(eq(schema.members.id, spareRequest.requester_id))
      .limit(1);
    
    const requester = requesters[0] as Member;

    // Get CC recipients for this request
    const ccMembers = await getCcMembersForRequest(requestId);

    // Send notifications asynchronously (fire-and-forget) to avoid blocking the response
    if (requester.email && requester.email_subscribed === 1) {
      const requesterToken = generateToken(requester);
      
      // Don't await - send in background
      sendSpareCancellationEmail(
        requester.email,
        requester.name,
        member.name,
        {
          requestedForName: spareRequest.requested_for_name,
          gameDate: spareRequest.game_date,
          gameTime: spareRequest.game_time,
          position: spareRequest.position || undefined,
        },
        body.comment,
        requesterToken
      ).catch((error) => {
        console.error('Error sending spare cancellation email:', error);
      });
    }

    // Confirmation email to the responder (the member who cancelled sparing)
    if (member.email && member.email_subscribed === 1) {
      const responderToken = generateToken(member);
      sendSpareOfferCancellationConfirmationEmail(
        member.email,
        member.name,
        requester.name,
        {
          requestedForName: spareRequest.requested_for_name,
          gameDate: spareRequest.game_date,
          gameTime: spareRequest.game_time,
          position: spareRequest.position || undefined,
        },
        body.comment,
        responderToken
      ).catch((error) => {
        console.error('Error sending spare offer cancellation confirmation email:', error);
      });
    }

    for (const ccMember of ccMembers) {
      if (!ccMember.email || (ccMember as any).email_subscribed !== 1) continue;
      const ccToken = generateToken(ccMember);
      sendSpareRequestCcCancellationEmail(
        ccMember.email,
        ccMember.name,
        requester.name,
        member.name,
        {
          requestedForName: spareRequest.requested_for_name,
          gameDate: spareRequest.game_date,
          gameTime: spareRequest.game_time,
          position: spareRequest.position || undefined,
        },
        body.comment,
        ccToken
      ).catch((error) => {
        console.error('Error sending spare request CC cancellation email:', error);
      });
    }

    if (requester.phone && requester.opted_in_sms === 1) {
      // Don't await - send in background
      sendSpareCancellationSMS(
        requester.phone,
        member.name,
        spareRequest.game_date,
        spareRequest.game_time
      ).catch((error) => {
        console.error('Error sending spare cancellation SMS:', error);
      });
    }

    return { success: true };
  });

  // Re-issue spare request (re-send notifications)
  fastify.post('/spares/:id/reissue', async (request, reply) => {
    console.log(`[Re-issue] ===== RE-ISSUE ENDPOINT CALLED =====`);
    const member = (request as any).member as Member;
    if (!member) {
      console.log(`[Re-issue] Unauthorized - no member`);
      return reply.code(401).send({ error: 'Unauthorized' });
    }
    if ((member as any).spare_only === 1) {
      return reply.code(403).send({ error: 'Spare-only members cannot request a spare' });
    }

    const { id } = request.params as { id: string };
    const requestId = parseInt(id, 10);
    console.log(`[Re-issue] Processing re-issue for request ${requestId} by member ${member.name} (${member.email})`);
    const body = reissueSpareRequestSchema.parse(request.body);
    const { db, schema } = getDrizzleDb();

    // Get the spare request
    const spareRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(eq(schema.spareRequests.id, requestId))
      .limit(1);
    
    const spareRequest = spareRequests[0] as SpareRequest | undefined;

    if (!spareRequest) {
      return reply.code(404).send({ error: 'Spare request not found' });
    }

    // Verify the member owns this request
    if (spareRequest.requester_id !== member.id) {
      return reply.code(403).send({ error: 'You can only re-issue your own requests' });
    }

    if (spareRequest.status !== 'open') {
      return reply.code(400).send({ error: 'You can only re-issue open requests' });
    }

    // Update message if provided
    if (body.message !== undefined) {
      await db
        .update(schema.spareRequests)
        .set({ message: body.message || null })
        .where(eq(schema.spareRequests.id, requestId));
      // Reload spare request to get updated message
      const updatedRequests = await db
        .select()
        .from(schema.spareRequests)
        .where(eq(schema.spareRequests.id, requestId))
        .limit(1);
      if (updatedRequests[0]) {
        spareRequest.message = updatedRequests[0].message;
      }
    }

    // Clear existing notification queue
    await db
      .delete(schema.spareRequestNotificationQueue)
      .where(eq(schema.spareRequestNotificationQueue.spare_request_id, requestId));

    // Determine who to notify (same logic as creating a request)
    let recipientMembers: Member[] = [];
    
    console.log(`[Re-issue] Starting re-issue for request ${requestId}, type: ${spareRequest.request_type}`);

    if (spareRequest.request_type === 'private') {
      // Private requests: send immediately to all invited members
      const invitations = await db
        .select({ member_id: schema.spareRequestInvitations.member_id })
        .from(schema.spareRequestInvitations)
        .where(eq(schema.spareRequestInvitations.spare_request_id, requestId));
      
      const invitedIds = invitations.map((inv: any) => inv.member_id);
      
      if (invitedIds.length > 0) {
        recipientMembers = await db
          .select()
          .from(schema.members)
          .where(
            and(
              inArray(schema.members.id, invitedIds),
              eq(schema.members.email_subscribed, 1)
            )
          ) as Member[];
      }

      // Get list of all invited member names for the email
      const invitedMemberNames = recipientMembers.map(m => m.name).sort();
      
      console.log(`[Re-issue] Private request: Found ${recipientMembers.length} recipient members with email_subscribed=1`);

      // Send notifications asynchronously (fire-and-forget) to avoid blocking the response
      for (const recipient of recipientMembers) {
        if (recipient.email) {
          const acceptToken = generateEmailLinkToken(recipient);
          
          console.log(`[Re-issue] Calling sendSpareRequestEmail for ${recipient.email} (request ${requestId})`);
          // Don't await - send in background
          sendSpareRequestEmail(
            recipient.email,
            recipient.name,
            member.name,
            {
              requestedForName: spareRequest.requested_for_name,
              gameDate: spareRequest.game_date,
              gameTime: spareRequest.game_time,
              position: spareRequest.position || undefined,
              message: body.message !== undefined ? body.message : (spareRequest.message || undefined),
              invitedMemberNames: invitedMemberNames,
            },
            acceptToken,
            requestId
          ).then(() => {
            console.log(`[Re-issue] Email function completed for ${recipient.email}`);
          }).catch((error) => {
            console.error(`[Re-issue] Error sending spare request email to ${recipient.email}:`, error);
          });
        }

        if (recipient.phone && recipient.opted_in_sms === 1) {
          // Don't await - send in background
          sendSpareRequestSMS(
            recipient.phone,
            member.name,
            spareRequest.game_date,
            spareRequest.game_time
          ).catch((error) => {
            console.error('Error sending spare request SMS:', error);
          });
        }
      }

      // Update notifications_sent_at timestamp and clear cancellation flag
      if (recipientMembers.length > 0) {
        await db
          .update(schema.spareRequests)
          .set({
            notifications_sent_at: await getCurrentTimeAsync(),
            had_cancellation: 0,
            notification_status: 'completed',
          })
          .where(eq(schema.spareRequests.id, requestId));
      }

      return {
        success: true,
        notificationsSent: recipientMembers.length,
      };
    } else {
      // Public requests: check if less than 24 hours before game time
      // Parse date/time as local to avoid timezone issues
      const [reissueYear, reissueMonth, reissueDay] = spareRequest.game_date.split('-').map(Number);
      const [reissueHours, reissueMinutes] = spareRequest.game_time.split(':').map(Number);
      const gameDateTime = new Date(reissueYear, reissueMonth - 1, reissueDay, reissueHours, reissueMinutes);
      const currentTime = await getCurrentTimeAsync();
      const hoursUntilGame = (gameDateTime.getTime() - currentTime.getTime()) / (1000 * 60 * 60);
      const isLessThan24Hours = hoursUntilGame < 24;

      // Find matching available members for public requests
      // Parse date string as local date to avoid timezone issues
      const gameDateObj = new Date(reissueYear, reissueMonth - 1, reissueDay); // month is 0-indexed
      const dayOfWeek = gameDateObj.getDay();

      // Find leagues that match this day and are active on this date
      const matchingLeagues = await db
        .select()
        .from(schema.leagues)
        .where(
          and(
            eq(schema.leagues.day_of_week, dayOfWeek),
            sql`date(${schema.leagues.start_date}) <= date(${spareRequest.game_date})`,
            sql`date(${schema.leagues.end_date}) >= date(${spareRequest.game_date})`
          )
        ) as League[];

      if (matchingLeagues.length > 0) {
        const leagueIds = matchingLeagues.map((l) => l.id);
        
        // Get members who are available for these leagues
        let conditions = [
          inArray(schema.memberAvailability.league_id, leagueIds),
          eq(schema.memberAvailability.available, 1),
          eq(schema.members.email_subscribed, 1),
          ne(schema.members.id, member.id),
        ];
        
        // If position is skip, only notify those who can skip
        if (spareRequest.position === 'skip') {
          conditions.push(eq(schema.memberAvailability.can_skip, 1));
        }

        recipientMembers = await db
          .selectDistinct({
            id: schema.members.id,
            name: schema.members.name,
            email: schema.members.email,
            phone: schema.members.phone,
            is_admin: schema.members.is_admin,
            opted_in_sms: schema.members.opted_in_sms,
            email_subscribed: schema.members.email_subscribed,
            first_login_completed: schema.members.first_login_completed,
            email_visible: schema.members.email_visible,
            phone_visible: schema.members.phone_visible,
            created_at: schema.members.created_at,
            updated_at: schema.members.updated_at,
          })
          .from(schema.members)
          .innerJoin(
            schema.memberAvailability,
            eq(schema.members.id, schema.memberAvailability.member_id)
          )
          .where(and(...conditions)) as Member[];
      }
      
      console.log(`[Re-issue] Public request: Found ${recipientMembers.length} recipient members, isLessThan24Hours: ${isLessThan24Hours}`);

      if (isLessThan24Hours) {
        // Less than 24 hours: send notifications asynchronously (fire-and-forget) to avoid blocking
        console.log(`[Re-issue] Sending immediate notifications (<24h path)`);
        for (const recipient of recipientMembers) {
          if (recipient.email) {
            const acceptToken = generateEmailLinkToken(recipient);
            
            console.log(`[Re-issue] Calling sendSpareRequestEmail for ${recipient.email} (request ${requestId})`);
            // Don't await - send in background
            sendSpareRequestEmail(
              recipient.email,
              recipient.name,
              member.name,
              {
                requestedForName: spareRequest.requested_for_name,
                gameDate: spareRequest.game_date,
                gameTime: spareRequest.game_time,
                position: spareRequest.position || undefined,
                message: body.message !== undefined ? body.message : (spareRequest.message || undefined),
              },
              acceptToken,
              requestId
            ).then(() => {
              console.log(`[Re-issue] Email function completed for ${recipient.email}`);
            }).catch((error) => {
              console.error(`[Re-issue] Error sending spare request email to ${recipient.email}:`, error);
            });
          }

          if (recipient.phone && recipient.opted_in_sms === 1) {
            // Don't await - send in background
            sendSpareRequestSMS(
              recipient.phone,
              member.name,
              spareRequest.game_date,
              spareRequest.game_time
            ).catch((error) => {
              console.error('Error sending spare request SMS:', error);
            });
          }
        }

        // Update notifications_sent_at timestamp and clear cancellation flag
        if (recipientMembers.length > 0) {
          await db
            .update(schema.spareRequests)
            .set({
              notifications_sent_at: await getCurrentTimeAsync(),
              had_cancellation: 0,
              notification_status: 'completed',
            })
            .where(eq(schema.spareRequests.id, requestId));
        } else {
          // Even if no members, mark as completed
          await db
            .update(schema.spareRequests)
            .set({ notification_status: 'completed' })
            .where(eq(schema.spareRequests.id, requestId));
        }

        console.log(`[Re-issue] Completed immediate notifications for ${recipientMembers.length} members`);
        console.log(`[Re-issue] Completed immediate notifications for ${recipientMembers.length} members`);
        return {
          success: true,
          notificationsSent: recipientMembers.length,
        };
      } else {
        // More than 24 hours: set up staggered notification queue
        console.log(`[Re-issue] Setting up staggered notification queue (>=24h path) for ${recipientMembers.length} members`);
        // Shuffle the list randomly
        const shuffled = [...recipientMembers].sort(() => Math.random() - 0.5);

        // Create notification queue entries
        if (shuffled.length > 0) {
          await db.insert(schema.spareRequestNotificationQueue).values(
            shuffled.map((recipient, index) => ({
              spare_request_id: requestId,
              member_id: recipient.id,
              queue_order: index,
            }))
          );
        }

        // Mark notification status as 'in_progress' and set next_notification_at to now
        // Clear paused flag when starting notifications
        // This will trigger the notification processor to send the first notification immediately
        // After the first notification, it will wait for the configured delay before sending the next one
        const currentTime = await getCurrentTimeAsync();
        await db
          .update(schema.spareRequests)
          .set({
            notifications_sent_at: currentTime,
            had_cancellation: 0,
            notification_status: 'in_progress',
            next_notification_at: currentTime,
            notification_paused: 0,
          })
          .where(eq(schema.spareRequests.id, requestId));

        return {
          success: true,
          notificationsQueued: shuffled.length,
          notificationStatus: 'in_progress',
        };
      }
    }
  });

  // Get notification status for a spare request
  fastify.get('/spares/:id/notification-status', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const requestId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    // Verify the request belongs to the member
    const spareRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(
        and(
          eq(schema.spareRequests.id, requestId),
          eq(schema.spareRequests.requester_id, member.id)
        )
      )
      .limit(1);
    
    const spareRequest = spareRequests[0] as any;

    if (!spareRequest) {
      return reply.code(404).send({ error: 'Spare request not found' });
    }

    // Get notification status
    const totalInQueueResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.spareRequestNotificationQueue)
      .where(eq(schema.spareRequestNotificationQueue.spare_request_id, requestId));
    
    const totalInQueue = { count: Number(totalInQueueResult[0]?.count || 0) };

    const notifiedCountResult = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(schema.spareRequestNotificationQueue)
      .where(
        and(
          eq(schema.spareRequestNotificationQueue.spare_request_id, requestId),
          isNotNull(schema.spareRequestNotificationQueue.notified_at)
        )
      );
    
    const notifiedCount = { count: Number(notifiedCountResult[0]?.count || 0) };

    // If notification_status is 'completed' but there's no queue, it means notifications were sent immediately
    // In this case, we need to estimate how many members were notified based on matching availability
    let totalMembers = totalInQueue.count;
    let notifiedMembers = notifiedCount.count;
    
    if (spareRequest.notification_status === 'completed' && totalInQueue.count === 0) {
      if (spareRequest.request_type === 'private') {
        // For private requests, count the invited members
        const invitationsResult = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(schema.spareRequestInvitations)
          .where(eq(schema.spareRequestInvitations.spare_request_id, requestId));
        
        const invitations = { count: Number(invitationsResult[0]?.count || 0) };
        
        if (invitations.count > 0) {
          totalMembers = invitations.count;
          notifiedMembers = invitations.count; // All invited members were notified immediately
        }
      } else if (spareRequest.request_type === 'public') {
        // For immediate notifications, estimate based on matching members
        // This is an approximation - we can't know the exact count without storing it
        // But we can check how many members would have matched
        const [year, month, day] = spareRequest.game_date.split('-').map(Number);
        const gameDateObj = new Date(year, month - 1, day);
        const dayOfWeek = gameDateObj.getDay();

        const matchingLeagues = await db
          .select()
          .from(schema.leagues)
          .where(
            and(
              eq(schema.leagues.day_of_week, dayOfWeek),
              sql`date(${schema.leagues.start_date}) <= date(${spareRequest.game_date})`,
              sql`date(${schema.leagues.end_date}) >= date(${spareRequest.game_date})`
            )
          ) as League[];

        if (matchingLeagues.length > 0) {
          const leagueIds = matchingLeagues.map((l) => l.id);
          
          let conditions = [
            inArray(schema.memberAvailability.league_id, leagueIds),
            eq(schema.memberAvailability.available, 1),
            eq(schema.members.email_subscribed, 1),
            ne(schema.members.id, spareRequest.requester_id),
          ];
          
          if (spareRequest.position === 'skip') {
            conditions.push(eq(schema.memberAvailability.can_skip, 1));
          }

          const matchingCountResult = await db
            .select({ count: sql<number>`COUNT(DISTINCT ${schema.members.id})` })
            .from(schema.members)
            .innerJoin(
              schema.memberAvailability,
              eq(schema.members.id, schema.memberAvailability.member_id)
            )
            .where(and(...conditions));
          
          const matchingCount = { count: Number(matchingCountResult[0]?.count || 0) };
          if (matchingCount.count > 0) {
            totalMembers = matchingCount.count;
            notifiedMembers = matchingCount.count; // All were notified immediately
          }
        }
      }
    }

    return {
      notificationStatus: spareRequest.notification_status || null,
      totalMembers: totalMembers,
      notifiedMembers: notifiedMembers,
      nextNotificationAt: spareRequest.next_notification_at || null,
      notificationPaused: spareRequest.notification_paused === 1,
    };
  });

  // Pause notifications for a spare request
  fastify.post('/spares/:id/pause-notifications', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const requestId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    // Verify the request belongs to the member
    const spareRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(
        and(
          eq(schema.spareRequests.id, requestId),
          eq(schema.spareRequests.requester_id, member.id)
        )
      )
      .limit(1);
    
    const spareRequest = spareRequests[0] as any;

    if (!spareRequest) {
      return reply.code(404).send({ error: 'Spare request not found' });
    }

    if (spareRequest.status !== 'open') {
      return reply.code(400).send({ error: 'Can only pause notifications for open requests' });
    }

    if (spareRequest.notification_status !== 'in_progress') {
      return reply.code(400).send({ error: 'Notifications are not in progress' });
    }

    // Pause notifications
    await db
      .update(schema.spareRequests)
      .set({ notification_paused: 1 })
      .where(eq(schema.spareRequests.id, requestId));

    return { success: true };
  });

  // Unpause notifications for a spare request
  fastify.post('/spares/:id/unpause-notifications', async (request, reply) => {
    const member = (request as any).member as Member;
    if (!member) {
      return reply.code(401).send({ error: 'Unauthorized' });
    }

    const { id } = request.params as { id: string };
    const requestId = parseInt(id, 10);
    const { db, schema } = getDrizzleDb();

    // Verify the request belongs to the member
    const spareRequests = await db
      .select()
      .from(schema.spareRequests)
      .where(
        and(
          eq(schema.spareRequests.id, requestId),
          eq(schema.spareRequests.requester_id, member.id)
        )
      )
      .limit(1);
    
    const spareRequest = spareRequests[0] as any;

    if (!spareRequest) {
      return reply.code(404).send({ error: 'Spare request not found' });
    }

    if (spareRequest.status !== 'open') {
      return reply.code(400).send({ error: 'Can only unpause notifications for open requests' });
    }

    if (spareRequest.notification_status !== 'in_progress') {
      return reply.code(400).send({ error: 'Notifications are not in progress' });
    }

    // Unpause notifications - set next_notification_at to now so it processes immediately
    await db
      .update(schema.spareRequests)
      .set({
        notification_paused: 0,
        next_notification_at: await getCurrentTimeAsync(),
      })
      .where(eq(schema.spareRequests.id, requestId));

    return { success: true };
  });
}

