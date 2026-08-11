# Play-in League Entry (TLINE Points)

This document describes the competitive entry scheme for play-in based leagues
(currently the Tuesday competitive league). It covers TLINE points, entry
teams, the guarantee evaluation, payment implications, and staff operations.

Related documents:

- `rules.md` — league types and configuration
- `data-model.md` — storage for the tables referenced here
- `league-priority.md` — how a play-in league sits on the priority list

## 1. Overview

Play-in based leagues have no waitlist. A play-in league appears on the priority
list like any other league, but its guarantee is earned rather than inherited:

1. Every curler carries a number of **TLINE points** earned from the prior
   season's sessions.
2. Registrants declare an **entry team** of at least two players (up to the
   league team size). The team's points are the sum of its members' points.
   Incomplete teams are never guaranteed and cannot pay at registration; later
   teammates can add members until the roster is full.
3. The top `autoEntryCount` teams by points are granted automatic entry, where
   `autoEntryCount = capacityValue − playInSpotCount` (for example
   20 − 2 = 18).
4. All other teams play down for the remaining `playInSpotCount` spots.

The system records playdown **outcomes** only. It does not schedule or manage
the playdown competition itself.

## 2. TLINE points

- Points are awarded per individual, per session, based on final standings
  (1st through 20th): 20, 19½, 19, 18½, 18, 17½, 17, 16½, 16, 15½, 15, 14, 13,
  12, 11, 10, 8, 6, 4, 2. All four members of a team receive the same award.
- Individuals carry their points to whichever team they join next session.
- Only points from the prior season's sessions count (typically Fall and
  Winter).
- Playdown participants who do not win entry earn 1 point. This point does
  **not** count as "playing in the league" for the returning-member rule.
- Points are stored in half-point units (`points_half`) to avoid floating
  point issues; 19½ is stored as 39.
- For now all points are entered manually by staff on the league's Play-in
  entry tab (`source = 'manual'`). Automatic awards from standings
  (`'standings'`) and playdown results (`'playdown'`) are reserved for a later
  phase.
- Injury and shared-spot cases are decided case by case by staff and entered
  manually.

## 3. Entry teams

- An entry team belongs to one play-in league and holds up to `teamSize`
  members (4 for `teams` format, 2 for `doubles`).
- Members are either linked member accounts or **pending names** (free-text
  names for people who have not joined yet). Pending names always contribute
  0 points until linked to an account.
- The first registrant to submit a play-in request creates the team from their
  declared roster (minimum two players). Teammates who register later are
  attached to the existing team. If the team is still incomplete, they can add
  more members; if it is already full, they see the team read-only with the
  notice "Not your team? Contact membership@trianglecurling.com ASAP." If two
  people declare the same account-linked roster in different orders, they share one entry team
  (duplicates are merged). Canceling a registration removes that curler from the
  entry team; if nobody else has registered onto the team yet, the declaration
  is deleted (these entry declarations are separate from in-league game teams on
  the Teams/Roster tabs).
- A member may be on at most one active entry team per league. Declaring a
  roster that includes someone already committed to another team is a blocking
  validation error (`play_in_teammate_already_committed`).
- Team statuses: `pending`, `guaranteed`, `playdown`, `entered`,
  `not_entered`, `withdrawn`. Active statuses (`pending`, `guaranteed`,
  `playdown`, `entered`) commit their members; `withdrawn` and `not_entered`
  teams release their members back to the pool.

## 4. Returning-member rule

A team is eligible for automatic entry only if at least **two** of its members
count as returning (their points ledger has `counts_as_returning` rows). A
40-point curler cannot team with three 0-point curlers to avoid a playdown.

- Losing a playdown does not count as returning.
- The rule is **waived** automatically when fewer than `autoEntryCount` teams
  have at least two returning curlers.
- A team relying on the waiver is never reported as guaranteed at registration
  time, because later registrations could deactivate the waiver.

## 5. Guarantee evaluation

At registration time the system determines whether a declared team is
**guaranteed** automatic entry. A team must have a **full roster** (team size
slots filled with linked members and/or pending names) before it can be
guaranteed—regardless of TLINE points. Incomplete teams always defer payment.

When the roster is complete:

1. Take every member's points that are not on an active declared team
   (the uncommitted pool), sorted high → low.
2. Form the strongest possible opposing teams by taking the next four players
   for each team (padding a partial final team with zero-point newcomers).
3. Combine those hypothetical totals with already-declared active team totals
   (teams already marked entered permanently occupy a top spot).
4. Sort opposing totals high → low. The `autoEntryCount`-th total is the
   **guaranteed-entry threshold** (the bar). A team whose total strictly
   exceeds that bar — and that meets the returning-member rule without
   relying on the waiver — is guaranteed.

Example with 18 auto-entry spots and no teams declared yet: the threshold is
the total of players ranked #69–#72 in the points pool. A team above that
total cannot be pushed out of the top 18 by any stronger stacking of the
remaining players.

