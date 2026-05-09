# Phase 2 — Admin Registration Configuration

## Status

Planned.

## Depends on

- Phase 0 registration rules specification
- Phase 1 registration data model

## Purpose

Phase 2 adds the staff/admin configuration surfaces needed before the public
registration flow can be built.

The goal is for authorized staff to configure seasons, sessions, registration
periods, league registration settings, pricing, and discounts without manually
editing the database.

This phase should not build the member-facing registration flow.

## Core rule: registration state authority

`registration_periods.current_state` is authoritative for registration UX and
permission gates.

Scheduled timestamp columns, such as priority open time, open registration time,
and registration close time, are staff configuration/planning fields in this
phase. They do not automatically change `current_state` in Phase 2.

If the admin UI displays scheduled timestamps, it must make clear that the
current state is controlled by `current_state`.

Recommended UI copy:

> The current state controls whether registration is closed, priority, or open.
> Scheduled dates are for planning and future automation; they do not
> automatically change the current state in this version.

## Scope

Phase 2 includes admin configuration for:

1. Curling seasons
2. Curling sessions
3. Registration periods
4. League registration settings
5. League session assignment
6. League predecessor/successor continuity
7. Registration price configs
8. Registration discount configs
9. Admin navigation/discoverability
10. Validation and tests for these configuration surfaces

## Non-goals

Phase 2 must not implement:

- Public/member registration flow
- Registration wizard screens
- Eligibility calculation engine
- Fee calculation engine
- Stripe checkout orchestration for registrations
- Waitlist automation
- Waitlist offer processing
- Sabbatical lifecycle automation
- League placement processing
- Financial assistance review workflow, except basic config visibility if
  already present
- Automated changes to `registration_periods.current_state` based on timestamps

Those belong to later phases.

## Existing Phase 1 data model summary

Phase 1 added or extended:

- `curling_seasons`
- `curling_sessions`
- `leagues.session_id`
- `registration_periods`
- `curling_registrations`
- `registration_policy_acceptances`
- `registration_selections`
- `financial_assistance_requests`
- `league_roster`
- `season_memberships`
- `curling_ice_privileges`
- `curling_league_sabbaticals`
- `curling_sabbatical_sessions`
- `waitlist_entries`
- `waitlist_offers`
- `waitlist_audit_events`
- `registration_price_configs`
- `registration_discount_configs`
- `registration_invoices`
- `registration_invoice_line_items`
- `payment_orders.subject_type = curling_registration`

Phase 2 should build configuration surfaces over the relevant configuration
tables and league fields. It should not attempt to orchestrate the whole
registration lifecycle.

## Implementation guidance

Before coding, inspect existing app patterns for:

- Admin routes
- RBAC guards
- API route conventions
- Validation conventions
- Form components
- Table/list components
- Mutation/query patterns
- Toast/error handling
- Generated API type workflow
- Existing league management UI
- Existing payment/admin UI conventions

Follow existing project conventions unless there is a strong reason not to.

## Required admin areas

The exact route names may follow existing app conventions, but staff must be
able to access these configuration areas.

Suggested information architecture:

- Registration Configuration
  - Seasons
  - Sessions
  - Registration Periods
  - Prices
  - Discounts
- League Management
  - Existing league configuration
  - Registration-related league settings

It is acceptable to integrate these into existing admin pages if that better
matches the current app.

## 1. Curling seasons admin

Staff must be able to:

- List curling seasons
- View a curling season
- Create a curling season
- Edit a curling season
- See associated sessions
- See associated registration periods, if practical

Validation:

- Season date ranges must be valid if start/end fields exist.
- Required fields must be enforced.
- Duplicate or overlapping seasons should be prevented if the schema and
  existing business rules support that validation.

Do not invent complicated season automation in this phase.

## 2. Curling sessions admin

Staff must be able to:

- List curling sessions
- View a curling session
- Create a curling session within a season
- Edit a curling session
- Assign a session to a season
- Configure session ordering if the schema supports it
- Identify whether the session is the first session of the season if the schema
  supports it
- See associated leagues, if practical
- See associated registration period, if practical

Validation:

- A session must belong to a season.
- Session date ranges must be valid if start/end fields exist.
- Session ordering should be stable and unambiguous if ordering fields exist.
- Session dates should fit within the season if the data model has date ranges
  that make this practical to validate.

## 3. Registration periods admin

Staff must be able to configure `registration_periods`.

Required capabilities:

- List registration periods
- View a registration period
- Create a registration period
- Edit a registration period
- Select season
- Select session
- Set `current_state`
  - `closed`
  - `priority`
  - `open`
