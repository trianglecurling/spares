# Phase 7: Submission & Checkout

## Purpose

Phase 7 converts a completed registration draft into a submitted registration and,
when appropriate, sends the registrant through Stripe Checkout.

This phase is responsible for:

- Final registration review
- Submission validation
- Invoice/line-item snapshotting
- Immediate vs deferred payment decisions
- Stripe Checkout creation for immediate-payment registrations
- Stripe webhook handling for completed or failed checkout
- Confirmation state updates
- Minimal confirmation emails or existing email hooks, if available

This phase is not responsible for staff waitlist management, waitlist offers,
third-league placement, Junior Recreational financial assistance decisions, or
member account pages. Those belong to later phases.

---

## Authoritative references

Before implementing this phase, read:

- `docs/registration/rules.md`
- `docs/registration/data-model.md`
- `docs/registration/fee-calculation.md`
- `docs/registration/eligibility.md`
- `docs/registration/waitlists.md`
- `docs/registration/sabbaticals.md`
- `docs/registration/user-flow.md`
- `docs/registration/test-matrix.md`

If there is a conflict between this file and `rules.md`, `rules.md` wins.

If there is a conflict between existing code and the docs, stop and ask for
clarification before changing behavior.

---

## Scope

### In scope

Phase 7 includes:

1. A final registration review screen.
2. A registration submission endpoint/action.
3. Submission-time validation.
4. Creation of finalized or pending registration billing records.
5. Creation of Stripe Checkout Sessions for immediate-payment registrations.
6. Stripe webhook handling for checkout completion.
7. Registration status transitions caused by submission and payment.
8. Idempotency protections for submission and Stripe webhooks.
9. Minimal confirmation messaging and/or email integration if the app already has
   an email mechanism.
10. Tests for immediate payment, deferred payment, no-payment registration, and
    Stripe webhook behavior.

### Out of scope

Phase 7 must not implement:

- Staff waitlist manager
- Staff offer workflow
- Waitlist offer emails
- Waitlist accept/decline behavior
- Third-league placement logic
- Junior Recreational assistance decision UI
- Full member registration dashboard
- Refund tools
- Staff billing adjustment tools
- Manual roster correction tools

Those are later phases.

---

## Required outcomes

After Phase 7, a user who has completed all prior registration steps should be
able to review and submit the registration.

Submission should result in exactly one of the following outcomes.

### 1. Immediate checkout

Used when everything in the registration can be confirmed now and there are no
deferral reasons.

Examples:

- Social membership only
- Regular membership plus one or two guaranteed returning leagues
- Regular membership plus spare-only ice privilege
- Junior Recreational with no financial assistance request
- BYOT request that is treated as payable now
- Sabbatical-only registration with no other pending/non-guaranteed items

Behavior:

1. Registration is submitted.
2. Billing line items are snapshotted.
3. A Stripe Checkout Session is created.
4. User is redirected to Stripe.
5. Registration is not confirmed as paid until Stripe confirms payment.
6. On successful payment, registration is marked paid/confirmed.
7. On failed/incomplete payment, registration remains unpaid and unconfirmed.

### 2. Deferred payment

Used when the final amount or placement is not fully known yet.

Deferral reasons include:

- Any waitlisted league request
- Any non-guaranteed league request
- Any third-league interest
- Junior Recreational financial assistance request
- Staff placement/review required
- Any other rule engine deferral reason

Behavior:

1. Registration is submitted.
2. Billing line items are snapshotted as pending/draft/provisional.
3. No Stripe Checkout Session is created.
4. Registration status becomes awaiting placement, awaiting staff review, or
   awaiting deferred payment depending on existing status terminology.
5. User sees a clear message explaining why payment is deferred.
6. Staff can later resolve the pending items and send a payment link in a later
   phase.

### 3. No payment required

Used when registration creates no current payable charges.

Example:

- New user/account joins one or more waitlists only

Behavior:

1. Registration is submitted.
2. No Stripe Checkout Session is created.
3. No invoice is required unless the existing app expects a zero-dollar invoice.
4. Registration is marked submitted/complete for now.
5. User sees confirmation explaining that no payment is due now.

---

## Important business rules

### One registration per curler

Each submitted registration is for exactly one curler.

A parent or another user may submit and pay on behalf of that curler, but the
registration itself belongs to the curler.

### Returning members

Returning members must already be authenticated by the time they reach Phase 7.

Do not allow a returning-member draft to submit unless the required login and
curler identity are already resolved.

### Policy acceptance

Do not allow submission unless the required policies have been accepted:

- Code of Conduct
- Minor Athlete Abuse Prevention Policy
- Privacy Policy

