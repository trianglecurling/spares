# Registration Business Logic Test Matrix

## Purpose

This document lists required business logic test cases.

These tests should be implemented as unit tests or lightweight integration tests depending on existing project conventions.

# Phase 3

## Registration state tests

### Closed registration blocks registration

Given registration is closed  
When a user attempts to register  
Then registration is blocked

### Open registration allows non-guaranteed registration

Given registration is open  
When a user registers for available non-guaranteed options  
Then registration may proceed, but guaranteed return and sabbatical options are unavailable

### Priority registration allows guaranteed return

Given registration is priority  
And the member has eligible predecessor league participation  
When they select a guaranteed return league  
Then the selection is allowed

## Membership tests

### Social membership has no ice privileges

Given a registrant selects social membership  
When they attempt to select a league  
Then the league selection is blocked

### Social membership is not discounted

Given a registrant selects social membership  
And student/reciprocal/winter-only discounts would otherwise be selected  
When fees are calculated  
Then no discount applies to social membership

### Social-to-regular upgrade gets no credit

Given a current social member upgrades to regular  
When fees are calculated  
Then they pay full regular membership price  
And receive no credit for social membership  
And receive no discounts

### Regular membership plus spare-only

Given a registrant selects spare-only  
When fees are calculated  
Then regular membership fee and spare-only fee are charged

## Discount tests

### Student discount requires institution

Given a registrant selects student discount  
When no institution is provided  
Then the discount is invalid

### Student discount auto-applies with institution

Given a registrant selects student discount  
And provides institution  
When fees are calculated  
Then the discount is applied automatically

### Reciprocal discount requires club

Given a registrant selects reciprocal discount  
When no other club is provided  
Then the discount is invalid

### Reciprocal discount auto-applies with club

Given a registrant selects reciprocal discount  
And provides other club  
When fees are calculated  
Then the discount is applied automatically

### Winter-only discount applies after first session

Given the registration session is beyond the first session of the season  
When regular membership is charged  
Then winter-only discount applies to regular membership dues

### Winter-only discount does not apply to first session

Given the registration session is the first session of the season  
When regular membership is charged  
Then winter-only discount does not apply

### Dollar discounts before percentage discounts

Given both dollar and percentage discounts apply  
When fees are calculated  
Then dollar discounts apply first  
And percentage discounts apply afterward

### Sabbatical fee not discounted

Given a registrant owes a sabbatical fee  
And discounts apply elsewhere  
When fees are calculated  
Then the sabbatical fee is not discounted

### Sabbatical-fill discount equals sabbatical fee

Given a registrant fills a temporary sabbatical spot  
When fees are calculated  
Then the sabbatical-fill discount equals the full sabbatical fee

## Age and experience tests

### Under minimum age blocked

Given a league has a minimum age  
And the registrant is younger than that age on the first day of league  
When they select the league  
Then the selection is blocked

### Over maximum age blocked

Given a league has a maximum age  
And the registrant is older than that age on the first day of league  
When they select the league  
Then the selection is blocked

### Age calculated on first day of league

Given a registrant has a birthday near the league start date  
When age eligibility is calculated  
Then age is based on the first day of league

### No experience allowed for instructional

Given a registrant has none or minimal experience  
And the league is instructional  
When they select the league  
Then the selection is allowed if all other rules pass

### No experience blocked from non-instructional

Given a registrant has none or minimal experience  
And the league requires experience  
When they select the league  
Then the selection is blocked

### Session experience accrues as half year

Given a member completed one session  
When experience is calculated  
Then 0.5 years is added

### Experience accrual capped per year

Given a member completed more than two sessions in one year  
When experience is calculated  
Then no more than 1.0 year is added for that year

## Returning guarantee tests

### Returning member can select two guaranteed leagues

Given priority registration  
And the member is eligible to return to two predecessor leagues  
When they select both as guaranteed returns  
Then both selections are allowed

### Returning member cannot select three protected claims

Given priority registration  
And the member is eligible for three leagues  
When they select three guaranteed returns or sabbaticals  
Then the third protected claim is blocked

### Guaranteed return unavailable outside priority

Given open registration  
And the member played in the predecessor league  
When they try to claim guaranteed return  
Then guaranteed return is blocked

### Skipped predecessor session loses guarantee

Given the member played Fall 2025  
And skipped Winter 2026 without sabbatical  
And Fall 2026 uses Winter 2026 as predecessor  
When they register for Fall 2026  
Then they do not have guaranteed return rights

## Sabbatical tests

### Sabbatical requires return eligibility

Given a member is not eligible for guaranteed return  
When they request sabbatical  
Then the request is blocked

### Sabbatical counts toward protected claim limit

Given a member selects one guaranteed return and one sabbatical  
When they attempt another guaranteed return  
Then the third protected claim is blocked

### Sabbatical-only does not require regular membership

Given a member requests only sabbatical  
When fees are calculated  
Then no regular membership is charged  
And sabbatical fee is charged

### Sabbatical not available for BYOT

Given a BYOT league  
When a member requests sabbatical  
Then the request is blocked

### Sabbatical not available for temporary fill spot

Given a member filled a temporary sabbatical spot  
When they request sabbatical for that spot  
Then the request is blocked

### Sabbatical duration allowed before limit

Given sabbatical limit is 3 years  
And the successor league ends before the 3-year cutoff  
When the member extends sabbatical  
Then the extension is allowed

### Sabbatical duration blocked at or after limit

Given sabbatical limit is 3 years  
And the successor league ends on or after the 3-year cutoff  
When the member extends sabbatical  
Then the extension is blocked unless staff override applies

## Waitlist tests

### Non-member can join waitlist

Given a registrant has an account but no membership  
And they meet league eligibility rules  
When they join a waitlist  
Then the waitlist request is allowed

### Ineligible person cannot join waitlist

Given a registrant does not meet age or experience requirements  
When they attempt to join a waitlist  
Then the waitlist request is blocked

### ADD allowed with zero leagues

Given a registrant is in zero leagues  
When they request ADD waitlist  
Then the request is allowed

### ADD allowed with one league

Given a registrant is in one league  
When they request ADD waitlist  
Then the request is allowed

### ADD blocked with two leagues

Given a registrant is in two leagues  
When they request ADD waitlist  
Then the request is blocked

### Unlimited ADD waitlists

Given a registrant is in zero or one leagues  
When they request multiple ADD waitlists  
Then no count limit blocks them

### REPLACE requires replaced league

Given a registrant requests REPLACE waitlist  
When no replaced league is specified  
Then the request is blocked

### REPLACE limited to two

Given a registrant already has two REPLACE waitlists  
When they request another REPLACE waitlist  
Then the request is blocked

### Reaching two leagues requires ADD cleanup

Given a registrant has active ADD waitlists  
And they are placed into their second league  
When business logic evaluates their waitlist state  
Then cleanup is required before completion

## Third-league interest tests

### Third-league interest is ranked

Given a registrant provides third-league interest  
When selections are validated  
Then ordered rankings are preserved

### Third-league interest has no limit

Given a registrant submits many third-league interest options  
When selections are validated  
Then no maximum count blocks them

### Third-league interest defers payment

