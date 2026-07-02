<!-- docs/registration/phases/phase-10-hardening.md -->

# Phase 10: Hardening, Validation, and Launch Readiness

## Purpose

Phase 10 is the final hardening phase before registration is released for live member use.

Phases 0-9 implemented the registration system. Phase 10 is not intended to add major new features. Its purpose is to verify correctness, reduce launch risk, improve operational safety, and ensure staff can successfully run registration for a real session.

This phase is especially important because registration:

- Will be used by approximately 400 people multiple times per year.
- Will process significant annual revenue.
- Contains complex eligibility, placement, waitlist, sabbatical, discount, and payment rules.
- Requires staff intervention and judgment in some workflows.
- Must be trustworthy for members and administrators.

## Phase 10 goals

By the end of Phase 10:

1. Registration rules should be verified against realistic scenarios.
2. Payment behavior should be tested end-to-end in Stripe test mode.
3. Staff workflows should be tested with realistic data.
4. Waitlist behavior should be audited and validated.
5. Registration launch, pause, close, and recovery procedures should be documented.
6. Staff should have a clear operational checklist.
7. Known risks should either be fixed or explicitly accepted.
8. The system should be ready for a controlled production launch.

## Out of scope

Phase 10 should avoid introducing new registration features unless a defect or launch blocker requires it.

Out of scope unless explicitly approved:

- New registration flow steps.
- New discount types.
- New league placement algorithms.
- New payment models.
- New member self-service change workflows.
- Major refactors unrelated to launch safety.
- Nonessential UI redesign.

## Prerequisites

Before beginning Phase 10, the following should already be complete:

- Registration rules documentation exists.
- Data model and migrations are complete.
- Admin configuration screens exist.
- Eligibility and fee calculation services exist.
- Registration workflow is implemented.
- League selection, sabbaticals, waitlists, BYOT, Junior Recreational, and third-league interest are implemented.
- Stripe checkout and deferred payment links are implemented.
- Staff waitlist and placement tooling exists.
- Member-facing registration status views exist.
- Registration emails exist.
- `docs/registration/test-matrix.md` exists.
- `docs/registration/launch-readiness.md` should be used as the operational
  sign-off checklist during Phase 10 execution.

## Workstreams

Phase 10 should be executed as several focused hardening workstreams.

---

# Workstream 1: Rule verification pass

## Objective

Verify that the implemented system matches the documented registration rules.

## Tasks

- Review `docs/registration/rules.md`.
- Review `docs/registration/test-matrix.md`.
- Confirm every major rule has at least one automated or manual test.
- Confirm no business rule exists only in UI code.
- Confirm backend/server-side validation protects all critical rules.
- Confirm staff overrides are intentional, permission-protected, and audited where required.
- Confirm error messages are clear when a registrant is blocked.

## Areas to verify

- Membership year and fiscal year behavior.
- Priority/open/closed registration behavior.
- Returning member login requirement.
- Policy acceptance.
- Registering on behalf of another curler.
- Minor parent/guardian requirements.
- Social membership behavior.
- Regular membership behavior.
- Spare-only behavior.
- Junior Recreational behavior.
- Junior Advanced Commitment behavior.
- Experience eligibility.
- Age eligibility.
- League capacity handling.
- Guaranteed returns.
- Sabbaticals.
- Sabbatical duration limits.
- Sabbatical-fill spots.
- Waitlist ADD behavior.
- Waitlist REPLACE behavior.
- Waitlist rollover.
- Third-league interest.
- BYOT league behavior.
- Discounts.
- Immediate vs deferred payment.
- Staff waitlist operations.
- Audit logging.

## Acceptance criteria

- Each documented rule is covered by either automated tests or a documented manual test.
- Any uncovered rule is added to `docs/registration/test-matrix.md`.
- Any implementation mismatch is fixed or documented as an accepted launch exception.
- Critical validations exist server-side, not only client-side.

---

# Workstream 2: Automated test expansion

## Objective

Increase confidence in the most failure-prone areas through automated tests.

## Priority test areas

Automated coverage should be strongest for:

1. Fee calculation.
2. Discount application.
3. Payment deferral decisions.
4. League eligibility.
5. Returning-member guarantees.
6. Sabbatical eligibility and expiration.
7. Waitlist state transitions.
8. Waitlist audit logging.
9. Registration status transitions.
10. Stripe webhook handling.

