# League priority selection

This document is the canonical description of how a registrant tells us which
leagues they want to play in. It replaces the older multi-step model of
returning-league decisions, direct league requests, ADD/REPLACE waitlist joins,
and third-league interest.

## Flow placement

Registration shows a purely informational step (`league-priority-intro`)
immediately before the interactive priority list **when the registrant is on
league play** and at least one eligible league or instructional program is
available. New curlers with **none or minimal** experience, or with **less than
one year** of self-reported experience, skip ice privileges and are placed on
league play automatically. New curlers who report **at least one year** of
experience see ice privileges first (including basic ice privileges); choosing
league play then continues through this intro.

For returning members, that screen explains:

1. What the next screen asks for (desired count and ordered priority list).
2. How league rosters use up to two protected spots from leagues the member
   played last session — as a guaranteed return, or as a guaranteed fallback
   when trying to switch into a higher-priority league.

For new members, the same screen uses shorter roster copy: returning members
are placed first, remaining spots come from waitlists, and adding a league to
the priority list joins that waitlist. New members with **one year of
experience or less** are also encouraged to add Saturday Instructional at the
top of their list. New members with more experience still go through this intro
and the priority list, without that Saturday Instructional prompt.

Continue advances to the priority list. No answers are saved on the intro step.
Registrants on basic ice privileges or other non–league-play paths skip this
intro and go straight to the priority list.

## Basic ice privileges

When the registrant chose **basic ice privileges**, the priority list is limited
to leagues listed as free (`registrationFeeMinor` of 0):

- The add-a-league picker only offers free leagues.
- Paid leagues are not seeded onto the list, including last-session leagues that
  would otherwise be guaranteed returns.
- Each paid last-session league must be answered with sabbatical or drop instead
  of remaining on the list.

The server rejects a save that includes a paid league on this path.

## The model

A registrant provides exactly two things:

1. **Desired league count** — how many leagues they want to play in this
   session, from 1 to 5.
2. **Priority list** — an ordered list of leagues, most wanted first. The list
   must be at least as long as the desired league count.

Everything else is derived. There are no separate "returning league",
"waitlist join", or "third league" answers.

### Why the list can be longer than the count

The list expresses preference; the count expresses capacity. A registrant who
wants 2 leagues but lists 5 is saying "give me my highest two that I can
actually get." Listing more leagues never obligates the registrant to more than
their count.

### Desired league count above two

Most registrants play one or two leagues. The count goes to 5 because some
daytime leagues are free for members who are already paying for a regular
league, and some members like to play several. Those leagues are configured
with a `registrationFeeMinor` of 0, so a larger count does not necessarily mean
a larger bill. Fees are always summed per league, never multiplied by a count.

### Defaults

On first load the flow seeds:

- **Count** = the number of leagues the registrant played in the prior session,
  or 1 if they did not play any.
- **List** = those same leagues, plus any league the registrant currently has an
  active waitlist entry for. Waitlisted leagues are placed at the highest ranks
  the play-in ordering rule allows.

The registrant may change all of it.

## Guarantee labels

Each entry in the list carries exactly one derived label. Labels are recomputed
live as the registrant reorders, adds, or removes leagues.

| Label | Meaning |
| --- | --- |
| Guaranteed return | The spot is held. Billed immediately. Priority registration only. |
| Guaranteed fallback | The spot is held as a backstop if higher choices do not come through. Billed immediately. Priority registration only. |
| Available | The league currently has vacancies. Billed immediately. Open registration, or instructional programs in any registration state. |
| Temporary spot available | A sabbatical has left a temporary fill vacancy. Billed immediately, minus the sabbatical fee. Open registration only. |
| Waitlisted | Queued on the league waitlist. Payment deferred. |
| Subject to availability | Wanted, not waitlisted, and not yet confirmed. Payment waits until staff places the curler. Includes a third league below two guaranteed returns, a leftover with no waitlist, and a full instructional program. |
| Superfluous | Below confirmed placements (guaranteed, available, or temporary fill) that already fill the desired count. Not waitlisted or billed. Must be removed or moved higher before continuing. Unconfirmed subject-to-availability leftovers do not fill the count. |

