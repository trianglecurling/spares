# Registration Data Model

This document describes the intended data model for the registration system.

It is a durable reference document. It should be kept up to date as the
implementation evolves.

For business rules, see:

```text
docs/registration/rules.md
```

If this document conflicts with `rules.md`, the rules document wins unless a
later approved change explicitly updates the rules.

## 1. Design goals

The registration data model should support:

- One registration per curler
- Registering for self or another person
- Returning member recognition
- Policy acceptance tracking
- Membership selection
- Junior program paths
- League selection
- Guaranteed returns
- Sabbaticals
- Waitlists
- ADD and REPLACE waitlist entries
- Third-league interest
- BYOT league requests
- Deferred payment
- Stripe checkout integration
- Staff review and correction
- Waitlist auditing
- Future maintainability

The model should avoid putting complex business rules only in UI state.

Registration should be persisted early so a user can abandon and resume the flow.

## 2. Existing app assumptions

The app already has some existing concepts, including:

- Users
- Authentication by email
- RBAC
- Delegated impersonation
- Stripe checkout pipeline
- Leagues
- League management
- Possibly seasons/sessions
- Possibly existing league roster/participation records

The exact implementation may differ. This document describes the conceptual model
needed for registration.

Where existing tables already exist, extend them instead of duplicating them.

## Phase 1 — Physical storage reference

Implementation lives in Drizzle (`backend/src/db/drizzle-schema.ts`) and the
legacy Postgres/SQLite bootstrap (`backend/src/db/registrationSchemaBootstrap.ts`).
Account identity continues to resolve through **`members`**; curling registration
records use **`curler_member_id`** and **`submitted_by_member_id`**.

### Hierarchy and leagues

| Concept | Tables / columns |
| --- | --- |
| Season | `curling_seasons` |
| Session | `curling_sessions` (`season_id` FK) |
| League ↔ session | **`leagues.session_id`** nullable FK onto `curling_sessions` |

**League** registration columns (`league_type`, `capacity_type`, `capacity_value`, `registration_fee_minor`, instructional and age guards, predecessor/successor self-FKs, `allows_waitlist`, `allows_sabbatical`, nullable `first_day_of_play` / `last_day_of_play`) live on **`leagues`**. Legacy `members` flags (`social_member`, `spare_only`, …) stay in place until later phases reconcile them.

### Registration flow

| Concept | Tables |
| --- | --- |
| Registration window | `registration_periods` (stored **`current_state`** plus schedule timestamps) |
| Aggregate registration row | **`curling_registrations`** |
| Accepted policies | `registration_policy_acceptances` |
| Normalized selections | `registration_selections` |
| Assistance workflow | **`financial_assistance_requests`** |

### Placement, memberships, privileges

| Concept | Tables / columns |
| --- | --- |
| Roster placement | Extend **`league_roster`** with `source_registration_id`, `placement_type`, `status`, `is_temporary_sabbatical_fill`, **`related_sabbatical_id`** |
| Membership for a season | **`season_memberships`** |
| Session-scoped ice privilege | **`curling_ice_privileges`** |

### Sabbaticals

| Concept | Tables |
| --- | --- |
| Lifecycle / lineage | **`curling_league_sabbaticals`** |
| Per-session charges | **`curling_sabbatical_sessions`** |

### Waitlist — structures only in Phase 1

| Concept | Tables |
| --- | --- |
| Queue entry | **`waitlist_entries`** (CHECK on `entry_type` vs `replaces_league_id`; partial unique index for active member + league) |
| Offers | **`waitlist_offers`** |
| Audit | **`waitlist_audit_events`** |

### Pricing and invoicing

| Concept | Tables |
| --- | --- |
| Fee grid | **`registration_price_configs`** (season, optional session) |
| Discount rules | **`registration_discount_configs`** |
| Payable totals | **`registration_invoices`** + **`registration_invoice_line_items`** |

### Payments

`payment_orders.subject_type` includes **`curling_registration`**. Planned wiring for Stripe is **`subject_id` → `registration_invoices.id`**; **`registration_invoices.payment_order_id`** backs the inverse once an order exists. Phase 1 does not change checkout orchestration beyond shared enum surfaces.

### Bootstrap notes

PostgreSQL installs run a guarded repair: tables that clearly predate Phase 1
(missing an expected **`season_id`**) drop with **`CASCADE`** so `CREATE TABLE IF NOT EXISTS` can recreate the full layout — safe for prototype stubs, risky if any production data depended on malformed tables. Older **SQLite** files may retain the legacy `subject_type` CHECK unless a deliberate constraint migration replaces it.