The registrant accepts policies on behalf of the curler being registered.

### Minor registration

If the curler is under 18, required parent/guardian information must be present
before submission.

### Eligibility must be rechecked

All eligibility must be rechecked at submission time.

Do not trust only the UI state from prior steps.

At minimum, recheck:

- Registration is open or priority as required
- User is eligible for selected membership/program choices
- League age requirements
- League experience requirements
- Junior Recreational exclusivity
- BYOT cannot be a third league
- BYOT teammate text is provided when required
- Sabbatical eligibility
- Sabbatical duration limit, unless staff override exists
- Maximum two protected return/sabbatical claims
- ADD waitlist eligibility
- REPLACE waitlist limit
- Required replacement league for REPLACE entries
- Third-league interest rules
- Discount self-report fields

### Fees must be recalculated at submission

Fees displayed during prior steps are estimates until submission.

On submission, the system must use the canonical fee calculator to recalculate
and snapshot:

- Membership charges
- Social membership charges
- Regular membership charges
- League fees
- BYOT league fees
- Spare-only ice privilege fee
- Sabbatical fees
- Junior Recreational fee
- Student discount
- Reciprocal discount
- Winter-only discount
- Sabbatical-fill discount, if applicable
- Junior Recreational financial assistance effect, if already decided

Do not duplicate fee logic in the UI.

### Payment decision must come from the rule engine

The immediate/deferred/no-payment decision must be made by the canonical
registration/payment decision service.

Do not duplicate this decision in the UI.

---

## Review screen requirements

The review screen is the last screen before submission.

It must be clear and concise.

The review screen should show:

1. Curler identity
2. Membership or program selection
3. Ice privilege selection, if any
4. Guaranteed leagues
5. Sabbaticals
6. Waitlist ADD entries
7. Waitlist REPLACE entries
8. Third-league interest, ordered
9. BYOT requests and teammate text
10. Discounts
11. Financial assistance request, if applicable
12. Itemized charges
13. Total amount due now, if any
14. Whether payment is due now or deferred
15. Why payment is deferred, if applicable

Use explicit status labels.

Recommended labels:

- `Confirmed now`
- `Payable now`
- `Payment required now`
- `Payment deferred`
- `On waitlist`
- `Subject to availability`
- `Subject to staff placement`
- `Third-league interest only`
- `Sabbatical`
- `No payment due now`

Avoid vague labels such as:

- `Pending`
- `Selected`
- `Registered`

unless they are accompanied by an explanation.

---

## Submission behavior

Submission must be transactional where possible.

A successful submission should perform these steps:

1. Load the registration draft.
2. Verify the current user may submit it.
3. Verify the registration is still in a submittable state.
4. Re-run policy, demographic, membership, eligibility, league, sabbatical,
   waitlist, and discount validation.
5. Recalculate fees.
6. Recalculate payment decision.
7. Snapshot registration selections.
8. Create or update league registration/selection records.
9. Create or update sabbatical records as required.
10. Create or update waitlist entries as required.
11. Audit all waitlist mutations.
12. Create invoice/payment records.
13. Transition registration to the correct submitted status.
14. If immediate payment is required, create a Stripe Checkout Session.
15. Return the next action to the UI:
    - redirect to Stripe
    - show deferred confirmation
    - show no-payment confirmation

If any step fails, the registration should not be partially submitted unless the
system can safely resume or retry.

---

## Registration status transitions

Use existing status names if the app already has them. If not, the following
conceptual statuses are recommended.

### Draft statuses

- `draft`
- `ready_for_review`

### Submitted statuses

- `submitted_awaiting_payment`
- `submitted_awaiting_placement`
- `submitted_awaiting_staff_review`
- `submitted_no_payment_due`

### Payment statuses

- `checkout_created`
- `paid`
- `payment_failed`
- `payment_expired`

### Final/correction statuses

- `confirmed`
- `cancelled`
- `staff_adjusted`

The exact enum values may differ, but the system must be able to distinguish:

1. Not submitted
2. Submitted but unpaid
3. Submitted and deferred
4. Submitted with no payment due
5. Paid
6. Confirmed
7. Cancelled

---

## Immediate payment registrations

For immediate-payment registrations:

1. Create a Stripe Checkout Session using the existing checkout pipeline.
2. Include enough metadata to identify:
   - registration ID
   - invoice/payment record ID
   - curler user/profile ID
   - submitting user ID
3. Redirect the user to Stripe Checkout.
4. Do not mark the registration paid until the webhook confirms payment.
5. If the user abandons checkout, registration remains submitted but unpaid.
6. If payment fails, registration remains unpaid and unconfirmed.
7. Staff can resolve payment issues manually later if needed.

