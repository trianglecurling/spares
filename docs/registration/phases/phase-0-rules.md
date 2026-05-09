# Phase 0 — Registration Rules Documentation

## Purpose

Phase 0 creates the canonical written registration rules for the application.

This phase does not implement application code.

The purpose is to produce a clear, complete, and internally consistent rules
document that future implementation phases can rely on.

The main output of this phase is:

```text
docs/registration/rules.md
```

This document becomes the source of truth for the registration system.

## Why this phase exists

Registration is the most complex component of the application.

It affects:

- Membership revenue
- League placement
- Waitlists
- Sabbaticals
- Discounts
- Stripe checkout
- Staff operations
- User accounts
- Delegated registration
- Junior programs
- Communications

Approximately 400 people will use the system multiple times per year, and the
system will process more than $200,000 annually.

Because of this, implementation must not depend on assumptions, memory, or
ambiguous interpretation.

Every implementation phase should reference `docs/registration/rules.md`.

## Primary deliverable

Create:

```text
docs/registration/rules.md
```

The document must define the registration rules in plain language.

It should be useful to:

- Developers
- LLM coding agents
- Staff reviewing business rules
- Future maintainers

It should not be written as user-facing help content. It is an internal product
and implementation rules document.

## Required sections

The rules document should include, at minimum, these sections:

1. Core definitions
2. Registration states
3. User categories
4. Login and accounts
5. Registering for yourself or another person
6. Required policy acceptance
7. Demographic information
8. Membership types and special programs
9. Membership and ice privileges
10. League types
11. League configuration
12. League eligibility
13. Returning members and guaranteed returns
14. Sabbaticals
15. Temporary sabbatical-fill spots
16. Waitlists
17. Filling open league spots
18. Third-league interest
19. Discounts
20. Fees
21. Payment rules
22. Registration flow
23. Staff operations
24. Auditing
25. Communications
26. User account visibility
27. Manual exceptions

## Important settled rules

The rules document must include the following settled decisions.

### Membership timing

The tenant fiscal year is July 1 through June 30.

Membership is valid September 1 through August 31.

Starting July 1, the app sells memberships for the season beginning in the
current fiscal year.

A membership purchased mid-season is valid through August 31 of that membership
year.

### Registration states

Registration states are:

- Closed
- Priority
- Open

Guaranteed returns and sabbatical requests require priority registration.

New members may register during priority registration but have no guaranteed
return rights.

### One registration per curler

Each registration is for one curler.

A parent may register multiple children by submitting one registration per child.

A person may register on behalf of another curler.

Delegated impersonation should be established when appropriate.

### Required policies

All registrants must agree to:

- Code of Conduct: `/go/conduct`
- Minor Athlete Abuse Prevention Policy: `/go/maapp`
- Privacy Policy: `/go/privacy`

The submitter agrees on behalf of the curler.

### Membership types

Membership/program paths include:

- Regular membership
- Social membership
- Regular membership plus spare-only ice privilege fee
- Junior Recreational
- Junior Advanced Commitment as a normal league/program structure

Spare-only is not its own membership type.

Spare-only equals regular membership plus spare-only ice privilege fee.

Social membership is never discounted.

Social members can upgrade to regular membership later, but:

- They pay the full regular membership price.
- The social membership fee is not credited.
- No discounts apply to the upgrade.

### Junior Recreational

Junior Recreational:

- Has a flat fee
- Covers membership and program participation
- Does not allow other leagues
- Does not allow sparing
- May include financial assistance request options of 25%, 50%, or 75%
- Defers payment if financial assistance is requested

### Junior Advanced Commitment

Junior Advanced Commitment is treated like a normal league for cost and
registration.

Participants pay:

- Regular membership fee
- JAC league fee

### Ice privileges

Ice privileges are session-specific.

Purchasing fall ice privileges does not grant winter ice privileges.

The Club Bonspiel is open to active club members who have purchased ice
privileges for at least one session during the season.

### League types

There are standard leagues and BYOT leagues.

Standard leagues use individual capacity.

BYOT leagues use team capacity, but each curler registers individually.

BYOT registrants must list teammates in a text field.

BYOT leagues:

- Do not use waitlists
- Do not use sabbaticals
- Cannot be third leagues
- Are treated as guaranteed for payment purposes
- May later require manual refund/correction if the coordinator does not place
  the registrant

### League continuity

Leagues are session-specific.

Continuity is established through predecessor/successor league configuration.

This continuity is used for:

- Guaranteed returns
- Sabbaticals
- Waitlist rollover

Waitlists automatically roll forward to successor leagues.

### Eligibility

League eligibility must be enforced before someone may register for or waitlist
for a league.

Eligibility includes:

- Age
- Experience
- Membership requirement
- League type restrictions
- Junior/adult rules

Age is calculated as of the first day of the league.

New members self-report experience.

Each completed session counts as 0.5 years of experience, with a maximum of 1.0
year per year.

`None or minimal` experience qualifies only for instructional leagues.

### Guaranteed returns

A returning member may protect at most two league spots total.

Protected claims include:

- Guaranteed return
- Sabbatical

A member cannot protect three league spots by combining returns and sabbaticals.

Guaranteed returns require priority registration.

### Sabbaticals

Sabbaticals:

- Require guaranteed-return eligibility
- Must be requested during priority registration
- Count toward the two protected-claim maximum
- Are limited to at most two leagues at once
- Are not available for BYOT leagues
- Are not available for temporary sabbatical-fill spots
- Do not require regular membership if the member is sabbatical-only

The default sabbatical duration limit is 3 years and must be configurable.

Sabbatical fees are charged per league per session and are never discounted.

Staff may override sabbatical limits in exceptional cases.

### Temporary sabbatical-fill spots

Temporary sabbatical-fill spots are offered through the waitlist.

The temporary curler:

- Must be told the spot is temporary
- Keeps their waitlist position
- Receives a discount equal to the sabbatical fee
- Is not guaranteed permanent return

The original sabbatical member cannot return mid-session.

### Waitlists

Users do not need to be members to join waitlists.

Users do need accounts to join waitlists.

Users must satisfy eligibility rules before joining waitlists.

Waitlists are first-come, first-served.

Waitlist entries are either:

- ADD
- REPLACE

ADD entries are allowed only if the person currently has 0 or 1 leagues.

There is no limit to ADD waitlists.

REPLACE entries require identifying the league being replaced.

A person may have at most two REPLACE waitlist entries.

When someone reaches two leagues, they must immediately clean up ADD waitlist
entries by removing them or converting at most two to REPLACE entries.

### Waitlist offers

Staff may send waitlist offers.

Users have 24 hours to decline.

No response within 24 hours is treated as acceptance.

First decline keeps position.

Second decline moves the user to the bottom of the waitlist.

Decline count is per waitlist instance and does not reset over time.

Removing/re-adding resets decline count.

Declining temporary sabbatical-fill counts as a decline.

### Filling open spots

For standard leagues, placement priority is:

1. Guaranteed returns and sabbatical returns
2. Remaining permanent spots from the waitlist
3. Temporary sabbatical-fill spots from the waitlist
4. Third-league requests after first/second league demand is satisfied

Permanent spots are filled before temporary sabbatical-fill spots.

### Third-league interest

Third-league interest is collected during registration.

Registrants may provide an ordered list of suitable third-league options.

There is no limit to the number of third-league options.

Third-league interest defers payment.

Third-league placement may be manual/outside the application for V1.

BYOT leagues cannot be third-league options.

### Discounts

Discounts include:

- Student
- Reciprocal
- Winter-only

Student and reciprocal discounts are automatically approved after required
self-reported information is provided.

Student discount requires institution.

Reciprocal discount requires other club name.

Winter-only discount applies when someone registers starting with a session
beyond the first session of the season.

Winter-only discount applies only to regular membership dues.

Discounts apply only to discount-eligible charges.

Social membership and sabbatical fees are never discount-eligible.

Dollar discounts apply before percentage discounts.

Percentage discounts apply to discount-eligible invoice items.

Sabbatical-fill discount is separate and always equals the full sabbatical fee.

### Payment

The app should avoid multiple payments whenever possible.

Immediate payment is used when all selected items are confirmed and no deferral
reason exists.

Payment is deferred if any selected item is uncertain or requires review.

Deferral reasons include:

- Waitlist placement
- Non-guaranteed league request
- Third-league interest
- Junior Recreational financial assistance review
- Staff placement/review

If payment is deferred, membership dues may also be deferred.

If payment fails or is incomplete, registration is not confirmed.

### Staff operations

Staff can manually handle:

- Registration changes
- Billing corrections
- Refunds
- Roster changes
- Waitlist changes
- Placement corrections
- Payment issues

Waitlist-related changes must be audited.

### Auditing

Any waitlist update must be audited.

The audit must capture:

- What changed
- Why it changed
- Who made the change, if applicable
- Whether it was manual or automatic
- Timestamp

## Out of scope for Phase 0

Phase 0 does not include:

- Database migrations
- UI implementation
- Stripe integration changes
- Admin screens
- Tests
- Email templates
- Waitlist processing code
- Registration workflow code

Those are handled in later phases.

## Acceptance criteria

Phase 0 is complete when:

- `docs/registration/rules.md` exists.
- It includes all known settled registration rules.
- It does not leave known policy decisions ambiguous.
- It does not contradict itself.
- It is detailed enough for future LLM coding agents to implement against.
- It clearly separates V1 app behavior from manual staff processes.
- It identifies staff-manual operations where automation is not required.
- It can be referenced as the authoritative source in future phase prompts.

## Recommended prompt for future phases

Future LLM implementation prompts should begin with:

```text
Read docs/registration/rules.md first.

Treat it as the authoritative source of truth for registration rules.

If your assumptions conflict with docs/registration/rules.md, the rules document
wins.

Do not implement behavior outside the current phase unless explicitly requested.
```

## Handoff to Phase 1

After Phase 0, Phase 1 should design and implement the data model needed to
support the rules.

Phase 1 should not reinterpret registration policy.

It should map the rules into database structures, migrations, constraints, and
types.

Likely Phase 1 outputs include support for:

- Registration records
- Registration selections
- Registration state/configuration
- League registration settings
- League predecessor/successor links
- Waitlist entries with ADD/REPLACE support
- Waitlist audit events
- Sabbatical records
- Pricing and discount configuration
- Payment/deferred-payment state