---

## 3. Core existing entities that may need extension

### User

Represents a person/account in the system.

Registration depends on users for:

- Curler identity
- Submitter identity
- Parent/guardian account, if applicable
- Delegated impersonation
- Waitlist ownership
- Payment ownership

A user may or may not be a current member.

A user may join a waitlist without being a paid member.

### User profile / person profile

If the app separates authentication users from person profiles, registration
should attach demographic information to the person/curler profile.

Needed demographic fields include:

- First name
- Last name
- Date of birth
- Email address
- Phone number
- Mailing address
- Emergency contact name
- Emergency contact phone number
- Parent/guardian first name, for minors
- Parent/guardian last name, for minors
- Parent/guardian email, for minors
- Parent/guardian phone, for minors

If these already exist, do not duplicate them on registration except as a
snapshot if the app requires historical preservation.

### Season

A season is the curling season, usually September through May.

Needed fields:

- ID
- Name, such as `2025-26`
- Start date
- End date
- Membership start date
- Membership end date
- Fiscal year start date or fiscal year relationship, if applicable

The tenant fiscal year is July 1 through June 30.

Membership is valid September 1 through August 31.

### Session

A session belongs to a season.

Needed fields:

- ID
- Season ID
- Name, such as `Fall 2025` or `Winter 2026`
- Start date
- End date
- Sort order within season
- Whether this is the first session of the season

The `isFirstSessionOfSeason` concept is important for winter-only discount
eligibility.

### League

A league belongs to one session.

Existing league records should be extended with registration settings.

Needed registration-related fields:

- Session ID
- Name
- League type
  - `standard`
  - `bring_your_own_team`
- Capacity type
  - `individual`
  - `team`
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

A league entity is session-specific.

League continuity is modeled through predecessor/successor relationships.

## 4. New registration entities

## 4.1 RegistrationPeriod

Represents the configured registration window for a session or registration
campaign.

Depending on the existing app design, this may belong to a session, a season, or
both. The recommended default is that it targets a session.

### Purpose

Controls whether registration is closed, priority, or open.

### Fields

Recommended fields:

- ID
- Tenant ID, if multi-tenant
- Season ID
- Session ID
- Name
- Current state
  - `closed`
  - `priority`
  - `open`
- Priority opens at
- Priority closes at
- Open registration opens at
- Registration closes at
- Timezone, if not tenant-global
- Created at
- Updated at

### Notes

The current state may be computed from scheduled timestamps or stored
explicitly.

If stored explicitly, scheduled transitions should still be represented so staff
can configure future state changes.

The implementation should choose one clear source of truth for current state.

## 4.2 Registration

Represents one curler's registration workflow.

One registration equals one curler.

A parent registering three children creates three registrations.

### Purpose

Tracks the full registration lifecycle.

### Fields

Recommended fields:

- ID
- Tenant ID, if multi-tenant
- Registration period ID
- Season ID
- Session ID
- Curler user ID
- Submitted by user ID
- Registering for self boolean
- Returning member answer
- Status
- Membership option
- Ice privilege option, if useful
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
- Cancelled at
- Created at
- Updated at

### Registration status enum

Recommended statuses:

- `draft`
- `submitted`
- `awaiting_staff_review`
- `awaiting_placement`
- `awaiting_payment`
- `payment_started`
- `paid`
- `confirmed`
- `cancelled`

The exact statuses can be adjusted to match existing app conventions.

### Membership option enum

Recommended values:

- `none`
- `regular`
- `social`
- `regular_spare_only`
- `junior_recreational`

Junior Advanced Commitment should be represented as a normal league selection,
not as a distinct membership option.

### Experience fields

Recommended values:

- Experience type:
  - `none_or_minimal`
  - `specified_years`
  - `known_existing`
- Self-reported years can be decimal.

Experience should support fractional years such as `0.5`.

## 4.3 RegistrationPolicyAcceptance

Tracks required policy acceptance for a registration.

### Purpose

Records that the submitter agreed to the required policies on behalf of the
curler.

### Fields

- ID
- Registration ID
- Policy type
  - `code_of_conduct`
  - `maapp`
  - `privacy`
- Policy URL
- Accepted by user ID
- Accepted for user ID
- Accepted at
- Policy version, if available
- Created at

