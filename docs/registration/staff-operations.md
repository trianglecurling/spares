# docs/registration/staff-operations.md

# Staff Operations

This document explains staff-facing registration operations.

It is intended for implementation and administrative workflow planning. It is
not member-facing.

---

## Staff responsibilities

Staff are responsible for:

- Configuring seasons, sessions, leagues, pricing, and discounts.
- Opening and closing registration periods.
- Reviewing registration status.
- Processing waitlists after priority registration.
- Sending waitlist offers.
- Managing temporary sabbatical-fill spots.
- Reviewing Junior Recreational financial assistance requests.
- Triggering payment links for deferred registrations.
- Handling exceptional manual corrections.
- Monitoring audit logs.

---

## Registration states and staff operations

Registration may be:

- Closed.
- Priority.
- Open.

During priority registration:

- Returning members may claim up to 2 protected return/sabbatical spots.
- New members may register and join waitlists.
- Waitlist order is first-come, first-served.
- Payment may be immediate or deferred depending on registration contents.

After priority registration:

- Staff process guaranteed returns and sabbatical returns.
- Staff identify permanent vacancies.
- Staff identify temporary sabbatical-fill vacancies.
- Staff send waitlist offers.
- Staff trigger payment links where appropriate.

---

## League placement order

For standard leagues, staff must process placements in this order:

1. Guaranteed returns and sabbatical returns.
2. Permanent vacancies from the waitlist.
3. Temporary sabbatical-fill vacancies from the waitlist.
4. Third-league interest, manually and only after first/second league demand is
   satisfied.

Permanent vacancies must be processed before temporary sabbatical-fill
vacancies.

---

## Waitlist management

Waitlists are ordered first-come, first-served.

Waitlists automatically roll forward to successor leagues.

Each waitlist entry is one of:

- `ADD`
- `REPLACE`

### ADD entries

An `ADD` entry means the member wants to add the league as one of their first
two leagues.

Rules:

- A person may have unlimited active `ADD` entries while they are in 0 or 1
  leagues.
- Once the person reaches 2 leagues, active `ADD` entries must be resolved.
- Resolution means removing the entries or converting up to 2 to `REPLACE`
  entries.

### REPLACE entries

A `REPLACE` entry means the member wants to replace an existing league with the
waitlisted league.

Rules:

- A person may have at most 2 active `REPLACE` entries.
- A `REPLACE` entry must identify the league being replaced.
- If a `REPLACE` offer is accepted, the replaced league placement is released.

---

## Waitlist offers

Staff may send waitlist offers to eligible people.

Offer types:

- Permanent spot.
- Temporary sabbatical-fill spot.

### Permanent spot offer

A permanent spot offer gives the recipient a regular league spot.

If accepted or auto-accepted:

- The member is placed into the league.
- The waitlist entry is removed or deactivated.
- Payment is triggered if appropriate.

### Temporary sabbatical-fill offer

A temporary sabbatical-fill offer gives the recipient a temporary spot while
another member is on sabbatical.

If accepted or auto-accepted:

- The member is placed into the league temporarily.
- The member keeps their waitlist position for a permanent spot.
- The member receives the sabbatical-fill discount.
- Payment is triggered if appropriate.

---

## Offer response rules

The recipient has 24 hours to decline.

If they do not decline within 24 hours, the offer is treated as accepted.

Offer emails must clearly state:

> If you do not decline this offer within 24 hours, we will treat the offer as
> accepted and add you to the league. If payment is required, staff will follow
> up with you.

For temporary sabbatical-fill offers, emails must also clearly explain that the
spot is temporary.

---

## Decline rules

Decline counts are tracked per waitlist instance.

- First decline: the member keeps their waitlist position.
- Second decline: the member moves to the bottom of the waitlist.
- Declining a temporary sabbatical-fill spot counts the same as declining a
  permanent spot.
- Removing and re-adding a member resets the decline count.
- Moving a member to the bottom resets the effective waitlist position and may
  reset the decline count according to the implementation's waitlist-instance
  model.

---

## Waitlist rollover

Waitlists roll forward automatically to successor leagues.

When rolling over:

- Preserve order.
- Preserve active entries.
- Preserve `ADD` or `REPLACE` status when valid.
- Preserve decline counts.
- Avoid duplicates.
- Audit every rollover-created or rollover-updated entry.

If a replacement league is no longer valid, staff should review and correct the
entry.

---

## Sabbatical-fill operations

Members on sabbatical preserve a league spot.

While they are away:

- Their spot may be offered as a temporary sabbatical-fill spot.
- The temporary curler is not guaranteed the permanent spot.
- The temporary curler keeps their waitlist position.
- The original member cannot return mid-session.
- If the original member returns in a future session, the temporary spot ends.
- If the original member releases or loses the spot, the spot becomes permanent
  and is filled according to waitlist rules.

---

## Third-league interest

Registrants may provide an ordered list of suitable third-league options.

For V1:

- Third-league interest is collected by registration.
- It defers payment.
- Placement is handled manually by staff.
- Third-league requests are considered only after first/second league demand is
  satisfied.
- BYOT leagues cannot be third leagues.

The application does not need to fully automate third-league placement in V1.

---

## BYOT leagues

Bring-your-own-team leagues:

- Are registered individually.
- Require registrants to list teammates.
- Cannot be third leagues.
- Do not use waitlists.
- Do not use sabbaticals.
- Are not processed through the waitlist manager.

Staff may manually correct BYOT placements and refunds as needed.

---

## Deferred payment operations

A registration may have deferred payment because of:

- Waitlist placement.
- Non-guaranteed league request.
- Third-league interest.
- Junior Recreational financial assistance review.
- Staff placement review.

When staff resolves the uncertainty, staff may trigger a payment link.

Whenever possible, the system should create one combined payment rather than
multiple partial payments.

If payment issues occur, staff handle them manually.

---

## Manual staff changes

Staff may manually update waitlists and placements in exceptional cases.

Manual actions include:

- Add a waitlist entry.
- Remove a waitlist entry.
- Reorder a waitlist.
- Move a member to the bottom.
- Convert `ADD` to `REPLACE`.
- Convert `REPLACE` to `ADD`.
- Change the replacement league.
- Send an offer.
- Cancel an offer.
- Mark an offer accepted.
- Mark an offer declined.
- Place a member.
- Trigger payment.
- Correct erroneous state.

Manual waitlist changes must require a reason.

---

## Audit requirements

All waitlist mutations must be audited.

Audit entries should record:

- Actor.
- Action.
- Entity affected.
- Previous state.
- New state.
- Reason.
- Timestamp.
- Whether the action was manual or automatic.

System-generated audit reasons should be explicit.

Examples:

- `registration-submitted`
- `staff-manual-change`
- `waitlist-offer-sent`
- `waitlist-offer-declined`
- `waitlist-offer-auto-accepted`
- `waitlist-entry-rolled-over`
- `waitlist-entry-moved-to-bottom`
- `permanent-placement-created`
- `temporary-sabbatical-fill-created`

Staff should be able to view audit history from the waitlist management screen.

---

## Staff UI principles

Staff interfaces should be explicit and safe.

The UI should clearly distinguish:

- Permanent vacancy.
- Temporary sabbatical-fill vacancy.
- ADD waitlist.
- REPLACE waitlist.
- Pending offer.
- Accepted offer.
- Declined offer.
- Auto-accepted offer.
- Confirmed placement.
- Temporary placement.
- Payment pending.
- Ineligible entry.
- Needs staff review.

Dangerous actions should require confirmation and a reason.

The UI should avoid hiding important operational consequences.