Given a registrant has otherwise guaranteed selections  
And submits third-league interest  
When payment decision is evaluated  
Then payment is deferred

### BYOT cannot be third-league interest

Given a BYOT league  
When a registrant selects it as third-league interest  
Then the selection is blocked

## BYOT tests

### New member can request BYOT

Given a new member  
When they request a BYOT league as one of their first two leagues  
Then the request is allowed if all other eligibility rules pass

### BYOT requires teammate text

Given a registrant requests BYOT  
When no teammate text is provided  
Then the request is blocked

### BYOT cannot be third league

Given a registrant already has two leagues  
When they request BYOT as a third league  
Then the request is blocked

### BYOT does not use waitlist

Given a BYOT league  
When a registrant requests waitlist entry  
Then the request is blocked

### BYOT treated as guaranteed for payment timing

Given a registrant requests BYOT  
And no other deferral reasons exist  
When payment decision is evaluated  
Then payment is immediate

## Junior program tests

### Junior Recreational blocks other leagues

Given a registrant selects Junior Recreational  
When they also select another league  
Then registration is blocked

### Junior Recreational blocks spare-only

Given a registrant selects Junior Recreational  
When they select spare-only  
Then registration is blocked

### Junior Recreational without assistance immediate payment

Given a registrant selects Junior Recreational  
And no financial assistance is requested  
When payment decision is evaluated  
Then payment is immediate

### Junior Recreational with assistance deferred

Given a registrant selects Junior Recreational  
And financial assistance is requested  
When payment decision is evaluated  
Then payment is deferred for staff review

### JAC treated as normal league

Given a registrant selects Junior Advanced Commitment  
When fees are calculated  
Then regular membership and JAC league fee are charged

## Payment decision tests

### Guaranteed returning member pays immediately

Given a returning member selects one or two guaranteed leagues  
And no other deferral reasons exist  
When payment decision is evaluated  
Then payment is immediate

### Waitlist-only registration has no payment

Given a registrant joins only waitlists  
And no membership or fees are due  
When payment decision is evaluated  
Then no payment is required

### Non-guaranteed league defers payment

Given a registrant selects a league subject to availability  
When payment decision is evaluated  
Then payment is deferred

### Sabbatical-only pays immediately

Given a registrant selects only sabbatical  
When payment decision is evaluated  
Then payment is immediate

### Sabbatical plus waitlist defers payment

Given a registrant selects sabbatical  
And also selects a non-guaranteed league or waitlist placement  
When payment decision is evaluated  
Then the whole payment is deferred

### Deferred reason list is returned

Given payment is deferred  
When payment decision is evaluated  
Then machine-readable deferral reasons are returned

## Fee total tests

### Invoice total never negative

Given discounts exceed eligible charges  
When fees are calculated  
Then total due is not negative

### Non-discountable and discountable charges separated

Given an invoice has regular membership and sabbatical fee  
When discounts are calculated  
Then only discount-eligible items are discounted

# Phase 4 - Registration Shell

### Draft registration

| Case | Expected result |
| --- | --- |
| User starts registration | Draft registration is created |
| User abandons registration and returns | Existing draft can be resumed |
| User has existing draft for same curler/session | App resumes or reuses existing draft instead of creating duplicate active draft |
| User cancels draft | Draft is marked canceled and is not resumed by default |

### Returning curler identity

| Case | Expected result |
| --- | --- |
| User says curler is returning | Login is required |
| Returning curler logs in | User can select eligible profile |
| User has delegated access to another profile | Delegated profile appears as selectable |
| User lacks access to intended returning curler | Registration cannot proceed for that curler |
| Returning curler flow completes | No duplicate account is created |

### New curler registering themself

| Case | Expected result |
| --- | --- |
| New curler registers themself | Submitted-by and curler are the same user/profile |
| New curler is not logged in | Email-based account creation/login is required |
| Required demographic field is missing | User cannot complete shell |
| Date of birth is in the future | Validation error is shown |

### New curler registered by someone else

| Case | Expected result |
| --- | --- |
| Parent registers child using same email | Parent and child profiles/accounts are associated according to existing same-email behavior |
| Parent registers child using child's email | Child profile/account is created with child's email |
| Parent and child use different emails | Explicit delegated access is granted to parent |
| Spouse registers spouse | Submitted-by and curler are stored separately |
| One person registers multiple children | Each child requires a separate registration |

### Policy acceptance

| Case | Expected result |
| --- | --- |
| User accepts all three policies | Policy step is complete |
| User misses one policy | User cannot continue |
| Parent registers minor | Parent/registrant accepts policies on behalf of minor |
| Policy acceptance is recorded | Timestamp, accepting user, curler, and policy identifiers are stored |

### Returning curler demographics

| Case | Expected result |
| --- | --- |
| Returning curler confirms info is current | Demographics step is complete |
| Returning curler says info is not current | User can edit required fields |
| Returning curler has missing required profile data | User must complete missing fields |

### Minor parent/guardian information

| Case | Expected result |
| --- | --- |
| Curler is under 18 | Parent/guardian fields are required |
| Curler is 18 or older | Parent/guardian fields are not required |
| User changes DOB from adult to minor | Parent/guardian step becomes required |
| User changes DOB from minor to adult | Parent/guardian step is no longer required |
| User copies curler email/phone | Parent/guardian fields populate correctly |

### Authorization

| Case | Expected result |
| --- | --- |
| Submitted-by user opens draft | Access allowed |
| Curler opens draft | Access allowed |
| Delegated user opens draft | Access allowed |
| Unrelated user opens draft | Access denied |
| Staff/admin opens draft | Access allowed according to RBAC |

# Phase 6: League Selection Test Matrix

## Returning guarantees

| Case | Expected result |
| --- | --- |
| Returning member in priority registration has one predecessor league and selects Return | Selection is accepted as a guaranteed return |
| Returning member in priority registration has two predecessor leagues and selects Return for both | Both selections are accepted as guaranteed returns |
| Returning member attempts to protect three leagues | System blocks the third protected claim |
| Returning member outside priority registration attempts guaranteed return | System blocks guaranteed return |
| Returning member attempts guaranteed return to a league without predecessor eligibility | System blocks guaranteed return |
| New member attempts guaranteed return | System blocks guaranteed return |

## Sabbaticals

| Case | Expected result |
| --- | --- |
| Returning member in priority registration requests sabbatical for eligible predecessor league | Sabbatical selection is accepted |
| Returning member requests two sabbaticals | Both are accepted if eligible |
| Returning member requests two returns and one sabbatical | System blocks because protected claims exceed two |
| Returning member requests sabbatical outside priority registration | System blocks sabbatical |
| Returning member requests sabbatical for BYOT league | System blocks sabbatical |
| Returning member requests sabbatical for temporary sabbatical-fill spot | System blocks sabbatical |
| Sabbatical-only registration has no regular membership | Allowed |
| Sabbatical exceeds configured duration limit | System blocks unless staff override exists |
| Sabbatical duration limit is overridden by staff | Sabbatical is allowed and override is auditable |

## Standard league eligibility

