# Phase 5: Membership, Discounts, Experience, and Basic Payment

## Objective

Implement the non-league portion of registration:

- Membership selection
- Spare-only ice privileges
- Discount collection and calculation
- Curling experience collection
- Immediate payment for registrations that do not require league placement
- Deferred-payment handling where required

This phase builds on the registration workflow shell from Phase 4 and prepares the registration record for league selection in Phase 6.

Phase 5 should **not** implement full league selection, guaranteed returns, sabbaticals, waitlists, BYOT league handling, third-league interest, or staff waitlist processing.

---

## Required reference documents

Before implementing this phase, read these documents and treat them as authoritative:

```text
docs/registration/rules.md
docs/registration/data-model.md
docs/registration/fee-calculation.md
docs/registration/eligibility.md
docs/registration/user-flow.md
docs/registration/test-matrix.md
```

If there is a conflict between this phase document and `rules.md`, `rules.md` wins.

If this phase reveals missing details in any of the above documents, update the relevant document as part of the implementation.

---

## Out of scope

Do **not** implement the following in Phase 5:

- League selection
- Returning league guarantees
- Sabbatical requests
- Waitlist ADD/REPLACE entries
- Waitlist rollover
- Third-league interest
- BYOT teammate collection
- Junior Advanced Commitment league registration
- Staff placement tools
- Staff waitlist tools
- Staff financial assistance review UI
- Registration changes after submission
- Refund flows

Some of these concepts may need to be represented in existing services or enums, but user-facing workflows for them are not part of this phase.

---

## Core business rules for this phase

### One registration is for one curler

A registration represents exactly one curler.

The person submitting the registration may be the curler or may be registering on behalf of the curler. Phase 4 should already support this.

---

### Membership season

Memberships are valid for one curling season.

The membership season is determined by the fiscal year start date:

- The tenant fiscal year starts July 1.
- A membership purchased on or after July 1 is for the season beginning in that fiscal year.
- Membership is valid September 1 through August 31 for that curling season.

For example:

- A membership purchased in August 2026 is for the 2026-27 curling season.
- A membership purchased in January 2027 is also for the 2026-27 curling season.
- That membership is valid through August 31, 2027.

---

### Membership types

Phase 5 must support these membership paths:

1. Regular membership
2. Social membership
3. Regular membership plus spare-only ice privileges

Junior Recreational is not fully implemented in Phase 5 unless the existing app already has enough support to add a simple deferred-payment placeholder. The full Junior Recreational flow, including financial assistance review, belongs in a later phase unless explicitly added to this phase by the implementer.

---

### Regular membership

Regular membership is the default membership choice.

Regular membership is required for:

- League participation
- Spare-only ice privileges
- Most ice privileges

A regular membership registration may be paid immediately if there are no non-guaranteed or deferred items.

In Phase 5, a regular membership without league selections may be submitted and paid if the user chooses not to continue into league selection or if the flow supports membership-only registration.

---

### Social membership

Social membership is for members who do not plan to curl in leagues.

Rules:

- Social members do not receive ice privileges.
- Social members cannot purchase spare-only ice privileges.
- Social members do not continue to league selection.
- Social membership is never discounted.
- A social membership registration is eligible for immediate payment.
- If a social member later upgrades to regular membership, they pay the full regular membership price and receive no credit for the social membership fee. The upgrade flow itself is out of scope for Phase 5 unless already supported elsewhere.

---

### Spare-only ice privileges

Spare-only is not a standalone membership type.

Spare-only means:

```text
Regular membership + spare-only ice privilege fee
```

Rules:

- Spare-only requires regular membership.
- Anyone eligible to join a league is eligible to purchase spare-only.
- Spare-only gives session-specific ice privileges.
- Spare-only may be purchased during registration.
- A spare-only registration does not require league selection.
- Spare-only registrations are eligible for immediate payment unless another deferred item is present.

Phase 5 should enforce that social members cannot purchase spare-only privileges.

---

### Ice privileges are session-specific

Ice privileges are tied to a session.