### Constraint

Each registration should have exactly one acceptance record for each required
policy before submission.

## 4.4 RegistrationSelection

Represents a league/program/waitlist/sabbatical-related choice made during
registration.

### Purpose

Stores all registration choices in a normalized way.

### Fields

Recommended fields:

- ID
- Registration ID
- League ID, nullable for spare-only or non-league selections
- Selection type
- Rank
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

### Selection type enum

Recommended values:

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

### Selection status enum

Recommended values:

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

### Notes

A registration may have multiple selections.

Examples:

- A returning member with two guaranteed leagues has two
  `guaranteed_return` selections.
- A member taking sabbatical has a `sabbatical` selection.
- A waitlist ADD request has a `waitlist_add` selection.
- A BYOT request has a `byot_request` selection with teammate text.
- Third-league interest is represented with one or more
  `third_league_interest` selections and rank values.

## 4.5 Membership

Represents paid membership for a season.

This may already exist in the app.

### Purpose

Records that a user is a member for a membership year/season.

### Fields

Recommended fields:

- ID
- User ID
- Season ID
- Membership type
- Starts at
- Ends at
- Source registration ID
- Payment ID or order ID
- Status
- Created at
- Updated at

### Membership type enum

Recommended values:

- `regular`
- `social`
- `junior_recreational`

Spare-only is not a membership type.

Spare-only is regular membership plus a session-specific ice privilege.

### Status enum

Recommended values:

- `pending`
- `active`
- `cancelled`
- `refunded`
- `expired`

## 4.6 IcePrivilege

Represents session-specific ice privileges.

### Purpose

Tracks who has ice privileges for a session and why.

### Fields

Recommended fields:

- ID
- User ID
- Season ID
- Session ID
- Source type
  - `league`
  - `spare_only`
  - `program`
  - `staff_adjustment`
- Source registration ID
- Source league ID, nullable
- Status
- Created at
- Updated at

### Notes

Ice privileges are session-specific.

A user may have fall ice privileges but not winter ice privileges.

The Club Bonspiel eligibility can check whether the user has at least one active
ice privilege in the season.

## 4.7 LeagueRegistration / LeagueRosterEntry

Represents a user's actual placement in a league.

This may already exist in the app.

### Purpose

Tracks confirmed participation in a league.

### Fields

Recommended fields:

- ID
- User ID
- League ID
- Source registration ID
- Status
- Placement type
- Is temporary sabbatical fill boolean
- Related sabbatical ID, nullable
- Created at
- Updated at

### Status enum

Recommended values:

- `pending`
- `active`
- `cancelled`
- `removed`
- `completed`

### Placement type enum

Recommended values:

- `guaranteed_return`
- `new_placement`
- `waitlist_add`
- `waitlist_replace`
- `byot`
- `staff_manual`
- `temporary_sabbatical_fill`

## 5. Sabbatical entities

## 5.1 Sabbatical

Represents a protected league spot held while the member is away.

### Purpose

Tracks sabbatical rights across sessions.

### Fields

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

### Status enum

Recommended values:

- `active`
- `returning`
- `released`
- `expired`
- `staff_overridden`
- `cancelled`

### Notes

A sabbatical is tied to a league continuity chain, not merely one league row.

The implementation may represent this through:

- Original league ID plus successor traversal
- A league lineage/group ID
- Another existing continuity mechanism

The model must support determining whether the sabbatical can continue into a
successor league.

## 5.2 SabbaticalSession

Optional but recommended.

Represents each session in which a sabbatical is used.

### Purpose

Keeps a per-session history of sabbatical usage and fees.

### Fields

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

### Notes

This is helpful because sabbatical fees are paid per league per session.

If not implemented as a separate table, equivalent history should still be
recoverable.

## 6. Waitlist entities

## 6.1 WaitlistEntry

Represents a user's active or historical position on a league waitlist.

### Purpose

Supports first-come, first-served waitlists, ADD/REPLACE behavior, rollover,
declines, and staff operations.

### Fields

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
- Offer response preference
- Status
- Rolled over from waitlist entry ID, nullable
- Created at
- Updated at

### Entry type enum

- `add`
- `replace`

### Offer response preference enum

- `ask`
- `auto_accept`
- `auto_decline`

Default: `ask`.

### Status enum

Recommended values:

- `active`
- `offered`
- `accepted`
- `declined`
- `placed`
- `removed`
- `moved_to_bottom`
- `rolled_over`
- `cancelled`

