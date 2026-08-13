# Registration Eligibility Rules

## Registration state

Registration may be:

- Closed
- Priority
- Open

Registration actions are allowed only during priority or open registration.

Guaranteed return and sabbatical requests are allowed only during priority registration.

## Account requirements

A person must have a user account to:

- Register.
- Join a waitlist.
- Be placed in a league.
- Hold a sabbatical.

A person does not need to be a paid member to join a waitlist.

## Returning member requirement

Returning members must log in before registering.

A returning member is someone with prior relevant club participation or account history. The registration flow asks whether the person is returning. If yes, login is required.

## Membership eligibility

### Regular membership

Regular membership is required for:

- Standard league play, unless the league explicitly does not require club membership.
- BYOT league play, unless the league explicitly does not require club membership.
- Spare-only ice privileges.
- Junior Advanced Commitment.

### Social membership

Social membership:

- Does not allow league play.
- Does not allow ice privileges.
- Does not allow spare-only privileges.
- Is never discounted.

A social member may later upgrade to regular membership, but pays full regular membership price with no credit and no discounts.

### Sabbatical-only

A member taking only sabbatical does not need to buy regular membership.

They owe the sabbatical fee for each sabbatical league.

## Spare-only eligibility

Spare-only is regular membership plus the spare-only ice privilege fee.

Anyone eligible to join a league is eligible to purchase spare-only.

Spare-only may be purchased during registration.

## League eligibility

A registrant must satisfy all relevant league eligibility rules before selecting or waitlisting for that league.

Eligibility checks include:

- Age
- Experience
- Membership requirement
- Junior/adult restrictions
- League type restrictions
- Registration mode restrictions

## Age eligibility

Age eligibility is based on the registrant's age on the first day of the league.

Leagues may define:

- Minimum age
- Maximum age

If the registrant is below the minimum age, they are ineligible.

If the registrant is above the maximum age, they are ineligible.

## Experience eligibility

New member experience is self-reported.

Experience may be fractional.

Available new-member experience answers include:

- None or minimal
- Specific number of years

None or minimal experience qualifies only for instructional leagues.

Each completed session with the club counts as 0.5 years of experience.

Experience accrual is capped at 1.0 year per year.

Staff may manually place someone into a league in exceptional cases, but normal user registration should enforce experience requirements.

## Instructional leagues

Instructional leagues may allow registrants with none or minimal experience.

Instructional leagues require club membership unless explicitly configured otherwise.

## Junior Recreational

Junior Recreational is exclusive.

A Junior Recreational registrant cannot:

- Join another league.
- Join a waitlist for another league.
- Purchase spare-only privileges.
- Register for Junior Advanced Commitment in the same registration.
- Register for standard adult leagues in the same registration.

Junior Recreational uses a flat program fee and may include financial assistance.

On submit, the curler is placed on the session league marked as the Junior
Recreational program league in league configuration.

## Junior Advanced Commitment

Junior Advanced Commitment is treated like a normal league.

A JAC participant pays:

- Regular membership fee.
- JAC league fee.

JAC participants have regular-member ice privileges and may use the normal league registration process.

## Return right eligibility

A registrant holds a return right for a league only if:

- Registration is in priority state.
- The registrant is a returning member.
- The target league has a configured predecessor relationship where relevant.
- The registrant participated in the predecessor league or has a qualifying sabbatical right.
- For a play-in based league, the declared entry team has a full roster and
  clears the TLINE guarantee bar.

A return right is not itself a guarantee. It becomes a Guaranteed return or a
Guaranteed fallback label depending on where the league sits on the registrant's
priority list. See `league-priority.md`.

## Protected-claim limit

A member may hold at most two protected claims, and never more than their
desired league count:

```
budget = min(2, desiredLeagueCount)
```

Protected claims are:

- Guaranteed return entries.
- Guaranteed fallback entries.

Sabbaticals do not count as protected claims.

## Sabbatical eligibility

A registrant may request sabbatical only if:

- Registration is in priority state.
- The registrant holds a return right for that league.
- The league allows sabbaticals.
- The league is not BYOT.
- The spot is not a temporary sabbatical-fill spot.
- The registrant has not exceeded the active sabbatical limit (two leagues).
- The sabbatical duration limit has not been exceeded, unless staff override applies.

A person may be on sabbatical for at most two leagues at a time.

The default sabbatical duration limit is 3 years, configurable.

## Sabbatical duration

The sabbatical start date is the first day of league play for the first league session in which the person began sabbatical.

A sabbatical cannot be extended into a league whose final game date is on or after the configured duration limit from the sabbatical start date, unless staff override applies.

Example:

- Sabbatical starts October 1, 2026.
- Limit is 3 years.
- The member is ineligible to extend sabbatical into any league whose final game date is on or after October 1, 2029.

## Waitlist eligibility

A registrant may join a waitlist if:

- They have a user account.
- They satisfy the league's eligibility rules.
- The league participates in waitlists.
- The league is not BYOT.
- Their requested waitlist type is allowed.

A person does not need to be a paid member to join a waitlist.

## Waitlist entry eligibility

A waitlist entry is created for every priority list entry labeled Waitlisted.
There is no ADD or REPLACE type and no cap on how many waitlists a registrant
may be on.

Each entry stores the registrant's priority rank for that league and their
desired league count. Displacement is decided at placement time. See
`waitlists.md`.

## Priority list eligibility

- The list must be at least as long as the desired league count.
- The desired league count is between 1 and 5.
- Every league on the list must pass the general league eligibility rules above.
- Bring-your-own-team leagues must be ranked above every standard league.
- A league may appear on the list at most once.

## BYOT eligibility

BYOT leagues:

- May be requested by new members.
- May be requested by returning members.
- Require each curler to register individually.
- Require a full team roster on the priority entry: exactly 4 for team leagues,
  2 for doubles.
- Must be ranked above every standard league on the priority list.
- Do not use sabbaticals.
- Are treated as guaranteed for payment timing, subject to later manual staff correction if the coordinator does not place the registrant.