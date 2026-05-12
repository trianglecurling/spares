# docs/registration/phases/phase-8-staff-waitlists.md

# Phase 8: Staff Waitlists, Placement, Offers, and Auditing

## Objective

Build the staff-facing waitlist and placement tools needed to process league
vacancies after registration submissions.

This phase gives staff the ability to:

- View league vacancies.
- View and manage waitlists.
- Send league offers.
- Process acceptances and declines.
- Fill permanent vacancies before temporary sabbatical-fill vacancies.
- Trigger deferred payment links after placement.
- Audit all waitlist changes.

This phase is operationally critical. Approximately 400 members will use
registration multiple times per year, and the system processes significant
annual revenue. Staff must be able to understand and safely manage every
waitlist action.

---

## Required source documents

Before implementing this phase, read these documents:

- `docs/registration/rules.md`
- `docs/registration/data-model.md`
- `docs/registration/eligibility.md`
- `docs/registration/waitlists.md`
- `docs/registration/sabbaticals.md`
- `docs/registration/fee-calculation.md`
- `docs/registration/user-flow.md`
- `docs/registration/test-matrix.md`
- `docs/registration/staff-operations.md`

If there is a conflict between this phase plan and `rules.md`, the canonical
rules document wins unless explicitly corrected by a maintainer.

---

## Scope

This phase includes:

1. Staff waitlist dashboard.
2. Per-league waitlist manager.
3. Vacancy calculation display.
4. Waitlist offer creation.
5. Offer acceptance, decline, and expiration handling.
6. Automatic acceptance after 24 hours if no response.
7. Permanent vacancy placement.
8. Temporary sabbatical-fill placement.
9. ADD/REPLACE waitlist handling during placement.
10. Staff manual waitlist changes.
11. Waitlist rollover to successor leagues.
12. Waitlist audit logging.
13. Triggering payment links for deferred registrations after placement.

---

## Non-goals

This phase does not include:

- Rebuilding the registration flow.
- Rebuilding Stripe checkout.
- Member-facing account pages for viewing waitlists.
- General-purpose member messaging.
- Fully automated third-league placement.
- Advanced roster/team management.
- Refund automation.
- Duplicate account merging.
- Waiver handling.

Third-league interest may be visible to staff if already stored, but placement
of third-league requests remains manual/outside the core application workflow
for V1.

---

## Key rules

### Placement order

For standard leagues, placement must follow this order:

1. Guaranteed returns and sabbatical returns are resolved first.
2. Remaining permanent spots are offered to the waitlist.
3. Temporary sabbatical-fill spots are offered separately.
4. Third-league requests are handled only after first/second league demand is
   satisfied.

Permanent vacancies must be filled before temporary sabbatical-fill vacancies.

### Waitlist types

Waitlist entries may be one of:

- `ADD`
- `REPLACE`

An `ADD` entry means the person is trying to add the league as one of their
first two leagues.

A `REPLACE` entry means the person is trying to replace an existing league with
this league.

Rules:

- A member may be on unlimited `ADD` waitlists if they are currently in 0 or 1
  leagues.
- A member may be on at most 2 active `REPLACE` waitlists.
- `REPLACE` entries must identify the league that would be replaced.
- If a member reaches 2 leagues while they still have active `ADD` waitlist
  entries, they must immediately resolve those entries by either:
  - Removing them, or
  - Converting up to 2 of them to `REPLACE` entries.

### Offer response rules

When staff sends a waitlist offer:

- The recipient has 24 hours to decline.
- If they do not decline within 24 hours, the offer is treated as accepted.
- The offer email must clearly explain this.
- Staff may manually mark an offer accepted or declined.
- Staff may manually correct offer state if needed.
- Payment issues are handled manually by staff.

### Decline rules

Declines are tracked per waitlist instance.

- First decline: person keeps their waitlist position.
- Second decline: person moves to the bottom of the waitlist.
- Moving to the bottom resets the decline count for the new waitlist instance
  or effective waitlist position.
