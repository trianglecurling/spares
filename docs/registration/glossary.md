<!-- docs/registration/glossary.md -->

# Registration Glossary

This glossary defines terms used throughout the registration documentation and implementation.

## Account

A login identity in the application.

The app uses email-based login without passwords. A person may have access to more than one curler account, including through delegated impersonation.

## Anonymous visitor

A person visiting the site who is not logged in.

Anonymous visitors may view public content, but they cannot complete registration actions that require an account.

## BYOT league

A “bring-your-own-team” league.

Each curler registers individually, but registrants must provide teammate information in a text box.

BYOT leagues:

- Have team-based capacity.
- Do not use the sabbatical system.
- Require a full team roster on the priority entry.
- Are treated as guaranteed for payment purposes, although staff may later manually refund or adjust if a curler is not placed.

## Club Bonspiel

A club activity open to active club members who have purchased ice privileges for at least one session during the season.

This is the only club activity identified as requiring ice privileges while not being tied to a specific league.

## Current member

A person who has paid membership dues for the current membership season.

Membership is valid for one curling season.

## Curler

The person being registered to participate in club activities.

The curler may or may not be the person completing the registration form.

For example, a parent may register a child. In that case, the child is the curler.

## Deferred payment

A registration payment that is not collected immediately at submission.

Payment is deferred when the registration includes items requiring placement, review, or staff decision before the final amount or participation status is known.

Common deferral reasons include:

- Waitlist placement still needed to fill the desired league count.
- Play-in entry that has not cleared the TLINE guarantee bar.
- Junior Recreational financial assistance review.
- Other staff placement decisions.

## Delegated impersonation

Permission for one user to act on behalf of another user in the application.

This is used when someone registers another person, such as a parent registering a child or a spouse registering a spouse.

## Discount-eligible charge

A charge that may receive one or more registration discounts.

Discounts apply only to discount-eligible charges.

Social membership fees and sabbatical fees are never discount-eligible.

## Drop

A registration choice indicating that the curler does not want to return to a previous league and does not want to hold the spot on sabbatical.

Dropping a league gives up the curler’s protected return claim for that league.

## Entry team

A persistent declared team for a play-in based league.

The first teammate to register creates the entry team from their declared roster. Later teammates are attached to the existing team instead of creating duplicates.

Entry team members are either linked member accounts or pending names. A member may be on at most one active entry team per league.

## Fiscal year

The tenant-configured financial year.

For this club, the fiscal year runs from July 1 through June 30.

For membership sales, a person always buys a membership that begins in the current fiscal year.

## Full spot

A normal, permanent league spot.

A person placed into a full spot may be eligible for guaranteed return in the successor league, subject to the normal return-to-league rules.

A full spot is different from a temporary sabbatical-fill spot.

## Guarantee threshold

The auto-entry cutoff for a play-in based league: the combined TLINE total of the `autoEntryCount`-th strongest opposing team (already-declared teams plus the strongest teams formable by stacking the uncommitted points pool).

A registering team is guaranteed automatic entry when its total strictly exceeds this threshold (and it meets the returning-member rule).

## Guaranteed return

A protected right for a returning member to return to an eligible league during priority registration, granted when the league is ranked 1st or 2nd on the registrant's priority list.

A member may claim up to two protected league spots total during priority registration, and never more than their desired league count.

Protected claims include guaranteed returns and guaranteed fallbacks. Sabbaticals do not count as protected claims.

To receive a guaranteed return, the member must register during priority registration and must be eligible based on league continuity and prior participation. For a play-in based league, the declared entry team must also have a full roster and clear the TLINE guarantee bar.

## Guaranteed fallback

A held league spot granted for a return-eligible league ranked 3rd or lower on
the priority list, when fewer than two guaranteed returns were granted.

A guaranteed fallback is billed and rostered exactly like a guaranteed return.
The difference is intent: the registrant would rather have a higher-ranked
league and keeps the fallback if those do not come through.

Play-in based leagues never receive a guaranteed fallback.

## Ice privileges

Permission to curl on club ice during a specific session.

Ice privileges are session-specific.

A person who purchases fall ice privileges must still purchase winter ice privileges if they want winter ice privileges.

Ice privileges may be obtained through league registration or spare-only registration, subject to eligibility rules.

## Immediate payment

Payment collected at the end of registration submission.

Immediate payment is used only when all selected items are confirmed and no staff placement or review is needed.

If payment fails or is not completed, the registration is not confirmed.

## Instructional league

A league intended for curlers with none or minimal prior experience.

Curlers with no or minimal experience are eligible only for instructional leagues.

Instructional leagues require club membership unless otherwise configured.

## Junior Advanced Commitment

A junior program treated like a normal league for cost and registration purposes.

Junior Advanced Commitment participants pay regular membership plus the league fee.

They have the same registration structure as regular members joining a league and are eligible to join other leagues if otherwise eligible.

## Junior Recreational

A junior program with special registration rules.