| Case | Expected result |
| --- | --- |
| Under-minimum-age curler selects restricted league | System blocks selection |
| Over-maximum-age curler selects restricted league | System blocks selection |
| New curler with no experience selects non-instructional experienced league | System blocks selection |
| New curler with no experience selects instructional league | System allows selection |
| Curler with sufficient experience selects experienced league | System allows selection |
| Non-member joins waitlist for league they are eligible for | System allows waitlist entry |
| Non-member tries to join waitlist for league they are not eligible for | System blocks waitlist entry |

## ADD waitlists

| Case | Expected result |
| --- | --- |
| Curler with zero leagues creates ADD waitlist entry | Entry is allowed |
| Curler with one league creates ADD waitlist entry | Entry is allowed |
| Curler with two leagues creates ADD waitlist entry | System blocks ADD |
| Curler with one league creates several ADD entries | All are allowed |
| Curler reaches two leagues while having active ADD entries | System requires cleanup |
| Curler removes ADD entries during cleanup | Cleanup succeeds |
| Curler converts ADD entries to REPLACE during cleanup | Cleanup succeeds if REPLACE rules are satisfied |
| Curler attempts to keep ADD entries after reaching two leagues | Registration progress is blocked |

## REPLACE waitlists

Phase 6 draft editing stores REPLACE intent on `registration_selections`.
Audited waitlist-entry replacement changes apply when an existing
`waitlist_entries` row is mutated, including rollover or later waitlist-entry
creation/update phases.

| Case | Expected result |
| --- | --- |
| Curler creates REPLACE waitlist and identifies replacement league | Entry is allowed |
| Curler creates REPLACE waitlist without replacement league | System blocks entry |
| Curler creates two REPLACE waitlists | Both are allowed |
| Curler attempts third active REPLACE waitlist | System blocks third entry |
| Curler changes replacement league | Change is saved and audited if it mutates waitlist state |

## Waitlist rollover

| Case | Expected result |
| --- | --- |
| League has successor and active ADD entries | Entries roll forward preserving order |
| League has successor and active REPLACE entries | Entries roll forward preserving order and replacement intent |
| Rolled ADD entry is no longer valid because curler now has two leagues | System requires cleanup |
| Rolled REPLACE entry references a league the curler no longer holds | System requires cleanup |
| Waitlist entry rolls forward | Audit record is created |

## Third-league interest

| Case | Expected result |
| --- | --- |
| Curler provides one third-league interest choice | Choice is saved |
| Curler provides multiple third-league interest choices | Choices are saved in order |
| Curler provides many third-league interest choices | All are saved; no limit is enforced |
| Registration includes third-league interest | Payment is deferred |
| Third-league interest is submitted | No normal waitlist entries are created |
| Curler attempts to select BYOT as third-league interest | System blocks selection |

## BYOT leagues

| Case | Expected result |
| --- | --- |
| New member requests BYOT league as first or second league | Request is allowed |
| Returning member requests BYOT league as first or second league | Request is allowed |
| BYOT request has teammate text | Request is allowed |
| BYOT request omits teammate text | System blocks request |
| BYOT requested as third league | System blocks request |
| BYOT request is submitted | No waitlist entry is created |
| BYOT request is submitted | No sabbatical option is available |
| BYOT request is submitted | Treated as guaranteed for payment timing |

## Junior Recreational

| Case | Expected result |
| --- | --- |
| Junior Recreational selected | Normal league selection is skipped |
| Junior Recreational registrant attempts to add standard league | System blocks selection |
| Junior Recreational registrant attempts to purchase sparing rights | System blocks selection |
| Junior Recreational registrant requests financial assistance | Payment is deferred |
| Junior Recreational registrant does not request financial assistance | Payment may proceed immediately if no other deferral applies |

## League selection summary

| Case | Expected result |
| --- | --- |
| Registrant has guaranteed return | Summary labels it as Guaranteed return |
| Registrant has sabbatical | Summary labels it as Sabbatical |
| Registrant has ADD waitlist | Summary labels it as Waitlist: ADD |
| Registrant has REPLACE waitlist | Summary labels it as Waitlist: REPLACE and shows replacement league |
| Registrant has third-league interest | Summary labels it as Third-league interest |
| Registrant has BYOT request | Summary labels it as BYOT request |
| Registrant has deferred-payment reason | Summary clearly states payment will be deferred |

## Phase 7: Submission & Checkout Tests

### Submission outcome tests

| Case | Expected outcome |
|---|---|
| Social membership only | Registration submitted; Stripe Checkout created |
| Regular membership plus spare-only | Registration submitted; Stripe Checkout created |
| Returning member with one guaranteed league | Registration submitted; Stripe Checkout created |
| Returning member with two guaranteed leagues | Registration submitted; Stripe Checkout created |
| Sabbatical-only registration | Registration submitted; Stripe Checkout created for sabbatical fee only |
| Junior Recreational without assistance | Registration submitted; Stripe Checkout created |
| BYOT request as first or second league | Registration submitted; Stripe Checkout created |
| Waitlist ADD request | Registration submitted; payment deferred; no Stripe Checkout |
| Waitlist REPLACE request | Registration submitted; payment deferred; no Stripe Checkout |
| Third-league interest | Registration submitted; payment deferred; no Stripe Checkout |
| Junior Recreational with assistance request | Registration submitted; payment deferred; no Stripe Checkout |
| Guaranteed league plus non-guaranteed league request | Registration submitted; payment deferred; no Stripe Checkout |
| Sabbatical plus waitlist request | Registration submitted; payment deferred; no Stripe Checkout |
| Waitlist-only registration | Registration submitted; no payment due; no Stripe Checkout |

### Review screen tests

| Case | Expected outcome |
|---|---|
| Registration has guaranteed leagues | Review labels them as confirmed/payable now |
| Registration has waitlist ADD entries | Review labels them as waitlisted ADD |
| Registration has waitlist REPLACE entries | Review labels them as waitlisted REPLACE and shows replacement league |
| Registration has third-league interest | Review shows ordered third-league list and payment deferral |
| Registration has sabbaticals | Review labels them as sabbaticals and shows sabbatical fee |
| Registration has BYOT request | Review shows teammate text and BYOT status |
| Registration has discounts | Review shows itemized discounts |
| Registration is deferred | Review clearly explains why payment is deferred |
| Registration requires immediate payment | Review clearly shows total due now |

### Submission validation tests

| Case | Expected outcome |
|---|---|
| Policies not accepted | Submission fails |
| Minor missing parent/guardian info | Submission fails |
| Registration closed | Submission fails |
| BYOT missing teammate text | Submission fails |
| BYOT selected as third league | Submission fails |
| Student discount missing institution | Submission fails |
| Reciprocal discount missing club | Submission fails |
| REPLACE waitlist missing replacement league | Submission fails |
| More than two REPLACE waitlists | Submission fails |
| More than two protected return/sabbatical claims | Submission fails |
| Ineligible age for league | Submission fails |
| Ineligible experience for league | Submission fails |

### Stripe tests

| Case | Expected outcome |
|---|---|
| Immediate-payment registration submitted | Stripe Checkout Session created |
| Checkout Session created | Stripe session ID stored internally |
| Checkout Session metadata | Metadata includes registration ID and invoice/payment ID |
| User returns from Stripe success URL | Registration is not marked paid unless webhook has confirmed |
| `checkout.session.completed` received | Invoice/payment marked paid |
| `checkout.session.completed` received | Registration marked paid/confirmed |
| Duplicate webhook received | No duplicate side effects |
| Checkout canceled | Registration remains unpaid/unconfirmed |
| Checkout fails or expires | Registration remains unpaid/unconfirmed |

