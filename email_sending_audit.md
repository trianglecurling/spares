# Email sending audit

This document lists every code path that causes the app to **attempt** to send email. Delivery uses Azure Communication Services (when configured) or SMTP (when `config.smtp.host` is set), with console logging or silent skip when email is disabled, not configured, or send fails. See `backend/src/services/email.ts` (`sendEmail`).

**Global rules**

- `disable_email` in server config, test mode, missing provider config, `@example.com` addresses, and send failures are handled inside `sendEmail` (log instead of send, or no-op in some cases).
- `sendEmail` wraps HTML bodies in a simple email shell when email is disabled, not configured, or send fails.

---

## Authentication

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **POST `/auth/request-code`** (email contact) | The email address on file for the first matched member, only if that member is **email_subscribed** | Subject: `Your login code: {code}`. Body: one-time **login code** (10-minute expiry), “ignore if you didn’t request” (`sendAuthCodeEmail` → `auth.ts`). |

SMS is used for phone login; it is not email.

---

## Public contact form

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **POST `/public/contact/request`** | The **submitter’s** address they typed on the form | “Confirm your contact message” with a 30-minute link; summary of which club inbox category, subject, and body they chose (`contact.ts`). |
| **POST `/public/contact/confirm`** (after they click the link) | The **category inbox** (e.g. `info@`, `membership@`, … per `contactRecipients` in `contact.ts`) with **Reply-To** set to the submitter | Subject: `[Contact Form] {their subject}`. Body: new public contact submission with category, from, subject, message (`contact.ts`). |

---

## In-app feedback (members only)

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **POST `/feedback`** when the user is **logged in** | **Every server admin** (emails from `config.admins`, database config admin list, and members with `is_server_admin`) | Subject: `Feedback: {category} from {member name}`. Body: category, who submitted, member id, page path, body text, link to admin feedback (`feedback.ts`). |

Unauthenticated feedback is stored but does not email anyone.

---

## Server admin: config / smoke test

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **POST `/config/test-email`** (server admin) | The **current admin’s** email | Subject: `Test Email from Triangle Curling`. Body: test message; mentions Azure CS when working (`config.ts`). |

---

## Members (admin)

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **POST `/members/:id/send-welcome`** (admin) | That **member’s** email | Subject: `Welcome to Triangle Curling`. Body: welcome, what the account is for, **“Get started”** link with login/setup token (`sendWelcomeEmail` → `members.ts`). |
| **POST `/members/bulk-send-welcome`** (admin) | Each selected **member** that has an email | Same welcome template per member (`members.ts`). |

---

## Spare requests

All spare templates live in `backend/src/services/email.ts` and are invoked from `spares.ts`, except queue processing (below).

| Trigger (summary) | Recipient | What it says |
|-------------------|-----------|--------------|
| **New spare request** – confirmation to requester | Requester | `sendSpareRequestCreatedEmail`: “Spare request created” with who it’s for, date/time, league, optional message. |
| **CC on create** | Each **CC** member on the request | `sendSpareRequestCcCreatedEmail`: awareness copy that someone created a request and CC’d them. |
| **Notify spares** (public flow, re-issue, or private invites) | Each targeted **spare** (queue / invite list) | `sendSpareRequestEmail`: “New Spare Request”, who asked, for whom, position, date/time, league, message; **Accept** (and for private, **Decline**) links; plain link copy. |
| **Background notification queue** | Next eligible **member** in the staggered queue (if they have email) | Same as `sendSpareRequestEmail` (`notificationProcessor.ts` on an interval). |
| **Private invitee declined** | **Requester** | `sendPrivateInviteDeclinedEmail`: who declined, game details, their message, link to “My requests”. |
| **All private invitees declined** | **Requester** | `sendAllPrivateInvitesDeclinedEmail`: all declined; next steps to invite more or convert to public. |
| **Request filled** | **Requester** | `sendSpareResponseEmail`: which spare accepted, details, optional comment. |
| **Request filled (CC)** | **CC** members | `sendSpareRequestCcFilledEmail`: who accepted, for whom, requester name, details, comment. |
| **Spare signed up (responder copy)** | **Responding member** (offer confirmation) | `sendSpareOfferConfirmationEmail`: you’re signed up, requester, date/time, optional comment, cancel in app. |
| **Requester or admin canceled open request** | Notified **spares** who had been told about the request | `sendSpareRequestCancelledEmail`: who canceled, for whom, when. |
| **Requester cancel confirmation** | **Person who canceled** | `sendSpareRequestCancelConfirmationEmail`. |
| **Responder canceled their offer** | **Requester** | `sendSpareCancellationEmail`: who canceled, reason, re-issue from My requests. |
| **Responder cancel confirmation** | **Responder** | `sendSpareOfferCancellationConfirmationEmail`: confirms they withdrew, reason. |
| **CC: responder canceled** | **CC** | `sendSpareRequestCcCancellationEmail`: same cancellation context with reason. |

