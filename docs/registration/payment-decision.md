# Registration Payment Decision Rules

## Purpose

The payment decision service determines whether payment should be collected immediately, deferred, or not required.

It should not calculate final fee amounts itself. It should consume fee calculation output and registration selection decisions.

## Payment outcomes

Possible outcomes:

- Immediate payment
- Deferred payment
- No payment required

## Immediate payment

Payment is immediate when:

- Registration is otherwise valid.
- There is an amount due.
- All selected items are guaranteed or treated as guaranteed for payment timing.
- No staff review is required.
- No third-league interest exists.
- No non-guaranteed league placement is pending.
- No Junior Recreational financial assistance request is pending.

Examples:

- Social membership only.
- Regular membership plus one or two guaranteed return leagues.
- Regular membership plus spare-only fee.
- Sabbatical-only registration.
- Junior Recreational without financial assistance.
- BYOT request, because BYOT is treated as guaranteed for payment timing.

## Deferred payment

Payment is deferred when any selected item requires later placement or review.

Deferral reasons include:

- Non-guaranteed league request.
- Waitlist placement.
- Return subject to availability.
- ADD waitlist request that may result in placement.
- REPLACE waitlist request that may result in placement.
- Third-league interest.
- Junior Recreational financial assistance request.
- Staff review required.
- Any other non-guaranteed league outcome.

If any deferral reason exists, payment for the entire registration is deferred whenever possible.

The system should avoid multiple payments for the same registration when practical.

## No payment required

No payment is required when the registration creates no immediate charges.

Examples:

- New non-member joining waitlists only.
- Registration consisting only of waitlist entries with no membership, league, spare-only, sabbatical, or program fee currently due.

## BYOT payment timing

BYOT leagues are treated as guaranteed for payment timing.

A registrant requesting BYOT may pay immediately if there are no other deferral reasons.

If the coordinator later determines the registrant is not placed, staff handles refund/correction manually.

BYOT cannot be a third league.

## Third-league interest

Third-league interest always defers payment.

This applies even if the registrant also has one or two guaranteed leagues.

Reason:

- The final league placement and amount due may change.
- The club wants to avoid multiple payments where possible.

## Junior Recreational financial assistance

If Junior Recreational financial assistance is requested, payment is deferred until staff decides the assistance request.

After the decision:

- The family is invoiced for the approved amount.
- If the family does not wish to proceed, staff can handle withdrawal/cancellation.

## Sabbatical payment timing

If the registration is sabbatical-only and no deferral reason exists, payment is immediate.

If the registration includes sabbatical plus a non-guaranteed item, the entire payment is deferred.

## Failed or incomplete immediate payment

If immediate payment fails or is not completed:

- Registration is not confirmed.
- Staff may help resolve the issue manually.

No league spot is awarded based on checkout race timing.

## Required payment decision output

The payment decision service should return:

- Outcome:
  - immediate_payment
  - deferred_payment
  - no_payment_required
- Deferral reason codes
- Human-readable explanation
- Whether staff review is required
- Whether Stripe checkout should be created now
- Whether a payment link may be generated later
- Total due from fee calculation
- Optional warnings

## Deferral reason code examples

- non_guaranteed_league
- waitlist_placement_pending
- return_subject_to_availability
- third_league_interest
- junior_financial_assistance_review
- staff_review_required
- registration_has_pending_placement