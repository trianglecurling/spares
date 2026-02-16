# Component Priority: Member Management vs. Event Management

## Executive Summary

**Recommendation: Start with Member Management.**

Member management is the foundation that both systems depend on. Building it first will unblock league roster automation, establish your payment integration pattern, and create the member database that event registration will eventually leverage. Event management can follow once members and payments are in place.

---

## Current State (What You Have)

### Members
- Basic member records: name, email, phone, `validThrough`, `spareOnly`, admin flags
- Manual creation by admins; bulk create; directory with search/filter
- Member profile with sparing and league participation views
- **Missing**: Annual registration flow, league preference selection, powerful querying, automated roster building

### Leagues
- Leagues, divisions, teams, rosters, games, scheduling, results, standings
- League managers manually add teams and assign members to rosters
- **Missing**: Automatic roster building from member preferences; the "complicated rules" engine

### Calendar
- Lightweight "direct" events: title, type, start/end, recurrence, locations
- Admin-created only; no registration, capacity, or custom fields
- **Missing**: The full event system you described (registration, capacity, waitlists, etc.)

---

## Why Member Management First

### 1. Foundation for Everything Else

Members are the core entity. Both leagues and events depend on them:

- **Leagues**: Rosters are built from members. League preferences, returning-member logic, and roster rules all require a robust member database.
- **Events**: Registration often distinguishes members vs. non-members (pricing, visibility). Member lookup, autocomplete, and contact info reuse all assume a solid member system.

You cannot automate roster building without first having a member system that supports registration and preferences.

### 2. League Roster Building Depends on It

The "complicated rules" for roster building require:

- Who is registered for the season
- League preferences (which leagues, divisions, draw times)
- Returning vs. new members
- Team formation constraints (skip/vice, doubles pairs, etc.)
- Possibly: past teams, skill level, availability

All of this is member data. The roster builder consumes member registration output. Build the member/registration side first, then the roster engine.

### 3. Annual Registration Is the Big Operational Win

For a curling club, annual registration is likely the largest manual burden:

- Happens once per season (or a few waves)
- High volume (many members at once)
- Complex (league selection, preferences, payments)
- Errors here affect the whole season

Getting this right first reduces work for the entire year. Event registration is more distributed and often smaller in scope per occurrence.

### 4. Payment Integration: Do It Once, Reuse

Both components need payments. Integrating a vendor (Stripe, etc.) is non-trivial. Doing it first for member registration:

- Establishes the pattern (checkout flow, webhooks, receipts)
- Handles the highest-value use case (dues)
- Event registration can reuse the same integration

Member registration is typically the bigger revenue event for a club, so it justifies the integration effort first.

### 5. Querying and Data Quality

"Powerful querying" and "vastly expanded database" matter more for members than for events:

- Members are long-lived; you query them constantly (directory, rosters, sparing, events)
- Events are more self-contained; queries are usually "events in date range" or "registrations for event X"

Investing in member querying and data model pays off across the whole app.

### 6. Dependency Direction

```
Members ──► Leagues (rosters, preferences)
    │
    └──► Events (registration, member vs. non-member)
```

Events can be built to work with a minimal member model, but leagues cannot. The league roster automation is blocked until member registration and preferences exist.

---

## When Event Management Might Come First

Consider events first only if:

- **Bonspiels and learn-to-curl are your top pain point** and league roster building is still manageable manually
- **Revenue from events exceeds dues** and you need event registration + payments urgently
- **You want a smaller, self-contained project** to validate payment integration before tackling member registration

Even then, you will eventually need member management for leagues. The question is whether events provide enough value to justify building them in isolation first.

---

## Suggested Phasing

### Phase A: Member Management Foundation
1. Expand member schema (registration status, season, preferences metadata)
2. Powerful querying (filters, search, exports)
3. Annual registration flow (returning members: re-register + league preferences)
4. New member registration flow
5. Payment integration (dues)

### Phase B: League Roster Automation
1. Define roster rules (format, constraints, preferences)
2. Roster builder engine (consumes registration + preferences)
3. Preview/approve flow for league managers
4. Integration with existing league/team/roster UI

### Phase C: Event Management
1. Event model (dates, registration window, capacity, visibility)
2. Registration fields (configurable per event)
3. Registration flow (member/non-member, waitlist)
4. Reuse payment integration for event fees
5. Email confirmations, reminders

### Phase D: Polish
- Notification preferences (already in leagues-dd.md)
- Analytics/reporting
- Kiosk and other integrations

---

## Payment Vendor Considerations

When you add payments, consider:

- **Stripe**: Widely used, good docs, supports subscriptions (for dues) and one-time payments (events). Webhooks for async processing.
- **Square**: Simpler for small orgs; good if you also have in-person sales.
- **PayPal**: Familiar to users; sometimes higher fees.

For a curling club with annual dues + event fees, Stripe is a strong default: flexible, well-documented, and scales as you add features.

---

## Summary

| Factor | Member Management First | Event Management First |
|--------|--------------------------|-------------------------|
| Unblocks league roster automation | ✅ Yes | ❌ No |
| Foundation for events | ✅ Yes | N/A |
| Bigger operational impact (annual cycle) | ✅ Yes | Depends on club |
| Payment integration | ✅ Establishes pattern | Could validate first |
| Complexity | High (registration + roster rules) | Medium (self-contained) |
| Dependency on existing work | Builds on leagues | More independent |

**Bottom line**: Start with member management. It is the prerequisite for league roster automation, establishes your payment and data patterns, and creates the member base that events will use. Event management can follow as a more self-contained phase once members and payments are in place.