### Return eligibility

An entry is *return eligible* when the registrant holds a return right for that
league: they played the configured predecessor league, or they hold a qualifying
sabbatical right in that lineage, and registration is in the priority state. See
`eligibility.md`.

A play-in based league is return eligible only when the registrant's declared
entry team has a complete roster and clears the TLINE guarantee bar. See
`play-in-entry.md`.

### Open registration

Open registration does not grant guaranteed returns or guaranteed fallbacks.
Labels come from live vacancies instead:

A league has vacancies when its active waitlist entry count is **strictly less
than** its remaining open spots (capacity minus permanent roster placements and
active sabbaticals).

```
availableGranted = 0
availableBudget = min(2, desiredLeagueCount)

for entry in rank order:
    if play-in and roster incomplete:
        entry.label = awaiting_roster_entry
    else if play-in and roster complete but TLINE bar not cleared:
        entry.label = subject_to_availability
    else if instructional:
        entry.label = available if vacancies else subject_to_availability
    else if league has vacancies and availableGranted < availableBudget:
        entry.label = available
        availableGranted += 1
    else if league has vacancies and desiredLeagueCount >= 3:
        entry.label = subject_to_availability
    else if league has a temporary sabbatical-fill vacancy:
        entry.label = temporary_spot_available
    else:
        entry.label = waitlisted

# then the same superfluous pass as priority registration
```

The add-a-league picker shows **Available**, **Temporary spot available**, or
**Waitlist** next to each league from that vacancy check, independent of how
many available spots the registrant has already taken. Permanent vacancies take
priority over temporary fill vacancies. A temporary fill is billed at the
league fee minus the sabbatical fee.

When the registrant wants three or more leagues, the first two vacant selections
are Available. Further vacant selections are Subject to availability. Leagues
without vacancies stay Waitlisted.

### The guarantee budget

A registrant may hold at most **two** guaranteed spots, and never more than
their desired league count:

```
budget = min(2, desiredLeagueCount)
```

Guaranteed return and guaranteed fallback labels draw from the same budget.

### Labeling algorithm

```
granted = 0

# Pass 1: guaranteed returns, ranks 1 and 2 only
for entry in ranks 1..2, ascending:
    if entry is return eligible and granted < budget:
        if roster incomplete and still all-returning:
            entry.label = awaiting_roster_entry
            # does not consume budget or bill
        else if roster complete and all-returning:
            entry.label = guaranteed_return
            granted += 1

returnCount = granted

# Pass 2: guaranteed fallbacks, ranks 3 and lower,
# only when fewer than two returns were granted
if returnCount < 2:
    for entry in ranks 3.., ascending:
        if entry is return eligible and roster complete and all-returning and granted < budget:
            entry.label = guaranteed_fallback
            granted += 1

# Pass 3: everything else (skip awaiting-roster labels)
for entry with no label:
    if play-in and roster incomplete:
        entry.label = awaiting_roster_entry
    else if instructional:
        entry.label = available if vacancies else subject_to_availability
    else if league.allowsWaitlist and guarantees above this rank < 2:
        entry.label = waitlisted
    else:
        entry.label = subject_to_availability

# Pass 4: superfluous leftovers below an already-filled desired count
secured = 0
for entry in rank order:
    if secured >= desiredLeagueCount:
        entry.label = superfluous
    else if entry is guaranteed, available, or temporary fill:
        secured += 1
```

Waitlists fill protected spots. A leftover can still waitlist when fewer than
two guarantees sit above it — including a rank-3 waitlist while a fallback is
held further down the list. Counting total grants (including those later
fallbacks) would label the leftover as subject to availability and then mark the
fallback superfluous. Once two spots above are already guaranteed, further
leftovers are subject to availability even if the league has a waitlist. Those
unconfirmed leftovers do not fill the desired count, so extra rows stay as
backups until guaranteed, available, or temporary-fill placements already fill
the number wanted. Anything below that confirmed fill is superfluous: the
registrant may add a league in order to move it higher (switch with fallback),
but cannot continue until those extra rows are removed or reordered.

