# Registration Rules

This document is the canonical source of truth for the registration system.

If another document, implementation detail, or prompt conflicts with this document, this
document wins unless it has been explicitly superseded by a later approved change.

## 1. Core definitions

### Season

A curling season spans one curling year and typically runs from September through May.

A season is commonly named using two calendar years, such as:

- 2025-26 season
- 2026-27 season

Memberships are valid for one curling season.

### Session

A season is divided into sessions.

The club typically has two sessions:

- Fall session: approximately September through December
- Winter session: approximately January through May

There may be other sessions.

A league exists within one session only. Teams, games, standings, scores, rosters,
and registrations are session-specific.

### Fiscal year

The tenant fiscal year is configured in the app.

For this tenant, the fiscal year is:

- July 1 through June 30

The fiscal year is used to determine which membership season is being sold.

### Membership year

Membership is technically valid from:

- September 1 through August 31

A membership purchased during a season is valid through August 31 of that same
membership year.

Example:

- A membership purchased in January 2026 for the 2025-26 season is valid through
  August 31, 2026.

Starting on July 1, the system sells memberships for the curling season beginning
in the current fiscal year.

Example:

- On July 1, 2026, the system begins selling memberships for the 2026-27 season.

## 2. Registration states

Registration may be in one of three states:

1. Closed
2. Priority
3. Open

### Closed

Registration is unavailable.

### Priority

Registration is available.

Returning members may claim eligible guaranteed return spots during priority
registration.

Sabbaticals may only be requested during priority registration.

New members may also register during priority registration, but they do not have
guaranteed return rights.

### Open

Registration is available.

Returning members may still register, but guaranteed return rights are no longer
available unless staff manually handles an exception.

Sabbaticals cannot be requested during open registration.

### Scheduled state changes

Registration state changes should be configurable by date/time.

Example:

- Priority registration begins August 15 at 12:00 PM.
- Open registration begins August 31 at 12:00 PM.

## 3. User categories

### Anonymous visitors

Users who have not logged in.

### Logged-in users

Users who have authenticated by email.

Being logged in alone does not imply membership or ice privileges.

### Current members

Users who have paid dues for the current membership year.

There are multiple member categories:

- Regular members
- Social members
- Junior Recreational members

### Current members with ice privileges

Users who have purchased ice privileges for a session.

Ice privileges are session-specific.

A person who purchases fall ice privileges must still purchase winter ice
privileges if they want winter ice access.

## 4. Login and accounts

The app uses email-based login without passwords.

A person must have a user account to join a waitlist.

A new user's account can be created during registration.

Returning members must log in before registering.

The first question in the registration flow should be:

> Are you a returning member?

If the answer is yes, the user must enter their email address and log in.

The app will not support account merging for V1.

## 5. Registering for yourself or another person

A user may register:

- Themself
- Another curler
- Multiple curlers through separate registrations

One registration is for exactly one curler.

A parent may register multiple children, but each child has a separate
registration.

If user X registers on behalf of curler Y:

- The demographic information should be for Y, the curler.
- X may provide a separate email address for Y.
- X may use X's own email address for Y if appropriate.
- Delegated impersonation should be established so X can manage/register Y in
  the future.

If X is not curling and is only registering Y, X may still need an account.

Example:

- Parent uses `parent@example.com`
- Child uses `child@example.com`
- Child's account explicitly grants delegated impersonation to the parent.

If the same email address is used for both, the app's existing support for
multiple accounts per email applies.

## 6. Required policy acceptance

All registrants must agree to these policies before continuing:

1. Code of Conduct: `/go/conduct`
2. Minor Athlete Abuse Prevention Policy: `/go/maapp`
3. Privacy Policy: `/go/privacy`

The person submitting the registration agrees on behalf of the curler being
registered.

For minors, the parent/guardian or submitting registrant agrees on the minor's
behalf.

Waivers are handled separately and are not part of this registration rules
document.

## 7. Demographic information

### New curlers

For a new curler, collect:

