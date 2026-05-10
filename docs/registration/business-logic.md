# Registration Business Logic

## Purpose

This document describes the business logic layer for registration.

The business logic layer is responsible for making registration decisions. It should be reusable from:

- User registration flow.
- Staff tools.
- Payment generation.
- Waitlist management.
- Registration review screens.
- Automated tests.

## Core idea

Registration should be evaluated from a normalized registration context.

The registration context represents:

- Who is registering.
- Who submitted the registration.
- Which season/session is being registered for.
- What the registrant selected.
- What the registrant is eligible for.
- Existing memberships, leagues, sabbaticals, and waitlists.
- League configuration.
- Pricing and discount configuration.

Business logic services should return structured decisions rather than directly performing side effects.

## Recommended services

### Registration context builder

Builds a normalized context object.

The context should include:

- Tenant
- Season
- Session
- Registration state
- Whether this is the first session of the season
- Membership season derived from fiscal year start
- Registrant user/profile
- Submitted-by user/profile
- Date of birth
- Existing membership status
- Existing ice privilege status
- Existing league participation
- Existing waitlist entries
- Existing sabbaticals
- League options
- League predecessor/successor relationships
- Pricing configuration
- Discount configuration
- Registration selections

### Eligibility service

Answers whether a registrant may select a given option.

It should evaluate:

- Membership eligibility
- League eligibility
- Age eligibility
- Experience eligibility
- Spare-only eligibility
- Waitlist eligibility
- ADD/REPLACE waitlist eligibility
- Sabbatical eligibility
- Guaranteed return eligibility
- Junior program eligibility
- BYOT eligibility

### Returning rights service

Answers what protected return rights the registrant has.

It should determine:

- Which predecessor leagues matter.
- Whether the registrant played in the predecessor league.
- Whether the registrant has an active sabbatical.
- Whether the registrant can return.
- Whether the registrant can extend sabbatical.
- Whether the registrant has exceeded the protected-claim limit.

### Fee calculator

Produces an invoice preview.

It should return:

- Line items
- Discount line items
- Subtotal
- Discount total
- Total due
- Items excluded from discount
- Warnings or notes

The fee calculator should not create Stripe checkout sessions.

### Payment decision service

Determines whether payment is immediate, deferred, or not required.

It should return:

- Payment timing
- Deferral reasons
- Whether staff review is required
- Whether Stripe checkout should be created later
- Human-readable explanation

## Decision object expectations

Business logic should return structured objects.

A decision should include:

- A status
- Machine-readable reason codes
- Human-readable messages
- Blocking errors
- Non-blocking warnings
- Relevant calculated values

Example statuses:

- eligible
- ineligible
- allowed
- blocked
- immediate_payment
- deferred_payment
- no_payment_required
- requires_staff_review

## Reason code examples

Use stable reason codes so UI, tests, and logs can rely on them.

Examples:

- registration_closed
- not_priority_registration
- under_minimum_age
- over_maximum_age
- insufficient_experience
- junior_recreational_exclusive
- social_membership_no_ice
- regular_membership_required
- byot_cannot_be_third_league
- byot_no_waitlist
- byot_no_sabbatical
- sabbatical_requires_return_right
- sabbatical_limit_exceeded
- protected_claim_limit_exceeded
- add_waitlist_requires_zero_or_one_leagues
- replace_waitlist_limit_exceeded
- replace_waitlist_requires_replaced_league
- third_league_interest_defers_payment
- junior_financial_assistance_requires_review
- non_guaranteed_league_defers_payment
- all_items_guaranteed
- no_payment_due

## Side effect rules

Phase 3 business logic should avoid side effects.

It should not directly:

- Add someone to a roster.
- Add someone to a waitlist.
- Create a sabbatical.
- Create an invoice.
- Create a Stripe checkout session.
- Send email.
- Mutate registration status.

Later phases may consume Phase 3 outputs to perform those actions.

## Validation levels

Some rules are hard blocks. Others are warnings or staff-review conditions.

### Hard blocks

Examples:

- Under minimum age.
- Over maximum age.
- Insufficient experience.
- BYOT selected as third league.
- Junior Recreational plus another league.
- Sabbatical requested without guaranteed-return eligibility.
- More than two protected claims.
- More than two REPLACE waitlists.
- ADD waitlist while already in two leagues.

### Staff-review or deferred conditions

Examples:

- Junior Recreational financial assistance requested.
- Third-league interest submitted.
- Non-guaranteed league request.
- Waitlist placement required.
- BYOT later not placed by coordinator.
- Sabbatical duration requiring staff override.

## Testing requirement

Every major rule should have at least one unit test.

See `docs/registration/test-matrix.md`.