### Instructional programs

Instructional programs such as Saturday Instructional use live vacancies in
both priority and open registration, instead of return rights or the two-spot
available budget:

- Remaining space → **Available**, billed immediately.
- Full → **Subject to availability**, payment deferred until staff can place
  the curler.

They do not join a waitlist from this leftover path.

A bring-your-own-team entry that still has a return right but an incomplete
all-returning declared team, or a play-in entry whose team is not yet fully
declared, shows **Awaiting roster entry**. Completing an all-returning BYOT
roster turns that into a real `guaranteed_return` and starts billing/roster
placement for it. Completing a play-in roster then evaluates the TLINE bar.

### Play-in leagues never receive a fallback

Play-in based leagues have no fallback right. A play-in team that misses the
TLINE bar goes to playdowns rather than dropping into a held spot. A play-in
entry therefore receives `guaranteed_return` (bar cleared, roster complete),
`awaiting_roster_entry` (roster incomplete), or `subject_to_availability`,
never `guaranteed_fallback`.

### Worked examples

Registrant played Tuesday and Thursday last session.

| Count | List (rank order) | Labels |
| --- | --- | --- |
| 2 | Tuesday, Thursday | Guaranteed return, Guaranteed return |
| 2 | Monday, Tuesday, Thursday | Waitlisted, Guaranteed return, Guaranteed fallback |
| 2 | Monday, Wednesday, Tuesday, Thursday | Waitlisted, Waitlisted, Guaranteed fallback, Guaranteed fallback |
| 2 | Tuesday, Monday, Wednesday, Thursday | Guaranteed return, Waitlisted, Waitlisted, Guaranteed fallback |
| 1 | Monday, Tuesday, Thursday | Waitlisted, Guaranteed return, (none — budget spent) |
| 3 | Monday, Tuesday, Thursday | Waitlisted, Guaranteed return, Guaranteed fallback |
| 3 | Tuesday, Thursday, Monday, Wednesday | Guaranteed return, Guaranteed return, Subject to availability, Subject to availability |

In the fifth row the budget is `min(2, 1) = 1`, so Thursday gets no guarantee
even though the registrant has a return right for it. In the last row both
protected spots are already guaranteed, and Monday and Wednesday remain
subject to availability as options for the third wanted league. Wednesday is a
backup if Monday does not come through. Monday and Wednesday in the
Tuesday-first count-2 row stay waitlisted because only one guarantee sits
above them; Thursday remains the fallback.

## Play-in ordering

Play-in leagues must be ranked above every other league. Play-in teams are
committed as a unit, so a play-in entry cannot sit behind a league that might
displace it. Bring-your-own-team leagues that are not play-in based may sit
anywhere on the list.

The registration flow enforces this by construction: adding a play-in league
places it at the end of the play-in block rather than the end of the list, and
reordering cannot move a play-in entry below another league or another league
above a play-in entry. The API re-checks the ordering and rejects a payload that
violates it.

## Team rosters

A bring-your-own-team or play-in entry carries a roster on the priority entry
itself: linked member ids plus free-text names for teammates who are not yet
members.

| Entry | Roster requirement |
| --- | --- |
| Bring-your-own-team, standard | Exactly the league team size (4 for teams, 2 for doubles) |
| Play-in based | At least 2 to declare; the full team size to clear the TLINE bar |

An entry whose roster is incomplete is never labeled guaranteed, and it does
not count toward filling the desired league count for the superfluous pass.
For a bring-your-own-team league, an incomplete roster of only returning
players shows **Awaiting roster entry**; naming a non-returning teammate (or a
free-text name) moves the entry to waitlisted. A play-in league with an
incomplete declared team also shows **Awaiting roster entry**.