- First name
- Last name
- Date of birth
- Email address
- Phone number
- Mailing address
- Emergency contact name
- Emergency contact phone number

This information should describe the curler, not necessarily the person filling
out the registration.

### Returning curlers

For returning curlers:

- Show existing demographic information.
- Ask whether it is still current.
- If not current, require the user to update it before continuing.

### Minors

If the curler is under 18, collect parent/guardian information:

- First name
- Last name
- Email address
- Phone number

The parent/guardian may copy email and phone number from the curler information.

Age is determined using the curler's date of birth.

For league age eligibility, age is calculated as of the first day of the league.

## 8. Membership types and special programs

### Regular membership

Regular membership is the main membership type for curlers.

Regular membership is required for:

- League play, unless the league does not require club membership
- Spare-only ice privileges
- Junior Advanced Commitment
- Most ice privileges

Regular membership can be discounted when eligible.

### Social membership

Social membership is for non-curling members.

Social members:

- Do not have ice privileges
- Cannot join leagues
- Cannot purchase spare-only ice privileges
- Cannot receive membership discounts

Social membership is never discounted for any reason.

### Social-to-regular upgrade

A social member may upgrade to regular membership later.

Rules:

- They pay the full regular membership price.
- The social membership fee is not credited.
- They receive no discounts on the upgrade.

### Spare-only

Spare-only is not a standalone membership type.

Spare-only equals:

- Regular membership
- Plus a spare-only ice privilege fee

Anyone eligible to join a league is eligible to purchase spare-only access.

Spare-only can be purchased during registration.

Spare-only provides ice privileges for sparing, subject to club rules.

### Junior Recreational Program

Junior Recreational is a special junior program.

Rules:

- It is handled separately from normal league registration.
- It charges a flat Junior Recreational fee.
- The flat fee covers membership and the program.
- Junior Recreational participants cannot join any other leagues.
- Junior Recreational participants cannot spare.
- Junior Recreational participants do not proceed through normal league
  selection.

Junior Recreational participants may request financial assistance.

Available assistance request levels:

- None
- 25%
- 50%
- 75%

Financial assistance:

- Applies only to Junior Recreational.
- Is subject to staff review.
- Depends on budget and applicant pool.
- Defers payment until a decision is made.

### Junior Advanced Commitment

Junior Advanced Commitment is treated like a normal league for registration and
cost purposes.

JAC participants pay:

- Regular membership fee
- JAC league fee

They have the same structure as other regular members joining a league.

JAC participants are likely eligible for the student discount.

JAC participants may join other leagues using the same rules as everyone else,
subject to league eligibility.

## 9. Membership and ice privileges

Ice privileges are session-specific.

A user may obtain ice privileges for a session by:

- Registering for one or more eligible leagues
- Purchasing spare-only ice privileges
- Participating in an eligible program that confers ice privileges

Social members do not have ice privileges.

The only club activity that requires ice privileges but is not league-specific is
the Club Bonspiel.

The Club Bonspiel is open to active club members who have purchased ice
privileges for at least one session during the season.

## 10. League types

There are two main league types:

1. Standard
2. Bring-your-own-team

### Standard leagues

Standard leagues have individual capacity.

Example:

- A league may have a capacity of 40 curlers.

Teams are formed by the league coordinator.

Standard leagues may participate in:

- Guaranteed returns
- Sabbaticals
- Waitlists
- Temporary sabbatical-fill placements
- Third-league interest

### Bring-your-own-team leagues

Bring-your-own-team leagues are called BYOT leagues.

BYOT leagues have team capacity.

Each curler still registers individually.

When registering for a BYOT league, the registrant must list teammates in a
simple text field.

BYOT rules:

- New members may request a BYOT league.
- Returning members may request a BYOT league.
- A returning individual may select a BYOT league even if their team is not
  returning.
- BYOT leagues cannot be selected as a third league.
- BYOT leagues must count as one of the registrant's first two leagues.
- BYOT leagues do not use the waitlist system.
- BYOT leagues do not use the sabbatical system.
- BYOT leagues are treated as guaranteed for payment purposes.
- League coordinators manually fill rosters after registration.
- Some registrants may not receive a spot.
- If someone pays and later does not receive a spot, staff handles the refund or
  correction manually.

