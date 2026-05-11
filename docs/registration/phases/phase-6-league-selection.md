# Phase 6: League Selection

## Objective

Implement the league selection portion of registration.

This phase covers:

- Returning league guarantees
- Sabbatical requests
- Dropping prior leagues
- Standard league waitlist requests
- ADD vs. REPLACE waitlist intent
- Third-league interest
- Bring-your-own-team league requests
- Junior Recreational short-circuit behavior
- League eligibility enforcement during registration

This phase does not complete registration submission, payment, staff placement,
waitlist offer processing, or final roster assignment. Those are handled in later
phases.

---

## Required reading

Before implementing this phase, read:

- `docs/registration/rules.md`
- `docs/registration/data-model.md`
- `docs/registration/eligibility.md`
- `docs/registration/fee-calculation.md`
- `docs/registration/user-flow.md`
- `docs/registration/waitlists.md`
- `docs/registration/sabbaticals.md`
- `docs/registration/test-matrix.md`

If there is a conflict between these documents, `rules.md` is authoritative
unless a later phase document explicitly narrows implementation scope.

---

## Scope

Phase 6 adds the user-facing and backend workflow needed for a registrant to
make league-related choices.

The system should be able to persist league selections to the registration
record, validate them, and present a clear summary of what the user has chosen.

Phase 6 should support both new and returning curlers.

---

## Non-goals

Do not implement the following in Phase 6:

- Stripe checkout
- Final invoice creation
- Final registration submission
- Waitlist offer emails
- Waitlist offer acceptance/decline flow
- Staff waitlist manager
- Staff placement tools
- Third-league placement
- Manual refunds
- Full staff override interfaces

However, Phase 6 should store enough structured data for later phases to use.

---

## Key concepts

### One registration equals one curler

Each registration is for exactly one curler.

If a parent registers multiple children, each child has a separate registration.

### League types

The system supports at least these league types:

- Standard league
- Bring-your-own-team league
- Junior Recreational Program
- Junior Advanced Commitment

Junior Advanced Commitment is treated as a normal league for registration and
cost purposes.

Junior Recreational is special and short-circuits the normal league selection
flow.

### Protected league claims

A protected league claim means one of:

- Guaranteed return to a league
- Sabbatical for a league

A registrant may have at most two protected league claims for a session.

Examples:

- Two guaranteed returns: allowed.
- One guaranteed return and one sabbatical: allowed.
- Two sabbaticals: allowed.
- Two guaranteed returns and one sabbatical: not allowed.
- Three sabbaticals: not allowed.

### Standard league waitlist intent

A standard league waitlist entry has one of two intents:

- ADD
- REPLACE

ADD means the registrant wants to add the league while ending up in no more than
two leagues.

REPLACE means the registrant wants to enter the league by giving up another
league.

### Third-league interest

Third-league interest is an ordered list of suitable additional leagues beyond
the registrant's first two leagues.

Third-league interest:

- Is ranked by the registrant.
- Has no maximum number of choices.
- Defers payment.
- Does not create normal waitlist entries.
- Is handled manually or outside the application for V1 placement purposes.

### BYOT leagues

Bring-your-own-team leagues:

- Are requested by individual curlers.
- Require a teammate list text field during registration.
- Cannot be selected as a third league.
- Do not use the waitlist system.
- Do not use the sabbatical system.
- Are treated as guaranteed for payment timing.
- May still require later manual refund or correction if staff determines the
  registrant cannot be placed.

---

## User flow

### 1. Enter league selection

A registrant reaches league selection after completing:

- Identity/account setup
- Policy acceptance
- Demographic confirmation or entry
- Membership selection
- Discount questions
- Experience questions, if applicable

If the registrant selected Social Membership, they should not enter normal
league selection.

If the registrant selected Junior Recreational, they should follow the Junior
Recreational path and skip normal league selection.

---

## 2. Junior Recreational short-circuit

If the registrant chooses Junior Recreational:

- Do not show normal league selection.
- Do not show waitlist options.
- Do not show sparing options.
- Do not show third-league interest.
- Do not allow additional league requests.

Junior Recreational registrants may request financial assistance at one of these
levels:

- None
- 25%
- 50%
- 75%

If financial assistance is requested, payment is deferred until staff reviews
the request.

Junior Recreational registrants cannot join other leagues or purchase sparing
rights.

---

## 3. Returning league protections

This section applies to returning members during priority registration.

The system should determine eligible returning leagues by using configured
league predecessor/successor relationships.

A league is eligible for guaranteed return only if the registrant was in the
configured predecessor league, or has an active sabbatical right that maps to
the current league.

For each eligible returning league, show clear options:

- Return
- Sabbatical
- Drop

The UI should explain:

- The registrant may protect at most two league spots total.
- Returning and taking sabbatical both count as protected league claims.
- Sabbaticals preserve a right to return but require a sabbatical fee.
- Sabbaticals are only available during priority registration.
- If a protected spot is dropped, it may not be recoverable except through the
  waitlist.

The system must prevent more than two protected claims.

### Sabbatical eligibility