- Removing and re-adding a person resets the decline count.
- Declining a temporary sabbatical-fill spot counts the same as declining a
  permanent spot.

### Temporary sabbatical-fill spots

A temporary sabbatical-fill spot is not a permanent league spot.

Rules:

- The user must be clearly told the spot is temporary.
- A temporary fill curler keeps their waitlist position for a permanent spot.
- The original sabbatical member cannot return mid-session.
- The original sabbatical member may return in a future session if eligible.
- If a permanent spot opens and the temporary fill curler is next on the
  waitlist, they may receive the permanent spot and be removed from the
  waitlist.
- The temporary spot then becomes available to the next person on the waitlist.

### BYOT leagues

Bring-your-own-team leagues:

- Do not participate in the waitlist system.
- Do not participate in the sabbatical system.
- Are not managed through the Phase 8 waitlist tools.
- May still appear in staff registration/placement views as informational
  records.

### Waitlist rollover

Waitlists automatically roll forward to successor leagues.

When a successor league is configured:

- Active waitlist entries from the predecessor league carry forward.
- Relative order is preserved.
- Decline counts are preserved unless the person is removed/re-added or moved
  to the bottom according to normal rules.
- The rollover must be audited.
- Rollover must not create duplicate active waitlist entries for the same
  person and successor league.

### Auditing

Any waitlist mutation must create an audit record.

This includes both manual and automatic changes.

Audit records must include:

- What changed.
- Previous value where practical.
- New value where practical.
- Who caused it, if a staff/user action.
- System source, if automatic.
- Why the change happened.
- Timestamp.

Staff manual changes must require a reason.

---

## Data model expectations

Use the data model created in previous phases where possible.

If missing, this phase may add or extend records for waitlist offers.

### Waitlist offer fields

A waitlist offer should conceptually include:

- Offer ID.
- League ID.
- Waitlist entry ID.
- User/member ID.
- Registration ID, if applicable.
- Offer type:
  - `PERMANENT_SPOT`
  - `TEMPORARY_SABBATICAL_FILL`
- Status:
  - `PENDING`
  - `ACCEPTED`
  - `DECLINED`
  - `EXPIRED_ACCEPTED`
  - `CANCELLED`
- Sent timestamp.
- Response deadline timestamp.
- Accepted timestamp.
- Declined timestamp.
- Staff actor ID, if staff-created or staff-updated.
- Token/hash for email action links, if email links are implemented.
- Cancellation reason, if cancelled.
- Staff notes, optional.

`EXPIRED_ACCEPTED` means the 24-hour period elapsed without a decline, so the
offer was accepted by rule.

If the app already has a generic offer/invitation model, adapt to that instead
of creating a duplicate concept.

---

## Staff permissions

Only authorized staff should access these tools.

Expected permission examples:

- View waitlists.
- Manage waitlists.
- Send waitlist offers.
- Override waitlist state.
- View waitlist audit logs.
- Trigger deferred payment links.

Use existing RBAC conventions.

Do not expose waitlist management tools to ordinary members.

---

## Staff dashboard

Create a staff dashboard for registration/waitlist operations.

The dashboard should show leagues for the active registration session.

For each standard league, show:

- League name.
- Session.
- Capacity.
- Confirmed/placed curler count.
- Permanent vacancies.
- Temporary sabbatical-fill vacancies.
- Number of active waitlist entries.
- Number of pending offers.
- Whether waitlist rollover has occurred.
- Warning indicators, if any.

Warnings may include:

- Missing capacity.
- Missing first day of play.
- Missing last day of play.
- Missing predecessor/successor link where expected.
- Active waitlist entries with now-ineligible users.
- ADD waitlist entries for users who now have 2 leagues.
- Pending offers past deadline that have not been processed.
- Duplicate active entries.

---

## Per-league waitlist manager

Create a per-league staff page.

It should show:

### League summary