### Stripe line items

Use the existing app's Stripe approach.

If the app uses dynamic prices, generate line items from the snapshotted invoice.

If the app uses configured Stripe prices, map invoice line items to configured
Stripe prices.

In either case, the internal invoice snapshot is the source of truth for what the
club intended to charge.

### Stripe metadata

Stripe Checkout metadata must include internal IDs sufficient for webhook
reconciliation.

Recommended metadata:

- `registrationId`
- `invoiceId`
- `curlerUserId`
- `submittedByUserId`
- `seasonId`
- `sessionId`

Do not put sensitive personal information in Stripe metadata.

---

## Deferred payment registrations

For deferred-payment registrations:

1. Create the submitted registration.
2. Snapshot current provisional charges if useful.
3. Record the deferral reason or reasons.
4. Do not create a Stripe Checkout Session.
5. Show the user a clear confirmation message.
6. Staff will finalize placement and payment in a later phase.

Possible deferral reasons:

- `WAITLIST`
- `NON_GUARANTEED_LEAGUE`
- `THIRD_LEAGUE_INTEREST`
- `JR_FINANCIAL_ASSISTANCE_REVIEW`
- `STAFF_PLACEMENT_REQUIRED`
- `OTHER`

The user-facing explanation should be plain language.

Example:

> Your registration has been submitted. You do not need to pay today because one
> or more of your league choices requires placement review. We will email you
> when your registration is ready for payment.

---

## No-payment registrations

For no-payment registrations:

1. Submit the registration.
2. Create waitlist entries or other records as needed.
3. Do not create a Stripe Checkout Session.
4. Show confirmation.

Example message:

> Your registration has been submitted. No payment is due at this time. We will
> email you if a league spot becomes available.

---

## Waitlist mutations during submission

If submission creates, updates, removes, rolls over, or reclassifies any waitlist
entry, the change must be audited.

Audit records should capture:

- Waitlist entry ID
- League ID
- Curler/user ID
- Previous state
- New state
- Actor user ID, if applicable
- Whether the actor was the system or a user
- Source registration ID
- Reason
- Timestamp

Examples of reasons:

- `REGISTRATION_SUBMITTED`
- `WAITLIST_ADD_CREATED`
- `WAITLIST_REPLACE_CREATED`
- `WAITLIST_ENTRY_REMOVED_BY_REGISTRANT`
- `ADD_CONVERTED_TO_REPLACE`
- `WAITLIST_ENTRY_UPDATED_FROM_REGISTRATION`

Every waitlist mutation must have an audit record, including automatic changes.

---

## Sabbatical records during submission

If the registration includes sabbatical choices, submission should create or
update sabbatical records.

Rules:

- Sabbatical-only registrations do not require regular membership.
- Sabbaticals count toward the maximum of two protected claims.
- Sabbaticals require guaranteed-return eligibility.
- Sabbaticals may only be requested during priority registration.
- Sabbaticals cannot be requested for BYOT leagues.
- Sabbaticals cannot be requested for temporary sabbatical-fill spots.
- Sabbatical fee is never discounted.
- If no other non-guaranteed items exist, sabbatical-only payment is immediate.
- If other non-guaranteed items exist, payment may be deferred with the rest of
  the registration.

---

## Idempotency requirements

### Submission idempotency

A user may double-click submit, refresh, or retry after a network error.

The submission endpoint/action must be idempotent.

Required behavior:

- Submitting the same registration twice must not create duplicate invoices.
- Submitting the same registration twice must not create duplicate waitlist
  entries.
- Submitting the same registration twice must not create duplicate sabbatical
  records.
- Submitting the same immediate-payment registration twice must not create
  multiple active Stripe Checkout Sessions unless the existing one is expired or
  explicitly abandoned according to existing checkout rules.

Recommended approach:

- Use a registration-level submission lock or transaction.
- Use unique constraints where appropriate.
- Store the created invoice/payment record.
- Store the Stripe Checkout Session ID.
- If a valid checkout session already exists, return it instead of creating a
  new one.

### Stripe webhook idempotency

Stripe may deliver the same webhook more than once.

Webhook processing must be idempotent.

Required behavior:

- Processing the same successful checkout event twice must not double-confirm
  the registration.
- Processing the same successful checkout event twice must not duplicate league
  records.
- Processing the same successful checkout event twice must not duplicate email
  sends if avoidable.
- Webhook event IDs should be stored or otherwise safely deduplicated.

---

## Stripe webhook handling

At minimum, handle the successful checkout event used by the existing app.

Usually this is:

- `checkout.session.completed`