Exact API routes and branches are in `backend/src/routes/spares.ts` (including re-issue flows that call the same `sendSpareRequestEmail`).

---

## League scheduling: bye requests

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **Team bye priorities updated** (member on the team updates requests) | **Every roster member** on that team who has an email | `sendByeRequestsConfirmationEmail`: league name, team name, who updated, table of draw dates and bye priority numbers, note that lower numbers are higher preference (`scheduling.ts`). |

---

## Ice bookings

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **POST** create ice booking (member with email) | The **booking member** | `sendIceBookingConfirmationEmail`: when, sheet, purpose (practice / make-up / guests / other), optional notes and guest names; facility/safety copy (`iceBookings.ts`). |

---

## Events (registrations and owners)

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **Successful registration** when no hosted checkout is returned (e.g. free, waitlisted, or no payment required path) | **Contact email** on the registration | `sendEventRegistrationConfirmationEmail`: status line (confirmed vs waitlist vs pending payment), event title, when, group size, cancel on event page (`events.ts` public and authenticated register + admin create registration). **Note:** when the API returns a **checkout URL** for payment, this confirmation is **not** sent in that same response; `confirmRegistrationPayment` does not send an email. |
| **Registration canceled** (user or admin path that calls `sendEventRegistrationCancelledEmail`) | **Contact email** on the registration | `sendEventRegistrationCancelledEmail`: event title; if a refund record was created, says refund will process in a few business days. |
| **New registration** (same non-checkout path as confirmation above) | **Each event owner** (members listed as owners, per `notifyEventOwners` in `events.ts`) | `sendEventOwnerNewRegistrationEmail`: event title, registrant name and email, group size, status. **Not** sent when the API returns a hosted **checkout** for payment (early return). |

If an owner’s email is missing, behavior depends on `sendEmail` (likely failure path → log).

---

## Payments: donations

| Trigger | Recipient | What it says |
|--------|-----------|--------------|
| **Donation receipt** after a succeeded donation order (once, idempotent in metadata) | **Donor email** from order metadata | `sendDonationReceiptEmail`: thank you, **amount and date**, 501(c)(3) and EIN text, treasurer name/signature block (`paymentService.ts`). |

---

## Email helpers defined but not referenced elsewhere

These functions exist in `backend/src/services/email.ts` and are **not** imported by any other module in the repo (no current automated send path):

- `sendEventWaitlistPromotionEmail` – waitlist spot opened, payment vs auto-confirm.
- `sendEventCancelledEmail` – event canceled to registrants.
- `sendEventReminderEmail` – upcoming event reminder.

They are **candidates** for future jobs or routes; as of this audit, nothing calls them.

---

## File index (implementation)

| Area | Main files |
|------|------------|
| Core transport and templates | `backend/src/services/email.ts` |
| Auth | `backend/src/routes/auth.ts` |
| Contact / feedback / config / members / ice / scheduling / events / spares | `backend/src/routes/*.ts` as named above |
| Spare queue | `backend/src/services/notificationProcessor.ts` |
| Donation receipt | `backend/src/services/paymentService.ts` |