The app may prefer to keep status as `active` after a first decline. That is
acceptable if decline history is captured separately.

### Position/order

Waitlists are first-come, first-served.

The implementation should use a stable sortable field.

Options include:

- Numeric position
- Decimal/rank key
- Joined-at timestamp plus ID
- Explicit sort order

The chosen method must allow staff reordering and moving entries to the bottom.

### Constraints

Recommended constraints:

- Active waitlist entries should be unique by user and league.
- A REPLACE entry must have `replacesLeagueId`.
- An ADD entry should not have `replacesLeagueId`.
- BYOT leagues cannot have waitlist entries.
- Users must satisfy league eligibility before entry creation.

Some constraints may need to be enforced in application code rather than the
database.

## 6.2 WaitlistOffer

Represents an offer made to a user from a waitlist.

### Purpose

Tracks 24-hour offer windows and responses.

### Fields

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

### Offer type enum

- `permanent`
- `temporary_sabbatical_fill`

### Status enum

- `pending`
- `accepted`
- `declined`
- `expired_accepted`
- `cancelled`

### Notes

No response within 24 hours is treated as acceptance.

That state should be distinguishable from explicit acceptance if practical.

## 6.3 WaitlistAuditEvent

Required.

Records every waitlist mutation.

### Purpose

Provides an audit trail for waitlist changes.

### Fields

Recommended fields:

- ID
- Waitlist entry ID, nullable
- League ID, nullable
- User ID, nullable
- Actor user ID, nullable for system action
- Source
- Action
- Reason
- Before JSON, nullable
- After JSON, nullable
- Metadata JSON, nullable
- Created at

### Source enum

Recommended values:

- `registration_submission`
- `waitlist_rollover`
- `staff_action`
- `offer_response`
- `offer_expiration`
- `placement_process`
- `system_cleanup`

### Action enum

Recommended values:

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

The exact enum can be adjusted, but all waitlist changes must be auditable.

## 7. Pricing and payment entities

## 7.1 RegistrationPriceConfig

Represents configurable prices for a season/session.

The exact structure may vary depending on the existing app.

### Purpose

Stores registration prices without hardcoding.

### Fields

Recommended fields:

- ID
- Tenant ID, if multi-tenant
- Season ID
- Session ID, nullable if season-wide
- Regular membership fee
- Social membership fee
- Spare-only ice privilege fee
- Sabbatical fee
- Junior Recreational fee
- Created at
- Updated at

League fees may live directly on league records.

## 7.2 DiscountConfig

Represents configurable discounts.

### Purpose

Supports student, reciprocal, and winter-only discounts.

### Fields

Recommended fields:

- ID
- Tenant ID, if multi-tenant
- Season ID
- Discount type
- Amount type
- Amount value
- Applies to scope
- Active boolean
- Created at
- Updated at

### Discount type enum

- `student`
- `reciprocal`
- `winter_only`

### Amount type enum

- `dollar`
- `percent`

### Applies-to scope enum

Recommended values:

- `regular_membership`
- `eligible_invoice_items`

Winter-only should apply only to regular membership.

Social membership and sabbatical fees are never discount-eligible.

## 7.3 RegistrationInvoice / Order

The app may already have a checkout/order model.

Registration needs an invoice/order-like record that can be paid immediately or
later.

### Purpose

Stores itemized charges and discounts.

### Fields

Recommended fields:

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
- Stripe payment intent ID, if applicable
- Paid at
- Created at
- Updated at

### Status enum

Recommended values:

- `draft`
- `deferred`
- `awaiting_payment`
- `checkout_started`
- `paid`
- `failed`
- `cancelled`
- `refunded`

## 7.4 RegistrationInvoiceLineItem

Represents itemized fees and discounts.

### Purpose

Ensures the review screen and payment record are explainable.

### Fields

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

### Line type enum

Recommended values:

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

Discounts may be stored as negative line items.

## 8. Junior Recreational financial assistance

If not modeled directly on Registration, create a separate assistance request
entity.

## 8.1 FinancialAssistanceRequest

Optional but recommended if staff review needs a workflow.

### Fields

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

### Status enum

- `pending`
- `approved`
- `partially_approved`
- `denied`
- `withdrawn`

Payment is deferred while the request is pending.

## 9. Communications

The existing app may already track email.

If not, registration may need a simple communication log.

## 9.1 RegistrationEmailLog

