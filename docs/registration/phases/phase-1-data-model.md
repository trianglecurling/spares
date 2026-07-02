# Phase 1 — Registration Data Model

## Purpose

Phase 1 implements the database structures and type definitions needed to support
the registration system.

This phase should not build the registration UI or the registration workflow.

The goal is to make the application capable of storing all registration-related
data described in:

```text
docs/registration/rules.md
docs/registration/data-model.md
```

## Required reading

Before starting implementation, read:

```text
docs/registration/rules.md
docs/registration/data-model.md
```

`rules.md` is the authoritative business rules document.

`data-model.md` describes the conceptual model to implement.

If there is a conflict, `rules.md` wins unless the product owner explicitly says
otherwise.

## Scope

Phase 1 includes:

- Database migrations
- Schema/model definitions
- Enum/type definitions
- Relationships
- Basic database constraints where practical
- Indexes
- Minimal seed/default data only if necessary
- Updating existing league/session/user models where needed

Phase 1 does not include:

- User-facing registration UI
- Admin configuration UI
- Fee calculation logic
- Eligibility logic
- Registration wizard
- Stripe checkout changes
- Waitlist offer processing
- Email templates
- Staff dashboards
- League placement automation

## Implementation principles

### 1. Extend existing models where appropriate

The app already has users, leagues, RBAC, login, Stripe checkout, and related
features.

Do not duplicate existing concepts unnecessarily.

If seasons, sessions, leagues, users, memberships, or payments already exist,
extend them to support registration instead of creating parallel concepts.

### 2. Preserve existing behavior

Existing app behavior should continue to work after Phase 1.

Adding registration data structures should not break:

- Login
- Existing league management
- Existing Stripe checkout
- Existing RBAC
- Existing user management

### 3. Prefer explicit status fields

Registration is stateful and operationally complex.

Use explicit status fields where they improve clarity and staff visibility.

### 4. Snapshot money values

Fees and discounts should be configurable, but submitted registrations and
invoices need historical accuracy.

Where relevant, store amount snapshots on selections or invoice line items.

### 5. Make waitlist auditing first-class

Waitlist changes are high-impact and must be audited.

The audit model should be implemented in Phase 1, even if the UI to view audits
comes later.

## Entities to implement or extend

The exact table/model names should follow the existing project conventions.

The conceptual entities below should be represented.

## 1. Season/session support

If seasons and sessions already exist, verify they support the required fields.

### Season must support

- Name
- Start date
- End date
- Membership start date
- Membership end date

For this tenant, membership is September 1 through August 31.

The tenant fiscal year is July 1 through June 30, but fiscal-year configuration
may already exist elsewhere.

### Session must support

- Season relationship
- Name
- Start date
- End date
- Sort order within the season
- Whether it is the first session of the season

The first-session flag or equivalent is required for winter-only discount logic.

## 2. League extensions

Extend the league model with registration settings.

Required fields:

- League type
  - standard
  - bring-your-own-team
- Capacity type
  - individual
  - team
- Capacity value
- Fee amount
- Requires club membership
- Is instructional
- Minimum experience years
- Minimum age
- Maximum age
- First day of play
- Last day of play
- Allows waitlist
- Allows sabbatical
- Predecessor league ID
- Successor league ID

### League extension constraints

Where practical, enforce:

- Minimum age cannot exceed maximum age.
- Fee amount cannot be negative.
- Capacity value cannot be negative.
- A league cannot be its own predecessor.
- A league cannot be its own successor.

Circular predecessor/successor chains may need to be validated in application
code later if difficult to enforce in the database.

## 3. RegistrationPeriod

Create a registration period/configuration model.

Recommended fields:

- ID
- Tenant ID, if applicable
- Season ID
- Session ID
- Name
- Current state
- Priority opens at
- Priority closes at
- Open registration opens at
- Registration closes at
- Created at
- Updated at

Current state values:

- `closed`
- `priority`
- `open`

The implementation may choose to compute current state from dates later, but
Phase 1 should store enough information to support scheduled state changes.

## 4. Registration

Create a registration model.

Recommended fields:

- ID
- Tenant ID, if applicable
- Registration period ID
- Season ID
- Session ID
- Curler user ID
- Submitted by user ID
- Registering for self boolean
- Returning member answer
- Status
- Membership option
- Experience type
- Self-reported experience years
- Student discount claimed boolean
- Student institution
- Reciprocal discount claimed boolean
- Reciprocal club name
- Winter-only discount applied boolean
- Junior Recreational assistance requested percentage
- Junior Recreational assistance decision
- Deferred payment boolean
- Deferred payment reason
- Stripe checkout session ID, nullable
- Payment status
- Submitted at
- Paid at
- Canceled at
- Created at
- Updated at

