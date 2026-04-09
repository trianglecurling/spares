# Consistency Audit

This audit inventories the highest-signal UX and API inconsistencies already present in the repo and names the canonical pattern to use for new work.

## Frontend Shells

### Authenticated pages

Canonical candidate:
- Use `Layout` plus `AppPage` and `AppPageHeader`.
- Reuse the `app-*` classes in `frontend/src/index.css` for page spacing, cards, tables, labels, and alerts.

Legacy or mixed patterns:
- Hand-rolled inner page spacing and headings on a few full-width or older screens.
- Loading branches that bypass `AppPage` and render raw centered text.

Priority:
- Medium.
- Most authenticated pages already use the canonical shell, so this is mostly an adoption and exception-list problem rather than a redesign problem.

Notes:
- Full-width and immersive screens can remain exceptions when the experience clearly requires it.
- Current documented exceptions: `frontend/src/pages/Calendar.tsx`, `frontend/src/pages/CalendarEventFormPage.tsx`, and `frontend/src/pages/admin/AdminArticleEditor.tsx`.

### Public pages

Canonical candidate:
- Use `PublicLayout` for public-site pages and flows.

Legacy or mixed patterns:
- `HelpHeader` and custom wrappers are used on some public/help pages.
- Public pages can look coherent individually while still drifting into a second shell pattern.

Priority:
- Medium.
- This should be governed by documentation first; broad migration can happen gradually.

## Interaction Patterns

### Tabs and section navigation

Canonical candidate:
- Use the underline-style page tabs extracted into `frontend/src/components/PageTabs.tsx`.

Current pattern split:
- `frontend/src/components/LeagueTabs.tsx` previously used a pill/button treatment for league detail sections.
- Several pages had hand-rolled underline tabs that have now been consolidated onto `PageTabs`.

Priority:
- High.
- Tabs are a high-visibility navigation primitive, and inconsistent styling makes equivalent page structures feel unrelated.

Decision:
- The event-management underline style is the canonical default for page-level tabs.
- Reuse `PageTabs` directly instead of hand-rolling underline tabs so behavior and styling stay aligned.

### Back navigation and copy casing

Canonical candidate:
- Use sentence case for product-facing UI copy.
- Use `frontend/src/components/BackButton.tsx` for authenticated page-level back actions.

Legacy or mixed patterns:
- Similar pages mix icon-plus-label buttons, `Back to ...` phrasing, and raw arrow characters.
- Headings, buttons, and navigation labels still drift between title case and sentence case.

Priority:
- Medium.
- This is a smaller surface than tabs or async states, but inconsistent casing makes adjacent screens feel like different systems.

### Page headers and secondary controls

Canonical candidate:
- Use `frontend/src/components/AppPage.tsx` plus `AppPageHeader` for page identity.
- Use `frontend/src/components/AppPageControlsRow.tsx` below the header for filters, search, utility links, view controls, and dense secondary action clusters.

Legacy or mixed patterns:
- Some pages put search and filter controls directly inside `AppPageHeader.actions`.
- Some pages overload the header action row with too many utility or bulk-action buttons.
- Some pages still hand-roll title and subtitle rows instead of using `AppPageHeader`.

Priority:
- Medium.
- Header layout drift is highly visible and tends to spread because new pages copy nearby examples.

### Autocomplete and member picking

Canonical candidate:
- Use `frontend/src/components/AutocompleteInput.tsx` as the shared autocomplete/listbox primitive.
- Use `frontend/src/contexts/MemberOptionsContext.tsx` and `useMemberOptions()` as the shared cached member source.
- Use `frontend/src/components/MemberAutocomplete.tsx` for single member selection as a thin member-specific wrapper over the generic autocomplete primitive.
- Use `frontend/src/components/MemberMultiSelect.tsx` for inviting or selecting multiple members.
- Follow the private-request member selection flow in `frontend/src/pages/RequestSpare.tsx` as the UX reference.

Legacy or mixed patterns:
- Some invite flows use searchable checkbox lists instead of the shared member multi-select interaction.
- Autocomplete-style suggestion inputs should route through `AutocompleteInput` or a thin wrapper rather than bespoke inline combobox/listbox implementations.

Priority:
- Medium.
- Member picking appears in several critical workflows, and duplicated implementations are already drifting in both behavior and accessibility.