## Required test categories

### Unit tests

Unit tests should cover pure business logic, especially:

- Eligibility service.
- Returning rights service.
- Fee calculator.
- Payment decision service.
- Waitlist state transition helpers.
- Sabbatical duration calculations.

### Integration tests

Integration tests should cover complete workflows involving multiple system areas:

- Registration submission.
- Payment creation.
- Deferred payment creation.
- Waitlist entry creation.
- Sabbatical creation.
- Staff offer creation.
- Offer acceptance.
- Offer decline.
- Stripe webhook completion.

### Permission tests

Permission tests should verify that:

- Anonymous visitors cannot access protected registration records.
- Users cannot view or modify another curler’s registration unless authorized.
- Delegated impersonation works where intended.
- Staff-only actions require the correct role.
- Waitlist management requires staff permissions.
- Audit history is visible only to authorized staff.

## Acceptance criteria

- Tests exist for high-risk business rules.
- Tests are deterministic.
- Tests do not depend on live Stripe.
- Tests can be run locally and in CI.
- Critical payment and waitlist tests pass before launch.

---

# Workstream 3: Stripe and payment hardening

## Objective

Verify that immediate and deferred payment flows are safe, accurate, and recoverable.

## Tasks

- Test Stripe checkout in test mode.
- Test Stripe webhook success behavior.
- Test abandoned checkout behavior.
- Test failed payment behavior.
- Test duplicate webhook delivery.
- Test payment link generation for deferred registrations.
- Test that unpaid registrations are not marked paid.
- Test that failed immediate payment does not confirm registration.
- Test that payment amounts match registration line items.
- Test that discount line items are understandable.
- Test that sabbatical fees are not discounted.
- Test that social membership is not discounted.
- Test that winter-only discount applies only to regular membership.
- Test that sabbatical-fill discount is applied separately and correctly.

## Required Stripe scenarios

- Immediate payment succeeds.
- Immediate payment fails.
- Checkout session expires or is abandoned.
- Webhook is delivered twice.
- Deferred payment link is created.
- Deferred payment succeeds.
- Deferred payment fails.
- Staff resends deferred payment link.
- Registration is canceled before deferred payment.
- Stripe amount equals internal invoice amount.

## Acceptance criteria

- Payment state transitions are idempotent.
- Duplicate Stripe webhooks do not duplicate payments or confirmations.
- Staff can identify unpaid, paid, deferred, and failed registrations.
- Payment failure leaves the registration in a safe, understandable state.
- Amounts in Stripe match the app’s internal calculation.

---

# Workstream 4: Staff operations rehearsal

## Objective

Verify that staff can run registration from configuration through post-priority placement.

## Rehearsal data

Create a realistic test data set including:

- Returning members.
- New members.
- Social members.
- Regular members.
- Junior Recreational registrants.
- Junior Advanced Commitment registrants.
- Members with prior league history.
- Members on existing sabbaticals.
- Members on existing waitlists.
- Members with no experience.
- Members with partial experience.
- Adult and junior curlers.
- Standard leagues.
- BYOT leagues.
- Instructional leagues.
- Full leagues.
- Leagues with vacancies.
- Leagues with temporary sabbatical vacancies.

## Staff rehearsal script

Staff should perform the following in a non-production or staging environment:

1. Configure a season.
2. Configure sessions.
3. Configure registration windows.
4. Configure prices and discounts.
5. Configure leagues.
6. Configure predecessor/successor league links.
7. Open priority registration.
8. Submit several returning-member registrations.
9. Submit several new-member registrations.
10. Submit a Junior Recreational financial assistance request.
11. Submit a BYOT registration.
12. Submit a spare-only registration.
13. Submit waitlist-only registrations.
14. Close priority registration.
15. Review league vacancies.
16. Resolve guaranteed returns and sabbaticals.
17. Send waitlist offers.
18. Process declines.
19. Process non-responses as acceptances.
20. Generate deferred payment links.
21. Review waitlist audit logs.
22. Confirm member-facing statuses are understandable.
23. Close registration.

## Acceptance criteria

- Staff can complete the rehearsal without developer intervention.
- Staff can identify where a registrant stands.
- Staff can understand why payment is immediate or deferred.
- Staff can process waitlists.
- Staff can send offers.
- Staff can recover from common user issues.
- Any confusing staff workflow is documented or improved before launch.

---

# Workstream 5: Email and communication hardening

