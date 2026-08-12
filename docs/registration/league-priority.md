# League priority selection

This document is the canonical description of how a registrant tells us which
leagues they want to play in. It replaces the older multi-step model of
returning-league decisions, direct league requests, ADD/REPLACE waitlist joins,
and third-league interest.

## Flow placement

Registration shows a purely informational step (`league-priority-intro`)
immediately before the interactive priority list. That screen explains:

1. What the next screen asks for (desired count and ordered priority list).
2. How league rosters use up to two protected spots from leagues the member
   played last session — as a guaranteed return, or as a guaranteed fallback
   when trying to switch into a higher-priority league.

Continue advances to the priority list. No answers are saved on the intro step.

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

- **Count** = the number of leagues the registrant played in the prior session.
- **List** = those same leagues, plus any league the registrant currently has an
  active waitlist entry for. Waitlisted leagues are placed at the highest ranks
  the bring-your-own-team ordering rule allows.

The registrant may change all of it.

## Guarantee labels

Each entry in the list carries exactly one derived label. Labels are recomputed
live as the registrant reorders, adds, or removes leagues.

| Label | Meaning |
| --- | --- |
| Guaranteed return | The spot is held. Billed immediately. |
| Guaranteed fallback | The spot is held as a backstop if higher choices do not come through. Billed immediately. |
| Waitlisted | Queued on the league waitlist. Payment deferred. |
| Subject to availability | Wanted, no waitlist on the league. Payment deferred. |

### Return eligibility

An entry is *return eligible* when the registrant holds a return right for that
league: they played the configured predecessor league, or they hold a qualifying
sabbatical right in that lineage, and registration is in the priority state. See
`eligibility.md`.

A play-in based league is return eligible only when the registrant's declared
entry team has a complete roster and clears the TLINE guarantee bar. See
`play-in-entry.md`.

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
    else:
        entry.label = league.allowsWaitlist ? waitlisted : subject_to_availability
```

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
| 1 | Monday, Tuesday, Thursday | Waitlisted, Guaranteed return, (none — budget spent) |
| 3 | Monday, Tuesday, Thursday | Waitlisted, Guaranteed return, Guaranteed fallback |

In the fourth row the budget is `min(2, 1) = 1`, so Thursday gets no guarantee
even though the registrant has a return right for it.

## Bring-your-own-team ordering

Bring-your-own-team leagues must be ranked above every standard league. Team
rosters are committed as a unit, so a BYOT entry cannot sit behind a league that
might displace it.

The registration flow enforces this by construction: adding a BYOT league places
it at the end of the BYOT block rather than the end of the list, and reordering
cannot move a BYOT entry below a standard entry or a standard entry above a BYOT
entry. The API re-checks the ordering and rejects a payload that violates it.

## Team rosters

A bring-your-own-team or play-in entry carries a roster on the priority entry
itself: linked member ids plus free-text names for teammates who are not yet
members.

| Entry | Roster requirement |
| --- | --- |
| Bring-your-own-team, standard | Exactly the league team size (4 for teams, 2 for doubles) |
| Play-in based | At least 2 to declare; the full team size to clear the TLINE bar |

An entry whose roster is incomplete is never labeled guaranteed. For a
bring-your-own-team league, an incomplete roster of only returning players
shows **Awaiting roster entry**; naming a non-returning teammate (or a
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

## Leaving a league behind

A league the registrant played last session that does not appear in the priority
list is being given up. Before the entry leaves the list the flow asks what
should happen to the return right:

- **Sabbatical** — hold the return right, pay the sabbatical fee. Available only
  when the league permits sabbaticals. See `sabbaticals.md`.
- **Drop** — release the spot permanently.

Sabbaticals do **not** count against the budget of two guaranteed return /
fallback spots. A registrant may claim two guaranteed leagues and still take
sabbatical from other prior leagues (subject to the separate limit of two
simultaneous sabbaticals).

## Basic ice fallback

When the priority list produces zero guarantee labels, the registrant is offered
basic ice as a fallback so they have something to skate on if no league spot
materializes. The question appears inline on the priority page and disappears as
soon as any guarantee label is present.

## Waitlist derivation

Every entry labeled `waitlisted` becomes a waitlist entry at submit, carrying
its priority rank and the registrant's desired league count. There is no ADD or
REPLACE entry type: whether a placement displaces an existing league is decided
at placement time by comparing the registrant's held league count against their
desired count.

See `waitlists.md` for offer and placement behavior.

## Billing

Guaranteed entries are billed. Non-guaranteed entries are not, because the
registrant may never be placed in them.

- **Confirmed total** = membership and other fixed fees, plus the sum of
  `registrationFeeMinor` for every entry labeled `guaranteed_return` or
  `guaranteed_fallback`.
- **Immediate payment** when the number of guaranteed entries equals the desired
  league count, and no unrelated deferral applies (for example a pending junior
  financial assistance request).
- **Deferred payment** otherwise, quoted as a range. The floor is the confirmed
  total. The ceiling adds the `desiredLeagueCount - guaranteedCount` most
  expensive remaining entries in the list — most expensive rather than
  next-by-priority, so the quoted maximum is never exceeded.

See `payment-decision.md` and `fee-calculation.md`.

## Placement

Guaranteed returns and guaranteed fallbacks are placed on the league roster at
submit. Everything else is resolved after priority registration closes, in the
order described in `staff-operations.md`. Entries ranked below a registrant's
desired count are only placed if room remains after everyone's higher-priority
demand has been satisfied.