## 11. League configuration

Each league exists for one session.

Each league may have registration-related configuration including:

- League type: standard or BYOT
- Fee
- Capacity
- Capacity type: individual or team
- Whether club membership is required
- Whether the league is instructional
- Minimum years of curling experience required
- Minimum age
- Maximum age
- First day of play
- Last day of play
- Whether waitlists are allowed
- Whether sabbaticals are allowed
- Predecessor league
- Successor league

### League continuity

League entities are session-specific.

Continuity is established by configuring a league as the successor of another
league.

Example:

- Winter 2026 Tuesday Evening is the successor of Fall 2025 Tuesday Evening.

The predecessor/successor chain is used for:

- Guaranteed return eligibility
- Sabbatical continuity
- Waitlist rollover

Every league where continuity matters should have predecessor/successor
relationships configured.

Circular league continuity chains must not be allowed.

## 12. League eligibility

League eligibility must be checked before a user can join, request, or waitlist
for a league.

Eligibility rules may include:

- Age
- Experience
- Membership requirement
- Junior/adult program restrictions
- BYOT restrictions
- League-specific settings

### Age eligibility

Each league may have:

- Minimum age
- Maximum age

Age is calculated as of the first day of the league.

A person who does not satisfy the age limits may not register for or join that
league's waitlist.

### Experience eligibility

Some leagues require prior curling experience.

New members self-report experience.

Experience options should include:

- None or minimal
- Specific number of years, including fractional years

`None or minimal` experience qualifies only for instructional leagues.

For returning members, the system should track experience.

Experience accrual rule:

- Each completed session counts as 0.5 years of experience.
- A user can accrue a maximum of 1.0 year of experience per season/year, even if
  the club has more than two sessions that year.

Staff may manually override league placement in exceptional cases.

## 13. Returning members and guaranteed returns

A returning member may be eligible to return to leagues from the configured
predecessor session.

A member is eligible for a guaranteed return only if:

- They participated in the predecessor league, or
- They hold a valid sabbatical right for that league lineage, and
- They register during priority registration, and
- The league permits the relevant return behavior.

A returning member may protect at most two league spots total.

Protected claims include:

- Guaranteed return to a league
- Sabbatical for a league

Example:

- A member cannot play in two guaranteed-return leagues and also take sabbatical
  for a third.
- A member could return to one league and take sabbatical for one league.
- A member could take sabbatical for two leagues.
- A member could return to two leagues.

If a member participated in Fall 2025, skipped Winter 2026 without an official
sabbatical, and wants to return in Fall 2026, they are not guaranteed a spot
unless the configured predecessor relationship and sabbatical rules grant one.

The previous league/session for return purposes is whatever league is configured
as the predecessor.

## 14. Sabbaticals

A sabbatical allows a returning member to temporarily step away from a league
while preserving the right to return later.

### Sabbatical eligibility

A member may request sabbatical only if:

- They are eligible for a guaranteed return spot in that league.
- Registration is in the priority state.
- The league permits sabbaticals.
- The league is not BYOT.
- The spot is not a temporary sabbatical-fill spot.
- The member has protected-claim capacity remaining.

Sabbatical cannot be requested:

- Outside priority registration
- For a league joined only from a waitlist offer before actually playing in it
- For a temporary sabbatical-fill spot
- For a BYOT league

### Sabbatical limits

A member may be on sabbatical for at most two leagues at the same time.

Sabbaticals count toward the maximum of two protected return claims.

The sabbatical duration limit is configurable.

Default/current policy:

- 3 years

The limit is the same for all leagues.

Staff may override the sabbatical duration limit for extenuating circumstances.

### Sabbatical duration calculation

The sabbatical start date is the first day of league play for the first league
session in which the member begins the sabbatical.

A member is ineligible to extend a sabbatical into any league whose final game
date is on or after the configured duration limit.

