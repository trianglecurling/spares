# Waitlists

## Purpose

Waitlists are used when a standard league has more interested curlers than
available spots.

A waitlist records a curler's interest in joining a standard league, either by
adding that league or by replacing another league.

Waitlists are not used for:

- Bring-your-own-team leagues
- Junior Recreational
- Third-league interest

---

## Account requirement

A person must have a user account to join a waitlist.

A person does not need to be a current member to join a waitlist.

A new user account may be created during registration.

---

## Eligibility requirement

A person may join a league waitlist only if they are eligible for that league.

Eligibility checks include:

- Minimum age
- Maximum age, if configured
- Experience requirement
- Instructional league restrictions
- League registration settings
- Junior/adult restrictions
- Any other configured eligibility rules

Age eligibility is based on the first day of the league.

New curler experience is self-reported.

Club experience accrues at 0.5 years per completed session, with a maximum of
1.0 year per season.

---

## Waitlist types

Each waitlist entry has one intent:

- ADD
- REPLACE

---

## ADD waitlist entries

ADD means the curler wants to add the league while ending up in no more than two
leagues.

Rules:

- ADD is allowed only if the curler currently has zero or one league for the
  session.
- There is no limit on the number of ADD waitlists.
- ADD entries are first-come, first-served within the waitlist.
- ADD entries roll forward to successor leagues.
- Once a curler reaches two leagues, active ADD entries must be resolved.

When a curler reaches two leagues, they must choose for each active ADD entry:

- Remove the entry; or
- Convert it to REPLACE and identify which league would be replaced.

If converting entries to REPLACE would exceed the two-REPLACE-entry limit, the
curler must remove enough entries to comply.

Registration progress should be blocked until this cleanup is complete.

---

## REPLACE waitlist entries

REPLACE means the curler wants to join the waitlisted league by giving up
another league.

Rules:

- A REPLACE entry must identify the league that would be replaced.
- A curler may have at most two active REPLACE waitlist entries.
- REPLACE entries are first-come, first-served within the waitlist.
- REPLACE entries roll forward to successor leagues.

The system must clearly show both:

- The league the curler wants to join.
- The league the curler would give up.

---

## Waitlist ordering

Waitlist order is first-come, first-served.

Earlier waitlist entries appear ahead of later waitlist entries.

Waitlists continue across sessions through configured league successor
relationships.

Because waitlists roll forward, someone who joined a waitlist in an earlier
session remains ahead of someone who joined later, unless their entry is
removed, moved, or otherwise modified according to the rules.

---

## Waitlist rollover

When a league has a configured successor, active waitlist entries automatically
roll forward to the successor league.

Rollover should preserve order.

Rollover should preserve the entry's ADD or REPLACE intent when still valid.

If an entry becomes invalid because the curler's circumstances changed, the
entry must be resolved before the curler can complete relevant registration
steps.

Examples of entries that may require cleanup:

- An ADD entry for a curler who now has two leagues.
- A REPLACE entry where the replacement league no longer exists or is no longer
  held by the curler.
- An entry for a league where the curler no longer meets eligibility
  requirements.

---

## Offers

After priority registration closes, staff may process waitlists.

Placement priority for standard leagues is:

1. Guaranteed returns and sabbatical returns are resolved first.
2. Remaining permanent spots are offered to the waitlist.
3. Temporary sabbatical spots are offered to the waitlist separately.
4. Third-league requests are handled only after first/second league demand is
   satisfied.

Permanent vacancies are filled before temporary sabbatical-fill vacancies.

---

## Offer response rule

When a waitlist offer is sent, the curler has 24 hours to decline.

If the curler does not decline within 24 hours, the offer is treated as
accepted.

Suggested user-facing wording:

"If you do not decline this offer within 24 hours, we will treat the offer as
accepted and add you to the league. If payment is required, staff will follow up
with you."

Payment issues after acceptance are handled manually by staff.

---

## Declines

Decline count is tracked per waitlist entry instance.

Rules:

- First decline: the curler keeps their waitlist position.
- Second decline: the curler moves to the bottom of the waitlist.
- Moving to the bottom resets the practical effect of prior position.
- Removing and re-adding a curler creates a new waitlist instance.
- A new waitlist instance starts with a fresh decline count.

Declining a temporary sabbatical-fill spot counts the same as declining a
permanent spot.

---

## Temporary sabbatical-fill spots

A temporary sabbatical-fill spot occurs when a member is holding a league spot
on sabbatical and another curler is allowed to play in that spot for the
session.

Rules:

- The temporary nature of the spot must be clear to the curler.
- The curler filling the temporary spot receives a discount equal to the
  sabbatical fee.
- The curler filling the spot keeps their position on the waitlist.
- If a permanent spot opens, the temporary curler may be offered the permanent
  spot according to waitlist order.
- The original sabbatical member cannot return mid-session.

Temporary sabbatical-fill spots are offered after permanent vacancies.

---

## Third-league interest is not a waitlist

Third-league interest is separate from the waitlist system.

A curler may provide an ordered list of third-league options during
registration.

Third-league interest:

- Has no maximum number of choices.
- Is not first-come, first-served.
- Does not create waitlist entries.
- Is handled manually or outside the application for V1.
- Defers payment.

---

## Auditing

Any waitlist update must be audited.

Audit records should be created for both user-initiated and system-initiated
changes.

Audit at least the following events:

- Entry created
- Entry removed
- Entry rolled forward
- Entry converted from ADD to REPLACE
- Entry converted from REPLACE to ADD, if allowed
- Replacement league changed
- Entry moved to bottom after second decline
- Entry manually reordered by staff
- Offer sent
- Offer accepted
- Offer declined
- Offer treated as accepted after no decline
- Entry marked inactive
- Entry restored

Audit records should include:

- Actor user, if applicable
- System actor, if automatic
- Timestamp
- Prior state
- New state
- Reason
- Related registration, if applicable