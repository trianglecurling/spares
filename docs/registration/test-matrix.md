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
| User cancels draft | Draft is marked cancelled and is not resumed by default |

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
| Checkout cancelled | Registration remains unpaid/unconfirmed |
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