Junior Recreational participants:

- Pay a flat fee covering membership and the program.
- May request financial assistance.
- May not join other leagues.
- May not spare.
- Do not participate in normal league selection.
- Are placed on the session league marked as the Junior Recreational program
  league at submit.

Financial assistance is subject to staff review and budget availability. Payment is deferred until the assistance decision is made.

## League

A curling program or competition within a specific session.

League entities exist for a single session only.

For example, Fall 2025 Tuesday Evening and Winter 2026 Tuesday Evening are separate league records, even if they represent the same continuing league concept.

## League continuity

The configured predecessor/successor relationship between league records.

League continuity determines:

- Return-to-league eligibility.
- Waitlist rollover.
- Sabbatical continuation.
- Historical relationship between sessions.

## League fee

The fee charged to participate in a league.

League fees may vary by league.

League fees confer session-specific ice privileges.

## League priority list

The ordered list of leagues a registrant wants to play in, most wanted first,
collected on a single page during registration alongside the desired league
count.

The list may be longer than the desired league count. Each entry derives a
guarantee label from its rank and the registrant's return rights. See
`league-priority.md`.

## League selection

A league-related choice made during registration that is not a priority list
entry:

- Sabbatical.
- Drop.
- Junior Recreational.
- Spare-only.

## Member

A person with a paid membership for the current membership season.

Membership types include regular, social, and Junior Recreational.

## Membership season

The period during which a membership is valid.

For this club, membership is valid from September 1 through August 31 for a single curling season.

If someone buys membership in January, it is valid through August 31 of that membership season.

## Minor

A curler under 18 years old.

For minors, parent or guardian information is required during registration.

The registrant agrees to required registration policies on behalf of the minor.

## New member

A curler who does not have previous league participation history at the club.

New members may register during priority registration but do not receive guaranteed return spots.

New members may be added to waitlists on a first-come, first-served basis if eligible.

## Non-guaranteed item

A registration item that cannot be confirmed immediately.

Examples include:

- New league request.
- Return subject to availability.
- Waitlist placement.
- Third-league interest.
- Some BYOT placement outcomes, although BYOT is treated as guaranteed for payment purposes.
- Junior Recreational assistance review.

Non-guaranteed waitlist and play-in-pending items cause payment to be deferred.
Subject-to-availability leagues (no waitlist) are billed immediately.

## Open registration

A registration state where anyone may register.

Return-to-league guarantees are not available in open registration unless otherwise handled by staff.

## Parent/guardian

The adult responsible for a minor curler.

Parent/guardian information is required when the curler is under 18.

## Pending name

A free-text teammate name on an entry team for someone who is not yet a member.

Pending names contribute zero TLINE points until staff link them to a member account.

## Play-in based league

A league whose roster is decided by TLINE points and playdowns instead of guaranteed returns and waitlists.

The top teams by combined TLINE points receive automatic entry. The remaining spots are decided by playdowns.

Play-in leagues must be ranked above every other league on the priority list.

## Play-in entry

A priority list entry for a play-in based league.

The entry declares an entry team. A full roster that clears the TLINE guarantee
bar earns a Guaranteed return label, is billed immediately, and consumes one of
the two protected claims. Anything else is Subject to availability and defers
payment. A play-in entry never receives a Guaranteed fallback.

## Playdown

The competitive process used to fill the final spots of a play-in based league.

Teams that are not guaranteed automatic entry play down for the remaining spots. Playdown participants who do not win entry earn 1 TLINE point, which does not count as returning participation.

## Policy acceptance

The required agreement to club policies before continuing registration.

The required policies are:

- Code of Conduct.
- Minor Athlete Abuse Prevention Policy.
- Privacy Policy.

The registrant agrees on behalf of the curler being registered.

## Predecessor league

The prior league record in a league continuity chain.

For example, Fall 2025 Tuesday Evening may be the predecessor of Winter 2026 Tuesday Evening.

## Priority registration

A registration state where returning members may claim eligible guaranteed return spots or sabbaticals.

Anyone may register during priority registration, including new members, but only eligible returning members receive guaranteed return rights.

## Protected claim

A guaranteed return or guaranteed fallback on the priority list.

A member may have at most two protected claims during priority registration, and
never more than their desired league count.

Sabbaticals are not protected claims. A member may hold two guaranteed-return
leagues and also take sabbatical for other prior leagues (subject to the
separate limit of two simultaneous sabbaticals).

Examples:

- Two guaranteed returns.
- One guaranteed return and one guaranteed fallback.
- Two guaranteed fallbacks.
- Two guaranteed returns plus one or two sabbaticals.

## Regular membership

The primary membership type for curlers.

Regular membership is required for normal league participation and spare-only registration.

Regular members may be eligible for ice privileges, league registration, spare-only registration, discounts, and the Club Bonspiel.

## Registration

The process and persisted record for one curler signing up for membership, ice privileges, leagues, waitlists, sabbaticals, or related programs.