- League name.
- Session.
- League type.
- Capacity.
- Confirmed placed members.
- Permanent vacancies.
- Temporary sabbatical-fill vacancies.
- Fee.
- First day of play.
- Last day of play.

### Current roster/placements

Show confirmed or pending placed curlers, including:

- Name.
- Registration status.
- Placement type:
  - Guaranteed return.
  - Standard placement.
  - Temporary sabbatical-fill.
  - Staff placement.
- Payment status.
- Relevant notes.

### Waitlist entries

For each active waitlist entry, show:

- Position.
- Member name.
- Entry type: `ADD` or `REPLACE`.
- League being replaced, if `REPLACE`.
- Decline count.
- Eligibility status.
- Current league count.
- Registration status.
- Pending offer status, if any.
- Created date.
- Rolled-over-from league, if applicable.
- Staff notes, if available.

### Actions

Staff actions should include:

- Send offer.
- Send offers to top N eligible entries.
- Mark offer accepted.
- Mark offer declined.
- Cancel offer.
- Add waitlist entry.
- Remove waitlist entry.
- Move entry to bottom.
- Reorder entry.
- Convert `ADD` to `REPLACE`.
- Convert `REPLACE` to `ADD` when eligible.
- Edit replacement league.
- View audit history.
- Trigger payment link for placed/deferred registration.

All mutation actions require auditing.

Manual staff mutations require a reason.

---

## Offer creation

Staff should be able to send offers to one or more eligible waitlist entries.

### Permanent vacancy offers

For permanent vacancies:

- Staff selects a number of offers to send.
- The system proposes the top N eligible waitlist entries in order.
- Staff confirms.
- Offer emails are sent.

### Temporary sabbatical-fill offers

For temporary sabbatical-fill vacancies:

- Staff must explicitly choose temporary fill offers.
- The offer email must clearly say the spot is temporary.
- Temporary fill offers do not remove the recipient from the waitlist if
  accepted.

### Offer validation

Before sending an offer, validate:

- The waitlist entry is active.
- The user is still eligible for the league.
- The user does not already have a conflicting placement.
- The user has no pending offer for the same league.
- The league has a vacancy or staff explicitly overrides.
- The offer type is valid for the league.
- BYOT leagues cannot receive waitlist offers.

If validation fails, show staff a clear error or warning.

---

## Offer email content

The waitlist offer email must include:

- League name.
- Whether the offer is permanent or temporary.
- Deadline to decline.
- Clear statement that no response means acceptance.
- Decline link or instructions.
- Contact information for staff.
- Payment note if applicable.

Required wording or equivalent:

> If you do not decline this offer within 24 hours, we will treat the offer as
> accepted and add you to the league. If payment is required, staff will follow
> up with you.

For temporary sabbatical-fill offers, include:

> This is a temporary sabbatical-fill spot. You may play in this spot for the
> session, but the original member may reclaim the spot in a future session. You
> will keep your position on the waitlist for a permanent spot.

---

## Offer lifecycle

### Pending

When sent, the offer is `PENDING`.

### Declined by user

If user declines within 24 hours:

- Mark offer `DECLINED`.
- Apply decline rules.
- Audit the change.
- Do not place the user into the league.

### Accepted by user

If user accepts, if accept links are implemented:

- Mark offer `ACCEPTED`.
- Place the user according to offer type.
- Audit the placement.
- Trigger payment workflow if needed.

### No response

If the deadline passes with no decline:

- Mark offer `EXPIRED_ACCEPTED`.
- Place the user according to offer type.
- Audit the placement.
- Trigger payment workflow if needed.

### Cancelled by staff

Staff may cancel a pending offer.

- Mark offer `CANCELLED`.
- Require a reason.
- Audit the cancellation.

---

## Placement behavior

### Permanent placement

When a permanent offer is accepted or auto-accepted:

- Add the member to the league as a permanent placement.
- Remove or deactivate the relevant waitlist entry.
- If the accepted entry was `REPLACE`, release the replaced league placement.
- The released league may now have a vacancy.
- Audit all affected waitlist and placement changes.
- Trigger deferred invoice/payment link if the member now has a payable
  registration.