### Returning team required for BYOT guarantee

A bring-your-own-team entry earns `guaranteed_return` only when:

1. The registrant holds a return right for the league,
2. The declared roster is complete, and
3. **Every** declared player also holds a return right for that league.

Free-text pending names never count as returning. A returning individual may
still list a mixed or new team — that entry is allowed on the priority list —
but it is labeled waitlisted (or subject to availability) rather than
guaranteed.

A non-play-in BYOT entry that does earn **Guaranteed return** is shown as
**Guaranteed return*** with a note below the list:

- Doubles: Doubles partner must also choose this league as their first or
  second priority.
- Teams: All teammates must also choose this league as their first or second
  priority.

Play-in guaranteed returns do not use this asterisk.

## Leaving a league behind

A league the registrant played last session that does not appear in the priority
list is being given up. A league that remains on the list is being kept: a
leftover drop or sabbatical answer for it is ignored and is not shown on review
or confirmation. Before the entry leaves the list the flow asks what should
happen to the return right:

- **Sabbatical** — hold the return right, pay the sabbatical fee. Available only
  when the league permits sabbaticals. See `sabbaticals.md`.
- **Drop** — release the spot permanently.

Sabbaticals do **not** count against the budget of two guaranteed return /
fallback spots. A registrant may claim two guaranteed leagues and still take
sabbatical from other prior leagues (subject to the separate limit of two
simultaneous sabbaticals).

## Basic ice fallback

When the priority list has no guaranteed leagues (no guaranteed return and no
guaranteed fallback), the registrant is offered basic ice as a fallback so they
have something to skate on if no league spot materializes. New curlers are not
offered this unless they report **at least one year** of experience. The
question appears inline on the priority page and disappears as soon as any
guaranteed league is present. Available and subject-to-availability entries do
not hide it.

## Waitlist derivation

Every entry labeled `waitlisted` becomes a waitlist entry at submit, carrying
its priority rank and the registrant's desired league count. There is no ADD or
REPLACE entry type: whether a placement displaces an existing league is decided
at placement time by comparing the registrant's held league count against their
desired count.

See `waitlists.md` for offer and placement behavior.

## Billing

Guaranteed entries, open-registration available entries, and instructional
programs with remaining space are billed now.
Waitlisted entries, incomplete rosters, play-in misses, subject-to-availability
leftovers, full instructional programs, and superfluous entries are not.
Superfluous entries also cannot be submitted.

Subject-to-availability on a standard league means the leftover is not joining
a waitlist and is not yet confirmed. That includes leagues with no waitlist,
and extra leagues below two protected spots already granted above them — for
example a third-league request after two guaranteed returns. Those leftovers
do not consume a protected guarantee spot, and payment waits until staff
confirms placement. A full instructional program uses the same label and the
same deferred payment.

- **Confirmed total** = membership and other fixed fees, plus the sum of
  `registrationFeeMinor` for every guaranteed entry and every available or
  temporary-fill entry that fills a remaining desired-count slot.
- **Immediate payment** when billed-now leagues fill the desired league count,
  and no unrelated deferral applies (for example a pending junior financial
  assistance request, a waitlist still needed to fill the count, a play-in
  miss, or a subject-to-availability leftover).
- **Deferred payment** otherwise, quoted as a range. The floor is the confirmed
  total. The ceiling adds the remaining desired-count slots' most expensive
  unbilled entries — most expensive rather than next-by-priority, so the quoted
  maximum is never exceeded.

See `payment-decision.md` and `fee-calculation.md`.

## Placement

Guaranteed returns, guaranteed fallbacks, and available or temporary-fill
entries are placed on the league roster at submit. Waitlisted entries,
play-in misses, and subject-to-availability leftovers are resolved after
priority registration closes, in the order described in `staff-operations.md`.
Entries ranked below a registrant's desired count are only placed if room
remains after everyone's higher-priority demand has been satisfied.
