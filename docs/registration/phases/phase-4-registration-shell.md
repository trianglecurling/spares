# Phase 4 — Registration Shell

## Objective

Build the foundational registration workflow that allows a person to start,
save, resume, and complete the identity/demographic portion of registration.

This phase establishes the registration "shell" before membership, league
selection, discounts, invoices, waitlists, sabbaticals, or payment are added.

At the end of this phase, the app should be able to create a draft registration
for exactly one curler, identify who is submitting the registration, collect or
confirm the curler's profile information, record required policy acceptance, and
handle parent/guardian information for minors.

## Authoritative references

Before implementing this phase, read these documents:

- `docs/registration/rules.md`
- `docs/registration/data-model.md`
- `docs/registration/eligibility.md`
- `docs/registration/user-flow.md`
- `docs/registration/test-matrix.md`

If there is a conflict between this phase document and `rules.md`, `rules.md`
wins.

## Scope

Phase 4 includes:

- Starting a registration
- Identifying whether the curler is returning or new
- Requiring login for returning curlers
- Supporting registration for self
- Supporting registration on behalf of another curler
- Creating accounts for new curlers when needed
- Creating an account for the submitting user when needed
- Creating delegated impersonation rights when one person registers another
- Recording policy acceptance
- Collecting demographics for new curlers
- Confirming or updating demographics for returning curlers
- Collecting parent/guardian information for minors
- Saving draft registration progress
- Resuming an incomplete registration

Phase 4 excludes:

- Membership selection
- Social membership
- Regular membership
- Spare-only registration
- Junior Recreational registration
- Junior Advanced Commitment registration
- Curling experience collection
- Discounts
- League selection
- Guaranteed return logic
- Sabbaticals
- Waitlists
- Third-league interest
- BYOT teammate collection
- Fee calculation UI
- Invoice creation
- Stripe checkout
- Final registration submission

Phase 4 may create a registration record, but it should not create payable
charges or final league/membership commitments.

## Key concepts

### One registration is for one curler

A registration record represents exactly one curler.

A parent registering multiple children must complete one registration per child.

### Submitted by vs. curler

Each registration must track both:

- The `submittedBy` user: the person completing the registration
- The `curler` user/profile: the person being registered to curl or participate

These may be the same person.

Examples:

- Adult registering themself:
  - `submittedBy` = adult
  - `curler` = adult

- Parent registering child with same email:
  - `submittedBy` = parent
  - `curler` = child
  - Same email may be associated with both accounts/profiles

- Parent registering child with child's own email:
  - `submittedBy` = parent
  - `curler` = child
  - Explicit delegated access is granted from child account/profile to parent

- Spouse registering spouse:
  - `submittedBy` = spouse A
  - `curler` = spouse B
  - Delegated access is granted if not already present

## Registration status during Phase 4

Phase 4 only needs draft-style statuses.

Recommended statuses for this phase:

- `draft`
- `identity_incomplete`
- `policies_incomplete`
- `demographics_incomplete`
- `shell_complete`
- `cancelled`

If the existing data model already has a different status naming convention, use
the existing convention but preserve the same meanings.

A Phase 4 registration is complete when:

1. The submitting user is known.
2. The curler user/profile is known.
3. Required policies have been accepted.
4. Required curler demographic fields are complete.
5. Parent/guardian fields are complete if the curler is a minor.

At that point the registration may move to the next phase of the registration
flow in later implementation phases.

## Entry point

The registration flow begins with this question:

> Is the curler a returning member?

Use the word "curler" intentionally. The person filling out the form may be a
parent, spouse, guardian, or other authorized person.

Choices:

- Yes
- No

## Returning curler flow

If the answer is yes:

1. Require the user to log in using the existing email-based login system.
2. After login, determine which curler profile is being registered.

The current logged-in user may register:

- Themself
- A profile available through same-email account selection
- A profile available through delegated impersonation

If multiple profiles are available, show a profile picker.

The profile picker should clearly ask:

> Who are you registering?

Each option should show enough information to avoid confusion, such as:

- Name
- Email
- Date of birth, if available

If the intended returning curler profile is not available, the user should be
directed to contact staff or log in using the email associated with that
returning curler's account.

Do not create a duplicate account for a returning member in Phase 4.

## New curler flow

If the answer is no:

Ask who is completing the registration:

- I am registering myself
- I am registering someone else

### New curler registering themself

If the person is registering themself:

1. If they are not logged in, collect their email address and create/login the
   user account through the existing email-based login flow.
2. Create or select the curler profile for that user.
3. Set `submittedBy` and `curler` to the same user/profile.
4. Continue to policy acceptance and demographics.

### New curler registered by someone else

If someone is registering another person:

1. Identify or create the submitting user's account.
2. Collect the new curler's account/contact choice:
   - Use the submitting user's email for the curler
   - Use a different email for the curler
