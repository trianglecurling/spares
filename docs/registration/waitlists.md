# Waitlists

## Purpose

Waitlists are used when a league has more interested curlers than available
spots.

A waitlist records a curler's interest in joining a league. Every entry on a
registrant's priority list that is labeled Waitlisted becomes a waitlist entry
at submit, carrying its priority rank and the registrant's desired league count.
See `league-priority.md`.

Waitlists are not used for:

- Junior Recreational
- Leagues configured without a waitlist, where the entry is instead labeled
  Subject to availability

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

## Entry shape

There is no ADD or REPLACE entry type. Each entry carries:

- `priority_rank` — where the league sat on the registrant's priority list
- `desired_league_count` — how many leagues the registrant wants in total

Both are snapshots taken at submit. Together they say everything the old entry
types said, and they stay correct when the registrant's circumstances change.

There is no limit on the number of waitlists a curler may be on. Entries are
first-come, first-served within each waitlist and roll forward to successor
leagues.

---

## Displacement

Whether a placement costs the curler another league is decided when the offer is
accepted, not when the entry is created.

On acceptance:

1. Place the curler on the league roster.
2. If they now hold more leagues than their desired league count, release their
   lowest-priority held league. Guaranteed spots are never released this way.
3. Skip any of their remaining entries that rank below the leagues they now
   hold, because those spots can no longer be used.

The registration and staff UI should show the curler's full priority list so it
is clear which league would be given up.

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

Rollover should preserve order, priority rank, and desired league count.

An entry for a league where the curler no longer meets eligibility requirements
must be resolved before the curler can complete relevant registration steps.

Because entries no longer name a specific replacement league, rollover cannot
be invalidated by the curler dropping or gaining a league. The desired count and
rank remain meaningful regardless.

---

## Offers

After priority registration closes, staff may process waitlists.

Placement priority for standard leagues is:

1. Guaranteed returns, guaranteed fallbacks, and sabbatical returns are resolved
   first. These are already rostered at submit.
2. Remaining permanent spots are offered to the waitlist in queue order.
3. Temporary sabbatical spots are offered to the waitlist separately.

Permanent vacancies are filled before temporary sabbatical-fill vacancies.

An entry is eligible for an offer only when:

- The curler currently holds fewer leagues than their desired league count, and
- None of their higher-ranked entries are still awaiting a response.

This is what keeps a curler's third and later choices from being filled before
everyone's first and second choices have been considered.

---

## Offer response rule

Year-round waitlist joins default to auto-accept. When priority registration
opens, those entries flip to Ask until the curler registers.

Submitting registration confirms waitlist intent from the priority list:

- Waitlisted leagues on the list auto-accept when a spot opens.
- Waitlists for leagues left off the list stay queued and auto-decline.
- Curlers who do not register stay at Ask.

When an entry's preference is `ask`, the offer includes a response deadline
chosen by staff. If the curler does not accept by that deadline, the offer is
treated as declined.

Suggested user-facing wording:

"If you do not accept this offer by the response deadline, we will treat it as
declined. If payment is required after acceptance, staff will follow up with
you."

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

## Auditing

Any waitlist update must be audited.

Audit records should be created for both user-initiated and system-initiated
changes.

Audit at least the following events:

- Entry created
- Entry removed
- Entry rolled forward
- Priority rank changed
- Desired league count changed
- Entry moved to bottom after second decline
- League released by displacement after a placement
- Entry manually reordered by staff
- Offer sent
- Offer accepted
- Offer declined
- Offer treated as declined after no acceptance by the deadline
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