Recommended registration statuses:

- `draft`
- `submitted`
- `awaiting_staff_review`
- `awaiting_placement`
- `awaiting_payment`
- `payment_started`
- `paid`
- `confirmed`
- `cancelled`

Recommended membership options:

- `none`
- `regular`
- `social`
- `regular_spare_only`
- `junior_recreational`

Recommended experience types:

- `none_or_minimal`
- `specified_years`
- `known_existing`

## 5. RegistrationPolicyAcceptance

Create a model for policy acceptance.

Recommended fields:

- ID
- Registration ID
- Policy type
- Policy URL
- Accepted by user ID
- Accepted for user ID
- Accepted at
- Policy version, nullable
- Created at

Policy types:

- `code_of_conduct`
- `maapp`
- `privacy`

A submitted registration must eventually have all three, though that validation
can be implemented in a later business logic phase.

## 6. RegistrationSelection

Create a model for league/program-related registration selections.

Recommended fields:

- ID
- Registration ID
- League ID, nullable
- Selection type
- Rank, nullable
- Replaces league ID, nullable
- Related sabbatical ID, nullable
- Is temporary sabbatical fill boolean
- BYOT teammate text, nullable
- Status
- Fee amount snapshot
- Discount amount snapshot
- Notes
- Created at
- Updated at

Selection type values:

- `guaranteed_return`
- `sabbatical`
- `drop`
- `return_subject_to_availability`
- `waitlist_add`
- `waitlist_replace`
- `third_league_interest`
- `byot_request`
- `junior_recreational`
- `spare_only`

Selection status values:

- `draft`
- `pending`
- `confirmed`
- `waitlisted`
- `offered`
- `accepted`
- `declined`
- `placed`
- `not_placed`
- `dropped`
- `cancelled`

## 7. Membership

If a membership model already exists, extend it as needed.

It should support:

- User ID
- Season ID
- Membership type
- Starts at
- Ends at
- Source registration ID
- Payment/order relationship
- Status

Membership types:

- `regular`
- `social`
- `junior_recreational`

Spare-only must not be modeled as a membership type.

Spare-only is regular membership plus a session-specific ice privilege fee.

## 8. IcePrivilege

Create an ice privilege model if one does not already exist.

Required because ice privileges are session-specific.

Recommended fields:

- ID
- User ID
- Season ID
- Session ID
- Source type
- Source registration ID
- Source league ID, nullable
- Status
- Created at
- Updated at

Source type values:

- `league`
- `spare_only`
- `program`
- `staff_adjustment`

## 9. LeagueRegistration or roster placement

If the app already has league roster/participation records, extend them.

Needed fields or equivalent:

- User ID
- League ID
- Source registration ID
- Status
- Placement type
- Is temporary sabbatical fill boolean
- Related sabbatical ID, nullable
- Created at
- Updated at

Placement type values:

- `guaranteed_return`
- `new_placement`
- `waitlist_add`
- `waitlist_replace`
- `byot`
- `staff_manual`
- `temporary_sabbatical_fill`

## 10. Sabbatical

Create a sabbatical model.

Recommended fields:

- ID
- User ID
- League lineage key or original league ID
- Current league ID
- Source registration ID
- First sabbatical league ID
- First sabbatical start date
- Status
- Staff override boolean
- Staff override reason
- Released at
- Released reason
- Created at
- Updated at

Status values:

- `active`
- `returning`
- `released`
- `expired`
- `staff_overridden`
- `cancelled`

The model must support sabbatical continuity across successor leagues.

## 11. SabbaticalSession

Implement if helpful.

Recommended for tracking per-session sabbatical usage and fee payment.

Fields:

- ID
- Sabbatical ID
- League ID
- Registration ID
- Fee amount
- Payment status
- Starts at
- Ends at
- Created at
- Updated at

If this is not implemented as a separate table, document how equivalent history
will be preserved.

## 12. WaitlistEntry

Create or extend waitlist entries.

Recommended fields:

- ID
- User ID
- League ID
- Source registration ID
- Entry type
- Replaces league ID, nullable
- Position sort key
- Joined at
- Decline count
- Status
- Rolled over from waitlist entry ID, nullable
- Created at
- Updated at

Entry types:

- `add`
- `replace`

Status values:

- `active`
- `offered`
- `accepted`
- `declined`
- `placed`
- `removed`
- `moved_to_bottom`
- `rolled_over`
- `cancelled`

Recommended constraints:

- Active waitlist entry should be unique by user and league.
- REPLACE entry requires replaces league ID.
- ADD entry should not have replaces league ID.