3. Create or select the curler account/profile.
4. Set `submittedBy` to the person completing the registration.
5. Set `curler` to the person being registered.
6. Establish delegated access from the curler to the submitting user.

If the curler uses the same email as the submitting user, same-email account
selection may provide implicit access if that is how the existing app works.

If the curler uses a different email from the submitting user, create explicit
delegated impersonation permission so the submitting user can register the curler
in the future.

## Account creation rules

Phase 4 must use the existing application account model and login system.

Rules:

- Do not introduce passwords.
- Use the existing email-based login system.
- Avoid duplicate accounts where possible.
- Returning curlers must log in rather than create a new account.
- New curler accounts may be created during registration.
- A non-curler parent/guardian account may be created when registering a child
  with a different email address.
- One email may be associated with multiple profiles/accounts if the existing app
  supports that behavior.

## Draft registration creation

Create a draft registration as soon as the app has enough information to know:

- The registration period/session being registered for
- The submitting user, if known
- Whether the curler is returning or new, if known

The draft should be updated as the user progresses.

Drafts should be resumable.

Recommended behavior:

- If the user has an existing incomplete draft for the same registration period
  and curler, allow them to resume it.
- Do not create multiple active drafts for the same curler and registration
  period unless the existing application architecture requires it.
- If multiple drafts somehow exist, prefer the most recently updated draft and
  leave staff cleanup for later.

## Policy acceptance

Before demographic confirmation or collection is considered complete, the
registrant must agree to these policies:

1. Code of Conduct — `/go/conduct`
2. Minor Athlete Abuse Prevention Policy — `/go/maapp`
3. Privacy Policy — `/go/privacy`

The registrant agrees on behalf of the curler.

For minors, the person completing registration is still the person who accepts
the policies on the minor's behalf.

Record:

- Registration ID
- Policy identifier
- Policy URL or version, if available
- Acceptance timestamp
- User who accepted
- Curler for whom the policy was accepted

If the app already has a policy acceptance model, use it. Otherwise, store this
on or under the registration.

The UI should require all three policies to be accepted before continuing.

## Demographics for new curlers

For new curlers, collect:

- First name
- Last name
- Date of birth
- Email address
- Phone number
- Mailing address
- Emergency contact name
- Emergency contact phone number

These fields describe the curler, not necessarily the person filling out the
registration.

The UI should explicitly say:

> Enter information for the person being registered.

## Demographics for returning curlers

For returning curlers:

1. Show the current demographic information on file.
2. Ask whether it is still current.
3. If not current, allow the user to update it.
4. Require all mandatory demographic fields to be complete before continuing.

Suggested wording:

> Please review the information we have on file for the curler. Is everything
> still current?

Choices:

- Yes, this is current
- No, I need to update it

## Minor detection

A curler is considered a minor for Phase 4 if they are under 18 years old on the
date the registration is being completed.

If the curler's date of birth changes during the flow, recalculate minor status.

## Parent/guardian information

If the curler is a minor, collect parent/guardian information:

- First name
- Last name
- Email address
- Phone number

The UI should allow copying email and/or phone from the curler information where
appropriate.

Example options:

- Use curler email
- Use curler phone

Parent/guardian information is required for minors.

Parent/guardian information is not required for adult curlers.

## Editing and resume behavior

During Phase 4, the registrant should be able to move backward and update
previous answers where safe.

At minimum, allow editing:

- Whether registering self or someone else, before account/profile creation is
  finalized
- Curler demographic fields
- Parent/guardian fields
- Policy acceptance before completing the policy step

Once the curler account/profile is attached to a draft registration, avoid
allowing the user to silently switch to another curler in the same draft. If they
need to register a different curler, start a separate registration.

## UX requirements

Keep screens short and clear.

Avoid presenting too many unrelated options on one screen.

Recommended screens:

1. Returning curler question
2. Login/profile selection if returning
3. Register self vs. someone else if new
4. Account/contact setup if new
5. Policy acceptance
6. Curler demographic information
7. Parent/guardian information if minor
8. Shell completion/continue screen

Every screen should make clear whether information is for:

- The person completing the registration
- The curler being registered
- The parent/guardian

## Routes/pages

Exact route names may follow existing app conventions.

Suggested conceptual routes:

- `/registration/start`
- `/registration/:registrationId/identity`
- `/registration/:registrationId/policies`
- `/registration/:registrationId/demographics`
- `/registration/:registrationId/guardian`
- `/registration/:registrationId/review-shell`

The final route may simply redirect to the next phase once Phase 5 exists.

## Backend/service responsibilities

The UI should not directly decide important identity or profile rules.

Create or use services for:

### Registration draft service

Responsibilities:

- Create draft registration
- Resume existing draft
- Update draft step completion
- Attach submitting user
- Attach curler user/profile
- Cancel draft

