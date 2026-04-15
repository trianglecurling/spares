# Backend architecture

This backend is organized as a modular monolith. The goal is to keep one deployable service and one database for now while making domain boundaries explicit enough that cross-cutting features do not leak table-level knowledge into route handlers.

## Principles

- Keep Fastify route plugins as HTTP adapters, not orchestration layers.
- Prefer domain-first modules under `backend/src/domains/`.
- Let each domain own its own repositories, policies, and DTO shaping.
- Cross-domain reads should go through published query/application APIs, not direct table joins from another route or domain.
- Preserve existing external route shapes unless there is an intentional contract change.
- Use `backend/src/api/errors.ts` and `backend/src/api/types.ts` for the shared error envelope.

## Target folder shape

```text
backend/src/domains/
  calendar/
    application/
    queries/
    repositories/
    policies/
    contracts/
  events/
    application/
    queries/
    repositories/
    policies/
    contracts/
  membership/
    application/
    queries/
    repositories/
    policies/
    contracts/
  leagues/
    application/
    queries/
    repositories/
    policies/
    contracts/
  spares/
    application/
    queries/
    repositories/
    policies/
    contracts/
  content/
    application/
    queries/
    repositories/
    contracts/
  config/
    application/
    queries/
    repositories/
    policies/
    contracts/
  payments/
    application/
    queries/
    repositories/
    contracts/
  public/
    queries/
    contracts/
```

Not every folder needs to exist on day one. Create them as a domain earns them.

## Dependency rules

- `routes/*` may depend on domain `application/` and `queries/` modules.
- `application/` modules may coordinate repositories in the same domain and call published interfaces from other domains.
- `queries/` modules may compose published read APIs from other domains.
- `repositories/` may only access tables owned by their domain.
- `policies/` should centralize permissions and eligibility instead of duplicating route-level checks.
- Avoid importing another domain's repository or reaching directly into another domain's tables from a route.

## Initial domain ownership

### Calendar

- Direct calendar events
- Recurrence expansion
- Calendar feed aggregation
- Sheet occupancy and conflict-style queries

Initial files:

- `backend/src/routes/calendar.ts`
- `backend/src/services/calendarExpansion.ts`
- `backend/src/services/iceBookingsCalendar.ts`

### Events

- Event CRUD
- Event timespans and locations
- Registration, waitlist, special links
- Event pricing rules

Initial files:

- `backend/src/routes/events.ts`
- `backend/src/services/eventService.ts`

### Membership

- Auth-linked member context
- Eligibility and viewer tiers
- Shared permission inputs

Initial files:

- `backend/src/routes/auth.ts`
- `backend/src/routes/members.ts`
- `backend/src/utils/auth.ts`
- `backend/src/utils/rbac.ts`

### Leagues

- League setup
- Draw schedule projections
- Games, results, availability

Initial files:

- `backend/src/routes/leagues.ts`
- `backend/src/routes/leagueSetup.ts`
- `backend/src/routes/games.ts`
- `backend/src/routes/results.ts`
- `backend/src/routes/scheduling.ts`
- `backend/src/routes/availability.ts`

### Spares

- Spare requests
- Invitations
- Fill/cancel/reissue flows
- Notification progress and delivery state

Initial files:

- `backend/src/routes/spares.ts`
- `backend/src/services/notificationProcessor.ts`
- `backend/src/services/spareRequestDelivery.ts`

### Content and sponsorship

- Articles
- Menus
- Showcase content
- Sponsorships
- Public files and permalinks

Initial files:

- `backend/src/routes/content.ts`
- `backend/src/routes/sponsorship.ts`
- `backend/src/routes/files.ts`
- `backend/src/routes/permalinksAdmin.ts`

### Config and governance

- Public site config
- Server operational config
- Governance content
- Facilities and security policy inputs

Initial files:

- `backend/src/routes/config.ts`
- `backend/src/routes/publicConfig.ts`
- `backend/src/routes/governance.ts`
- `backend/src/routes/rbac.ts`

### Payments

- Orders
- Provider integration
- Webhooks
- Reconciliation
- Payment summaries for other domains

Initial files:

- `backend/src/routes/payments.ts`
- `backend/src/routes/paymentWebhooks.ts`
- `backend/src/routes/donations.ts`
- `backend/src/services/paymentService.ts`

### Public read facade

The public surface is an internal composition layer, not a separate deployable service yet. It should gather content, config, sponsorship, and calendar data for public pages while keeping route handlers thin.

Initial file:

- `backend/src/routes/public.ts`

## First extraction targets

- Calendar read facade for unified calendar and upcoming bonspiels.
- Public read facade for bootstrap, home, menus, and public article reads.
- Payments summary query consumed by Events.
- Spares read/query layer for list and detail endpoints.
