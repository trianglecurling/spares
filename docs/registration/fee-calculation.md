# Registration Fee Calculation

## Purpose

The fee calculator produces an itemized invoice preview for registration.

It should not create Stripe checkout sessions.

It should not decide whether payment happens now or later. That is handled by the payment decision service.

## Required output

The fee calculator should return:

- Line items
- Discount line items
- Subtotal before discounts
- Discount total
- Total due
- Discount-eligible subtotal
- Non-discountable subtotal
- Notes or warnings

## Charge types

The calculator must support:

- Regular membership fee
- Social membership fee
- League fee
- Spare-only ice privilege fee
- Sabbatical fee
- Junior Recreational flat fee
- Approved Junior Recreational financial assistance
- Temporary sabbatical-fill discount

## Membership fees

### Regular membership

Regular membership is discount-eligible unless excluded by a specific rule.

Winter-only discount applies only to regular membership dues.

### Social membership

Social membership is never discount-eligible.

If a social member upgrades to regular membership later:

- They pay the full regular membership price.
- They receive no credit for the social membership fee.
- They receive no discounts on the upgrade.

### Junior Recreational

Junior Recreational has a flat fee that covers membership and program participation.

Financial assistance may reduce the Junior Recreational amount if approved.

If financial assistance is requested but not yet decided, payment is deferred and the final amount may not yet be known.

## League fees

League fees are discount-eligible unless configured otherwise.

If a registrant is later not placed for league play, staff handles refund/correction manually.

## Spare-only fee

Spare-only consists of:

- Regular membership fee.
- Spare-only ice privilege fee.

The spare-only ice privilege fee should be treated like an ice privilege/league-related fee for discount eligibility unless configuration says otherwise.

## Sabbatical fee

Sabbatical fee is charged per sabbatical league per session.

Sabbatical fee is never discount-eligible.

A sabbatical-only registrant does not need regular membership.

## Sabbatical-fill discount

A registrant filling a temporary sabbatical spot receives a discount equal to the sabbatical fee.

This discount:

- Is always exactly the full sabbatical fee.
- Is applied separately from other discounts.
- Is not reduced by percentage discounts.
- Is an exception to the general dollar-before-percentage rule.
- Applies to the league fee associated with the temporary sabbatical-fill spot.

## Discounts

Supported discounts:

- Student discount
- Reciprocal discount
- Winter-only discount

Student and reciprocal discounts are automatically approved when required self-reported information is provided.

### Student discount

Requires self-reported institution of study.

Eligible examples:

- K-12 student
- Full-time college/university student

### Reciprocal discount

Requires self-reported membership in another dedicated ice or arena curling club.

### Winter-only discount

The winter-only discount applies when someone is registering starting with a session beyond the first session of the season.

The winter-only discount applies only to regular membership dues.

It does not apply to:

- Social membership
- Sabbatical fees
- League fees
- Spare-only fee
- Junior Recreational fee unless separately configured

## Discount order

When multiple discounts apply:

1. Identify discount-eligible charges.
2. Exclude non-discountable charges.
3. Apply ordinary dollar discounts to discount-eligible charges first.
4. Apply ordinary percentage discounts after dollar discounts.
5. Apply sabbatical-fill discount separately according to its own rule.
6. Add non-discountable charges.
7. Produce final total.

## Discount scope

Discounts apply only to discount-eligible charges.

Non-discountable charges include:

- Social membership fees
- Sabbatical fees

Winter-only discount has narrower scope and applies only to regular membership dues.

## Combining discounts

Student, reciprocal, and winter-only discounts may be combined when eligible. It may be the case that any combination of the three are applied.

## Rounding

Use the app's standard currency rounding rules.

If no standard exists, round currency calculations to the nearest cent at the final line-item/discount calculation boundaries in a deterministic way.

## Negative totals

The invoice total must never be negative.

If discounts exceed eligible charges, cap the discount so the total does not go below zero.

## Fee calculation examples

### Returning member with two guaranteed leagues

Charges:

- Regular membership
- League fee 1
- League fee 2

Discounts:

- Any eligible student/reciprocal/winter-only discounts

Payment decision is separate, but this scenario is likely immediate payment if no other deferral reasons exist.

### Sabbatical-only

Charges:

- Sabbatical fee

No regular membership required.

No discounts apply to sabbatical fee.

### Spare-only

Charges:

- Regular membership
- Spare-only ice privilege fee

Eligible discounts may apply according to normal rules.

### Social membership

Charges:

- Social membership

No discounts apply.

### Junior Recreational with approved 50% assistance

Charges:

- Junior Recreational flat fee

Discount/reduction:

- Approved 50% financial assistance

Payment amount:

- Remaining 50%

### Temporary sabbatical-fill

Charges:

- Regular membership, if required
- League fee

Discount:

- Sabbatical-fill discount equal to sabbatical fee

Other discounts:

- Apply according to normal discount rules, excluding the sabbatical-fill discount from percentage reduction behavior.