If a member buys fall ice privileges, they must still purchase winter ice privileges separately if they want winter ice privileges.

In Phase 5, spare-only ice privileges should be associated with the registration session being registered for.

---

### Club Bonspiel note

The Club Bonspiel is open to active club members who have purchased ice privileges for at least one session during the season.

This does not need a user-facing flow in Phase 5, but data produced in Phase 5 should make this determinable later.

---

## Discounts

Phase 5 must support these discounts:

1. Student discount
2. Reciprocal discount
3. Winter-only discount

Discounts may be fixed-dollar or percentage-based, according to tenant configuration.

### General discount rules

Discounts can be combined.

Discounts apply only to discount-eligible charges.

Social membership fees are never discount-eligible.

Sabbatical fees are never discount-eligible.

Sabbatical-fill discounts are handled separately and are out of scope for Phase 5.

If fixed-dollar discounts and percentage-based discounts are combined:

1. Apply fixed-dollar discounts first.
2. Then apply percentage-based discounts to the remaining discount-eligible subtotal.

Percentage discounts apply only to discount-eligible invoice items.

Discounts must not reduce the invoice below zero.

---

### Student discount

Student discounts are automatically approved.

To claim the student discount, the registrant must provide the institution of study.

Eligible students include:

- K-12 students
- Full-time college/university students

Phase 5 should collect and persist the self-reported institution name.

---

### Reciprocal discount

Reciprocal discounts are automatically approved.

To claim the reciprocal discount, the registrant must provide the name of the other dedicated ice or arena curling club where they are a member.

Phase 5 should collect and persist the self-reported club name.

---

### Winter-only discount

The winter-only discount applies when someone is registering starting with a session beyond the first session of the season.

This is not defined by a fixed calendar date.

Examples:

- If Fall is the first session of the season and Winter is the second session, someone beginning registration in Winter may be eligible for the winter-only discount.
- If a season has more than two sessions, the discount applies to registrations beginning with any session after the first session.

Rules:

- The winter-only discount applies only to regular membership dues.
- The winter-only discount does not apply to social membership.
- The winter-only discount does not apply to league fees, spare-only fees, sabbatical fees, or other charges unless explicitly configured otherwise in a later rule update.

Phase 5 must determine whether the registration session is beyond the first session of the season.

---

## Curling experience collection

Phase 5 must collect or confirm curling experience because it will be used by Phase 6 league eligibility.

### New curlers

New curlers must answer:

> What is your previous curling experience?

Allowed answers:

- None or minimal
- A specific number of years of experience

The number of years must support fractional values.

Examples:

- 0.5
- 1
- 1.5
- 3

Validation:

- Experience cannot be negative.
- If using a numeric field, decimals must be allowed.
- Values should be stored in a normalized numeric format.

### Returning curlers

For returning curlers, use known experience where available.

Experience should be calculated as:

- Self-reported prior experience
- Plus experience from curling with the club
- Each session counts as 0.5 years
- Maximum of 1.0 year of added experience per calendar/curling year

If the exact calculation service already exists from Phase 3, use it.

If it does not exist yet, Phase 5 may store the self-reported experience answer and leave the full derived-experience calculation to the eligibility service, but the UI should still display or collect enough information for Phase 6.

### None or minimal experience

A new curler choosing “None or minimal” should be represented distinctly from a numeric experience value where practical.

For eligibility purposes, “None or minimal” only qualifies the curler for instructional leagues.

Instructional league selection is out of scope for Phase 5.

---

## Registration statuses used in this phase

Phase 5 should integrate with the persisted registration workflow created in Phase 4.

At minimum, Phase 5 should support these conceptual outcomes:

### Draft

The user has started registration but has not submitted.

### Awaiting payment

The registration has been submitted and requires payment before confirmation.

### Paid / confirmed

The registration has been paid successfully.

### Deferred

The registration has been submitted but payment should not be collected yet.

Deferral can happen in later phases for:

- Non-guaranteed league placement
- Waitlist placement
- Third-league interest
- Junior Recreational financial assistance review
- Staff review