A registrant may request sabbatical only if:

- They are eligible for guaranteed return to that league.
- Registration is currently in the priority state.
- The league supports sabbaticals.
- The league is not a BYOT league.
- The registrant is not requesting sabbatical for a temporary sabbatical-fill
  spot.
- The registrant has not exceeded the simultaneous sabbatical limit.
- The sabbatical would not exceed the configured sabbatical duration limit,
  unless staff has overridden the limit.

The default sabbatical duration limit is three years, but it must be
configurable.

Sabbatical-only registrants do not need to purchase regular membership.

---

## 4. Prior league choices not protected

If a returning registrant has eligible prior leagues that were not selected as
protected claims, the system should ask what they want to do with each.

Available choices may include:

- Return subject to availability
- Drop
- Sabbatical, only if protected-claim capacity remains and all sabbatical rules
  are satisfied

"Return subject to availability" should create an appropriate non-guaranteed
league request, typically a waitlist or staff-placement record depending on the
league type.

The UI must not imply that these choices are guaranteed.

---

## 5. Desired total league count

The registrant should provide how many total leagues they want to play in for
the session.

This answer is used to help classify later league selections.

The system should clearly distinguish:

- First or second league choices
- Replacement waitlist choices
- Third-league interest choices

The system should not allow BYOT leagues to be treated as third leagues.

---

## 6. Standard league requests

For standard leagues, the registrant may request league access through the
waitlist system.

Before allowing a request, the system must enforce league eligibility:

- Age requirements based on the first day of the league
- Maximum age requirements, if configured
- Experience requirement
- Instructional league requirements
- Membership requirement behavior
- Junior Recreational exclusivity
- League availability for registration
- Any other configured league restrictions

A non-member may join a waitlist if they meet league eligibility requirements.

A user account is required to join a waitlist.

---

## 7. ADD waitlist requests

An ADD request means the registrant wants to add that league while ending up in
no more than two leagues.

Rules:

- ADD is allowed only if the registrant currently has zero or one league for the
  session.
- There is no maximum number of ADD waitlists.
- ADD entries automatically roll forward to successor leagues.
- If the registrant reaches two leagues, they must immediately resolve any
  active ADD waitlist entries.

When a registrant reaches two leagues and still has ADD waitlists, they must
choose for each active ADD waitlist:

- Remove the waitlist entry; or
- Convert it to REPLACE, specifying which league would be replaced.

If converting to REPLACE would result in more than two active REPLACE waitlists,
the registrant must remove enough entries to stay within the REPLACE limit.

Registration progress should be blocked until this cleanup is complete.

---

## 8. REPLACE waitlist requests

A REPLACE request means the registrant wants to join the requested league by
giving up another league.

Rules:

- A REPLACE entry must identify the league being replaced.
- A registrant may have at most two active REPLACE waitlist entries.
- REPLACE entries automatically roll forward to successor leagues.
- REPLACE entries are subject to the same waitlist decline rules as ADD entries.

The UI must clearly show:

- The desired league.
- The league that would be given up if the waitlist spot is accepted.

---

## 9. Third-league interest

The registrant may provide an ordered list of suitable third-league options.

Rules:

- The list is ranked.
- There is no maximum number of options.
- Third-league interest is not a normal waitlist.
- Third-league interest does not guarantee placement.
- Third-league interest defers payment.
- Third-league placement is manual or outside application scope for V1.

The UI should label this clearly as interest only.

Suggested wording:

"These choices tell staff which additional leagues you would be interested in
if third-league spots are available. These are not waitlist entries and do not
guarantee placement."

---

## 10. BYOT league requests

For BYOT leagues:

- Each curler registers individually.
- The registrant must enter teammate names in a simple text box.
- New members may request BYOT leagues.
- Returning members may request BYOT leagues.
- A registrant may request a BYOT league even if their prior team is not
  returning.
- BYOT leagues cannot be selected as third leagues.
- BYOT leagues do not use waitlists.
- BYOT leagues do not use sabbaticals.
- BYOT league requests are treated as guaranteed for payment timing.

The UI must state that final roster placement may be adjusted by the league
coordinator.

Suggested wording:

"Bring-your-own-team leagues are reviewed by the league coordinator. You will
list your teammates here. In the rare case that your team cannot be placed,
staff will follow up."

---

## 11. Selection summary before review

Before leaving Phase 6, the registrant should see a clear summary of all league
choices.

Each item should have a status label.

Possible labels:

- Guaranteed return
- Sabbatical
- Dropped
- Waitlist: ADD
- Waitlist: REPLACE
- Third-league interest
- BYOT request
- Junior Recreational
- Not eligible
- Requires staff review

The summary should make clear whether any choice causes payment to be deferred.

Payment should be deferred if any of the following are present:

- Non-guaranteed standard league request
- Waitlist request
- Third-league interest
- Junior Recreational financial assistance request
- Any other staff-placement-dependent item

BYOT requests are treated as guaranteed for payment timing.

---

## Backend behavior

### Persisted league selections

The system should persist each league-related decision in a structured form.

The persisted data should be able to distinguish:

- Guaranteed return
- Sabbatical
- Drop
- Return subject to availability
- Waitlist ADD
- Waitlist REPLACE
- Third-league interest
- BYOT request
- Junior Recreational

For ranked choices, store an explicit rank/order.

For REPLACE entries, store the league that would be replaced.

For BYOT entries, store teammate text.

### Validation

Validation should run server-side before allowing the registrant to continue.

Validation should include:

- Registration is in a state that allows league selection.
- The selected league belongs to the registration session.
- The registrant meets age requirements.
- The registrant meets experience requirements.
- The league type supports the requested selection type.
- Protected claims do not exceed two.
- Sabbatical requests meet sabbatical rules.
- BYOT is not selected as a third league.
- ADD waitlist rules are satisfied.
- REPLACE waitlist rules are satisfied.
- Junior Recreational exclusivity is enforced.

### Idempotency

Saving league selections should be safe to retry.

If a user goes backward and changes selections, old pending selections should be
updated or replaced cleanly rather than duplicated.

### Audit behavior

Phase 6 may create or update waitlist-intent records, but formal staff waitlist
management is later.

Any actual waitlist entry mutation must create an audit record.

At minimum, audit:

- Created waitlist entry
- Removed waitlist entry
- Converted ADD to REPLACE
- Converted REPLACE to ADD, if allowed
- Changed replacement league
- Changed waitlist order due to system behavior
- Rolled waitlist entry forward to successor league

Audit records should capture:

- Actor, if user-initiated
- Whether action was system-initiated
- Previous state
- New state
- Reason
- Timestamp

---

## UI requirements

The league selection UI should avoid overwhelming users.

Prefer multiple focused screens instead of one large screen.

Recommended screens:

1. Returning league protections
2. Prior league decisions for unprotected leagues
3. Desired league count
4. Add or replace standard leagues
5. BYOT requests, if applicable
6. Third-league interest
7. League selection summary

The exact screen structure may vary, but each screen should present a small
number of decisions.

The UI must clearly distinguish:

- Confirmed choices
- Waitlist choices
- Replacement choices
- Interest-only choices
- Temporary or non-guaranteed choices
- Choices that defer payment

---

## Acceptance criteria

### Returning guarantees

- A returning member in priority registration can select up to two guaranteed
  return leagues.
- A returning member cannot select three protected claims.
- Guaranteed return eligibility is based on configured predecessor/successor
  league relationships.
- Returning guarantees are unavailable outside priority registration.

### Sabbaticals

- A returning member can request sabbatical only for an eligible guaranteed
  return league.
- Sabbatical requests count toward the maximum of two protected claims.
- Sabbatical requests are unavailable outside priority registration.
- BYOT leagues cannot be selected for sabbatical.
- Temporary sabbatical-fill spots cannot be selected for sabbatical.
- Sabbatical-only registration does not require regular membership.

### Standard league waitlists

- A registrant can create ADD waitlist requests when they have zero or one
  league.
- A registrant can have unlimited ADD waitlists while eligible.
- A registrant cannot leave active ADD waitlists unresolved after reaching two
  leagues.
- A registrant can create at most two REPLACE waitlist requests.
- A REPLACE request must specify the league being replaced.
- League eligibility is enforced before creating waitlist requests.

### Third-league interest

- A registrant can provide an ordered list of third-league interest choices.
- There is no limit on third-league interest choices.
- Third-league interest defers payment.
- Third-league interest does not create normal waitlist entries.
- BYOT leagues cannot be third-league choices.

### BYOT leagues

- A registrant can request a BYOT league as one of their first two leagues.
- A registrant must provide teammate text for a BYOT request.
- A BYOT request is not waitlisted.
- A BYOT request cannot be used as a third league.
- A BYOT request is treated as guaranteed for payment timing.

### Junior Recreational

- Junior Recreational registrants bypass normal league selection.
- Junior Recreational registrants cannot select other leagues.
- Junior Recreational registrants cannot purchase sparing rights.
- Junior Recreational financial assistance requests defer payment.

### Summary

- The user can see all league choices before continuing.
- Each league choice has a clear status.
- Deferred-payment reasons are visible.

---

## Test requirements

Add unit and integration tests for the cases listed in
`docs/registration/test-matrix.md`.

At minimum, test:

- Protected-claim maximum.
- Sabbatical eligibility.
- BYOT exclusions.
- ADD waitlist eligibility.
- REPLACE waitlist limit.
- ADD cleanup after reaching two leagues.
- Third-league interest deferral.
- Junior Recreational exclusivity.
- Age and experience enforcement.
- League predecessor/successor guarantee eligibility.

---

## Handoff to Phase 7

At the end of Phase 6, the system should have a registration record with all
league decisions persisted and validated.

Phase 7 should be able to use these persisted decisions to:

- Build a final review page.
- Calculate invoice line items.
- Determine immediate vs deferred payment.
- Create waitlist entries.
- Create sabbatical records.
- Create pending registration records.
- Start Stripe checkout when appropriate.

Phase 6 should not assume that payment has been collected.