## Objective

Ensure emails are clear, correct, and actionable.

## Emails to verify

- Registration submitted.
- Immediate payment confirmation.
- Deferred registration confirmation.
- Deferred payment link.
- Junior Recreational assistance pending.
- Junior Recreational assistance decision.
- Waitlist offer.
- Waitlist acceptance confirmation.
- Waitlist decline confirmation.
- Sabbatical confirmation.
- BYOT registration confirmation.
- Staff-adjusted registration notification, if implemented.
- Registration cancellation notification, if implemented.

## Required checks

Each email should be reviewed for:

- Correct recipient.
- Correct curler name.
- Correct league names.
- Correct session/season.
- Correct payment status.
- Clear call to action.
- Clear deadline, if applicable.
- No technical language.
- No misleading guarantee language.
- Support/contact instructions.

## Special waitlist offer language

Waitlist offer emails must clearly state:

> If you do not decline this offer within 24 hours, we will treat the offer as accepted and add you to the league. If payment is required, staff will follow up with you.

## Acceptance criteria

- Every email uses member-friendly language.
- Waitlist offer emails clearly explain automatic acceptance after 24 hours.
- Deferred payment emails clearly explain that placement/payment is not complete until payment is made, where applicable.
- Email previews or test sends are verified before launch.

---

# Workstream 6: Data migration and production readiness

## Objective

Ensure production has accurate starting data.

## Required production data

Before launch, verify:

- Fiscal year configuration.
- Membership season configuration.
- Active season.
- Active sessions.
- Registration state schedule.
- Pricing configuration.
- Discount configuration.
- League fees.
- League age limits.
- League experience requirements.
- League capacity.
- League first and last play dates.
- League predecessor/successor links.
- Existing user accounts.
- Existing member demographic data.
- Prior session league participation.
- Existing sabbaticals.
- Existing waitlists.
- Existing delegated impersonation relationships, where known.

## Data quality checks

Run checks for:

- Users without email addresses, if email is required.
- Duplicate users that may confuse returning-member login.
- Members without dates of birth.
- Members without emergency contact information.
- Minors without parent/guardian information.
- Leagues without first day of play.
- Leagues without last day of play.
- Leagues without fees.
- Leagues without capacity.
- Leagues with invalid age ranges.
- Leagues with invalid predecessor/successor links.
- Waitlist entries for ineligible users.
- Sabbaticals beyond the configured duration limit.
- Sabbaticals attached to non-sabbatical leagues.
- BYOT leagues incorrectly configured for waitlists or sabbaticals.
- Standard leagues missing waitlist settings.

## Acceptance criteria

- Production data is sufficient to open registration.
- Critical data quality issues are resolved before launch.
- Known non-critical data issues are documented.
- Staff has reviewed league and price configuration.

---

# Workstream 7: Observability, logging, and support tools

## Objective

Make sure staff and developers can diagnose registration issues quickly.

## Tasks

- Confirm registration status changes are logged or inspectable.
- Confirm payment events are logged.
- Confirm Stripe webhook processing failures are visible.
- Confirm waitlist audit logs are complete.
- Confirm staff can find a registration by curler name or email.
- Confirm staff can see why payment was deferred.
- Confirm staff can see registration line items.
- Confirm staff can see current waitlist position and history.
- Confirm staff can see who made a manual waitlist change.
- Confirm errors are not silently swallowed.

## Acceptance criteria

- A staff member can answer “What happened to this registration?” without developer database access in normal cases.
- A developer can debug payment/webhook issues from logs.
- Waitlist audit logs show what changed, why, when, and by whom when applicable.

---

# Workstream 8: Security and access control review

## Objective

Confirm registration data is protected.

## Tasks

- Review all registration routes.
- Review all API endpoints.
- Verify ownership checks.
- Verify delegated impersonation checks.
- Verify staff permission checks.
- Verify payment endpoints cannot be manipulated to change price.
- Verify users cannot submit league selections they are ineligible for by bypassing the UI.
- Verify users cannot access another curler’s registration.
- Verify users cannot alter waitlist position.
- Verify users cannot mark themselves as paid.
- Verify users cannot create unauthorized sabbaticals.
- Verify users cannot exceed waitlist limits by direct API calls.

## Acceptance criteria

- Critical registration actions are protected server-side.
- Client-side validation is treated only as UX, not security.
- Staff-only operations require staff permissions.
- Payment amounts are calculated server-side.