In Phase 5, deferred payment may be needed only if the current workflow includes a path that explicitly requires deferral.

### Cancelled / abandoned

Optional for Phase 5 unless already part of the app’s registration shell.

---

## Payment decision rules for Phase 5

A registration should proceed to immediate payment if all selected items are known and chargeable now.

Immediate-payment examples in Phase 5:

- Social membership only
- Regular membership only
- Regular membership plus student discount
- Regular membership plus reciprocal discount
- Regular membership plus winter-only discount
- Regular membership plus spare-only ice privileges
- Regular membership plus spare-only ice privileges plus eligible discounts

No-payment examples:

- Registration path only creates a user/account but does not purchase membership or ice privileges.
- Registration is only being prepared for a later waitlist-only flow, if such a path exists.

Deferred-payment examples:

- Any current or future selected item requires staff review or placement before billing.
- Junior Recreational financial assistance, if implemented in this phase.
- Any flow that is intentionally handed off to later league selection before invoice finalization.

When payment is deferred, the system must clearly record why.

---

## Invoice and line-item requirements

Phase 5 should produce itemized line items for payment calculations.

Line items should include enough metadata to distinguish:

- Regular membership
- Social membership
- Spare-only ice privilege fee
- Student discount
- Reciprocal discount
- Winter-only discount

Line items should support:

- Description
- Amount
- Quantity, if applicable
- Whether the item is discount-eligible
- Which discount adjusted the item, if applicable
- Final total

The fee calculator should be the source of truth.

The UI must not duplicate fee calculation logic.

---

## Stripe checkout integration

The app already has a Stripe checkout pipeline. Phase 5 should integrate registration payments into that pipeline.

### Immediate payment

For immediate-payment registrations:

1. User reviews registration.
2. User submits registration.
3. System creates the invoice or equivalent internal payment record.
4. System creates a Stripe Checkout Session.
5. User is redirected to Stripe.
6. On Stripe success webhook/callback:
   - Mark payment as successful.
   - Mark registration as paid/confirmed.
   - Persist paid line items.
   - Send confirmation email if email infrastructure exists.
7. On Stripe failure, cancellation, or incomplete checkout:
   - Do not confirm the registration.
   - Leave the registration in an unpaid or awaiting-payment state.
   - Allow user or staff to retry.

### Deferred payment

For deferred registrations:

1. User submits registration.
2. System records the selected items and fee estimate if appropriate.
3. System does not create a Stripe Checkout Session.
4. Registration is marked as deferred or awaiting staff action.
5. The reason for deferral is stored.

Staff-triggered payment links are out of scope unless already present.

---

## User flow for Phase 5

Phase 4 should already handle:

- Returning/new member question
- Login requirement for returning members
- Self vs. on-behalf-of registration
- Policy acceptance
- Demographic collection
- Minor parent/guardian collection

Phase 5 adds the following steps.

---

### Step 1: Membership selection

Show a clear, simple membership choice.

Default selection:

- Regular membership

Other option:

- Social membership

Suggested user-facing descriptions:

#### Regular Membership

Choose this if you plan to curl, spare, or register for leagues.

#### Social Membership

Choose this if you want to be a club member but do not plan to curl.

Important behavior:

- If social membership is selected, hide spare-only and league-related options.
- If regular membership is selected, continue to experience and ice privilege options.

---

### Step 2: Discount selection

If the selected membership or charges are discount-eligible, allow the registrant to claim available discounts.

Show:

- Student discount
- Reciprocal discount
- Winter-only discount, if eligible

Student discount fields:

- Checkbox or toggle to claim student discount
- Institution name, required if selected

Reciprocal discount fields:

- Checkbox or toggle to claim reciprocal discount
- Other curling club name, required if selected

Winter-only discount:

- Show automatically if eligible.
- It may either be auto-applied or shown as an available discount depending on existing discount design.
- It should not require user-entered proof.

Do not show discounts that cannot apply.

For example:

- Do not show discounts on social membership-only registrations.

---

### Step 3: Curling experience

For regular membership paths, ask for or confirm curling experience.

