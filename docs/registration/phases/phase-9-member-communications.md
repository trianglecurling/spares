# Phase 9 — Member Communications

## Purpose

Phase 9 completes the user-facing communication layer for registration.

By the end of this phase, members should be able to understand their registration
status without contacting staff, receive clear email notifications at important
registration milestones, and take supported self-service actions such as viewing
waitlist position, removing themselves from waitlists, and accessing payment
links.

This phase should not change the core registration, placement, waitlist,
sabbatical, fee, or payment rules implemented in earlier phases. It should expose
those rules clearly to members and send accurate communications when important
events occur.

## Authoritative references

Before implementing this phase, read:

- `docs/registration/rules.md`
- `docs/registration/rules.md`
- `docs/registration/user-flow.md`
- `docs/registration/staff-operations.md`
- `docs/registration/waitlists.md`
- `docs/registration/sabbaticals.md`
- `docs/registration/fee-calculation.md`
- `docs/registration/eligibility.md`
- `docs/registration/business-logic.md`
- `docs/registration/test-matrix.md`

If there is a conflict between this file and the core registration rules, the
core rules win. If there is a conflict between this file and existing completed
Phase 0–8 implementation, stop and ask for clarification before changing
business logic.

## Scope

This phase includes:

1. Member-facing registration status pages.
2. Member-facing waitlist visibility.
3. Member-facing sabbatical visibility.
4. Member-facing payment link visibility.
5. Email notifications for registration and waitlist events.
6. Email templates and copy.
7. Email send triggers.
8. Email resend/retry affordances for staff where appropriate.
9. Basic communication audit/history visibility.
10. Self-service waitlist removal.

This phase excludes:

1. New registration rules.
2. New fee calculation rules.
3. New placement logic.
4. New staff placement workflows, except minor resend/view communication tools.
5. New checkout behavior, except displaying already-created payment links.
6. SMS or phone communications.
7. Complex notification preferences.
8. Automatic duplicate account resolution.
9. Refund workflows.

## Communication principles

All member communications must be:

- Clear.
- Short.
- Action-oriented.
- Consistent with the registration rules.
- Specific about what is confirmed and what is not confirmed.
- Explicit about whether payment is due now or later.
- Explicit about whether a league spot is guaranteed, waitlisted, temporary, or
  subject to staff placement.

Avoid ambiguous terms like:

- "registered" when the registration is only submitted but not paid.
- "accepted" when the member is only on a waitlist.
- "confirmed" when staff placement or payment is still pending.

Use clear status language:

- `Confirmed`
- `Awaiting payment`
- `Payment deferred`
- `On waitlist`
- `Subject to availability`
- `Third-league interest`
- `Temporary sabbatical-fill offer`
- `Sabbatical held`
- `Staff review required`
- `Financial assistance under review`

## Member account pages

### Registration dashboard

Create or update a member-facing account page where a member can see their
registration status.

This page should show current and recent registrations for the active season.

Each registration summary should include:

- Curler name.
- Season.
- Session, if applicable.
- Registration status.
- Payment status.
- Membership type or program.
- Whether payment is due now, deferred, completed, or not required.
- A payment link if payment is currently due.
- Submission date.
- Last updated date.

If the logged-in user can act on behalf of another curler through delegated
impersonation, the page should make it clear which curler each registration
belongs to.

### Registration detail page

Each registration should have a detail view.

The detail page should display:

#### Membership/program section

Show one of:

- Regular membership.
- Social membership.
- Junior Recreational Program.
- Other configured program/membership result as applicable.

Also show relevant items:

- Spare-only ice privileges, if purchased.
- Student discount, if claimed.
- Reciprocal discount, if claimed.
- Winter-only discount, if applied.
- Junior Recreational financial assistance status, if applicable.

Do not show internal implementation details.

#### League section

Group league-related items by status.

Recommended groups:

1. Confirmed leagues.
2. Sabbaticals.
3. Waitlists.
4. Third-league interest.
5. BYOT requests.
6. Not placed / dropped / declined, if relevant.

For each confirmed league, show:

- League name.
- Session.
- Status.
- Whether the spot is permanent or temporary sabbatical-fill.
- If temporary, clearly state that the original member may return in a future
  session and the spot is not guaranteed permanently.

For each sabbatical, show:

- League name.
- Session.
- Status.
- Sabbatical fee status.
- Plain-language explanation that the member is preserving their return right.
- If known/applicable, whether this sabbatical is approaching or at the
  configured duration limit.

For each waitlist entry, show:

- League name.
- Waitlist type:
  - `ADD`
  - `REPLACE`
- Waitlist position.
- Replacement league, if type is `REPLACE`.
- Decline count for the current waitlist instance.
- Whether the waitlist entry rolled over from a prior session, if this is useful
  and available.
- A self-service "Remove from waitlist" action.

For third-league interest, show:

- Ordered list of requested leagues.
- Explanation that these are not active guaranteed spots.
- Explanation that third-league placement is handled after first/second league
  demand is satisfied.
- Explanation that staff will follow up if a third-league placement is possible.

For BYOT requests, show:

- League name.
- Teammates text submitted by the registrant.
- Clear text that BYOT placement is coordinated by the league coordinator and
  may require staff follow-up.
- If already paid, explain that staff will contact the member if any adjustment
  is needed.

#### Payment section

Show:

- Current payment status.
- Amount paid, if available.
- Amount currently due, if available.
- Payment link, if currently available.
- Explanation for deferred payment, if payment is not currently available.

Common deferral reasons include:

- Awaiting waitlist or staff placement.
- Awaiting third-league placement decision.
- Awaiting Junior Recreational financial assistance decision.
- Awaiting staff review.
- No payment required because the registration only joined waitlists.

If payment failed or was abandoned, show:

- The registration is not confirmed as paid.
- A payment link if one is available.
- Instruction to contact staff if there is a payment problem.

#### Communication history section

Show a simple list of registration-related communications if the app already has
or can reasonably add this support.

For each message, show:

- Sent timestamp.
- Recipient email address.
- Message type.
- Delivery status, if available.
- Resend action for staff only, if appropriate.

Member visibility into communication history may be read-only. Staff may have
resend controls.

## Self-service waitlist removal

Members must be able to voluntarily remove themselves from a waitlist.

### Requirements

A member may remove their own active waitlist entry if:

- They are the curler; or
- They are acting through valid delegated impersonation for the curler.

When removing a waitlist entry:

- Show a confirmation prompt.
- Clearly state that removing the entry gives up the member's current waitlist
  position.
- If they later rejoin the waitlist, they will be added as a new entry according
  to current rules.
- After confirmation, mark the waitlist entry inactive/removed rather than
  deleting it.
- Audit the waitlist change.
- Send a confirmation email.

### Confirmation copy

Use plain language similar to:

```text
Are you sure you want to remove yourself from the waitlist for
[League Name]?

You will give up your current waitlist position. If you join this waitlist again
later, you will be added as a new entry.
```

## Email infrastructure

Use the existing app email infrastructure where possible.

Every registration email should have:

- A stable message type/key.
- Recipient email address.
- Associated curler/user where applicable.
- Associated registration where applicable.
- Associated league/waitlist/offer where applicable.
- Rendered subject.
- Rendered body or template data sufficient to reproduce/debug.
- Sent timestamp.
- Delivery status if available.
- Error/bounce information if available.

If the app already has a general email log, extend it. Do not create a parallel
system unless necessary.

## Required email types

### 1. Registration submitted — immediate payment required

Send when a registration is submitted and immediate payment is required.

Subject example:

```text
Complete your registration payment
```

Must include:

- Curler name.
- Season/session.
- Summary of selected membership/program/leagues.
- Amount due.
- Payment link.
- Statement that registration is not fully confirmed until payment is complete.
- Staff contact information.

### 2. Registration submitted — payment deferred

Send when a registration is submitted but payment is deferred.

Subject example:

```text
Registration submitted — payment will come later
```

Must include:

- Curler name.
- Season/session.
- Summary of submitted choices.
- Clear reason payment is deferred.
- Statement that staff will follow up when placement/review is complete.
- No payment link unless one already exists.

Common reasons:

- League placement is pending.
- Waitlist placement is pending.
- Third-league interest requires staff review.
- Junior Recreational financial assistance is under review.

### 3. Registration paid / payment confirmation

Send when registration payment succeeds.

Subject example:

```text
Registration payment received
```

Must include:

- Curler name.
- Season/session.
- Amount paid.
- Summary of paid items.
- Reminder of any items that are still pending, if applicable.
- Receipt/payment reference if available.

Avoid implying that pending waitlist or third-league requests are confirmed.

### 4. Social membership confirmation

This may be a separate email or a variant of payment confirmation.

Must clearly state:

- Social membership is active for the season after payment.
- Social membership does not include ice privileges.
- Social members are not eligible for league play or sparing unless they later
  upgrade to regular membership and purchase applicable ice privileges.