### Idempotency tests

| Case | Expected outcome |
|---|---|
| User double-clicks submit for immediate-payment registration | One invoice/payment record created |
| User double-clicks submit for immediate-payment registration | One active Stripe Checkout Session reused |
| User double-clicks submit for deferred registration | One submitted registration state; no duplicate invoice |
| User double-clicks submit with waitlist entries | No duplicate waitlist entries |
| User double-clicks submit with sabbaticals | No duplicate sabbatical records |
| Stripe sends duplicate successful webhook | Payment confirmation runs once |

# Phase 8 Test Matrix Additions: Staff Waitlists

Implementation note: Phase 8 now has automated helper coverage for vacancy
calculation and decline movement rules in
`backend/src/registration/waitlistStaffService.test.ts`. The remaining rows
below describe integration and UI workflows that should be exercised as seeded
end-to-end fixtures become available.

## Staff access and permissions

### P8-001: Unauthorized user cannot access waitlist manager

Given a user without waitlist management permissions  
When they attempt to access the staff waitlist dashboard  
Then access is denied.

### P8-002: Authorized staff can access waitlist dashboard

Given a user with waitlist management permissions  
When they open the staff waitlist dashboard  
Then they can view league vacancy and waitlist summaries.

---

## Vacancy calculations

### P8-003: Permanent vacancies are calculated correctly

Given a standard league with capacity 40  
And 35 confirmed permanent placements  
When staff views the league waitlist manager  
Then the system shows 5 permanent vacancies.

### P8-004: Temporary sabbatical-fill vacancies are calculated separately

Given a league with 2 active sabbatical spots available for temporary fill  
When staff views the league waitlist manager  
Then the system shows 2 temporary sabbatical-fill vacancies separately from
permanent vacancies.

### P8-005: Permanent vacancies are prioritized before temporary vacancies

Given a league with both permanent and temporary vacancies  
When staff processes offers  
Then permanent spot offers are processed before temporary sabbatical-fill
offers.

---

## Offer creation

### P8-006: Staff can send permanent offers to top eligible waitlist entries

Given a league with permanent vacancies  
And active eligible waitlist entries  
When staff sends offers to the top N eligible entries  
Then offer records are created  
And offer emails are sent  
And waitlist audit entries are created.

### P8-007: Staff can send temporary sabbatical-fill offers

Given a league with temporary sabbatical-fill vacancies  
And active eligible waitlist entries  
When staff sends temporary fill offers  
Then offer records are created as temporary offers  
And the email clearly states the spot is temporary.

### P8-008: BYOT leagues cannot receive waitlist offers

Given a BYOT league  
When staff attempts to send waitlist offers  
Then the action is blocked.

### P8-009: Ineligible waitlist entry cannot receive offer without override

Given a waitlist entry whose member is no longer eligible for the league  
When staff attempts to send an offer  
Then the system blocks the offer or requires a documented override, depending
on configured staff permissions.

---

## Offer response behavior

### P8-010: First decline preserves waitlist position

Given a member with decline count 0  
And a pending waitlist offer  
When the member declines the offer  
Then the offer is marked declined  
And the member remains in the same waitlist position  
And decline count becomes 1  
And the change is audited.

### P8-011: Second decline moves member to bottom

Given a member with decline count 1  
And a pending waitlist offer  
When the member declines the offer  
Then the offer is marked declined  
And the member is moved to the bottom of the waitlist  
And the change is audited.

### P8-012: Temporary fill decline counts like permanent decline

Given a member receives a temporary sabbatical-fill offer  
When the member declines the offer  
Then decline rules are applied the same as for a permanent offer.

### P8-013: No response auto-accepts after 24 hours

Given a pending waitlist offer whose deadline has passed  
And the member did not decline  
When the auto-accept job runs  
Then the offer is marked auto-accepted  
And the member is placed into the league  
And the action is audited.

### P8-014: Auto-accept job is idempotent

Given an offer already auto-accepted  
When the auto-accept job runs again  
Then no duplicate placement is created  
And no duplicate audit mutation occurs.

---

## Placement behavior

### P8-015: Permanent accepted offer creates permanent placement

Given a pending permanent offer  
When the offer is accepted  
Then the member is placed permanently into the league  
And the waitlist entry is deactivated or removed  
And the change is audited.

### P8-016: Temporary accepted offer creates temporary placement

Given a pending temporary sabbatical-fill offer  
When the offer is accepted  
Then the member is placed temporarily into the league  
And the member remains on the waitlist  
And the change is audited.

### P8-017: REPLACE placement releases replaced league

Given a waitlist entry of type REPLACE  
And the member accepts the offer  
When the placement is processed  
Then the member is added to the new league  
And the replaced league placement is released  
And both changes are audited.

### P8-018: ADD placement requiring cleanup is detected

Given a member has active ADD waitlist entries  
And the member reaches 2 active leagues  
When placement is processed  
Then the system identifies ADD entries requiring cleanup  
And blocks further progression or flags staff review until resolved.

---

## Waitlist rollover

### P8-019: Waitlist rolls over to successor league

Given a predecessor league with active waitlist entries  
And a configured successor league  
When rollover runs  
Then active waitlist entries are created or updated for the successor league.

### P8-020: Rollover preserves order

Given multiple active predecessor waitlist entries  
When rollover runs  
Then successor waitlist entries preserve the same relative order.

### P8-021: Rollover preserves decline counts

Given an active predecessor waitlist entry with decline count 1  
When rollover runs  
Then the successor waitlist entry has decline count 1.

### P8-022: Rollover is idempotent

Given rollover has already run for a predecessor/successor pair  
When rollover runs again  
Then no duplicate active waitlist entries are created.

### P8-023: Rollover is audited

Given rollover creates or updates waitlist entries  
When rollover completes  
Then audit entries exist for the rollover changes.

---

## Manual staff actions

### P8-024: Manual removal requires reason and audit

Given staff removes a person from a waitlist  
When they submit the action  
Then a reason is required  
And the removal is audited.

### P8-025: Manual reorder requires reason and audit

Given staff reorders waitlist entries  
When they submit the action  
Then a reason is required  
And the reorder is audited.

### P8-026: Manual ADD-to-REPLACE conversion requires replacement league

Given staff converts an ADD entry to REPLACE  
When they submit the conversion  
Then they must specify the league being replaced  
And the change is audited.

### P8-027: Manual offer cancellation requires reason and audit

Given staff cancels a pending offer  
When they submit the cancellation  
Then a reason is required  
And the offer is marked canceled  
And the cancellation is audited.

---

## Payment links after placement

### P8-028: Staff can trigger payment link after placement

Given a deferred registration becomes ready for payment after placement  
When staff triggers payment  
Then a payment link is created using the existing fee calculation service.

### P8-029: Temporary sabbatical-fill placement applies sabbatical-fill discount

Given a member accepts a temporary sabbatical-fill spot  
When the payment amount is calculated  
Then the sabbatical-fill discount is applied as the full sabbatical fee amount.