---

# Workstream 9: Performance and load sanity check

## Objective

Confirm the system behaves acceptably under expected registration load.

## Expected usage

The system is expected to support approximately 400 members, with spikes during registration opening.

## Tasks

- Test registration start under moderate concurrent usage.
- Test login/email code flow under registration load.
- Test league selection queries.
- Test waitlist position queries.
- Test registration submission.
- Test Stripe checkout creation.
- Review slow queries.
- Add indexes where needed.

## High-risk query areas

- Returning league eligibility.
- Waitlist position calculation.
- League capacity calculation.
- Registration dashboard counts.
- Staff waitlist views.
- Staff placement views.
- Audit log views.

## Acceptance criteria

- Common registration pages load quickly with realistic data.
- Staff waitlist views are usable with realistic data.
- No obvious N+1 query issues remain.
- Necessary indexes exist for registration, waitlist, league, and audit queries.

---

# Workstream 10: Launch, rollback, and contingency plan

## Objective

Ensure the club can safely launch registration and respond to problems.

## Launch checklist

Before opening registration:

- Confirm registration state is closed.
- Confirm season/session configuration.
- Confirm registration schedule.
- Confirm pricing.
- Confirm discounts.
- Confirm league settings.
- Confirm predecessor/successor links.
- Confirm Stripe is in live mode.
- Confirm webhook endpoint is configured.
- Confirm email sending is configured.
- Confirm staff roles are assigned.
- Confirm staff have completed rehearsal.
- Confirm support contact information is visible.
- Confirm backup/export of relevant data exists.
- Confirm developers/staff know how to pause registration.
- Confirm test registrations are not present in production.

## Go-live steps

1. Announce expected registration opening.
2. Confirm production configuration.
3. Enable monitoring/log review.
4. Open registration or allow scheduled transition.
5. Submit one controlled real registration, if appropriate.
6. Verify payment, email, and staff visibility.
7. Monitor errors and support requests.
8. Keep staff available during the first registration window.

## Pause plan

Staff must be able to quickly pause registration if a serious issue occurs.

A serious issue includes:

- Incorrect pricing.
- Incorrect discounts.
- Incorrect eligibility decisions.
- Payment failures affecting multiple users.
- Users accessing registrations they should not see.
- Waitlists being corrupted.
- Stripe webhook failure affecting confirmations.

When paused:

- Existing submitted registrations should remain intact.
- Users should see a clear message that registration is temporarily unavailable.
- Staff should be able to continue reviewing existing registrations if safe.

## Rollback/contingency plan

For launch, define:

- Who can pause registration.
- Who can communicate with members.
- Who can fix production data.
- Who can issue refunds.
- Who can manually place members.
- Who can resend payment links.
- How to export current registration data.
- How to reconstruct payment state from Stripe if needed.

## Acceptance criteria

- Staff know how to open and pause registration.
- Staff know who to contact for urgent issues.
- A clear member communication plan exists.
- A serious issue can be contained without data loss.

---

# Final Phase 10 acceptance criteria

Phase 10 is complete when all of the following are true:

- The test matrix has been reviewed and updated.
- Critical automated tests pass.
- Stripe test-mode payment flows have been verified.
- Staff has completed at least one realistic rehearsal.
- Email templates have been reviewed.
- Production data has been validated.
- Access control has been reviewed.
- Waitlist audit behavior has been verified.
- Launch checklist has been completed.
- Pause/rollback plan exists.
- `docs/registration/launch-readiness.md` has been completed or updated with
  accepted exceptions.
- Known issues are documented and classified.
- Staff and developers agree the system is ready for controlled launch.

## Known issue classification

Any unresolved issue should be classified as one of:

- **Launch blocker**: Must be fixed before registration opens.
- **High priority**: Should be fixed before launch unless explicitly accepted.
- **Medium priority**: Can launch with staff awareness or workaround.
- **Low priority**: Can be addressed after launch.
- **Enhancement**: Not required for V1.

## Recommended final sign-off

Before launch, obtain sign-off from:

- Product/application owner.
- Registration/club staff lead.
- Technical lead.
- Treasurer or payment/revenue owner, if applicable.

The sign-off should confirm:

- Pricing is correct.
- Payment behavior is correct.
- League configuration is correct.
- Staff can operate the system.
- Known risks are acceptable.