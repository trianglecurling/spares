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
- Billed-now leagues (guaranteed entries plus subject-to-availability entries)
  fill the desired league count, so nothing about the league outcome is still
  unresolved.
- No staff review is required.
- No Junior Recreational financial assistance request is pending.

Examples:

- Social membership only.
- Regular membership, desired league count of 2, with two guaranteed entries.
- Regular membership, desired league count of 1, with one guaranteed entry, even
  if the priority list has four more leagues on it.
- Regular membership, desired league count of 1, with one subject-to-availability
  league (no waitlist; assumed to have room).
- Regular membership plus spare-only fee.
- Sabbatical-only registration.
- Junior Recreational without financial assistance.

## Deferred payment

Payment is deferred when any selected item requires later placement or review.

Deferral reasons include:

- Fewer billed-now leagues on the priority list than the desired league count.
- Waitlist placement still needed to fill the desired count.
- Play-in entry that has not cleared the TLINE guarantee bar.
- Junior Recreational financial assistance request.
- Staff review required.

If any deferral reason exists, payment for the entire registration is deferred whenever possible.

The system should avoid multiple payments for the same registration when practical.

## Estimated range for deferred registrations

A deferred registration is quoted as a range, not a single total:

- **Floor** — the confirmed total: membership and other fixed fees plus the
  league fees for every guaranteed entry and every subject-to-availability
  entry filling a remaining desired-count slot.
- **Ceiling** — the floor plus the remaining desired-count slots' most
  expensive unbilled entries on the priority list.

The ceiling uses the most expensive remaining entries rather than the
next-by-priority entries so the quoted maximum is a true upper bound. Fees are
summed per league because leagues differ in price and some daytime leagues are
configured at zero.

When floor and ceiling are equal, show a single total instead of a range.

## No payment required

No payment is required when the registration creates no immediate charges.

Examples:

- New non-member joining waitlists only.
- Registration consisting only of waitlist entries with no membership, league, spare-only, sabbatical, or program fee currently due.

## BYOT payment timing

A bring-your-own-team entry with a full roster is treated as guaranteed for
payment timing, so it contributes to the confirmed total.

If the coordinator later determines the registrant is not placed, staff handles refund/correction manually.

BYOT entries must be ranked above every standard league on the priority list.

## Entries below the desired count

Entries ranked below a registrant's desired league count never affect the floor
and never trigger a deferral on their own. They only widen the ceiling when the
registrant has fewer guarantees than their desired count.

## Junior Recreational financial assistance

If Junior Recreational financial assistance is requested, payment is deferred until staff decides the assistance request.

After the decision:

- The family is invoiced for the approved amount.
- If the family does not wish to proceed, staff can handle withdrawal/cancellation.

## Sabbatical payment timing

If the registration is sabbatical-only and no deferral reason exists, payment is immediate.

If the registration includes sabbatical plus a waitlist, incomplete roster, or
play-in miss, the entire payment is deferred.

## Voluntary pay later

When payment would otherwise be immediate, registrants may always choose **Pay later**.

Pay later:

- Does not change the payment decision outcome (`immediate_payment` still applies).
- Creates a hosted checkout payment link via the configured payment provider and emails it immediately (`registration_submitted_immediate_payment`).
- Does not redirect the browser to checkout; the registrant continues to the success page.
- Warns that payment must be completed by the configured payment deadline (Registration schedule admin), or **before leagues begin** when no deadline is set, to secure league selections.
- Guaranteed league selections and billed subject-to-availability leagues are placed on the roster while payment is outstanding (same as other submitted unpaid statuses). Staff removes non-payers and may promote from the waitlist.

## Failed or incomplete immediate payment

If immediate payment fails or is not completed:

- Registration is not confirmed as paid.
- Guaranteed and billed subject-to-availability roster placements may already exist from submission; staff handles cleanup for non-payers.
- Staff may help resolve the issue manually.

## Required payment decision output

The payment decision service should return:

- Outcome:
  - immediate_payment
  - deferred_payment
  - no_payment_required
- Deferral reason codes
- Human-readable explanation
- Whether staff review is required
- Whether hosted checkout should be created now
- Whether a payment link may be generated later
- Total due from fee calculation
- Optional warnings

## Deferral reason code examples

- non_guaranteed_league
- waitlist_placement_pending
- play_in_placement_pending
- junior_financial_assistance_review
- staff_review_required
- registration_has_pending_placement