Depending on the existing checkout pipeline, also handle or already support:

- expired checkout sessions
- async payment success/failure, if enabled
- payment intent failure, if relevant

On successful checkout:

1. Verify the webhook signature.
2. Extract metadata.
3. Load the invoice/payment record.
4. Verify the amount/currency if available.
5. Mark invoice/payment as paid.
6. Mark registration as paid.
7. Confirm registration items that are payable/confirmed now.
8. Send or queue payment confirmation email if email infrastructure exists.
9. Record payment timestamp and Stripe IDs.

Do not trust client-side success redirects as proof of payment.

The success redirect may show a "payment processing" page, but the webhook is the
source of truth.

---

## Confirmation after payment

After payment succeeds, mark the immediate-payment registration as confirmed.

Confirmed items may include:

- Social membership
- Regular membership
- Spare-only ice privileges
- Guaranteed standard leagues
- BYOT requests treated as payable now
- Junior Recreational registration without assistance
- Sabbaticals

Important:

BYOT requests are treated as payable now, but staff may later determine a person
does not have a BYOT spot and issue a manual refund. Do not implement the refund
workflow in this phase.

---

## Client success and cancel URLs

Stripe Checkout should redirect to existing app routes.

Recommended routes:

- Success: registration payment status page
- Cancel: registration payment cancelled page or registration review page

The success page must not claim payment is final unless webhook-confirmed status
is already known.

Recommended success page language before webhook confirmation:

> Your payment was submitted. We are confirming it with Stripe. This usually
> takes a few moments.

Recommended cancel page language:

> Checkout was not completed. Your registration is not confirmed until payment is
> completed.

---

## Error handling

Submission errors should be user-actionable when possible.

Examples:

- "Registration is currently closed."
- "This league is no longer available for this registration type."
- "Please provide teammate names for this bring-your-own-team league."
- "Please resolve your waitlist choices before continuing."
- "Please provide the required student institution."
- "Please provide the required reciprocal club."
- "Your registration needs to be reviewed by staff before payment."

Internal errors should be logged with enough context for staff/developers to
investigate.

Do not expose stack traces or internal IDs unnecessarily to users.

---

## Security requirements

- Only an authorized submitting user may submit a registration.
- A user may not submit another user's registration unless delegated/authorized.
- Stripe webhook signature verification is required.
- Do not store sensitive payment card data.
- Do not put sensitive personal data in Stripe metadata.
- Server-side validation must enforce all rules.
- Client-side validation is only for usability.

---

## Minimal emails or notifications

If the app already has an email system, send or queue these emails:

1. Registration submitted, payment deferred
2. Registration submitted, no payment due
3. Payment confirmed

If email integration is not ready or belongs to a later phase, create the
appropriate hooks/events so Phase 9 can add the emails cleanly.

Do not block successful submission solely because a non-critical email fails.

---

## Implementation checklist

### Review UI

- [ ] Add final review screen.
- [ ] Show curler identity.
- [ ] Show membership/program choice.
- [ ] Show league selections grouped by status.
- [ ] Show sabbaticals.
- [ ] Show waitlist ADD entries.
- [ ] Show waitlist REPLACE entries.
- [ ] Show ordered third-league interest.
- [ ] Show BYOT teammate text.
- [ ] Show discounts and required self-report info.
- [ ] Show itemized charges.
- [ ] Show total due now or payment deferred explanation.
- [ ] Show clear submit/checkout button.

### Submission backend

- [ ] Add submission endpoint/action.
- [ ] Enforce authorization.
- [ ] Enforce submittable registration status.
- [ ] Re-run all validation.
- [ ] Recalculate fees.
- [ ] Recalculate payment decision.
- [ ] Snapshot invoice/line items.
- [ ] Persist selections.
- [ ] Persist waitlist entries.
- [ ] Audit waitlist mutations.
- [ ] Persist sabbaticals.
- [ ] Transition registration status.
- [ ] Return next action to UI.

### Immediate checkout

- [ ] Create Stripe Checkout Session.
- [ ] Store Stripe session ID.
- [ ] Include safe metadata.
- [ ] Redirect user to Stripe.
- [ ] Reuse existing valid checkout session on retry.
- [ ] Do not mark paid until webhook.

### Deferred payment

- [ ] Do not create Stripe Checkout Session.
- [ ] Store deferral reasons.
- [ ] Show confirmation.
- [ ] Make registration visible to staff if existing staff screens support it.

### No payment due

- [ ] Do not create Stripe Checkout Session.
- [ ] Show no-payment confirmation.
- [ ] Ensure waitlist records are created if applicable.

### Webhooks