### P8-030: Payment remains deferred if unresolved placement items remain

Given a registration still has unresolved non-guaranteed items  
When staff attempts to trigger payment  
Then the system either blocks payment or warns staff according to existing
payment-deferral rules.

# Phase 9 Addendum — Member Communications Tests

## Member registration dashboard

### MC-001 — Member can view submitted immediate-payment registration

**Scenario:** A member submits a registration that requires immediate payment.

**Expected result:**

- Registration appears on the member dashboard.
- Status indicates payment is required.
- Payment link is visible.
- League and membership choices are shown accurately.
- Registration is not shown as paid or fully confirmed until payment succeeds.

---

### MC-002 — Member can view deferred registration

**Scenario:** A member submits a registration with a waitlist request or
third-league interest causing payment deferral.

**Expected result:**

- Registration appears on the dashboard.
- Status indicates payment is deferred.
- No payment link is shown unless one has been generated.
- Deferral reason is shown in plain language.
- Pending items are not displayed as confirmed.

---

### MC-003 — Delegated user can view registration for managed curler

**Scenario:** A parent or delegated user registers a curler and later views the
registration.

**Expected result:**

- Delegated user can view the registration.
- Curler name is clearly displayed.
- The page does not imply the delegated user is the curler.
- Unauthorized users cannot view the registration.

---

### MC-004 — Member cannot view another member's registration

**Scenario:** A logged-in user attempts to access a registration for a curler
they do not manage.

**Expected result:**

- Access is denied.
- No registration details are leaked.

---

## Registration detail display

### MC-005 — Confirmed leagues are displayed as confirmed

**Scenario:** A paid registration includes confirmed guaranteed leagues.

**Expected result:**

- Confirmed leagues are listed under confirmed leagues.
- League names and sessions are correct.
- No waitlist language is shown for confirmed leagues.

---

### MC-006 — Waitlist entries display type and position

**Scenario:** A member has active ADD and REPLACE waitlist entries.

**Expected result:**

- Each waitlist entry is shown.
- Each entry shows ADD or REPLACE.
- REPLACE entries show the replacement league.
- Current position is shown.
- Decline count is shown if available.

---

### MC-007 — Third-league interest is displayed in member-provided order

**Scenario:** A member submits ranked third-league interest choices.

**Expected result:**

- Third-league choices are displayed in the submitted order.
- Page explains these are interest choices, not confirmed spots.
- Page explains staff will follow up if placement is possible.

---

### MC-008 — Temporary sabbatical-fill spot is clearly marked

**Scenario:** A member is placed into a temporary sabbatical-fill spot.

**Expected result:**

- League is marked as temporary.
- Page explains the original member may return in a future session.
- Page explains the member keeps their waitlist position for a permanent spot.

---

### MC-009 — Sabbatical is displayed correctly

**Scenario:** A member has an active sabbatical.

**Expected result:**

- Sabbatical is shown separately from confirmed active leagues.
- Page explains that the member is preserving a return right.
- Sabbatical fee/payment status is shown.
- If applicable, duration-limit warning is shown.

---

### MC-010 — BYOT request displays teammate text

**Scenario:** A member registers for a BYOT league and provides teammate names.

**Expected result:**

- BYOT league request is shown.
- Submitted teammate text is visible.
- Page explains placement is coordinated by the league coordinator.

---

## Payment visibility

### MC-011 — Payment link shown only when payment is due

**Scenario:** Registration has a current payable invoice/payment link.

**Expected result:**

- Payment link is visible.
- Amount due is visible.
- Payment status says payment is required.

---

### MC-012 — Payment link hidden when payment is deferred

**Scenario:** Registration is awaiting placement or review.

**Expected result:**

- No payment link is shown.
- Page explains why payment is deferred.

---

### MC-013 — Successful payment updates member view

**Scenario:** Member pays through Stripe successfully.

**Expected result:**

- Registration payment status updates to paid.
- Payment confirmation details are visible.
- Payment link is no longer presented as an unpaid action.

---

### MC-014 — Failed or abandoned payment does not confirm registration

**Scenario:** Member starts checkout but payment fails or is abandoned.

**Expected result:**

- Registration is not marked paid.
- Registration is not falsely shown as confirmed due to payment.
- Member is instructed to retry or contact staff.

---

## Self-service waitlist removal

### MC-015 — Member removes self from waitlist

**Scenario:** Member removes their own active waitlist entry.

**Expected result:**

- Confirmation prompt is shown.
- Waitlist entry becomes inactive/removed after confirmation.
- Member no longer appears in active waitlist position list.
- Waitlist change is audited.
- Confirmation email is sent.

---

### MC-016 — Delegated user removes curler from waitlist

**Scenario:** Delegated user removes a managed curler from a waitlist.

**Expected result:**

- Action is allowed.
- Audit identifies the acting user.
- Curler/waitlist entry is updated correctly.
- Confirmation email is sent to the appropriate address.

---

### MC-017 — Unauthorized waitlist removal is blocked

**Scenario:** User attempts to remove another user's waitlist entry.

**Expected result:**

- Action is denied.
- Waitlist entry remains active.
- No removal email is sent.
- No misleading audit entry is created.

---

### MC-018 — Removing waitlist entry warns about losing position

**Scenario:** Member starts waitlist removal flow.

**Expected result:**

- Confirmation copy clearly says the current waitlist position will be lost.
- Cancellation leaves the waitlist entry unchanged.

---

## Email sending

### MC-019 — Immediate-payment registration email

**Scenario:** Registration is submitted and immediate payment is required.

**Expected result:**

- Correct email type is sent.
- Email includes curler name, season/session, summary, amount due, and payment
  link.
- Email says registration is not fully confirmed until payment is complete.

---

### MC-020 — Deferred-payment registration email

**Scenario:** Registration is submitted and payment is deferred.

**Expected result:**

- Correct email type is sent.
- Email includes curler name, season/session, submitted choices, and deferral
  reason.
- Email does not include a payment link unless one exists.

---

### MC-021 — Payment confirmation email

**Scenario:** Stripe payment succeeds.

**Expected result:**

- Payment confirmation email is sent.
- Email includes curler name, season/session, amount paid, and paid item summary.
- Pending waitlist or third-league items are not described as confirmed.

---

### MC-022 — Social membership confirmation email

**Scenario:** Member purchases social membership.

**Expected result:**

- Email confirms social membership after payment.
- Email states social membership does not include ice privileges.
- Email states social members cannot curl or spare unless they later upgrade and
  purchase applicable ice privileges.

---

### MC-023 — Waitlist joined email

**Scenario:** Member is added to a waitlist.

**Expected result:**

- Waitlist joined email is sent.
- Email includes league name, ADD/REPLACE type, replacement league if
  applicable, and current position.
- Email explains waitlists roll forward to successor leagues.

---

### MC-024 — Waitlist removed by member email

**Scenario:** Member removes themselves from a waitlist.

**Expected result:**

- Removal confirmation email is sent.
- Email confirms the league and loss of previous position.

---

### MC-025 — Staff waitlist change email

**Scenario:** Staff materially changes a member's waitlist entry.

**Expected result:**

