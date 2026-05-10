# Phase 3: Business Logic

## Purpose

Phase 3 builds the core registration business logic layer.

This phase should implement the rule engine that determines:

- Whether a registrant is eligible for a membership, league, waitlist, sabbatical, or ice privilege option.
- Whether a returning member has guaranteed return rights.
- Whether a registrant may request sabbatical.
- Whether a league request is guaranteed, waitlisted, third-league interest, BYOT, or otherwise deferred.
- Which fees and discounts apply.
- Whether payment is due immediately, deferred, or not required.
- Why a decision was made.

This phase should not build user-facing registration screens. It should produce backend services/functions and tests that future registration UI and staff tools can call.

## Authoritative documents

Before implementing this phase, read:

- `docs/registration/rules.md`
- `docs/registration/business-logic.md`
- `docs/registration/eligibility.md`
- `docs/registration/fee-calculation.md`
- `docs/registration/payment-decision.md`
- `docs/registration/test-matrix.md`

If there is a conflict between these documents and existing assumptions in code, the registration docs are authoritative unless the project owner says otherwise.

## Non-goals

Do not build:

- Registration UI screens.
- Staff waitlist management UI.
- Email templates.
- Stripe checkout integration beyond producing payment-decision outputs.
- Actual waitlist placement automation.
- Third-league placement automation.
- Junior Recreational financial assistance review UI.
- Full registration submission side effects.

Phase 3 may define outputs that later phases use to create registrations, invoices, waitlist entries, and Stripe checkout sessions, but Phase 3 should not be responsible for the complete submission workflow.

## Design principles

### 1. Keep business rules out of the UI

The UI should ask questions and display results.

The business logic layer should decide:

- Eligibility
- Fees
- Discounts
- Payment timing
- Guaranteed return rights
- Sabbatical rights
- Waitlist request validity
- Deferral reasons

### 2. Prefer pure functions where practical

Business logic should be testable without rendering UI and without requiring full database workflows.

A good pattern is:

- Query/build a registration context.
- Pass that context to business logic services.
- Return structured decision objects.
- Let later workflow code persist those decisions.

### 3. Explain every important decision

Business logic should not return only `true` or `false`.

It should return structured results with machine-readable reason codes and user/staff-facing explanations.

Example concepts:

- Eligible
- Ineligible because under minimum age
- Ineligible because insufficient experience
- Payment deferred because third-league interest exists
- Payment deferred because Junior Recreational financial assistance requires review
- Payment immediate because all selected items are guaranteed

### 4. Avoid hidden side effects

This phase should not silently mutate rosters, waitlists, registrations, invoices, or payments.

Later phases may use Phase 3 outputs to perform those writes.

## Core services to implement

The exact filenames and class/function names may follow the conventions of the existing codebase, but Phase 3 should produce these logical services.

### Registration context builder

Builds a normalized context object for a potential registration.

The context should include enough information for business rules to run without repeatedly querying unrelated tables.

It should include:

- Tenant
- Season
- Session
- Whether the session is the first session of the season
- Registration state
- Fiscal year/membership season information
- Registrant user/profile
- Submitted-by user, if different
- Date of birth and age-on-league-start calculations
- Existing memberships
- Existing ice privileges
- Existing league participation
- Existing sabbaticals
- Existing waitlist entries
- Selected membership option
- Selected leagues
- Selected discounts
- Selected Junior Recreational assistance request, if any
- Pricing configuration
- League configuration
- Predecessor/successor league relationships

### Eligibility service

Determines whether the registrant is eligible for:

- Regular membership
- Social membership
- Spare-only ice privilege
- Junior Recreational
- Junior Advanced Commitment
- A standard league
- A BYOT league
- A waitlist entry
- An ADD waitlist entry
- A REPLACE waitlist entry
- Third-league interest
- Sabbatical
- Guaranteed return

See `docs/registration/eligibility.md`.

### Returning rights service

Determines:

- Which predecessor leagues are relevant.
- Which leagues the member is eligible to return to.
- Which leagues are eligible for guaranteed return during priority registration.
- Which leagues are eligible for sabbatical.
- Whether the two protected-claim limit has been exceeded.
- Whether a sabbatical is within the allowed duration.
- Whether a sabbatical requires staff override.
- Whether a member is returning from sabbatical.

Protected claims include:

- Guaranteed return league selections.
- Sabbatical selections.

A member may have at most two protected claims during registration.

### League selection validator

Validates the complete set of league-related selections.

It should check:

- Age eligibility.
- Experience eligibility.
- Membership requirements.
- Junior Recreational exclusivity.
- BYOT cannot be a third league.
- BYOT does not use waitlists.
- BYOT does not use sabbaticals.
- ADD waitlist rules.
- REPLACE waitlist rules.
- Maximum of two active REPLACE waitlists.
- Third-league interest ranking.
- Sabbatical eligibility.
- Maximum two protected claims.
- Standard league capacity concepts, if relevant to decision labels.
- Whether non-guaranteed selections require payment deferral.