- Upgrading later requires paying the full regular membership price with no
  social membership credit and no discounts.

### 5. Waitlist joined

Send when a member is added to a waitlist.

Subject example:

```text
You have joined the [League Name] waitlist
```

Must include:

- League name.
- Waitlist type:
  - ADD
  - REPLACE
- Replacement league if applicable.
- Current position.
- Explanation that waitlists roll forward to successor leagues unless removed,
  placed, or discontinued.
- Link to view waitlist status.
- Link or instructions for removing themselves from the waitlist.

### 6. Waitlist removed by member

Send when a member removes themselves from a waitlist.

Subject example:

```text
You have been removed from the [League Name] waitlist
```

Must include:

- League name.
- Confirmation of removal.
- Explanation that their previous position is no longer held.
- Staff contact information if removal was a mistake.

### 7. Waitlist removed or changed by staff

Send when staff materially changes a member's waitlist entry, unless staff
explicitly suppresses the notification for a legitimate administrative reason.

Subject example:

```text
Your [League Name] waitlist status changed
```

Must include:

- League name.
- What changed.
- New status or position, if applicable.
- Staff contact information.

Staff changes must also be audited by the waitlist audit system.

### 8. Waitlist offer — permanent spot

Send when staff offers a permanent league spot from a waitlist.

Subject example:

```text
League spot available: [League Name]
```

Must include:

- League name.
- Whether the spot is permanent.
- 24-hour response rule.
- Clear explanation that no response means acceptance.
- Accept action/link if supported.
- Decline action/link.
- Statement that staff will follow up about payment if needed.

Required wording or equivalent:

```text
If you do not decline this offer within 24 hours, we will treat the offer as
accepted and add you to the league. If payment is required, staff will follow up
with you.
```

### 9. Waitlist offer — temporary sabbatical-fill spot

Send when staff offers a temporary sabbatical-fill spot.

Subject example:

```text
Temporary league spot available: [League Name]
```

Must include everything from the permanent offer email plus:

- Clear statement that the spot is temporary.
- Explanation that another member is holding the underlying league spot while on
  sabbatical.
- Explanation that the original member may return in a future session.
- Explanation that accepting the temporary spot does not remove the member from
  the waitlist for a permanent spot.
- Explanation that declining this temporary spot counts under the normal decline
  rules.

### 10. Waitlist offer accepted

Send when an offer is accepted, whether explicitly by the member or automatically
after 24 hours with no decline.

Subject example:

```text
League offer accepted: [League Name]
```

Must include:

- League name.
- Whether acceptance was explicit or automatic, if useful.
- Whether the spot is permanent or temporary.
- Next steps.
- Payment information or statement that staff will follow up.

### 11. Waitlist offer declined

Send when a member declines an offer.

Subject example:

```text
League offer declined: [League Name]
```

Must include:

- League name.
- Confirmation of decline.
- Current decline count effect:
  - First decline: position is retained.
  - Second decline: member moves to the bottom of the waitlist.
- Updated position, if available.
- Link to view waitlist status.

### 12. Payment link for deferred registration

Send when staff or the system creates a payment link for a deferred registration.

Subject example:

```text
Your registration payment is ready
```

Must include:

- Curler name.
- Season/session.
- Summary of confirmed/chargeable items.
- Amount due.
- Payment link.
- Statement that payment is required to complete registration.
- Staff contact information.

### 13. Junior Recreational financial assistance pending

Send when a Junior Recreational registration requesting financial assistance is
submitted.

Subject example:

```text
Junior Recreational assistance request received
```

Must include:

- Curler name.
- Requested assistance level.
- Statement that payment is deferred while staff reviews the request.
- Statement that staff will follow up with the final amount due.
- Staff contact information.

### 14. Junior Recreational financial assistance decision

Send after staff records the financial assistance decision.

Subject example:

```text
Junior Recreational registration payment is ready
```

Must include:

- Curler name.
- Requested assistance level.
- Approved assistance level or amount.
- Final amount due.
- Payment link.
- Statement that the family may contact staff before paying if the approved
  amount creates a concern.

If assistance is denied or reduced from the requested level, the email should be
sensitive and clear.

### 15. Sabbatical confirmation

Send when a sabbatical is successfully submitted/confirmed.

Subject example:

```text
Sabbatical confirmed for [League Name]
```

Must include:

- League name.
- Session.
- Sabbatical fee status.
- Explanation that the member is preserving their right to return under the
  sabbatical rules.