Optional.

### Fields

- ID
- Registration ID, nullable
- User ID
- Email type
- Recipient email
- Status
- Provider message ID
- Sent at
- Bounced at
- Metadata JSON
- Created at

## 10. Important relationships

### Registration relationships

A registration belongs to:

- One registration period
- One season
- One session
- One curler user
- One submitting user

A registration has many:

- Policy acceptances
- Selections
- Invoice line items through invoice/order
- Waitlist entries, indirectly or directly
- Emails, if tracked

### League relationships

A league belongs to:

- One session

A league may have:

- One predecessor league
- One successor league
- Many waitlist entries
- Many league registrations
- Many registration selections

### Waitlist relationships

A waitlist entry belongs to:

- One user
- One league
- Optionally one source registration
- Optionally one replaced league

A waitlist entry has many:

- Audit events
- Offers

### Sabbatical relationships

A sabbatical belongs to:

- One user
- One league continuity chain

A sabbatical has many session usages if `SabbaticalSession` is implemented.

## 11. Recommended constraints

The implementation should enforce the following either in the database or
application service layer.

### League continuity

- A league cannot be its own predecessor.
- A league cannot be its own successor.
- Circular predecessor/successor chains are not allowed.

### League configuration

- Minimum age cannot exceed maximum age.
- Fee amounts cannot be negative.
- Capacity cannot be negative.
- BYOT leagues should use team capacity.
- Standard leagues should use individual capacity.
- BYOT leagues should not allow waitlists.
- BYOT leagues should not allow sabbaticals.
- Age eligibility requires first day of play.
- Sabbatical duration checks require last day of play.

### Registration

- One registration is for one curler.
- Submitted registrations must have required policy acceptances.
- Minor registrations must have parent/guardian information.
- Returning members must authenticate before registering as returning.
- Junior Recreational registrations cannot include other leagues or spare-only.
- Social registrations cannot include leagues, spare-only, or ice privileges.
- BYOT cannot be selected as a third league.
- Third-league interest defers payment.

### Protected claims

- Guaranteed returns plus sabbaticals cannot exceed two.
- Sabbaticals require priority registration.
- Sabbaticals require guaranteed-return eligibility.
- Sabbaticals are not available for BYOT.
- Sabbaticals are not available for temporary sabbatical-fill spots.

### Waitlists

- A user must have an account to join a waitlist.
- A user must be eligible for the league to join its waitlist.
- BYOT leagues cannot have waitlist entries.
- Active waitlist entry should be unique by user and league.
- ADD entries are allowed only when the user currently has 0 or 1 leagues.
- REPLACE entries require a replaced league.
- A user may have at most two active REPLACE waitlist entries.
- Once a user reaches two leagues, ADD entries must be cleaned up.

### Payment

- Deferred registrations should not create immediate checkout sessions.
- Failed or incomplete payment does not confirm registration.
- Sabbatical fees are never discounted.
- Social membership is never discounted.
- Winter-only discount applies only to regular membership.

## 12. Recommended indexes

Exact indexes depend on the database.

Recommended indexes include:

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

## 13. Data snapshots

Certain values should be snapshotted at registration/invoice time so historical
records remain accurate even if configuration changes later.

Recommended snapshots:

- Fee amounts
- Discount amounts
- Discount eligibility
- League fee at time of registration
- Sabbatical fee at time of registration
- Membership fee at time of registration
- Policy URL/version at time of acceptance
- BYOT teammate text
- Self-reported discount information
- Self-reported experience

## 14. Open implementation choices

The following details can be decided by the implementation phase based on the
existing codebase:

1. Whether registration state is computed or stored.
2. Whether sabbatical session history is a separate table.
3. Whether financial assistance requests are separate records or fields on
   Registration.
4. Whether invoice/order entities reuse the existing Stripe checkout pipeline.
5. Whether user demographics are snapshotted on Registration or read from profile
   records.
6. Whether league lineage is represented by predecessor/successor traversal or a
   separate league lineage/group entity.
7. Exact enum names and database naming conventions.

These choices should not change the business rules in `rules.md`.

## 15. Phase 1 completion expectation

After Phase 1, the database should be capable of representing all registration
rules even if the UI and business logic are not yet implemented.

Phase 1 does not need to build:

- Registration UI
- Admin configuration UI
- Eligibility services
- Fee calculator
- Waitlist offer processing
- Stripe checkout changes
- Email templates

Those are later phases.