The threshold is shown on the staff report and to registrants as
"more than X points."

During registration, the entry-status notice (guarantee / playdown) is shown
only after a full team roster is selected. Incomplete rosters show that
guaranteed entry and payment are unavailable until the team is full. Until a
full roster is selected the threshold can appear to move as drafted members
leave the uncommitted points pool used to stack hypothetical opposing teams.

## 6. Payment implications

- A play-in entry whose team is guaranteed earns a **Guaranteed return** label on
  the priority list and pays immediately. It consumes one of the two protected
  claims.
- A play-in entry never earns a **Guaranteed fallback** label, no matter how low
  it ranks: a team that misses the bar goes to playdowns rather than into a held
  spot. Non-guaranteed play-in entries are labeled **Subject to availability**.
- After registration, play-in leagues appear on the member's dashboard
  membership card before staff clicks Grant entry: guaranteed teams look like
  normal roster leagues (no badge); teams that may still need to play in show a
  Pending badge.
- A guaranteed play-in entry hides the basic ice fallback question, like any
  other guarantee: the registrant already has a confirmed league path for ice
  privileges.
- BYOT and play-in teammate lists appear on the main registration confirmation
  emails (deferred submission and payment received). A separate BYOT
  registration confirmation email is not sent.
- All other play-in registrations defer payment (`play_in_placement_pending`),
  like waitlisted registrations.
- Displacement follows the priority list rather than a named replacement league.
  If a play-in placement puts the registrant over their desired league count,
  their lowest-priority non-guaranteed held league is released.
- When staff record a "grant entry" outcome for a team that was not guaranteed at
  registration, deferred registrations are billed through the standard
  deferred-payment path and displacement is applied as above.
- Teams marked "not entered" have their play-in selections marked
  `not_placed` and are not billed for the league.

## 7. Registration flow

1. A play-in league is added to the priority list from the league picker, and is
   seeded there when the registrant played its predecessor or is already on a
   declared entry team.
2. The entry expands to collect the team: at least two players (member
   autocomplete plus "Manually add by name" for future members), or attaching to
   and extending an existing incomplete declared team. Continuing with an
   incomplete roster shows a confirmation that the coordinator will try to help
   fill the team with no guarantee.
3. Once a **full** team is known, the guarantee result is shown inline on the
   entry:
   - Guaranteed entry — the entry shows **Guaranteed return** and payment is due
     now.
   - Returning and not guaranteed — show the play-in event notice and suggest
     adding a back-up league lower on the list.
   - Otherwise — **Subject to availability**, payment deferred until placement.
   Incomplete teams are never guaranteed and always defer payment.
4. On submit, the entry team is created or the registrant is attached to the
   existing team (`source_registration_id` recorded per member).

A guaranteed play-in entry consumes one of the two protected claims, alongside
guaranteed returns, guaranteed fallbacks, and sabbaticals.

## 8. Staff operations (Play-in entry tab)

The Play-in entry tab appears on the league detail page for play-in based
leagues. League managers can view; registration managers
(`registrations.manage`) and global league administrators can manage.

- **TLINE points panel** — seed and maintain each member's points before
  registration opens: points value (whole or half), returning flag, notes.
- **Entry teams report** — summary strip (guarantee threshold, auto-entry
  count, play-in spots, team counts by projected status, returning-rule waiver
  state) plus a table of teams with per-member points, registered indicators,
  pending-name badges, and each member's priority rank and desired league count.
- **Row actions:**
  - Link a pending name to a member account once they join (their points then
    count toward the team total).
  - Edit team membership or withdraw/reinstate a team (with audit note).
  - **Record outcome / withdraw:**
    - *Grant entry* — places all account-linked members on the league roster
      with `placement_type = 'play_in'`, creates a Teams-tab league team for
      those members (provisional roles; staff can edit), releases each member's
      lowest-priority held league when the placement puts them over their desired
      league count, and triggers deferred payments.
    - *Withdraw* — removes the declaration from the entry pool (covers pulling
      out early, recording that the team did not get a spot, or reversing a
      mistaken Grant entry). Play-in registrations for this league are marked
      not placed and are not billed. If the team had been granted entry, their
      play_in roster placements are removed and a matching Teams-tab league
      team is deleted. The declaration can be reinstated later.

## 9. Configuration

On the league Configuration tab:

- **Play-in based roster** — enables the scheme. Play-in leagues should not
  also enable waitlists; the play-in mechanism replaces the waitlist.
- **Play-in spots** (`playInSpotCount`, default 2) — the number of spots
  decided by playdowns. Automatic entry count is
  `capacityValue − playInSpotCount`.

The competitive league should be configured as
`league_type = 'bring_your_own_team'`, `format = 'teams'`,
`capacity_type = 'team'`, with `is_play_in_based` enabled.

## 10. Deferred to later phases

- Automatic TLINE point awards from final standings.
- Automatic 1-point award to playdown losers.
- Playdown bracket/scheduling management.