- Waitlist status changed email is sent unless staff intentionally suppresses
  notification.
- Email describes what changed.
- Waitlist audit records the staff action.

---

### MC-026 — Permanent waitlist offer email

**Scenario:** Staff offers a permanent spot from a waitlist.

**Expected result:**

- Offer email is sent.
- Email identifies the spot as permanent.
- Email states the 24-hour response rule.
- Email states no response means acceptance.
- Email includes accept/decline links or clear instructions.

---

### MC-027 — Temporary sabbatical-fill offer email

**Scenario:** Staff offers a temporary sabbatical-fill spot.

**Expected result:**

- Offer email is sent.
- Email identifies the spot as temporary.
- Email explains another member may return in a future session.
- Email explains accepting does not remove the member from the permanent
  waitlist.
- Email states declining counts under normal decline rules.

---

### MC-028 — Offer accepted email, explicit acceptance

**Scenario:** Member explicitly accepts an offer.

**Expected result:**

- Offer accepted email is sent.
- Email includes league name and spot type.
- Email includes next steps/payment follow-up if applicable.

---

### MC-029 — Offer accepted email, automatic acceptance

**Scenario:** Member does not decline within 24 hours and offer is treated as
accepted.

**Expected result:**

- Offer accepted email is sent.
- Email may state acceptance occurred automatically.
- League placement follows Phase 8 rules.
- Payment follow-up is included if applicable.

---

### MC-030 — Offer declined email, first decline

**Scenario:** Member declines an offer for the first time on that waitlist
instance.

**Expected result:**

- Decline confirmation email is sent.
- Email says position is retained.
- Updated waitlist position is shown if available.

---

### MC-031 — Offer declined email, second decline

**Scenario:** Member declines an offer for the second time on that waitlist
instance.

**Expected result:**

- Decline confirmation email is sent.
- Email says the member was moved to the bottom of the waitlist.
- Updated waitlist position is shown if available.
- Waitlist audit records the move.

---

### MC-032 — Deferred payment link email

**Scenario:** Staff generates a payment link for a deferred registration.

**Expected result:**

- Payment-ready email is sent.
- Email includes summary, amount due, and payment link.
- Email states payment is required to complete registration.

---

### MC-033 — Junior Recreational financial assistance pending email

**Scenario:** Junior Recreational registration requests financial assistance.

**Expected result:**

- Assistance pending email is sent.
- Email includes requested assistance level.
- Email says payment is deferred during review.

---

### MC-034 — Junior Recreational financial assistance decision email

**Scenario:** Staff records financial assistance decision.

**Expected result:**

- Decision/payment email is sent.
- Email includes approved assistance level/amount.
- Email includes final amount due and payment link.
- If assistance is reduced or denied, email is clear and sensitive.

---

### MC-035 — Sabbatical confirmation email

**Scenario:** Member submits a sabbatical registration.

**Expected result:**

- Sabbatical confirmation email is sent.
- Email includes league name and session.
- Email explains the sabbatical preserves return rights under sabbatical rules.

---

### MC-036 — Sabbatical release email

**Scenario:** Member or staff releases a sabbatical-held spot.

**Expected result:**

- Sabbatical release email is sent.
- Email explains the protected spot has been released.
- Email explains future return requires joining the waitlist.

---

### MC-037 — BYOT confirmation email

**Scenario:** Member submits BYOT registration.

**Expected result:**

- BYOT confirmation language is included in registration/payment email or a
  separate email.
- Email includes teammate text.
- Email explains coordinator-managed placement and possible staff follow-up.

---

### MC-038 — Staff manual update email

**Scenario:** Staff materially updates a submitted registration.

**Expected result:**

- Manual update email can be sent.
- Email states what changed and whether payment status changed.
- Sending the email does not itself alter registration business state.

---

## Email logging and resending

### MC-039 — Emails are logged

**Scenario:** Any registration-related email is sent.

**Expected result:**

- Email log records message type, recipient, associated registration/offer if
  applicable, subject, timestamp, and status if available.

---

### MC-040 — Staff can view registration communication history

**Scenario:** Staff opens a registration.

**Expected result:**

- Staff can see related communications.
- Each entry shows message type, recipient, timestamp, and delivery status if
  available.

---

### MC-041 — Staff can resend payment link email without duplicate charge

**Scenario:** Staff resends a deferred payment link email.

**Expected result:**

- Email is resent.
- Existing payment link/session/invoice is reused where appropriate.
- No duplicate business action or duplicate charge is created.

---

### MC-042 — Staff can resend waitlist offer email without duplicate offer

**Scenario:** Staff resends an offer email.

**Expected result:**

- Existing offer is referenced.
- No new offer is created.
- Offer deadline is not accidentally reset unless staff explicitly performs a
  separate deadline-extension action.

---

### MC-043 — Failed/bounced email visible to staff

**Scenario:** Email provider reports failure or bounce.

**Expected result:**

- Communication log shows failed/bounced status.
- Staff can identify the affected recipient and registration/offer.
- Registration business state is not automatically changed solely due to bounce.

---

## Email action links and authorization

### MC-044 — Decline offer link works for intended recipient

**Scenario:** Member clicks decline link from waitlist offer email.

**Expected result:**

- Offer is declined.
- Decline rules are applied.
- Confirmation email is sent.
- Waitlist audit records the change.

---

### MC-045 — Expired/invalid action link is rejected

**Scenario:** User clicks expired or invalid signed action link.

**Expected result:**

- Action is not performed.
- User sees clear message.
- No waitlist or registration state is changed.

---

### MC-046 — Action link cannot be used for unrelated account access

**Scenario:** User clicks a signed action link.

**Expected result:**

- Link only authorizes the specific intended action.
- It does not expose unrelated registration/account data.

---

### MC-047 — Duplicate action link usage is safe

**Scenario:** User clicks the same decline or accept link multiple times.

**Expected result:**

- Business action is idempotent or safely rejected after first use.
- No duplicate decline count increments occur.
- No duplicate placement occurs.

---

## Copy correctness

### MC-048 — No deferred registration is described as confirmed

**Scenario:** Review emails and member pages for deferred registrations.

**Expected result:**

- Pending league placement is not called confirmed.
- Pending payment is not called paid.
- Third-league interest is not called a league registration.

---

### MC-049 — No temporary sabbatical-fill spot is described as permanent

**Scenario:** Review emails and member pages for temporary sabbatical-fill
placements/offers.

**Expected result:**

- Temporary nature is clearly stated.
- Member is told original sabbatical holder may return in a future session.

---

### MC-050 — No-response-means-acceptance rule is explicit

**Scenario:** Review waitlist offer emails.

**Expected result:**

- Offer email clearly says no response within 24 hours means acceptance.
- Email says staff will follow up about payment if required.

# Phase 10 Test Matrix Addendum

This section adds hardening, launch-readiness, and operational tests that should be included before registration is opened for live use.

These tests supplement the existing registration test matrix.

---