### Registration identity service

Responsibilities:

- Determine whether the curler is returning
- Resolve available profiles after login
- Attach selected returning curler profile
- Create new curler account/profile
- Create submitting user account/profile when needed
- Establish delegated access when needed

### Policy acceptance service

Responsibilities:

- Record policy acceptance
- Validate all required policies have been accepted
- Return current acceptance status for a registration

### Demographics service

Responsibilities:

- Validate required curler demographic fields
- Update curler profile fields
- Determine whether parent/guardian fields are required
- Validate parent/guardian fields

If similar services already exist, reuse them rather than creating duplicate
abstractions.

## Validation rules

Phase 4 validation should include:

- Returning curler cannot proceed without login.
- Returning curler must resolve to an existing curler profile.
- New curler must have required demographic fields.
- Email fields must be valid email addresses.
- Phone fields must be non-empty and follow existing app validation conventions.
- Date of birth must be a valid date and not in the future.
- Parent/guardian fields are required if curler is a minor.
- Policy acceptance is required before shell completion.
- A registration cannot be marked shell-complete without a curler and
  submitted-by user.

## Security and permissions

A user may view or edit a draft registration only if one of the following is
true:

- They are the submitting user.
- They are the curler.
- They have delegated access to the curler.
- They have staff/admin permission.

Do not expose another user's profile information during profile selection unless
the logged-in user is allowed to act for that profile.

## Data persistence expectations

At the end of Phase 4, the system should persist:

- Registration draft
- Registration status/step progress
- Submitted-by user
- Curler user/profile
- Returning/new curler answer
- Policy acceptances
- Curler demographic information
- Parent/guardian information, if applicable
- Delegated access relationship, if applicable

No invoice, payment, league selection, waitlist entry, or membership purchase
should be created in this phase.

## Tests

Add or update tests in `docs/registration/test-matrix.md` and in the automated
test suite.

Minimum automated tests are listed below.

### Draft creation and resume

- New user can start a draft registration.
- Logged-in user can resume an incomplete registration.
- Duplicate active drafts are not created for the same curler and registration
  period if an existing draft can be resumed.
- A cancelled draft is not resumed by default.

### Returning curler

- Returning curler who selects "yes" must log in.
- Returning curler can select their own profile.
- Returning curler can select a delegated profile.
- Returning curler cannot proceed if no eligible profile is available.
- Returning curler flow does not create a duplicate account.

### New curler registering themself

- New self-registering curler can create/login account.
- Submitted-by and curler are the same user/profile.
- Required demographic fields are enforced.

### New curler registered by someone else

- Submitting user account can be created/login can be completed.
- Curler account/profile can be created with same email as submitter.
- Curler account/profile can be created with different email from submitter.
- Explicit delegated access is created when emails differ.
- Submitted-by and curler are stored separately.

### Policies

- Registration cannot proceed without all three policies accepted.
- Policy acceptance records who accepted and for whom.
- Minor registration records policy acceptance by the registering user on behalf
  of the minor.

### Demographics

- New curler must provide required fields.
- Returning curler can confirm existing demographics.
- Returning curler can update demographics.
- Date of birth cannot be in the future.
- Minor status recalculates when date of birth changes.

### Parent/guardian

- Parent/guardian fields are required for minors.
- Parent/guardian fields are not required for adults.
- Copy email/phone from curler works if implemented.
- Registration cannot become shell-complete without guardian info for a minor.

### Authorization

- Submitted-by user can edit the draft.
- Curler can edit the draft.
- Delegated user can edit the draft.
- Unrelated user cannot view or edit the draft.
- Staff/admin can view or edit according to existing permissions.

## Acceptance criteria

Phase 4 is complete when:

1. A registration can be started for a returning curler.
2. Returning curlers are required to log in.
3. A logged-in user can choose from profiles they are allowed to register.
4. A new curler can register themself.
5. A user can register a new curler on behalf of someone else.
6. Delegated access is created when required.
7. A draft registration persists and can be resumed.
8. Required policy acceptance is recorded.
9. New curler demographic information can be collected.
10. Returning curler demographic information can be confirmed or updated.
11. Parent/guardian information is collected for minors.
12. The system can mark the registration shell as complete.
13. No membership, league, invoice, waitlist, or payment behavior is implemented
    in this phase.
14. Tests cover the flows listed in this document.

## Handoff to Phase 5

At the end of Phase 4, Phase 5 should be able to assume:

- A shell-complete registration exists.
- The registration has a submitted-by user.
- The registration has a curler user/profile.
- Policy acceptance is complete.
- Demographics are complete.
- Parent/guardian information is complete if needed.
- The registration can move into membership, discounts, experience, and basic
  payment selection.

Phase 5 should not need to re-solve identity, account creation, delegated
access, or demographic completeness except for validation.