Example:

- Sabbatical limit: 3 years
- First sabbatical league starts: October 1, 2026
- The member is ineligible to claim sabbatical for any league whose final game
  date is on or after October 1, 2029.

### Sabbatical fees

A member pays the sabbatical fee for each league, each session, while on
sabbatical.

Sabbatical-only members do not need to purchase regular membership.

If a registration contains only sabbatical fees and no non-guaranteed items,
payment should be immediate.

If a registration contains a sabbatical plus non-guaranteed items, payment should
be deferred and billed together when possible.

The sabbatical fee is never discounted.

### Sabbatical expiration or release

When a sabbatical expires, if the member does not return to the league, their
spot is released permanently.

After release, the member must join the waitlist to get back into the league.

Members should be clearly warned when a decision will release their league spot.

Nonpayment of sabbatical fees is handled manually by staff.

## 15. Temporary sabbatical-fill spots

When a member is on sabbatical, another curler may temporarily fill that vacancy.

Rules:

- The temporary curler is clearly told the spot is temporary.
- The original sabbatical member cannot return mid-session.
- The original sabbatical member may request return for a future session.
- The temporary curler is not guaranteed permanent return to that spot.
- The temporary curler keeps their position on the waitlist.
- If a permanent spot opens, the temporary curler may receive the permanent spot
  according to waitlist rules.
- If the original member remains on sabbatical in a later session, the temporary
  spot can again be offered from the waitlist.

The temporary curler receives a league fee discount equal to the sabbatical fee.

The sabbatical-fill discount is always the full sabbatical fee amount.

Declining a temporary sabbatical-fill offer counts the same as declining a
permanent spot offer.

## 16. Waitlists

Waitlists are used for standard leagues with limited capacity.

BYOT leagues do not use waitlists.

A user does not need to be a member to join a waitlist.

A user must have an account to join a waitlist.

A user must satisfy league eligibility rules before joining a waitlist.

Users can see their position on waitlists they are part of.

Users may remove themselves from a waitlist at any time.

### Waitlist rollover

Waitlists automatically roll forward to successor leagues.

When a successor league is configured, the predecessor league waitlist continues
into the successor league.

Position/order is preserved.

Rollover changes must be audited.

### Waitlist ordering

Waitlists are first-come, first-served.

Waitlists may persist across seasons, so members who joined earlier retain
priority by virtue of their earlier waitlist position.

### Waitlist entry types

Each waitlist entry must specify whether the person is trying to:

1. ADD the league
2. REPLACE an existing league with this league

#### ADD waitlist entries

A member may be on a waitlist as ADD only if they are currently in 0 or 1
leagues.

This means that if the league is added, they will be in at most 2 leagues.

There is no limit to the number of ADD waitlists a member may be on.

#### REPLACE waitlist entries

A REPLACE waitlist entry means the member wants to join this league by giving up
another league.

A REPLACE entry must identify which existing league would be replaced.

A member may have at most two active REPLACE waitlist entries.

### Cleanup when a member reaches two leagues

Once a member gets into their second league by any mechanism, if they have ADD
waitlist entries, they must immediately decide whether to:

- Remove themselves from those ADD waitlists, or
- Convert ADD entries to REPLACE entries and specify which league would be
  replaced.

If they are on more than two ADD waitlists and want to convert them, they must
choose at most two to keep as REPLACE entries.

The registration or placement flow should block completion until this cleanup is
resolved.

### Waitlist offers

When a spot becomes available, staff may send offers to waitlisted users.

A waitlist offer gives the user 24 hours to decline.

If the user does not respond within 24 hours, the offer is treated as accepted.

User-facing offer language should clearly state:

> If you do not decline this offer within 24 hours, we will treat the offer as
> accepted and add you to the league. If payment is required, staff will follow
> up with you.

Payment issues after acceptance are handled manually by staff.

### Declines

Decline count is per waitlist instance.

Decline rules:

- First decline: user keeps their position.
- Second decline: user moves to the bottom of the waitlist.
- Declining a temporary sabbatical-fill spot counts as a decline.
- Removing and re-adding a user resets decline count.
- Moving the user to the bottom resets the practical instance/order as needed.

Decline count does not reset merely because time passes.

### Waitlist staff management

Staff can manage waitlists manually.

All waitlist changes, manual or automatic, must be audited.

## 17. Filling open league spots

For standard leagues, after priority registration closes, placement priority is:

1. Guaranteed returns and sabbatical returns are resolved first.
2. Remaining permanent spots are offered to the waitlist.
3. Temporary sabbatical-fill spots are offered separately to the waitlist.
4. Third-league requests are handled only after first/second league demand is
   satisfied.

Permanent vacancies are filled before temporary sabbatical-fill vacancies.

Staff should have oversight of this process.

A staff member may view league vacancies and send offers to the top eligible
waitlisted users.

## 18. Third-league interest

A member may express interest in joining a third league.

Third-league interest is not the same as joining a waitlist.

Rules:

- Third-league interest is collected during registration.
- The registrant may provide an ordered list of suitable third-league options.
- There is no limit to the number of third-league options they may list.
- Third-league placement is handled after first/second league demand is
  satisfied.
- Third-league placement may be manual or outside the application.
- The exact placement mechanism, such as lottery or staff decision, is not part
  of V1 app automation.
- BYOT leagues cannot be selected as third-league options.

Third-league interest defers payment.

## 19. Discounts

Discounts are configurable.

Discounts may be either:

- Dollar amount
- Percentage-based

Available discounts:

- Student discount
- Reciprocal discount
- Winter-only discount

### Student discount

Available to:

- K-12 students
- Full-time college/university students

The registrant must self-report the institution of study.

The discount is automatically approved during registration.

### Reciprocal discount

Available to members of another dedicated ice or arena curling club.

The registrant must self-report the other club.

The discount is automatically approved during registration.

### Winter-only discount

The true definition of the winter-only discount is:

- It applies when someone is registering starting with a session beyond the first
  session of the season.

Example:

- If Fall is the first session and Winter is the second session, someone
  registering to begin in Winter may be eligible.

The winter-only discount applies only to regular membership dues.

It does not apply to social membership.

### Discount application rules

Discounts apply only to discount-eligible charges.

Social membership fees are never discount-eligible.

Sabbatical fees are never discount-eligible.

Winter-only discount applies only to regular membership dues.

Sabbatical-fill discounts are applied separately and always equal the full
sabbatical fee.

If dollar discounts and percentage discounts both apply:

1. Apply dollar discounts first.
2. Then apply percentage discounts.

Percentage discounts apply to all discount-eligible invoice items unless a
discount's configuration narrows its scope.

Student and reciprocal discounts may be combined.

## 20. Fees

The following prices must be configurable:

- Regular membership
- Social membership
- League fee
- Spare-only ice privilege fee
- Sabbatical fee
- Junior Recreational fee
- Junior Advanced Commitment league fee, if applicable as a league fee
- Student discount
- Reciprocal discount
- Winter-only discount

League fees may differ by league.

Sabbatical fee is always the configured amount and is never discounted.

## 21. Payment rules

The app should avoid multiple payments per user/registration whenever possible.

### Immediate payment

Payment may be immediate when all selected items are confirmed and there are no
deferral reasons.

Examples:

- Social membership only
- Regular membership plus guaranteed returning leagues
- Regular membership plus spare-only
- Sabbatical-only registration
- Junior Recreational with no financial assistance request
- BYOT request treated as guaranteed for payment purposes

### Deferred payment

Payment is deferred if any item requires later decision, staff review, or
placement.

Deferral reasons include:

- Non-guaranteed league request
- Waitlist placement
- Third-league interest
- Junior Recreational financial assistance request
- Staff placement required
- Any other non-guaranteed item

If payment is deferred, membership dues may also be deferred so that the
registrant can make one payment later.

If a person cannot be placed into any league, they may not want to become a
member.