## 1. Rule coverage audit

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-RULE-001 | Compare implemented registration rules to `docs/registration/rules.md` | Every documented rule has automated coverage, manual coverage, or an explicitly accepted exception | Blocker |
| P10-RULE-002 | Attempt to bypass UI validation through direct API submission for ineligible league | Server rejects the request | Blocker |
| P10-RULE-003 | Attempt to submit registration without policy acceptance | Registration is rejected | Blocker |
| P10-RULE-004 | Attempt to claim three protected returns/sabbaticals | Registration is rejected | Blocker |
| P10-RULE-005 | Attempt to select BYOT as third-league interest | Registration is rejected | Blocker |
| P10-RULE-006 | Attempt to create sabbatical outside priority registration | Registration is rejected unless staff override exists | Blocker |
| P10-RULE-007 | Attempt to apply discounts to social membership | Discounts are not applied | Blocker |
| P10-RULE-008 | Attempt to apply discounts to sabbatical fees | Discounts are not applied | Blocker |

---

## 2. Stripe and payment hardening

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-PAY-001 | Immediate-payment registration completes Stripe checkout successfully | Registration is marked paid/confirmed exactly once | Blocker |
| P10-PAY-002 | Immediate-payment registration abandons checkout | Registration remains unpaid and unconfirmed | Blocker |
| P10-PAY-003 | Immediate-payment registration payment fails | Registration remains unpaid and unconfirmed | Blocker |
| P10-PAY-004 | Stripe success webhook is delivered twice | Registration is not double-confirmed and no duplicate payment record is created | Blocker |
| P10-PAY-005 | Stripe webhook arrives before user returns from checkout | Registration is correctly marked paid | High |
| P10-PAY-006 | Deferred payment link is generated by staff | Payment link amount matches internal invoice amount | Blocker |
| P10-PAY-007 | Deferred payment succeeds | Registration/payment status updates correctly | Blocker |
| P10-PAY-008 | Deferred payment fails | Registration remains unpaid and staff can see failure/pending status | High |
| P10-PAY-009 | Staff resends payment link | Existing registration remains consistent; duplicate invoice/payment records are not incorrectly created | High |
| P10-PAY-010 | Registration is canceled before deferred payment | Old payment link cannot incorrectly confirm canceled registration | Blocker |
| P10-PAY-011 | Stripe amount differs from internal calculation due to tampering attempt | Payment creation uses server-calculated amount only | Blocker |
| P10-PAY-012 | Social membership registration with attempted discount | Stripe amount excludes discount | Blocker |
| P10-PAY-013 | Sabbatical fee with attempted percentage discount | Stripe amount does not discount sabbatical fee | Blocker |
| P10-PAY-014 | Sabbatical-fill discount applies with other discounts | Sabbatical-fill discount equals full sabbatical fee and is applied separately | High |

---

## 3. Registration status transitions

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-STATUS-001 | Draft registration is abandoned | Draft remains resumable or safely expired according to app behavior | Medium |
| P10-STATUS-002 | Submitted registration requires immediate payment | Registration enters payment-pending state | Blocker |
| P10-STATUS-003 | Submitted registration requires deferred payment | Registration enters awaiting-placement/review/payment state with clear reason | Blocker |
| P10-STATUS-004 | Payment succeeds | Registration enters paid/confirmed state | Blocker |
| P10-STATUS-005 | Payment fails | Registration does not enter confirmed state | Blocker |
| P10-STATUS-006 | Staff cancels registration | Registration enters canceled state and is not payable unless restored | High |
| P10-STATUS-007 | Deferred registration receives placement decision | Registration can generate correct payment amount | High |
| P10-STATUS-008 | Junior Recreational assistance request submitted | Registration enters assistance-review state and payment is deferred | High |
| P10-STATUS-009 | Junior Recreational assistance decision made | Registration can be invoiced for approved amount | High |

---

## 4. Access control and security

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-SEC-001 | Anonymous visitor attempts to access registration dashboard | Access denied or redirected to login | Blocker |
| P10-SEC-002 | User attempts to view another user's registration without delegation | Access denied | Blocker |
| P10-SEC-003 | Delegated registrant views delegated curler registration | Access allowed | Blocker |
| P10-SEC-004 | User attempts staff waitlist endpoint | Access denied | Blocker |
| P10-SEC-005 | Staff user accesses waitlist manager | Access allowed | Blocker |
| P10-SEC-006 | User attempts to modify their waitlist position directly | Request rejected | Blocker |
| P10-SEC-007 | User attempts to mark registration paid directly | Request rejected | Blocker |
| P10-SEC-008 | User attempts to create unauthorized sabbatical directly | Request rejected | Blocker |
| P10-SEC-009 | User attempts to exceed REPLACE waitlist limit through API | Request rejected | Blocker |
| P10-SEC-010 | User attempts to join age-ineligible league through API | Request rejected | Blocker |
| P10-SEC-011 | User attempts to join experience-ineligible league through API | Request rejected | Blocker |
| P10-SEC-012 | Staff action is performed without required role | Request rejected | Blocker |

---

## 5. Waitlist hardening and audit tests

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-WL-001 | User joins waitlist as ADD | Entry is created in correct order and audit log is written | Blocker |
| P10-WL-002 | User joins waitlist as REPLACE | Entry records replacement league and audit log is written | Blocker |
| P10-WL-003 | User removes self from waitlist | Entry is inactive/removed and audit log is written | Blocker |
| P10-WL-004 | Staff manually adds waitlist entry | Entry is created and audit log records staff actor and reason | Blocker |
| P10-WL-005 | Staff manually removes waitlist entry | Entry is removed/inactive and audit log records staff actor and reason | Blocker |
| P10-WL-006 | Staff manually reorders waitlist | New order is saved and audit log records before/after state or sufficient details | Blocker |
| P10-WL-007 | Waitlist rolls over to successor league | Order is preserved and audit log records system rollover | Blocker |
| P10-WL-008 | First offer decline | User keeps position and decline count increments | Blocker |
| P10-WL-009 | Second offer decline | User moves to bottom and audit log is written | Blocker |
| P10-WL-010 | Offer receives no response after 24 hours | Offer is treated as accepted | Blocker |
| P10-WL-011 | Temporary sabbatical-fill offer is declined | Decline count behavior matches permanent spot decline behavior | High |
| P10-WL-012 | User is removed and re-added to waitlist | Decline count resets for new waitlist instance | High |
| P10-WL-013 | User reaches two leagues while on ADD waitlists | User must resolve ADD waitlists immediately | High |
| P10-WL-014 | User converts ADD waitlist to REPLACE | Replacement league is required and REPLACE limit is enforced | High |
| P10-WL-015 | User attempts more than two active REPLACE waitlists | Request is rejected | Blocker |

---

## 6. Staff operations rehearsal tests

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-STAFF-001 | Staff configures a full season and session | Configuration is saved and usable for registration | Blocker |
| P10-STAFF-002 | Staff configures registration schedule | Registration transitions or displays correct state | Blocker |
| P10-STAFF-003 | Staff configures league predecessor/successor links | Returning rights and waitlist rollover work | Blocker |
| P10-STAFF-004 | Staff opens priority registration | Returning members can claim eligible protected spots | Blocker |
| P10-STAFF-005 | Staff closes priority registration | Guaranteed return period ends; post-priority workflows are available | Blocker |
| P10-STAFF-006 | Staff views league vacancy summary | Permanent and temporary vacancies are understandable | High |
| P10-STAFF-007 | Staff sends offers to top N waitlisted users | Correct recipients receive offer emails | Blocker |
| P10-STAFF-008 | Staff processes declined offer | Waitlist position and decline count update correctly | High |
| P10-STAFF-009 | Staff processes no-response offer | Offer is accepted after 24 hours | High |
| P10-STAFF-010 | Staff generates deferred payment link | Correct invoice/payment link is produced | Blocker |
| P10-STAFF-011 | Staff reviews waitlist audit history | Audit entries are understandable and complete | High |
| P10-STAFF-012 | Staff pauses registration | Users cannot start/submit new registrations; existing data is preserved | Blocker |