One registration is for one curler only.

A person registering multiple curlers submits one registration per curler.

## Registration state

The current availability state of registration.

Possible states:

- Closed.
- Priority.
- Open.

## Registrant

The person completing the registration form.

The registrant may be registering themselves or another curler.

## Returning member

A curler with previous relevant club participation history.

Returning members must log in before registering so the system can identify their eligibility for guaranteed returns, sabbaticals, and historical league information.

## Sabbatical

A protected temporary absence from an eligible league.

A member may request a sabbatical only if they are eligible for a guaranteed return spot in that league.

Sabbaticals:

- Must be requested during priority registration.
- Do not count toward the maximum of two guaranteed return / fallback spots.
- Are limited to two leagues at a time.
- Require a sabbatical fee per league per session.
- Do not require regular membership if the person is only taking sabbatical.
- Are not available for BYOT leagues.
- Are not available for temporary sabbatical-fill spots.
- Are limited by a configurable duration, defaulting to three years.
- May be overridden by staff in exceptional circumstances.

## Sabbatical fee

The fee paid to hold a league spot on sabbatical for a session.

Sabbatical fees are never discounted.

## Sabbatical-fill discount

A discount given to a curler who fills a temporary sabbatical vacancy.

The discount is always equal to the sabbatical fee and is applied separately from other discounts.

## Social membership

A membership type for people who want to be part of the club but do not want ice privileges or league play.

Social members:

- Cannot register for leagues.
- Cannot purchase spare-only ice privileges.
- Cannot receive discounts on social membership.
- May later upgrade to regular membership, but must pay the full regular membership price with no credit for the social membership fee and no discounts.

## Spare-only

A registration option for eligible curlers who want sparing rights but are not registering for a specific league.

Spare-only requires:

- Regular membership.
- Spare-only ice privilege fee.

Spare-only confers session-specific ice privileges.

## Staff override

A staff action that bypasses or adjusts the normal automated registration process.

Staff overrides should be exceptional.

Waitlist changes must be audited whether they occur manually or automatically.

## Standard league

A league with individual-based capacity.

Most leagues are standard leagues.

Standard leagues may use:

- Guaranteed returns.
- Sabbaticals.
- Waitlists.
- Temporary sabbatical-fill spots.

## Student discount

A configurable discount for eligible students.

The registrant must self-report an institution of study.

The discount is automatically approved once required information is provided.

## Successor league

The next league record in a league continuity chain.

For example, Winter 2026 Tuesday Evening may be the successor of Fall 2025 Tuesday Evening.

Waitlists automatically roll forward to successor leagues.

## Temporary sabbatical-fill spot

A temporary league spot created because another member is on sabbatical.

The person filling the spot:

- Receives a sabbatical-fill discount equal to the sabbatical fee.
- Is not guaranteed permanent return to that spot.
- Keeps their waitlist position if they are on the waitlist for a full spot.
- May continue filling the temporary spot in future sessions if it remains available and they are still the highest eligible waitlisted person.

The original sabbatical member cannot return mid-session.

## Subject to availability

The guarantee label for a priority list entry that is neither guaranteed nor
queueable, because the league has no waitlist. The registrant wants it; staff
place them if room exists. Defers payment.

## TLINE points

Individual points earned from prior-season standings, used to rank entry teams for play-in based leagues.

Points are awarded per session based on finishing position (20, 19½, 19, ... down to 2), carried by the individual to their next team, and count only from the prior season. Playdown participants who do not win entry earn 1 point.

Points are stored in half-point units and are currently entered manually by staff.

## User

An application account holder.

A user may be the curler, the registrant, a parent/guardian, a staff member, or another person with delegated access.

## Waitlist

An ordered list of eligible people interested in joining a league.

Waitlists are first-come, first-served.

Waitlists automatically roll forward to successor leagues.

Users can see their waitlist positions and may remove themselves from waitlists.

## Waitlist audit log

A record of changes to a waitlist.

Every waitlist update must be audited, whether the change was manual or automatic.

Audit records should identify:

- What changed.
- When it changed.
- Why it changed.
- Who made the change, if applicable.
- Whether the change was system-generated.

## Waitlist decline count

The number of times a person has declined an offer for a specific waitlist instance.

Rules:

- First decline keeps the person in their current waitlist position.
- Second decline moves the person to the bottom of the waitlist.
- Decline count is per waitlist instance.
- Removing and re-adding a person resets the decline count.
- Moving a person to the bottom resets the relevant instance behavior.
- Declining a temporary sabbatical-fill spot counts the same as declining a permanent spot.

## Waitlist offer

An offer sent to a person on a waitlist when a spot is available.

The offer includes a response deadline chosen by staff.

If the recipient does not accept by that deadline, the offer is treated as declined.

## Winter-only discount

A configurable discount that applies when someone is registering starting with a session beyond the first session of the season.

The winter-only discount applies only to regular membership dues.

It does not apply to social membership.