For new curlers, ask:

> What is your previous curling experience?

Options:

1. None or minimal
2. I have curled before

If “I have curled before” is selected, collect:

- Number of years of experience

For returning curlers:

- Show known or calculated experience if available.
- If no experience value is available, ask the same question as for new curlers.

---

### Step 4: Spare-only option

For regular members, offer spare-only ice privileges if the registration flow allows membership/ice privileges without league selection.

Suggested copy:

> I want spare-only ice privileges for this session.

If selected:

- Add the spare-only ice privilege fee.
- Do not require league selection.
- Continue to review/payment.

Rules:

- Social members cannot select spare-only.
- Spare-only is associated with the current registration session.
- Spare-only requires regular membership.

---

### Step 5: Review

Before payment, show a concise review screen.

The review must include:

- Curler name
- Membership type
- Session/season
- Claimed discounts
- Experience answer
- Spare-only selection, if any
- Itemized charges
- Total due now
- Whether payment is due now or deferred

For immediate payment, show:

> Payment is due now to complete this registration.

For deferred payment, show:

> No payment is due now. We will contact you when your registration is ready for payment.

Include a clear explanation of the deferral reason.

---

### Step 6: Submit and pay

If immediate payment is required:

- Submit the registration.
- Create the payment record.
- Redirect to Stripe Checkout.

If payment is deferred:

- Submit the registration.
- Do not create Stripe Checkout.
- Show a confirmation page explaining the next step.

If no payment is required:

- Submit the registration.
- Show a confirmation page.

---

## Implementation plan

### 1. Review existing Phase 0-4 work

Before writing code, inspect:

- Registration model/statuses
- Existing Stripe checkout pipeline
- Existing price/fee configuration
- Existing discount configuration
- Existing tenant fiscal year configuration
- Existing user/profile demographic model
- Existing registration shell routes/components
- Existing services from Phase 3

Do not duplicate existing services.

---

### 2. Add or confirm data fields

Confirm the registration data model can persist:

- Membership selection
- Membership season
- Registration session
- Spare-only selection
- Spare-only session
- Student discount claim
- Student institution
- Reciprocal discount claim
- Reciprocal club name
- Winter-only discount application
- Self-reported experience value
- None/minimal experience flag
- Fee calculation snapshot
- Payment decision
- Payment deferral reason
- Stripe checkout/session/payment references

If these fields already exist, reuse them.

If they do not exist, add migrations or model changes.

---

### 3. Implement membership selection UI

Add or update registration step components for:

- Regular membership
- Social membership
- Spare-only option for regular members

Ensure:

- Regular membership is selected by default.
- Social membership short-circuits league/ice privilege flow.
- Social membership cannot claim discounts.
- Social membership cannot choose spare-only.

---

### 4. Implement discount UI and persistence

Add UI and validation for:

- Student discount claim and institution
- Reciprocal discount claim and other club name
- Winter-only discount application

Ensure:

- Student institution is required if student discount is selected.
- Reciprocal club name is required if reciprocal discount is selected.
- Winter-only discount eligibility is based on whether the registration session is beyond the first session of the season.
- Discounts are not shown or applied to social membership.

---

### 5. Implement experience UI and persistence

Add UI for previous curling experience.

For new curlers:

- None/minimal
- Numeric years

For returning curlers:

- Display calculated/known experience if available.
- Fall back to asking if unavailable.

Validate numeric experience:

- Required when applicable
- Non-negative
- Fractional values allowed

---

### 6. Integrate fee calculation

Use the Phase 3 fee calculation service.

The fee calculator must return:

- Itemized charges
- Itemized discounts
- Discount-eligible subtotal
- Final total
- Explanation of applied discounts
- Whether total is payable now

Do not calculate totals in the UI.

The UI may display the fee calculator result only.

---

### 7. Implement payment decision service usage

Use the payment decision service to determine:

- Immediate payment
- Deferred payment
- No payment required

Store the decision on registration submission.

Store the explanation/deferral reason when applicable.

---

### 8. Integrate with Stripe checkout

