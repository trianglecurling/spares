# Phase 2 handoff — Phase 1 data model lands

Phase 1 added storage for curling registration alongside existing app concepts. This note frames what landed, where it lives, what is deliberately deferred, and how Phase 2 should relate to **`registration_periods.current_state`** and scheduled timestamps.

## What was created or extended

### New hierarchy

- **`curling_seasons`**, **`curling_sessions`**
- **`leagues.session_id`** nullable FK onto sessions; existing leagues may remain unassigned until backfill.

### Registration core

- **`registration_periods`**: FK to season + session, **`current_state`** (`closed` | `priority` | `open`) plus milestone timestamps.
- **`curling_registrations`**: aggregates curler/submitter **`members`** FKs, status, membership option, discounts and assistance hints, Stripe/payment placeholders, timestamps.
- **`registration_policy_acceptances`**, **`registration_selections`** (selection types per phase‑1 enumerations).
- **`financial_assistance_requests`**: structured staff workflow alongside registration-level hints.

### Placement & membership

- **`league_roster`**: additions for source registration, **`placement_type`**, **`status`**, temporary sabbatical flag, **`related_sabbatical_id`**.
- **`season_memberships`** and **`curling_ice_privileges`**.
- Sabbatical **`curling_league_sabbaticals`** and usage **`curling_sabbatical_sessions`**.

### Waitlist (structures only — no automation)

- **`waitlist_entries`**, **`waitlist_offers`**, **`waitlist_audit_events`**, partial unique constraint for active member+league.
- Circular league chains, eligibility, and orchestration deferred to Phase 2+.

### Pricing & invoices

- **`registration_price_configs`**, **`registration_discount_configs`**.
- **`registration_invoices`**, **`registration_invoice_line_items`**.
- **`payment_orders.subject_type`** extended with **`curling_registration`**; intended **`subject_id`** mapping is to **`registration_invoices.id`**. Inverse **`registration_invoices.payment_order_id`** holds the order FK when wired.

### Type / API surfaces

- Backend **`PaymentSubjectType`**, `/payments` query schema, **`AdminPayments.tsx`** filters, regenerated **`openapi.json`** / **`frontend/src/api/generated/types.ts`**.

## Source of truth: `registration_periods.current_state` vs timestamps

Implementations should treat **`registration_periods.current_state`** as the authoritative flag for UX and permission gates. Scheduled columns (`priority_opens_at`, `open_registration_opens_at`, `registration_closes_at`, …) describe how staff configures transitions or how a Phase 2 job might advance **`current_state`**; they do not supersede **`current_state`** on their own this phase unless product later defines derived behavior.

## Explicitly deferred to application / Phase 2+

Cross-table pairing rules (e.g. BYOT vs waitlists), predecessor/successor graph validation beyond simple non-self FKs, protected-slot counts, full eligibility calculation, Stripe checkout orchestration beyond enum alignment, SQLite constraint evolution for **`payment_orders.subject_type`** on aged files, **`leagues`** without **`session_id`**, reconciliation of **`members`** legacy membership flags vs **`season_memberships`**.

## Operational risks / backfills

1. **`leagues.session_id` null** until staff or tooling bind leagues to **`curling_sessions`**.
2. **Postgres bootstrap repair** removes stub curling tables lacking **`season_id`** (see `postgresRepairRegistrationStubTablesSql`).
3. Existing **SQLite CHECK** constraints on **`payment_orders`** may need explicit migration paths for **`curling_registration`** on long-lived installs.