### Failed or incomplete payment

If immediate payment fails or is not completed:

- Registration is not confirmed.
- League spots do not need to be held during checkout.
- Staff may help resolve payment issues manually.

Spot availability is not decided by a race during checkout.

### Payment for another curler

If a user registers on behalf of another person and immediate payment is
required, the submitting user can/must pay for that registration.

## 22. Registration flow

The user-facing registration flow should be clear and broken into small steps.

Avoid showing too many inputs or choices on one screen.

### High-level flow

1. Ask whether the registrant is a returning member.
2. Require returning members to log in.
3. Determine whether registering self or another curler.
4. Accept required policies.
5. Confirm or collect demographic information.
6. Collect parent/guardian information if the curler is under 18.
7. Select membership/program path.
8. Collect discount information.
9. Collect curling experience where needed.
10. Handle Junior Recreational special path if selected.
11. Handle returning league guarantees and sabbaticals if applicable.
12. Handle new league requests, ADD/REPLACE waitlists, BYOT, and third-league
    interest.
13. Show review screen.
14. Submit registration.
15. Collect payment immediately or defer payment.

### Review screen

The review screen must clearly show:

- Membership choice
- Program choice, if applicable
- Ice privilege status
- Guaranteed leagues
- Sabbaticals
- Waitlist ADD entries
- Waitlist REPLACE entries
- Third-league interest
- BYOT requests
- Discounts
- Charges
- Whether payment is due now or deferred
- Why payment is deferred, if applicable

The UI should use clear labels such as:

- Confirmed
- On waitlist
- Subject to availability
- Sabbatical
- Temporary sabbatical-fill
- Third-league interest
- BYOT request
- Payment deferred

## 23. Staff operations

For V1, staff may handle many corrections manually.

If a member wants to change their registration after submission, they must
contact staff.

Staff will handle necessary:

- Billing changes
- Refunds
- Roster changes
- Waitlist changes
- Registration corrections

Staff should be able to:

- View registrations and statuses
- View deferred payment reasons
- Manage waitlists
- Send waitlist offers
- Trigger payment links
- Override sabbatical duration limits
- Manually place users in leagues in exceptional cases
- Handle refunds or corrections manually

## 24. Auditing

Waitlist changes are the most important audit requirement.

Any time a waitlist is updated, the system must audit:

- What changed
- Why it changed
- Who made the change, if applicable
- Whether it was manual or automatic
- When it happened

Waitlist audit events include, but are not limited to:

- Entry created
- Entry removed
- Entry rolled over to successor league
- Entry reordered
- Entry converted from ADD to REPLACE
- Entry converted from REPLACE to ADD, if allowed by staff
- Replacement league changed
- Offer sent
- Offer declined
- Offer accepted
- Offer expired into acceptance
- Decline count changed
- Entry moved to bottom
- Staff correction

Other staff actions may also be audited where practical, but waitlist auditing is
required.

## 25. Communications

All registration-related communications are by email.

The system should track email bounces and allow staff to investigate.

For V1, pending waitlist offers do not need to appear in the user's account if
they are handled by email.

Useful emails include:

- Registration submitted
- Immediate payment confirmation
- Deferred registration confirmation
- Junior Recreational assistance pending
- Junior Recreational assistance decision/payment link
- Waitlist offer
- Waitlist accepted
- Waitlist declined
- Payment link
- Sabbatical confirmation

## 26. User account visibility

Users should be able to see:

- Registration status
- Confirmed leagues
- Sabbaticals
- Waitlist entries
- Waitlist positions
- ADD/REPLACE status
- Replacement league, if applicable
- Payment status

Users may remove themselves from a waitlist at any time.

For V1, other changes after submission may require contacting staff.

## 27. Manual exceptions

Staff may override or manually correct exceptional cases.

Examples:

- Manual league placement despite eligibility rule
- Sabbatical duration override
- Waitlist correction
- BYOT refund/correction
- Payment issue
- Registration correction

Manual exceptions should be rare.

Waitlist-related manual exceptions must be audited.