For immediate-payment registrations:

- Create internal payment/invoice record.
- Create Stripe Checkout Session.
- Redirect to Stripe.

On successful payment:

- Mark payment successful.
- Mark registration paid/confirmed.
- Persist fee snapshot.
- Trigger confirmation email if available.

On failed/cancelled/incomplete payment:

- Do not confirm registration.
- Leave registration awaiting payment or unpaid.
- Allow retry if existing checkout pipeline supports retry.

---

### 9. Confirmation pages

Implement or update confirmation pages for:

- Paid/confirmed registration
- Awaiting payment
- Deferred payment
- No payment required

Each confirmation page should clearly explain the registration state.

---

### 10. Update docs

Update these docs if implementation details differ from existing docs:

```text
docs/registration/fee-calculation.md
docs/registration/eligibility.md
docs/registration/user-flow.md
docs/registration/test-matrix.md
docs/registration/data-model.md
```

Do not leave undocumented business-rule changes in code only.

---

## Validation rules

### Membership validation

- Membership type is required.
- Membership type must be regular or social.
- Regular membership is default.
- Social membership cannot include spare-only.
- Social membership cannot include discounts.
- Social membership cannot include ice privileges.

### Spare-only validation

- Spare-only requires regular membership.
- Spare-only must be tied to a session.
- Spare-only requires the curler to be eligible to join leagues generally.
- Spare-only cannot be selected with social membership.

### Student discount validation

- Student discount may be selected only when discount-eligible charges exist.
- Institution name is required.
- Institution name must not be blank.

### Reciprocal discount validation

- Reciprocal discount may be selected only when discount-eligible charges exist.
- Other club name is required.
- Other club name must not be blank.

### Winter-only discount validation

- Must only apply when registration begins with a session beyond the first session of the season.
- Must only apply to regular membership dues.
- Must not apply to social membership.
- Must not apply to spare-only fees.

### Experience validation

- New regular members must provide experience information.
- Numeric years must be non-negative.
- Fractional years are allowed.
- None/minimal must be stored distinctly or normalized clearly.

### Payment validation

- Registration cannot be marked paid until Stripe confirms payment.
- Failed/cancelled checkout does not confirm registration.
- Deferred registrations must not create a Stripe Checkout Session.
- Immediate-payment registrations must have a fee calculation snapshot before checkout.

---

## Required tests

Add or update tests in the relevant test locations.

### Unit tests: fee calculation

Test:

1. Regular membership only.
2. Social membership only.
3. Social membership receives no discounts.
4. Regular membership plus student discount.
5. Regular membership plus reciprocal discount.
6. Regular membership plus student and reciprocal discounts.
7. Regular membership plus winter-only discount.
8. Winter-only discount applies only to regular membership.
9. Winter-only discount does not apply during the first session of the season.
10. Fixed-dollar discounts apply before percentage discounts.
11. Percentage discounts apply only to discount-eligible charges.
12. Discounts cannot reduce invoice below zero.
13. Spare-only fee is added to regular membership.
14. Spare-only fee is not discounted unless explicitly marked discount-eligible by configuration.
15. Social membership plus spare-only is invalid.

### Unit tests: eligibility/payment decision

Test:

1. Social membership only requires immediate payment.
2. Regular membership only requires immediate payment.
3. Regular plus spare-only requires immediate payment.
4. Deferred registration does not create Stripe checkout.
5. Immediate-payment registration creates a payment intent/checkout session through the existing pipeline.
6. Payment failure does not confirm registration.
7. Payment success confirms registration.

### Unit tests: winter-only eligibility

Test:

1. First session of season: winter-only discount not eligible.
2. Second session of season: winter-only discount eligible.
3. Third session of season: winter-only discount eligible.
4. Social membership in second session: winter-only discount still not applied.

### Unit tests: experience

Test:

1. New curler can choose none/minimal.
2. New curler can enter 0.5 years.
3. New curler can enter whole-number years.
4. New curler cannot enter negative years.
5. Returning curler displays known experience.
6. Returning curler without known experience is prompted.