### Fee calculator

Produces an itemized invoice preview.

It should calculate:

- Regular membership dues.
- Social membership dues.
- League fees.
- BYOT league fees.
- Spare-only ice privilege fee.
- Sabbatical fees.
- Junior Recreational fee.
- Junior Advanced Commitment fee as a normal league fee.
- Student discount.
- Reciprocal discount.
- Winter-only discount.
- Sabbatical-fill discount.
- Junior Recreational financial assistance effect when approved.

See `docs/registration/fee-calculation.md`.

### Payment decision service

Determines whether the registration should result in:

- Immediate payment.
- Deferred payment.
- No payment due.

It must also return the reasons.

See `docs/registration/payment-decision.md`.

### Decision/result types

Create shared result types for business decisions.

Recommended shape:

- `allowed` or `eligible`
- `status`
- `reasonCodes`
- `messages`
- `blockingErrors`
- `warnings`
- `lineItems`, where relevant
- `discounts`, where relevant
- `deferralReasons`, where relevant
- `requiresStaffReview`, where relevant

Use existing project conventions for typing, validation, and error handling.

## Required rule coverage

Phase 3 must cover the following rules.

### Membership

- Membership season is September 1 through August 31.
- The fiscal year begins July 1.
- A purchased membership belongs to the membership season that begins in the current fiscal year.
- Regular membership is required for league ice privileges and spare-only ice privileges.
- Social membership does not allow league play or ice privileges.
- Social membership is never discounted.
- A social member may upgrade later to regular membership.
- Social-to-regular upgrade receives no credit for the social membership fee.
- Social-to-regular upgrade receives no discounts.

### Spare-only

- Spare-only is not its own membership type.
- Spare-only means regular membership plus the spare-only ice privilege fee.
- Anyone eligible to join a league is eligible to purchase spare-only.
- Spare-only can be purchased during registration.

### Ice privileges

- Ice privileges are session-specific.
- Fall ice privileges do not automatically grant winter ice privileges.
- Winter ice privileges must be purchased separately.
- The Club Bonspiel is open to active club members who purchased ice privileges for at least one session during the season.

### Discounts

- Student discount is automatically approved when required self-reported institution information is provided.
- Reciprocal discount is automatically approved when required self-reported club information is provided.
- Winter-only discount applies when someone is registering starting with a session beyond the first session of the season.
- Discounts may be combined.
- Dollar discounts apply before percentage discounts.
- Percentage discounts apply only to discount-eligible charges.
- Social membership fees are never discount-eligible.
- Sabbatical fees are never discount-eligible.
- Winter-only discount applies only to regular membership dues.
- Sabbatical-fill discount is applied separately and always equals the full sabbatical fee.

### Returning guarantees

- Returning guarantees are available only during priority registration.
- A returning member may claim at most two protected claims.
- Protected claims are guaranteed returns and sabbaticals combined.
- The relevant previous league is determined by configured predecessor/successor league continuity.
- If a member skipped the immediate predecessor session without official sabbatical, they do not have guaranteed return rights.
- BYOT leagues are treated as guaranteed for payment purposes for returning members, even though coordinator placement may later require manual correction.

### Sabbaticals

- Sabbatical requires eligibility for a guaranteed return spot.
- Sabbatical may only be requested during priority registration.
- Sabbatical does not require regular membership.
- Sabbatical counts toward the two protected-claim limit.
- A person may be on sabbatical for at most two leagues at a time.
- Sabbatical duration limit is configurable, defaulting to 3 years.
- Sabbatical duration begins on the first day of league play for the first sabbatical league.
- A sabbatical cannot be extended into a league whose final game date is on or after the configured duration limit from the sabbatical start date, unless staff overrides.
- Sabbatical is not available for BYOT leagues.
- Sabbatical is not available for temporary sabbatical-fill spots.
- If sabbatical expires and the member does not return, their spot is released.
- Sabbatical fee is charged per league per session.
- Sabbatical fee is never discounted.

### Sabbatical-fill spots

- Permanent vacancies are filled before temporary sabbatical-fill vacancies.
- A curler filling a temporary sabbatical spot receives a discount equal to the sabbatical fee.
- The sabbatical-fill discount is not reduced by other discounts.
- A temporary sabbatical-fill spot is not guaranteed permanently.
- The original member cannot return mid-session.
- Declining a temporary sabbatical-fill offer counts like declining a permanent spot.

### Waitlists