---

## 7. Email verification tests

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-EMAIL-001 | Registration submitted with immediate payment | User receives clear submission/payment email | High |
| P10-EMAIL-002 | Registration submitted with deferred payment | User receives clear deferred-status email | High |
| P10-EMAIL-003 | Junior Recreational assistance requested | User receives assistance-review email | High |
| P10-EMAIL-004 | Junior Recreational assistance decision made | User receives decision and payment instructions | High |
| P10-EMAIL-005 | Waitlist offer sent | Email clearly states 24-hour decline window and automatic acceptance rule | Blocker |
| P10-EMAIL-006 | Waitlist offer declined | User receives confirmation if implemented | Medium |
| P10-EMAIL-007 | Waitlist offer accepted | User receives confirmation if implemented | Medium |
| P10-EMAIL-008 | Deferred payment link sent | Email has correct amount, curler, season/session, and payment link | Blocker |
| P10-EMAIL-009 | Sabbatical registration submitted | Email clearly confirms sabbatical and fee/payment status | High |
| P10-EMAIL-010 | BYOT registration submitted | Email avoids over-promising placement if coordinator review may occur | High |

---

## 8. Production data validation tests

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-DATA-001 | Fiscal year is configured | Fiscal year is July 1-June 30 or correct tenant-specific value | Blocker |
| P10-DATA-002 | Active membership season is configured | Membership validity is correct for current registration period | Blocker |
| P10-DATA-003 | Session order is configured | Winter-only discount applies only when registering after first session | Blocker |
| P10-DATA-004 | Pricing is configured | Regular, social, league, spare-only, sabbatical, and junior fees are correct | Blocker |
| P10-DATA-005 | Discounts are configured | Student, reciprocal, and winter-only discounts are correct | Blocker |
| P10-DATA-006 | League fees are configured | No registrable league has missing or incorrect fee | Blocker |
| P10-DATA-007 | League capacities are configured | No registrable league has missing or invalid capacity | Blocker |
| P10-DATA-008 | League first day of play is configured | Age eligibility can be calculated | Blocker |
| P10-DATA-009 | League last day of play is configured | Sabbatical duration can be calculated | Blocker |
| P10-DATA-010 | League age limits are valid | Maximum age is not lower than minimum age | High |
| P10-DATA-011 | League experience requirements are valid | Requirements are non-negative and sensible | High |
| P10-DATA-012 | Predecessor/successor links are valid | No circular league continuity chains exist | Blocker |
| P10-DATA-013 | BYOT league settings are valid | BYOT leagues do not use waitlists/sabbaticals and have team capacity | High |
| P10-DATA-014 | Existing waitlists are valid | Waitlist entries reference eligible users and active/current league lineage | High |
| P10-DATA-015 | Existing sabbaticals are valid | Sabbaticals reference eligible leagues and do not exceed limit unless overridden | High |
| P10-DATA-016 | Existing users have required profile data | Missing critical data is identified before launch | High |

---

## 9. Performance sanity tests

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-PERF-001 | 50 users start registration within a short period | System remains responsive | Medium |
| P10-PERF-002 | 50 users submit registration within a short period | Submissions complete without data corruption | High |
| P10-PERF-003 | Staff opens waitlist manager for a large league | Page loads within acceptable time | Medium |
| P10-PERF-004 | Staff opens registration dashboard with realistic data | Page loads within acceptable time | Medium |
| P10-PERF-005 | Member views waitlist positions | Page loads within acceptable time | Medium |
| P10-PERF-006 | Registration submission creates multiple related records | Operation completes atomically or rolls back safely | Blocker |

---

## 10. Launch and pause tests

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-LAUNCH-001 | Registration is closed | Users cannot submit registration | Blocker |
| P10-LAUNCH-002 | Registration enters priority state | Priority-specific returning-member options appear | Blocker |
| P10-LAUNCH-003 | Registration enters open state | Guaranteed return options are no longer available to normal users | Blocker |
| P10-LAUNCH-004 | Staff pauses registration unexpectedly | New submissions are blocked and clear message is shown | Blocker |
| P10-LAUNCH-005 | Staff reopens registration after pause | Existing draft/submitted registrations remain consistent | High |
| P10-LAUNCH-006 | Controlled production test registration is submitted | Payment, email, registration status, and staff visibility are correct | Blocker |
| P10-LAUNCH-007 | Serious issue occurs after launch | Staff can identify how to pause registration and contact support | Blocker |

---

## 11. Regression tests for resolved policy decisions

| ID | Scenario | Expected result | Priority |
|---|---|---|---|
| P10-REGRESS-001 | Spare-only registration | Charges regular membership plus spare-only ice privilege fee | Blocker |
| P10-REGRESS-002 | Sabbatical-only registration | Does not require regular membership | Blocker |
| P10-REGRESS-003 | Social member upgrades to regular | Pays full regular membership price with no social credit and no discounts | High |
| P10-REGRESS-004 | Student and reciprocal discounts both selected | Both apply automatically when required self-reported info is provided | High |
| P10-REGRESS-005 | Dollar and percentage discounts combined | Dollar discounts apply first, then percentage discounts | High |
| P10-REGRESS-006 | Winter-only discount | Applies only to regular membership when registration starts after first session of season | High |
| P10-REGRESS-007 | Third-league interest exists | Payment is deferred | Blocker |
| P10-REGRESS-008 | Third-league interest list submitted | Ordered list is preserved and has no maximum length | Medium |
| P10-REGRESS-009 | Permanent and temporary sabbatical vacancies exist | Permanent vacancies are offered before temporary vacancies | High |
| P10-REGRESS-010 | New member requests BYOT league | Allowed if BYOT counts as one of first two leagues and teammate text is provided | High |
| P10-REGRESS-011 | Returning member requests BYOT league as third league | Rejected | High |
| P10-REGRESS-012 | Junior Recreational financial assistance requested | Payment is deferred until decision | High |
| P10-REGRESS-013 | Non-member joins waitlist only | Account is required; no membership payment is required | High |
| P10-REGRESS-014 | Ineligible non-member tries to join waitlist | Request is rejected | High |
| P10-REGRESS-015 | Waitlist rolls to successor league | Position is preserved | High |

---

## Phase 10 completion requirement

Phase 10 should not be considered complete until:

- All blocker tests pass.
- Any failed high-priority tests are fixed or explicitly accepted.
- Staff has completed a realistic registration rehearsal.
- Stripe test-mode workflows have been verified.
- Production configuration has been reviewed.
- Registration can be paused quickly if needed.
- Known issues are documented.