- [ ] Verify Stripe webhook signature.
- [ ] Handle checkout completion.
- [ ] Deduplicate webhook events.
- [ ] Verify payment amount/currency if available.
- [ ] Mark invoice/payment paid.
- [ ] Mark registration paid/confirmed.
- [ ] Trigger confirmation notification/hook.

### Tests

- [ ] Unit tests for payment decision integration.
- [ ] Integration tests for immediate checkout.
- [ ] Integration tests for deferred submission.
- [ ] Integration tests for no-payment submission.
- [ ] Integration tests for Stripe webhook success.
- [ ] Idempotency tests for double submission.
- [ ] Idempotency tests for duplicate webhook delivery.
- [ ] Authorization tests.

---

## Acceptance criteria

Phase 7 is complete when:

1. A completed registration draft can be reviewed.
2. The review screen clearly distinguishes confirmed, waitlisted, sabbatical,
   BYOT, third-league interest, deferred, and payable items.
3. Submitting a registration revalidates all rules server-side.
4. Submitting a registration snapshots fees and discounts.
5. Immediate-payment registrations create Stripe Checkout Sessions.
6. Deferred-payment registrations do not create Stripe Checkout Sessions.
7. No-payment registrations do not create Stripe Checkout Sessions.
8. Stripe webhook success marks payment as paid.
9. Client-side redirects alone do not mark payment as paid.
10. Double submission does not create duplicate invoices, waitlist entries,
    sabbaticals, or checkout sessions.
11. Duplicate Stripe webhooks do not duplicate effects.
12. Waitlist mutations caused by submission are audited.
13. Failed or incomplete checkout leaves the registration unpaid and unconfirmed.
14. The implementation includes tests for all major submission/payment outcomes.

---

## Required test cases

Add or verify tests for the following cases.

### Immediate payment

1. Social membership only submits and creates Stripe Checkout.
2. Regular membership plus spare-only submits and creates Stripe Checkout.
3. Returning member with one guaranteed league submits and creates Stripe
   Checkout.
4. Returning member with two guaranteed leagues submits and creates Stripe
   Checkout.
5. Sabbatical-only registration submits and creates Stripe Checkout for
   sabbatical fee only.
6. Junior Recreational with no assistance request submits and creates Stripe
   Checkout.
7. BYOT request submits and creates Stripe Checkout.

### Deferred payment

1. Registration with waitlist ADD submits with payment deferred.
2. Registration with waitlist REPLACE submits with payment deferred.
3. Registration with third-league interest submits with payment deferred.
4. Junior Recreational with financial assistance request submits with payment
   deferred.
5. Guaranteed league plus non-guaranteed league request submits with payment
   deferred.
6. Sabbatical plus waitlist request submits with payment deferred.

### No payment due

1. New user joins waitlist only and no checkout is created.
2. Existing user joins waitlist only and no checkout is created.

### Validation failures

1. Submit fails if policies are not accepted.
2. Submit fails if minor parent/guardian information is missing.
3. Submit fails if registration is closed.
4. Submit fails if BYOT teammate text is missing.
5. Submit fails if BYOT is selected as a third league.
6. Submit fails if required student institution is missing.
7. Submit fails if required reciprocal club is missing.
8. Submit fails if REPLACE waitlist entry has no replacement league.
9. Submit fails if more than two REPLACE waitlists are active.
10. Submit fails if more than two protected return/sabbatical claims are
    selected.

### Stripe/webhook behavior

1. Checkout creation stores Stripe session ID.
2. Successful webhook marks invoice paid.
3. Successful webhook marks registration paid/confirmed.
4. Duplicate webhook does not duplicate effects.
5. Client success redirect does not mark registration paid by itself.
6. Cancelled checkout leaves registration unpaid and unconfirmed.
7. Failed checkout leaves registration unpaid and unconfirmed.

### Idempotency

1. Double-clicking submit creates only one invoice.
2. Double-clicking submit creates only one set of waitlist entries.
3. Double-clicking submit creates only one set of sabbatical records.
4. Double-clicking submit reuses an existing active checkout session when
   appropriate.
5. Retrying deferred submission does not duplicate deferred invoice records.

---

## Handoff to Phase 8

At the end of Phase 7, provide a handoff note describing:

1. Registration statuses created or changed.
2. Invoice/payment tables or records created.
3. How deferred registrations are represented.
4. How waitlist entries are created during submission.
5. How waitlist audit records are written.
6. How staff can identify registrations needing placement/review.
7. How to generate payment links later, if already partially supported.
8. Any known limitations or TODOs for staff processing.

Phase 8 will build staff placement, waitlist management, offer handling, and
deferred payment link generation.