- Reminder that sabbaticals are time-limited.
- If applicable, warning if this sabbatical approaches the configured duration
  limit.

### 16. Sabbatical release warning/confirmation

Send when a member makes or confirms a choice that releases a sabbatical-held
spot, or when staff records such a release.

Subject example:

```text
Your sabbatical spot for [League Name] has been released
```

Must include:

- League name.
- Explanation that the protected spot has been released.
- Explanation that returning later requires joining the waitlist.
- Staff contact information.

### 17. BYOT registration confirmation

This may be a separate email or part of registration/payment confirmation.

Must include:

- League name.
- Submitted teammate list.
- Reminder that BYOT placement is coordinated by the league coordinator.
- Reminder that staff will contact the member if an adjustment or refund is
  needed.

### 18. Registration manually updated by staff

Send when staff materially changes a submitted registration.

Subject example:

```text
Your registration has been updated
```

Must include:

- Curler name.
- What changed.
- Whether payment is now due, refunded, deferred, or unchanged.
- Staff contact information.

This email may be manually triggered by staff if automatic detection of every
change is too complex for V1.

## Email links and actions

### Payment links

Payment links should use the existing Stripe checkout pipeline.

Payment link behavior must follow earlier payment rules:

- Payment success marks the relevant payable registration items paid/confirmed.
- Failed or incomplete payment does not confirm registration.
- Staff may help resolve payment issues manually.

### Waitlist offer links

If Phase 8 already created accept/decline links, use them in emails.

If only decline links are implemented, the email may rely on the rule that no
response means acceptance.

Minimum V1 requirement:

- Decline link or clear decline instructions.
- Clear 24-hour deadline.
- Clear no-response-means-acceptance language.

Preferred V1 requirement:

- Accept link.
- Decline link.
- Account page where pending/recent offers can be viewed.

### Authentication

Email action links should be safe.

Preferred behavior:

- Links require login before completing sensitive actions; or
- Links use signed, expiring tokens scoped to the specific action.

If signed tokens are used, they should:

- Expire.
- Be single-use where appropriate.
- Be tied to the specific offer/payment/registration action.
- Not expose unrelated account data.

## Bounce and delivery handling

All registration-related email should be logged.

If the email provider reports a bounce or delivery failure:

- Mark the message as bounced/failed.
- Make the failure visible to staff.
- Staff should be able to investigate and update contact information if needed.

V1 does not require automatic SMS fallback.

## Staff communication tools

Staff should be able to:

- View communications associated with a registration.
- View communications associated with a waitlist offer.
- Resend payment-link emails.
- Resend registration confirmation emails.
- Resend waitlist offer emails, if appropriate.
- See bounced/failed emails.

Staff resending an email should not create duplicate business actions.

For example:

- Resending a waitlist offer email should not create a new offer unless staff
  explicitly creates a new offer.
- Resending a payment link should not create duplicate charges.
- Resending a registration confirmation should not alter registration state.

## Member-facing wording requirements

### Deferred payment

Use wording similar to:

```text
You do not need to pay yet. Some of your registration choices require placement
or staff review first. We will email you when your payment is ready.
```

### Waitlist ADD

Use wording similar to:

```text
You are on this waitlist to add this league. If you are placed into this league,
it would bring you to no more than two leagues.
```

### Waitlist REPLACE

Use wording similar to:

```text
You are on this waitlist to replace another league. If you are placed into this
league, you will give up your spot in [Replacement League].
```

### Third-league interest

Use wording similar to:

```text
These are third-league interest choices. They are not guaranteed and are handled
only after first- and second-league demand is satisfied. Staff will follow up if
a placement is possible.
```

### Temporary sabbatical-fill

Use wording similar to:

```text
This is a temporary spot while another member is on sabbatical. You may play in
the league for this session, but the original member may return in a future
session. You keep your position on the waitlist for a permanent spot.
```

### BYOT

Use wording similar to:

```text
Bring-your-own-team league placement is coordinated by the league coordinator.
You may be contacted if roster adjustments are needed.
```

## Permissions

Member-facing pages/actions should be available to:

- The curler.
- A user with delegated impersonation rights for that curler.
- Staff/admin users with appropriate permissions.

Self-service waitlist removal should be permitted only for:

- The curler.
- A delegated user acting on behalf of the curler.
- Staff/admin users.

Staff-only communication tools must require staff/admin permissions.

## Accessibility and usability

Member communications pages should:

- Work well on mobile.
- Use clear headings.
- Avoid dense tables where possible on small screens.
- Use consistent badges/status labels.
- Avoid relying on color alone to convey status.
- Provide clear next-step buttons.