- Configure scheduled milestone timestamps created in Phase 1, such as:
  - priority opens at
  - open registration opens at
  - registration closes at
- See a clear explanation that `current_state` is authoritative

Validation:

- Registration period must belong to a season.
- Registration period must belong to a session.
- The selected session should belong to the selected season.
- Prevent duplicate registration periods for the same season/session if
  appropriate.
- Timestamp ordering should be reasonable:
  - priority open time should be before open registration time
  - open registration time should be before registration close time

Important behavior:

- Do not derive `current_state` from scheduled timestamps.
- Do not automatically transition registration periods.
- Do not open or close public registration based only on timestamps.

## 4. League registration settings

Extend the existing league management/admin UI to support the registration
fields added in Phase 1.

Staff must be able to configure, where supported by the schema:

- Session assignment
- League type:
  - standard
  - bring-your-own-team
- Capacity type:
  - individual
  - team
- Capacity value
- Fee
- Requires club membership
- Instructional flag
- Minimum experience years
- Minimum age
- Maximum age
- First day of play
- Last day of play
- Predecessor league
- Successor league, if exposed directly
- Whether waitlists are supported
- Whether sabbaticals are supported
- Whether third-league interest is supported

If the schema uses different field names, use the schema names.

Validation:

- A league cannot be its own predecessor.
- A league cannot be its own successor.
- Application-level validation must prevent obvious circular
  predecessor/successor chains.
- Maximum age cannot be less than minimum age.
- Minimum experience years cannot be negative.
- Fees cannot be negative.
- First day of play must be on or before last day of play when both are present.
- BYOT leagues must not be configured to use waitlists if that flag exists.
- BYOT leagues must not be configured to use sabbaticals if that flag exists.
- BYOT leagues should use team capacity if capacity type is modeled.
- Standard leagues should use individual capacity if capacity type is modeled.

Phase 1 allowed `leagues.session_id` to be nullable because existing leagues may
need backfill. Phase 2 should allow staff to assign unassigned leagues to
sessions.

## 5. League continuity

League continuity is used by later phases for:

- Returning member guarantees
- Sabbaticals
- Waitlist rollover
- League history

Staff must be able to link a league to its predecessor/successor.

Rules:

- A league may not be linked to itself.
- Circular chains must be rejected.
- The UI should make it easy to choose a predecessor from a relevant prior
  session when possible.
- The UI should not require every league to have a predecessor.

Preferred UX:

- On a league edit page, staff can select the predecessor league.
- The successor relationship can be displayed as derived information when
  possible.

## 6. Price configuration

Build admin configuration for `registration_price_configs`.

Staff must be able to configure prices for the types supported by the Phase 1
schema, including:

- Regular membership
- Social membership
- Spare-only ice privilege fee
- Sabbatical fee
- Junior Recreational fee
- Other configured registration price types

League-specific fees may live directly on leagues. If so, do not duplicate
league fee configuration here unless the schema explicitly requires it.

Validation:

- Amounts cannot be negative.
- Required scope fields must be present.
- If price configs have active/inactive status, only valid statuses are allowed.
- Avoid duplicate active configs for the same price type and scope if practical.

Phase 2 only configures prices. It does not need to calculate invoices.

## 7. Discount configuration

Build admin configuration for `registration_discount_configs`.

Staff must be able to configure discounts for:

- Student discount
- Reciprocal discount
- Winter-only discount

Discounts must support what Phase 1 schema allows, including:

- Dollar amount discounts
- Percentage discounts
- Active/inactive state, if modeled
- Season/session/tenant scope, if modeled

Validation:

- Dollar discount amounts cannot be negative.
- Percentage discounts must be between 0 and 100.
- Discount value must match discount type.
- Required scope fields must be present.
- Avoid duplicate active discounts of the same type and scope if practical.

Business rules preserved for later phases:

- Student discounts are automatically approved when claimed with required
  self-reported institution information.
- Reciprocal discounts are automatically approved when claimed with required
  self-reported club information.
- Discounts apply only to discount-eligible charges.
- Social membership fees are never discount-eligible.
- Sabbatical fees are never discount-eligible.
- Winter-only discount applies only to regular membership.
- Sabbatical-fill discounts are separate and always equal the full sabbatical
  fee.

Phase 2 does not implement discount calculation.

## 8. Admin navigation

Add discoverable admin navigation for the new configuration areas.

Staff should not need to know direct URLs.

Depending on current app conventions, this may be:

- A new "Registration Configuration" admin section
- Additional entries under existing admin navigation
- Tabs inside an existing leagues/settings area

Required navigation targets:

- Seasons
- Sessions
- Registration periods
- Registration prices
- Registration discounts
- League registration settings

## 9. RBAC and permissions

All Phase 2 configuration surfaces must be protected by existing admin/staff
permissions.

Use existing RBAC patterns.

At minimum:

- Anonymous users cannot access these pages or APIs.
- Regular logged-in users cannot access these pages or APIs.
- Only authorized staff/admin roles can create, update, or delete configuration.

If the app has separate permissions for league management, payments, or global
settings, follow the closest existing convention.

## 10. Tests

Add tests according to existing project conventions.

Required test coverage:

### API/RBAC tests

- Unauthorized users cannot access configuration endpoints.
- Non-staff users cannot mutate configuration.
- Authorized staff can create/update/list relevant records.

### Season/session tests

- Can create valid season.
- Can create valid session under season.
- Invalid date ranges are rejected when applicable.
- Session cannot be assigned inconsistently if validation is implemented.

### Registration period tests

- Can create a registration period.
- Can set `current_state`.
- Can configure scheduled timestamps.
- Timestamp order validation works.
- Scheduled timestamps do not automatically override `current_state`.

### League settings tests

- Can assign league to session.
- Can configure league registration fields.
- League cannot be its own predecessor/successor.
- Circular predecessor/successor chains are rejected.
- Invalid age range is rejected.
- Negative experience requirement is rejected.
- Negative fee is rejected.
- BYOT waitlist/sabbatical invalid combinations are rejected if those flags
  exist.

### Price config tests

- Can create valid price config.
- Negative amount is rejected.
- Duplicate active configs are rejected if implemented.

### Discount config tests

- Can create dollar discount.
- Can create percentage discount.
- Negative discount is rejected.
- Percentage over 100 is rejected.
- Invalid discount type/value combinations are rejected.

## 11. Acceptance criteria

Phase 2 is complete when:

- Staff can configure curling seasons.
- Staff can configure curling sessions.
- Staff can configure registration periods.
- Staff can manually set registration period `current_state`.
- Staff can configure scheduled registration timestamps.
- The UI clearly explains that `current_state` is authoritative.
- Staff can assign leagues to sessions.
- Staff can configure league registration settings.
- Staff can configure predecessor/successor league continuity.
- The app prevents self-referential and circular league continuity chains.
- Staff can configure registration prices.
- Staff can configure registration discounts.
- All admin surfaces are RBAC-protected.
- Existing app functionality is not broken.
- Tests cover the major validation and permission rules.
- OpenAPI/generated frontend types are regenerated if this project requires it.

## 12. Out-of-scope reminders

Do not implement these in Phase 2:

- Public registration wizard
- Registration submission
- Registration payment calculation
- Stripe checkout for registration invoices
- Waitlist placement automation
- Waitlist offer emails
- Sabbatical eligibility engine
- Returning member guarantee engine
- Junior Recreational assistance review processing
- Third-league placement
- Automatic registration state scheduler

Those belong to later phases.

## 13. Suggested implementation sequence

1. Inspect existing admin/API/form patterns.
2. Add or update backend validation helpers for registration configuration.
3. Build season/session admin endpoints if missing.
4. Build season/session admin UI.
5. Build registration period admin endpoints.
6. Build registration period admin UI.
7. Extend league admin API and UI for registration settings.
8. Add league continuity validation.
9. Build price config admin endpoints and UI.
10. Build discount config admin endpoints and UI.
11. Add admin navigation.
12. Add tests.
13. Regenerate API/client types if required.
14. Run full test suite.
15. Write Phase 2 handoff.

## 14. Phase 2 handoff requirements

When Phase 2 is complete, produce a handoff note that includes:

- New or changed routes/pages
- New or changed API endpoints
- New or changed validation rules
- Any schema changes made during Phase 2
- Any known limitations
- Any configuration that must be backfilled manually
- Confirmation of how `registration_periods.current_state` is handled
- Confirmation of whether league continuity circular validation exists
- Any generated type updates
- Test coverage summary
- Risks or deferred items for Phase 3

## 15. Phase 3 preview

Phase 3 will build the eligibility and fee calculation engine.

Phase 2 should leave Phase 3 with reliable configuration data for:

- Seasons
- Sessions
- Registration periods
- League eligibility settings
- League continuity
- Price configs
- Discount configs

Phase 3 should not need to manually patch configuration data in the database in
order to test business rules.