### Form structure and field states

Canonical candidate:
- Use `frontend/src/components/FormField.tsx`, `frontend/src/components/FormFieldMessage.tsx`, and `frontend/src/components/FormSection.tsx` as the shared form shell.
- Keep labels above controls, required markers in text, helper and error copy below the field, and save feedback visible on failure.
- Treat `disabled`, `readOnly`, and hidden states as distinct product decisions instead of styling variants.

Legacy or mixed patterns:
- Required fields often rely on red asterisks alone.
- Helper text, error copy, and section spacing drift between admin and public forms.
- Some save flows still rely on silent failures or inconsistent busy wording.
- Disabled and readonly inputs are not consistently styled or explained.

Priority:
- High.
- Forms appear across every major workflow, and small inconsistencies compound quickly when new pages copy nearby examples.

### Confirmations

Canonical candidate:
- Use `useConfirm()` backed by `ConfirmDialog`.

Legacy or mixed patterns:
- Native `window.confirm()` still appears in admin flows and unsaved-change handling.

Priority:
- High.
- Native confirms are visually inconsistent, harder to control, and bypass the app's accessibility and theming work.

### Success and error feedback

Canonical candidate:
- Use `useAlert()` for routine success, warning, and error feedback.

Legacy or mixed patterns:
- `NotificationModal` is still used on `frontend/src/pages/Dashboard.tsx` and `frontend/src/pages/MyRequests.tsx`.
- Some pages use ad hoc inline success or error messaging.

Priority:
- High.
- This is one of the most visible forms of UX drift and is easy for future AI edits to copy.

Decision:
- Treat `NotificationModal` as legacy. Keep the component for backward compatibility if needed, but do not use it for new work.

## Loading, Empty, and Error States

Canonical candidate:
- For page-level loading or empty states inside authenticated screens, render them within `AppPage` and prefer `frontend/src/components/AppStateCard.tsx` or `app-alert-*` styling.
- For page-level loading, empty, and not-found/error states on public screens, prefer `frontend/src/components/PublicStateCard.tsx`.
- For compact states inside cards, modals, and subsection panels, prefer `frontend/src/components/InlineStateMessage.tsx`.

Legacy or mixed patterns:
- Some screens render plain text loading states without page chrome.
- Empty-state copy varies heavily by page and often lacks a next action.
- Public pages and inline panels frequently hand-roll centered gray text or one-off bordered boxes for equivalent states.

Priority:
- Medium.
- Fix the most visited screens by touchpoint, then apply rules in docs and review.

## Frontend Data Access

Canonical candidate:
- Keep `frontend/src/utils/api.ts` as the shared axios transport and interceptor layer.
- Prefer `frontend/src/api/client.ts` for typed request helpers wherever OpenAPI coverage exists.

Legacy or mixed patterns:
- Mixed usage of the typed client and raw `api.get/post/patch/delete`.
- This creates inconsistent error handling and makes generated types less effective.

Priority:
- Medium.
- Migration should follow OpenAPI coverage so the typed client becomes the default paved road.

## Backend API Contracts

### Error envelope

Canonical candidate:
- Standardize on `ApiErrorResponse` from `backend/src/api/types.ts`.
- Use one helper for common error replies so new routes stop hand-rolling slightly different envelopes.

Legacy or mixed patterns:
- Similar statuses return mixed strings such as `Forbidden`, `Insufficient permissions`, `Unauthorized`, and route-specific variants.
- Validation failures commonly include `details`, but the pattern is repeated manually.

Priority:
- High.
- Client-side UX consistency depends heavily on backend contract consistency.

### Route registration and OpenAPI

Canonical candidate:
- Register public and protected routes from one shared module so the live app and OpenAPI generation use the same route list.

Legacy or mixed patterns:
- `backend/src/index.ts` and `backend/src/openapi.ts` currently register different route sets.

Priority:
- Highest.
- This is the core source of drift for generated frontend types and API discoverability.

## Recommended Migration Order

1. Unify route registration so OpenAPI and the server cannot drift.
2. Replace remaining `window.confirm()` usage with `useConfirm()`.
3. Move `NotificationModal` usage onto `useAlert()`.
4. Introduce a shared backend API error helper and use it first in `backend/src/routes/events.ts`.
5. Keep documenting shell rules and exception lists so future page work does not invent a third pattern.