Some constraints can be implemented later in the service layer if database-level
constraints are not practical.

## 13. WaitlistOffer

Create a waitlist offer model.

Recommended fields:

- ID
- Waitlist entry ID
- League ID
- User ID
- Offer type
- Status
- Offered at
- Expires at
- Responded at
- Response source
- Offered by user ID
- Source registration ID, nullable
- Payment link ID, nullable
- Created at
- Updated at

Offer types:

- `permanent`
- `temporary_sabbatical_fill`

Status values:

- `pending`
- `accepted`
- `declined`
- `expired_accepted`
- `cancelled`

No response within 24 hours is treated as accepted.

The automation for this does not need to be built in Phase 1.

## 14. WaitlistAuditEvent

Create required waitlist audit model.

Recommended fields:

- ID
- Waitlist entry ID, nullable
- League ID, nullable
- User ID, nullable
- Actor user ID, nullable for system actions
- Source
- Action
- Reason
- Before JSON, nullable
- After JSON, nullable
- Metadata JSON, nullable
- Created at

Source values:

- `registration_submission`
- `waitlist_rollover`
- `staff_action`
- `offer_response`
- `offer_expiration`
- `placement_process`
- `system_cleanup`

Action values:

- `entry_created`
- `entry_removed`
- `entry_reordered`
- `entry_rolled_over`
- `entry_converted_add_to_replace`
- `entry_converted_replace_to_add`
- `replacement_league_changed`
- `offer_sent`
- `offer_accepted`
- `offer_declined`
- `offer_expired_accepted`
- `decline_count_changed`
- `entry_moved_to_bottom`
- `entry_placed`
- `staff_correction`

Every waitlist mutation in later phases must create an audit event.

## 15. Pricing configuration

Create a registration pricing configuration model unless the app already has a
suitable pricing system.

Recommended fields:

- ID
- Tenant ID, if applicable
- Season ID
- Session ID, nullable
- Regular membership fee
- Social membership fee
- Spare-only ice privilege fee
- Sabbatical fee
- Junior Recreational fee
- Created at
- Updated at

League fees may be stored on league records.

## 16. DiscountConfig

Create a discount configuration model.

Recommended fields:

- ID
- Tenant ID, if applicable
- Season ID
- Discount type
- Amount type
- Amount value
- Applies to scope
- Active boolean
- Created at
- Updated at

Discount types:

- `student`
- `reciprocal`
- `winter_only`

Amount types:

- `dollar`
- `percent`

Suggested scopes:

- `regular_membership`
- `eligible_invoice_items`

## 17. RegistrationInvoice / order integration

If the app already has an order, invoice, or checkout entity, extend it.

If not, create registration invoice models.

Recommended invoice fields:

- ID
- Registration ID
- User ID responsible for payment
- Status
- Subtotal amount
- Discount amount
- Total amount
- Currency
- Deferred boolean
- Deferred reason
- Stripe checkout session ID
- Stripe payment intent ID, nullable
- Paid at
- Created at
- Updated at

Invoice statuses:

- `draft`
- `deferred`
- `awaiting_payment`
- `checkout_started`
- `paid`
- `failed`
- `cancelled`
- `refunded`

## 18. RegistrationInvoiceLineItem

Recommended fields:

- ID
- Invoice ID
- Line type
- Description
- Related league ID, nullable
- Related selection ID, nullable
- Amount
- Discount eligible boolean
- Sort order
- Created at

Line types:

- `regular_membership_fee`
- `social_membership_fee`
- `league_fee`
- `spare_only_fee`
- `sabbatical_fee`
- `junior_recreational_fee`
- `student_discount`
- `reciprocal_discount`
- `winter_only_discount`
- `sabbatical_fill_discount`
- `financial_assistance_discount`
- `manual_adjustment`

## 19. FinancialAssistanceRequest

Implement as a separate model if appropriate.

Recommended fields:

- ID
- Registration ID
- User ID
- Requested percentage
- Approved percentage
- Status
- Reviewed by user ID
- Reviewed at
- Staff notes
- Created at
- Updated at

Status values:

- `pending`
- `approved`
- `partially_approved`
- `denied`
- `withdrawn`

If this is represented directly on Registration instead, document that decision.

## 20. Optional communication log

If the app already logs emails, reuse the existing system.

If not, optionally add:

- Registration ID
- User ID
- Email type
- Recipient email
- Status
- Provider message ID
- Sent at
- Bounced at
- Metadata JSON
- Created at

This is optional for Phase 1.

## Required indexes

Add indexes appropriate to the database and ORM.

At minimum, index frequently queried foreign keys and status fields.

