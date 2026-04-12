import type { FastifyInstance } from 'fastify';
import { publicAuthRoutes, protectedAuthRoutes } from './routes/auth.js';
import { memberRoutes } from './routes/members.js';
import { leagueRoutes } from './routes/leagues.js';
import { leagueSetupRoutes } from './routes/leagueSetup.js';
import { gameRoutes } from './routes/games.js';
import { resultsRoutes } from './routes/results.js';
import { schedulingRoutes } from './routes/scheduling.js';
import { availabilityRoutes } from './routes/availability.js';
import { spareRoutes } from './routes/spares.js';
import { configRoutes } from './routes/config.js';
import { calendarRoutes } from './routes/calendar.js';
import { iceBookingRoutes } from './routes/iceBookings.js';
import { installRoutes } from './routes/install.js';
import { publicFeedbackRoutes, protectedFeedbackRoutes } from './routes/feedback.js';
import { publicConfigRoutes } from './routes/publicConfig.js';
import { publicRoutes } from './routes/public.js';
import { contactRoutes } from './routes/contact.js';
import { donationRoutes } from './routes/donations.js';
import { paymentWebhookRoutes } from './routes/paymentWebhooks.js';
import { paymentRoutes } from './routes/payments.js';
import { contentRoutes } from './routes/content.js';
import { permalinkAdminRoutes } from './routes/permalinksAdmin.js';
import { fileRoutes } from './routes/files.js';
import { sponsorshipRoutes } from './routes/sponsorship.js';
import { governanceRoutes } from './routes/governance.js';
import { rbacRoutes } from './routes/rbac.js';
import { publicEventRoutes, protectedEventRoutes } from './routes/events.js';

export async function registerPublicApiRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(installRoutes, { prefix: '/api' });
  await fastify.register(publicAuthRoutes, { prefix: '/api' });
  await fastify.register(publicFeedbackRoutes, { prefix: '/api' });
  await fastify.register(publicRoutes, { prefix: '/api' });
  await fastify.register(contactRoutes, { prefix: '/api' });
  await fastify.register(donationRoutes, { prefix: '/api' });
  await fastify.register(publicEventRoutes, { prefix: '/api' });
  await fastify.register(paymentWebhookRoutes, { prefix: '/api' });
}

export async function registerProtectedApiRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(protectedAuthRoutes, { prefix: '/api' });
  await fastify.register(memberRoutes, { prefix: '/api' });
  await fastify.register(leagueRoutes, { prefix: '/api' });
  await fastify.register(leagueSetupRoutes, { prefix: '/api' });
  await fastify.register(gameRoutes, { prefix: '/api' });
  await fastify.register(resultsRoutes, { prefix: '/api' });
  await fastify.register(schedulingRoutes, { prefix: '/api' });
  await fastify.register(availabilityRoutes, { prefix: '/api' });
  await fastify.register(spareRoutes, { prefix: '/api' });
  await fastify.register(publicConfigRoutes, { prefix: '/api' });
  await fastify.register(configRoutes, { prefix: '/api' });
  await fastify.register(calendarRoutes, { prefix: '/api' });
  await fastify.register(iceBookingRoutes, { prefix: '/api' });
  await fastify.register(contentRoutes, { prefix: '/api' });
  await fastify.register(permalinkAdminRoutes, { prefix: '/api' });
  await fastify.register(fileRoutes, { prefix: '/api' });
  await fastify.register(sponsorshipRoutes, { prefix: '/api' });
  await fastify.register(governanceRoutes, { prefix: '/api' });
  await fastify.register(paymentRoutes, { prefix: '/api' });
  await fastify.register(rbacRoutes, { prefix: '/api' });
  await fastify.register(protectedEventRoutes, { prefix: '/api' });
  await fastify.register(protectedFeedbackRoutes, { prefix: '/api' });
}