- A person does not need to be a member to join a waitlist.
- A person does need a user account to join a waitlist.
- A person must satisfy league eligibility rules to join that league's waitlist.
- Waitlist order is first-come, first-served.
- Waitlists automatically roll forward to successor leagues.
- Waitlist entries may be ADD or REPLACE.
- ADD means the person is trying to add the league as one of their first two leagues.
- REPLACE means the person is trying to replace an existing league with the waitlisted league.
- A member may be on an ADD waitlist only if they are currently in 0 or 1 leagues.
- There is no limit to the number of ADD waitlists.
- A member may be on at most two REPLACE waitlists.
- REPLACE waitlists must specify which league would be replaced.
- Once a member reaches two leagues, they must immediately resolve active ADD waitlist entries by removing them or converting up to two to REPLACE.
- Waitlist decline count is per waitlist instance.
- Decline count does not reset by time.
- Decline count resets if the person is removed and re-added or moved to the bottom.
- First decline keeps position.
- Second decline moves the person to the bottom.
- No response to an offer within 24 hours is treated as acceptance.
- Waitlist changes must be auditable in later phases.

### Third-league interest

- Third-league interest is collected during registration.
- Registrants may provide an ordered list of suitable third-league options.
- There is no limit to the number of third-league interest options.
- Third-league placement is manual/outside application scope for V1.
- Third-league interest defers payment.
- Third-league requests are handled only after first/second league demand is satisfied.
- BYOT cannot be selected as a third league.

### BYOT leagues

- BYOT means bring-your-own-team.
- BYOT leagues have team capacity.
- Each curler registers individually.
- A registrant requesting a BYOT league must provide teammates in a text box.
- New members may request BYOT leagues.
- Returning individuals may request BYOT leagues even if their prior team is not returning.
- BYOT leagues cannot be third leagues.
- BYOT leagues must count as one of the registrant's first two leagues.
- BYOT leagues do not use waitlists.
- BYOT leagues do not use sabbaticals.
- BYOT leagues are treated as guaranteed for payment timing.
- If a registrant later does not get a BYOT spot, staff handles correction/refund manually.

### Junior programs

- Junior Recreational is a special program.
- Junior Recreational has a flat fee.
- Junior Recreational covers membership and program participation.
- Junior Recreational participants cannot join other leagues.
- Junior Recreational participants cannot purchase spare-only privileges.
- Junior Recreational financial assistance options are none, 25%, 50%, or 75%.
- Junior Recreational financial assistance is subject to review.
- Payment is deferred until assistance decision if assistance is requested.
- Junior Advanced Commitment is treated as a normal league for registration and cost purposes.
- Junior Advanced Commitment participants pay regular membership plus the JAC league fee.
- JAC participants have normal regular-member ice privileges.
- JAC participants are likely eligible for student discount, but the normal student discount rules apply.

### Age and experience

- League age eligibility is based on the first day of the league.
- Leagues may define minimum age and maximum age.
- New member experience is self-reported.
- None or minimal experience only qualifies for instructional leagues.
- Experience may be fractional.
- Each completed session counts as 0.5 years of experience.
- Experience accrual is capped at 1.0 year per year.
- Staff may manually override league placement in exceptional cases in later phases.

## Required outputs

Phase 3 should produce:

- Business logic services/functions.
- Structured decision result types.
- Fee calculation outputs with itemized line items.
- Payment decision outputs with deferral reasons.
- Unit tests for all important rules.
- Test fixtures/factories for seasons, sessions, leagues, users, memberships, registrations, sabbaticals, waitlists, and pricing.
- Documentation updates if implementation reveals a gap.

## Acceptance criteria

Phase 3 is complete when:

- Eligibility decisions can be made without UI.
- Fee previews can be generated without Stripe.
- Payment timing can be determined without submitting a full registration.
- Returning rights can be evaluated from predecessor/successor league data.
- Sabbatical eligibility and expiration can be evaluated.
- ADD and REPLACE waitlist request validity can be evaluated.
- Third-league interest causes payment deferral.
- BYOT rules are enforced.
- Junior Recreational rules are enforced.
- Discounts are calculated correctly.
- Test coverage exists for all cases listed in `docs/registration/test-matrix.md`.
- Existing non-registration features continue to pass tests.

## Suggested implementation order

1. Create shared decision/result types.
2. Create test fixtures/factories.
3. Implement age and experience helpers.
4. Implement membership and ice privilege eligibility.
5. Implement league eligibility.
6. Implement returning rights.
7. Implement sabbatical eligibility.
8. Implement waitlist request validation.
9. Implement third-league and BYOT validation.
10. Implement fee calculation.
11. Implement payment decision service.
12. Add full test coverage.
13. Update docs with any confirmed clarifications.

## Handoff to Phase 4

At the end of Phase 3, produce a short handoff summary including:

- Services/functions created.
- Result object shapes.
- Known limitations.
- Any implementation assumptions.
- How UI code should call the business logic.
- Any remaining questions for the project owner.