Recommended indexes:

### Registration

- Registration period ID
- Season ID
- Session ID
- Curler user ID
- Submitted by user ID
- Status
- Payment status

### RegistrationSelection

- Registration ID
- League ID
- Selection type
- Status

### League

- Session ID
- Predecessor league ID
- Successor league ID
- League type

### WaitlistEntry

- League ID
- User ID
- Status
- Entry type
- Position sort key
- Joined at
- Source registration ID
- Replaces league ID

### WaitlistOffer

- Waitlist entry ID
- League ID
- User ID
- Status
- Expires at

### WaitlistAuditEvent

- Waitlist entry ID
- League ID
- User ID
- Actor user ID
- Created at
- Action

### Sabbatical

- User ID
- Current league ID
- Status
- First sabbatical start date

### Invoice/order

- Registration ID
- User ID
- Status
- Stripe checkout session ID

## Data constraints and validation

Implement database constraints where easy and safe.

Leave complex business validation for later service-layer phases.

### Good database-level constraints

- Non-null required foreign keys
- Non-negative money values
- Non-negative capacity
- Non-negative decline count
- Valid enum values
- Unique active waitlist entry by user and league, if supported
- A league cannot have itself as predecessor
- A league cannot have itself as successor

### Better as service-layer validation

- Circular league predecessor/successor chains
- Sabbatical duration eligibility
- Guaranteed return eligibility
- Maximum two protected claims
- ADD waitlist eligibility based on current league count
- Maximum two REPLACE waitlists
- Junior Recreational exclusivity
- Discount eligibility
- Payment deferral decisions
- BYOT cannot be third league
- Experience eligibility
- Age eligibility

## Migration safety

Before implementing migrations:

1. Inspect existing schema.
2. Identify existing tables that can be extended.
3. Avoid creating duplicate user, league, session, membership, or payment
   concepts.
4. Prefer nullable fields for new data where existing records need to survive.
5. Add stricter constraints only when existing data is known to satisfy them.
6. Ensure migrations are reversible if the project convention supports rollback.

## Testing expectations for Phase 1

Phase 1 should include basic schema/model tests if the project has that pattern.

At minimum:

- Migrations apply cleanly.
- Migrations roll back cleanly, if rollback is supported.
- Existing tests still pass.
- New enums/types compile.
- Basic create/read tests pass for new entities.
- Required relationships work.
- Basic constraints work.

Do not attempt to test full registration business logic in Phase 1.

That belongs in Phase 3.

## Acceptance criteria

Phase 1 is complete when:

- The database can represent registration periods.
- The database can represent one registration per curler.
- The database can store policy acceptances.
- The database can store membership/program choices.
- The database can store league selections.
- The database can represent guaranteed returns, sabbaticals, drops, BYOT
  requests, waitlist requests, and third-league interest.
- The database can represent ADD and REPLACE waitlist entries.
- The database can represent waitlist offers.
- The database can audit waitlist changes.
- The database can represent sabbaticals across league continuity.
- The database can represent configurable registration pricing.
- The database can represent configurable discounts.
- The database can represent deferred invoices or integrate with the existing
  order/checkout system.
- Existing app functionality still works.
- Relevant indexes and basic constraints exist.
- `docs/registration/data-model.md` is updated if implementation decisions differ
  from the initial conceptual model.

## Handoff required at end of Phase 1

At the end of Phase 1, produce a short handoff summary for Phase 2.

The handoff should include:

1. Tables/models created.
2. Existing tables/models modified.
3. Enums/types added.
4. Any conceptual model changes from `data-model.md`.
5. Any constraints deferred to service-layer validation.
6. Any migration risks or data backfill requirements.
7. Any open questions for the product owner.
8. Instructions for how Phase 2 should use the new models.

## Recommended LLM implementation prompt

Use a fresh context for Phase 1 and begin with:

```text
You are implementing Phase 1 of the registration system: the data model.

Read these files first:
- docs/registration/rules.md
- docs/registration/data-model.md
- docs/registration/phases/phase-1-data-model.md

Treat docs/registration/rules.md as authoritative.

Do not implement UI, checkout behavior, eligibility services, fee calculation, or
waitlist processing in this phase.

Before coding:
1. Inspect the existing schema and models.
2. Summarize the existing relevant app structure.
3. Identify which existing models should be extended.
4. Propose the migration/model plan.
5. Wait for approval.

After approval:
1. Implement migrations and model/type changes.
2. Add basic schema/model tests where appropriate.
3. Run the test suite.
4. Update docs/registration/data-model.md if implementation differs from the
   conceptual model.
5. Produce a handoff summary for Phase 2.
```