Email bodies should:

- Be readable in plain text.
- Not rely on images.
- Include full league names and season/session labels.
- Include staff contact information.

## Implementation checklist

### Member account pages

- [ ] Add registration dashboard.
- [ ] Add registration detail page.
- [ ] Show membership/program status.
- [ ] Show payment status and payment links.
- [ ] Show confirmed leagues.
- [ ] Show sabbaticals.
- [ ] Show waitlist entries and positions.
- [ ] Show ADD/REPLACE status.
- [ ] Show replacement league for REPLACE entries.
- [ ] Show third-league interest in order.
- [ ] Show BYOT teammate text.
- [ ] Show communication history if supported.
- [ ] Support delegated user visibility.

### Waitlist self-service

- [ ] Add remove-from-waitlist action.
- [ ] Add confirmation prompt.
- [ ] Mark waitlist entry inactive/removed.
- [ ] Audit the waitlist change.
- [ ] Send removal confirmation email.
- [ ] Update waitlist positions after removal if applicable.

### Email templates

- [ ] Registration submitted — immediate payment required.
- [ ] Registration submitted — payment deferred.
- [ ] Registration paid / payment confirmation.
- [ ] Social membership confirmation or variant.
- [ ] Waitlist joined.
- [ ] Waitlist removed by member.
- [ ] Waitlist changed by staff.
- [ ] Waitlist offer — permanent spot.
- [ ] Waitlist offer — temporary sabbatical-fill spot.
- [ ] Waitlist offer accepted.
- [ ] Waitlist offer declined.
- [ ] Deferred registration payment link.
- [ ] Junior Recreational assistance pending.
- [ ] Junior Recreational assistance decision.
- [ ] Sabbatical confirmation.
- [ ] Sabbatical release warning/confirmation.
- [ ] BYOT registration confirmation or variant.
- [ ] Registration manually updated by staff.

### Email sending

- [ ] Send appropriate email after registration submission.
- [ ] Send appropriate email after payment success.
- [ ] Send appropriate email when joining a waitlist.
- [ ] Send appropriate email when removed from a waitlist.
- [ ] Send appropriate email when staff changes waitlist status.
- [ ] Send appropriate email when waitlist offer is created.
- [ ] Send appropriate email when offer is accepted.
- [ ] Send appropriate email when offer is declined.
- [ ] Send appropriate email when deferred payment link is ready.
- [ ] Send appropriate email for JR financial assistance review and decision.
- [ ] Send appropriate email for sabbatical confirmation/release.
- [ ] Send appropriate email when staff manually updates registration.

### Staff communication tools

- [ ] View communication log by registration.
- [ ] View communication log by waitlist offer, if available.
- [ ] Resend payment link email.
- [ ] Resend confirmation email.
- [ ] Resend offer email without creating a duplicate offer.
- [ ] Show bounced/failed emails.

## Acceptance criteria

Phase 9 is complete when all of the following are true:

1. A member can view the status of a submitted registration.
2. A delegated user can view the status of a registration they submitted or are
   authorized to manage.
3. A member can see which league items are confirmed, waitlisted, subject to
   availability, third-league interest, BYOT, sabbatical, or temporary.
4. A member can see payment status and access a payment link when one exists.
5. A member can see their active waitlist entries and positions.
6. A member can remove themselves from a waitlist.
7. Removing oneself from a waitlist is audited.
8. Removing oneself from a waitlist sends a confirmation email.
9. Registration submission sends the correct immediate-payment or
   deferred-payment email.
10. Successful payment sends a payment confirmation email.
11. Waitlist offer emails clearly state the 24-hour rule and that no response
    means acceptance.
12. Temporary sabbatical-fill offer emails clearly state that the spot is
    temporary.
13. Junior Recreational financial assistance emails clearly explain review and
    payment timing.
14. Staff can resend important emails without duplicating business actions.
15. Staff can see failed/bounced emails if delivery information is available.
16. No email or member page misrepresents an unconfirmed placement as confirmed.
17. Existing Phase 0–8 tests still pass.

## Out-of-scope future enhancements

These are intentionally not required for V1:

- SMS notifications.
- User-configurable notification preferences.
- Calendar invite generation.
- In-app notification center.
- Automatic reminder emails before waitlist offer expiration.
- Automatic escalation for bounced emails.
- Self-service registration edits after submission.
- Self-service refund/cancellation flow.
- Full member-facing waitlist history.