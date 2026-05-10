# Registration User Flow

This document describes the user-facing registration flow.

It is intentionally written from a workflow perspective rather than a database
or implementation perspective.

## Guiding principles

The registration flow should be:

- Clear
- Step-by-step
- Easy to resume
- Explicit about who is being registered
- Explicit about whether information is for the curler, parent/guardian, or
  person completing the form
- Conservative about confirming commitments
- Careful not to collect payment until the registration is ready for payment

Avoid showing too many unrelated options on one screen.

## One curler per registration

Each registration is for exactly one curler.

A parent registering multiple children completes one registration per child.

A person registering themself and a spouse completes two registrations.

## Phase 4 flow: registration shell

Phase 4 covers the beginning of registration through demographic completion.

### Step 1: Start registration

Ask:

> Is the curler a returning member?

Choices:

- Yes
- No

Use "curler" because the person filling out the form may be registering someone
else.

### Step 2A: Returning curler login

If the curler is returning:

1. Require login using the existing email-based login system.
2. After login, show the profiles the logged-in user is allowed to register.
3. Ask:

> Who are you registering?

Available profiles may include:

- The logged-in user's own profile
- Profiles associated with the same email
- Profiles available through delegated access

If the intended curler is not listed, the user should log in with the correct
email or contact staff.

Do not create a new account for a returning curler.

### Step 2B: New curler path

If the curler is new, ask:

> Who are you registering?

Choices:

- Myself
- Someone else

#### New curler registering themself

If registering themself:

1. Create or log into the user's account using the email-based login flow.
2. Treat the logged-in user as both the submitter and the curler.
3. Continue to policy acceptance.

#### New curler registered by someone else

If registering someone else:

1. Create or log into the submitting user's account.
2. Ask whether the curler should use:
   - The same email as the submitting user
   - A different email
3. Create the curler account/profile.
4. Grant delegated access from the curler to the submitting user when required.
5. Continue to policy acceptance.

### Step 3: Policy acceptance

The registrant must agree to:

1. Code of Conduct
2. Minor Athlete Abuse Prevention Policy
3. Privacy Policy

The registrant agrees on behalf of the curler.

All three policies are required before continuing.

### Step 4A: Demographics for new curlers

Collect the curler's:

- First name
- Last name
- Date of birth
- Email address
- Phone number
- Mailing address
- Emergency contact name
- Emergency contact phone number

The screen should clearly say:

> Enter information for the person being registered.

### Step 4B: Demographics for returning curlers

Show the curler's existing information and ask:

> Is this information still current?

Choices:

- Yes, this is current
- No, I need to update it

If the information is not current, allow editing before continuing.

### Step 5: Parent/guardian information

If the curler is under 18, collect parent/guardian:

- First name
- Last name
- Email address
- Phone number

Allow the user to copy the curler's email or phone number if appropriate.

Parent/guardian information is required for minors.

### Step 6: Shell completion

Once identity, policy acceptance, demographics, and guardian information are
complete, the registration shell is complete.

Later phases continue from this point into:

- Membership selection
- Discounts
- Curling experience
- Ice privileges
- League selection
- Review
- Payment or deferred payment

## Resume behavior

If a user leaves registration partway through, they should be able to resume the
draft.

When resuming, the app should return them to the first incomplete step.

If a user has a completed shell but has not completed later registration steps,
later phases should resume from the next incomplete registration step.

## Language conventions

Use clear labels:

- "Person completing this registration"
- "Curler"
- "Parent/guardian"
- "Emergency contact"

Avoid ambiguous labels like "your information" unless the user is definitely
registering themself.

## Phase 4 completion requirements

A registration shell is complete when:

- The submitting user is known.
- The curler is known.
- Required policies are accepted.
- Required curler demographics are complete.
- Parent/guardian information is complete if the curler is a minor.