### Temporary sabbatical-fill placement

When a temporary offer is accepted or auto-accepted:

- Add the member to the league as a temporary sabbatical-fill placement.
- Do not remove the member from the waitlist.
- Apply the sabbatical-fill discount in the invoice/payment calculation.
- Audit the placement.
- Trigger deferred invoice/payment link if appropriate.

### ADD cleanup

If placement causes a member to reach two active leagues and they still have
active `ADD` waitlist entries:

- The system must identify the conflicting entries.
- The member or staff must resolve them immediately.
- Until resolved, further placement/payment progression may be blocked.
- Resolution options:
  - Remove the entries.
  - Convert up to two entries to `REPLACE`.
  - Specify replacement league for each converted entry.

For V1, if no member-facing cleanup screen exists yet, staff may perform this
cleanup manually with a required audit reason.

---

## Payment link behavior

When a deferred registration becomes ready for payment:

- Staff can trigger a payment link.
- The invoice should include all current payable items whenever possible.
- Avoid multiple payments per user when practical.
- If non-guaranteed items remain unresolved, payment may remain deferred.
- Payment issues are handled manually by staff.

Examples:

- A waitlisted member is placed into their requested league.
- A temporary sabbatical-fill spot is accepted.
- Staff completes JR financial assistance review.
- Staff finalizes a registration with previously pending placement decisions.

The payment calculation must use the existing fee calculation service from
previous phases.

---

## Waitlist rollover

Implement or expose staff controls for automatic rollover.

Rollover should occur when successor leagues are configured and a new session is
being prepared.

For each active waitlist entry on a predecessor league:

- Create or update the corresponding active waitlist entry on the successor
  league.
- Preserve ordering.
- Preserve decline count.
- Preserve `ADD` or `REPLACE` type where valid.
- Preserve replacement league where valid, or flag for staff review if not.
- Link the new entry to the prior entry if the data model supports lineage.
- Audit the rollover.

Rollover must be idempotent.

Running rollover twice must not duplicate entries.

---

## Audit log requirements

Every waitlist mutation must be audited.

Audit these actions at minimum:

- Waitlist entry created.
- Waitlist entry removed.
- Waitlist entry reordered.
- Waitlist entry moved to bottom.
- Waitlist entry rolled over.
- Waitlist entry converted from `ADD` to `REPLACE`.
- Waitlist entry converted from `REPLACE` to `ADD`.
- Replacement league changed.
- Decline count changed.
- Offer sent.
- Offer accepted.
- Offer auto-accepted after deadline.
- Offer declined.
- Offer cancelled.
- Permanent placement created from waitlist.
- Temporary sabbatical-fill placement created.
- Waitlist entry deactivated after permanent placement.
- Staff override applied.

Audit records should be easily viewable by staff from the per-league waitlist
manager.

---

## User experience requirements

Staff pages should favor clarity over density.

Important labels must be explicit:

- Permanent vacancy.
- Temporary sabbatical-fill vacancy.
- ADD waitlist.
- REPLACE waitlist.
- Pending offer.
- Auto-accepts at deadline.
- Payment pending.
- Ineligible.
- Needs cleanup.

Dangerous actions should require confirmation.

Examples:

- Removing someone from a waitlist.
- Moving someone to the bottom.
- Marking an offer declined.
- Cancelling an offer.
- Reordering the waitlist.
- Releasing a replaced league placement.

---

## Implementation steps

### Step 1: Inspect existing models and services

Review existing code for:

- Registration models.
- League models.
- Waitlist models.
- Sabbatical models.
- Payment/invoice services.
- Email service.
- RBAC/permissions.
- Audit logging utilities.
- Background job/scheduled task system.

Do not duplicate existing abstractions.

### Step 2: Add missing offer/audit data structures

If needed, add migrations for:

- Waitlist offers.
- Additional audit fields.
- Rollover lineage fields.
- Offer status fields.

Keep schema changes minimal and aligned with previous phases.

### Step 3: Build waitlist query/service layer

Create services for:

- League vacancy calculation.
- Active waitlist lookup.
- Top N eligible waitlist entries.
- Offer validation.
- Offer creation.
- Offer acceptance.
- Offer decline.
- Offer auto-acceptance.
- Waitlist rollover.
- Waitlist audit creation.

Business logic belongs in services, not UI components.

### Step 4: Build staff dashboard

Create the staff overview page showing leagues, vacancies, waitlist counts, and
warnings.

### Step 5: Build per-league waitlist manager

Create the detailed per-league page with roster, waitlist entries, offer state,
actions, and audit history.

### Step 6: Implement offer emails

Use existing email infrastructure.

Include clear no-response-means-acceptance language.

### Step 7: Implement 24-hour auto-acceptance

Use the app's existing scheduled job/background task mechanism.

The job should:

- Find pending offers past deadline.
- Mark them `EXPIRED_ACCEPTED`.
- Place the user.
- Audit the action.
- Trigger payment workflow if appropriate.
- Be idempotent.

### Step 8: Implement manual staff actions

Implement staff actions with confirmation, reason capture, validation, and audit
logging.

### Step 9: Implement waitlist rollover

Add staff-triggered or system-triggered rollover.

Ensure it is idempotent and audited.

### Step 10: Add tests

Add unit, integration, and permission tests for Phase 8 behavior.

Update `docs/registration/test-matrix.md`.

---

## Acceptance criteria

Phase 8 is complete when:

- Staff can view waitlists for each standard league.
- Staff can see permanent and temporary vacancies.
- Staff can send offers to top eligible waitlist entries.
- Staff can distinguish permanent offers from temporary sabbatical-fill offers.
- Offer emails clearly explain that no response within 24 hours means
  acceptance.
- Staff can mark offers accepted or declined.
- Pending offers auto-accept after 24 hours.
- First decline preserves position.
- Second decline moves the person to the bottom.
- Decline counts are scoped to the waitlist instance.
- Permanent placements remove/deactivate the accepted waitlist entry.
- Temporary sabbatical-fill placements keep the waitlist entry active.
- REPLACE placements release the replaced league placement.
- Staff can perform manual waitlist changes with required reasons.
- All waitlist mutations are audited.
- Waitlist rollover to successor leagues works and is idempotent.
- Staff can trigger payment links for ready deferred registrations.
- BYOT leagues are excluded from waitlist operations.
- RBAC prevents unauthorized access.
- Tests cover the major workflows.

---

## Testing requirements

Add tests for at least:

1. Staff permission checks.
2. League vacancy calculation.
3. Sending permanent offers.
4. Sending temporary sabbatical-fill offers.
5. Offer decline first time.
6. Offer decline second time.
7. Offer auto-accept after 24 hours.
8. Permanent placement from accepted offer.
9. Temporary placement from accepted offer.
10. REPLACE placement releasing replaced league.
11. ADD cleanup required after reaching 2 leagues.
12. Waitlist rollover preserving order.
13. Waitlist rollover preserving decline counts.
14. Waitlist rollover idempotency.
15. Manual waitlist removal audit.
16. Manual waitlist reorder audit.
17. Offer cancellation audit.
18. Unauthorized staff access denied.
19. BYOT leagues excluded from waitlist offers.
20. Deferred payment link triggered after placement.

---

## Handoff to Phase 9

After Phase 8, Phase 9 can build member-facing account pages and communications.

Phase 8 should provide reusable services/API endpoints so Phase 9 can show:

- Member waitlist positions.
- Pending offers, if desired.
- Confirmed placements.
- Temporary sabbatical-fill status.
- Payment links.
- Registration status.

Phase 8 should also document:

- Waitlist offer statuses.
- Placement statuses.
- Audit event names.
- Any known manual staff workflows.