### Integration tests: user flows

Test:

1. New user registers for social membership and pays.
2. Returning user registers for social membership and pays.
3. New user registers for regular membership and pays.
4. New user registers for regular membership with student discount and pays.
5. New user registers for regular membership with reciprocal discount and pays.
6. New user registers for regular membership with both student and reciprocal discounts and pays.
7. New user registers for regular membership in a post-first session and receives winter-only discount.
8. New user registers for regular membership plus spare-only and pays.
9. Checkout cancellation leaves registration unpaid.
10. Checkout success marks registration paid/confirmed.

---

## Acceptance criteria

Phase 5 is complete when all of the following are true:

### Membership

- Users can choose regular or social membership.
- Regular membership is selected by default.
- Social membership short-circuits ice privilege and league-related paths.
- Social membership cannot receive discounts.
- Social membership can be paid immediately.

### Spare-only

- Regular members can purchase spare-only ice privileges.
- Spare-only is implemented as regular membership plus spare-only ice privilege fee.
- Social members cannot purchase spare-only.
- Spare-only is associated with the selected registration session.
- Spare-only registrations can be paid immediately when no deferred items exist.

### Discounts

- Student discounts are supported and automatically approved.
- Student institution is collected and required.
- Reciprocal discounts are supported and automatically approved.
- Reciprocal club name is collected and required.
- Winter-only discount applies when registration begins after the first session of the season.
- Winter-only discount applies only to regular membership.
- Discounts are calculated according to the canonical fee rules.
- Discount calculations are itemized and test-covered.

### Experience

- New regular members must provide curling experience.
- Experience supports none/minimal and fractional numeric years.
- Returning members use known/calculated experience where available.
- Experience data is persisted for later league eligibility.

### Payment

- Immediate-payment registrations create Stripe Checkout sessions.
- Successful Stripe payment confirms the registration.
- Failed or cancelled payment does not confirm the registration.
- Deferred registrations do not create Stripe Checkout sessions.
- Payment decisions are persisted with clear reasons.
- Fee calculation snapshots are stored before checkout.

### Documentation

- Relevant registration docs are updated if implementation details changed.
- Test matrix includes Phase 5 cases.
- No new business rules are introduced only in code.

---

## Suggested implementation prompt for an LLM

Use the following prompt to implement Phase 5 in a fresh context:

```text
You are implementing Phase 5 of the registration system: Membership,
Discounts, Experience, and Basic Payment.

Read these files first and treat them as authoritative:

- docs/registration/rules.md
- docs/registration/data-model.md
- docs/registration/fee-calculation.md
- docs/registration/eligibility.md
- docs/registration/user-flow.md
- docs/registration/test-matrix.md
- docs/registration/phases/phase-5-membership-payment.md

Do not implement league selection, waitlists, sabbaticals, BYOT, third-league
interest, or staff placement tools in this phase.

Before coding:
1. Summarize the Phase 5 requirements.
2. Identify existing files, models, services, and routes that need changes.
3. Identify any missing data fields or migrations.
4. Propose a concise implementation plan.
5. Wait for approval.

After approval:
1. Implement membership selection.
2. Implement discount collection and validation.
3. Implement experience collection.
4. Implement spare-only registration.
5. Integrate fee calculation.
6. Integrate payment decision logic.
7. Integrate immediate Stripe checkout.
8. Add/update tests.
9. Update docs if needed.
10. Provide a handoff summary for Phase 6.
```

---

## Handoff requirements for Phase 6

At the end of Phase 5, provide a handoff summary containing:

- New or changed database fields
- New or changed registration statuses
- New or changed routes/components
- New or changed services
- How membership choice is persisted
- How discounts are persisted
- How experience is persisted
- How fee calculation snapshots are stored
- How payment decisions are stored
- How Stripe checkout is initiated
- Known limitations intentionally deferred to Phase 6

Phase 6 will build league selection, guaranteed returns, sabbaticals, waitlists,
BYOT requests, Junior Recreational special handling, and third-league interest on
top of the Phase 5 foundation.