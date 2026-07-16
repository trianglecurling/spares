# AGENTS.md

This repo has explicit consistency rules. Follow existing product patterns before introducing new ones.

## Primary References

- `docs/ux-constitution.md`
- `docs/api-conventions.md`
- `docs/accessibility-checklist.md`
- `docs/golden-examples.md`
- `docs/consistency-review-checklist.md`
- `docs/ai-feature-prompt-template.md`

## Core Expectations

- Consistency is more important than novelty.
- Reuse existing components, layouts, and interaction patterns before creating a new one.
- If nearby examples conflict, prefer the documented canon in the docs above.
- Call out any intentional deviation from existing UX, API, accessibility, or terminology patterns before implementing it.
- After schema-affecting changes, run `bun run db:migrate:preview` only. Do not run `bun run db:migrate` from agent workflows (see `backend/MIGRATIONS.md` and `.cursor/rules/database-migration-workflow.mdc`).

## Frontend Defaults

- Prefer **`preventDefault()`** and **`defaultPrevented`** checks over **`stopPropagation()`** for nested interactions; reserve **`stopPropagation()`** for documented third-party DOM integration exceptions per **`docs/ux-constitution.md`** (DOM events and bubbling).
- Default to sentence case for product-facing UI copy unless a proper noun, acronym, or external label requires different casing.
- For authenticated pages, prefer `Layout` + `AppPage` + `AppPageHeader`.
- Use `frontend/src/components/AppPageControlsRow.tsx` for search, filters, utility links, and dense secondary action clusters below the header.
- Reuse `app-card`, `app-section-title`, `app-label`, `app-input`, `app-table-*`, and `app-alert-*`.
- Use `frontend/src/components/ChoiceInput.tsx` as the default shared selection primitive for select, dropdown, combobox, radiogroup, and checkboxgroup scenarios.
- Use `frontend/src/components/AutocompleteInput.tsx` only as a thin wrapper over `ChoiceInput` for suggestion-based text-entry flows that already fit its API.
- Use `frontend/src/components/MemberAutocomplete.tsx` and `frontend/src/components/MemberMultiSelect.tsx` for member/user picking instead of hand-rolled search dropdowns.
- Use `frontend/src/contexts/MemberOptionsContext.tsx` and `useMemberOptions()` as the default cached member source instead of fetching member lists separately in page components.
- Use `frontend/src/components/FormField.tsx`, `frontend/src/components/FormFieldMessage.tsx`, `frontend/src/components/FormSection.tsx`, and `frontend/src/components/FormCheckbox.tsx` as the default shared form shell for new or edited forms.
- Do not introduce a form library by default. Reuse the shared form primitives first, and only revisit a library for unusually dynamic, nested, validation-heavy forms.
- Use the shared table layer in `frontend/src/components/table/` for sortable, paginated, selectable admin tables.
- Keep server-backed table state such as page, sort, order, and filters in the URL through the shared query-state hook.
- Put table filters on the left and primary or bulk actions on the right of `frontend/src/components/AppPageControlsRow.tsx`.
- Keep the row-actions column stable and move selected-row bulk actions above the table to avoid layout shift.
- Do not add page-size selectors by default for admin tables.
- Use `@dnd-kit/core`, `@dnd-kit/sortable`, and the shared components in `frontend/src/components/dragDrop/` for row-based drag and drop.
- Do not introduce new native HTML5 drag-and-drop reorder implementations for lists or tree editors.
- Drag-and-drop surfaces should use visible handles, keyboard-accessible reordering, drag overlays, and reduced-motion-safe animation defaults.
- Use `frontend/src/components/PageTabs.tsx` for page-level tabs and section navigation.
- Use `frontend/src/components/BackButton.tsx` for authenticated page-level back actions.
- Use `frontend/src/components/AppStateCard.tsx` for standard authenticated loading and empty states unless a richer custom empty state is clearly warranted.
- Use `frontend/src/components/InlineStateMessage.tsx` for compact loading, empty, and explanatory states inside cards, modals, and subsection panels.
- Use `PublicLayout` for public pages unless the route is a documented exception.
- Use `frontend/src/components/PublicStateCard.tsx` for standard public-page loading, empty, and not-found/error states unless a richer custom public treatment is clearly warranted.
- Use `useAlert()` for routine success, warning, and error feedback.
- Use `useConfirm()` for confirmations. Do not use `window.confirm()`.
- Do not introduce new `NotificationModal` usages.
- Keep labels above inputs, mark required fields with text, and preserve entered values on validation failure.
- Do not introduce new native `<select>` inputs for standard product choice picking; prefer `ChoiceInput` with the appropriate layout and behavior.
- Use `disabled` only for temporarily unavailable fields, `readOnly` for visible immutable values, and hide fields only when they do not apply.
- Disabled controls should look muted and non-interactive, and should explain why they are unavailable when the reason is not obvious.
- Render loading, empty, and error states inside the normal page shell.
- Every control needs an accessible name.

### Labels and focus (canonical)

- **Labels** — Use **`FormField`** with `htmlFor` and a matching control **`id`** (prefer **`useId()`**). Use **`FormCheckbox`** for standalone checkbox rows. For composite editors use **`role="group"`** + **`aria-labelledby`** or valid **`fieldset`/`legend`**. For **`ChoiceInput`** and wrappers such as **`AutocompleteInput`**, pass **`inputId`** matching `htmlFor` when the text input is the labeled control. Details: `docs/accessibility-checklist.md` (Label–control association).
- **Focus** — Use **`app-input`** for standard fields. `ChoiceInput` should inherit the same focus treatment as other inputs. Legacy native `<select>` focus remains centralized in **`frontend/src/index.css`** while older screens are migrated. Public forms that cannot use `app-input` must match the same ring treatment (see `PublicEventRegisterPage`, `PublicContactPage`, `index.css`).

## Backend Defaults

- Keep live API registration and OpenAPI generation aligned through `backend/src/registerRoutes.ts`.
- Use `ApiErrorResponse` from `backend/src/api/types.ts` as the standard error envelope.
- Prefer shared helpers in `backend/src/api/errors.ts` for common API errors.
- For Drizzle writes to Postgres `timestamp` columns, pass a `Date` (`new Date()`) or `sql\`CURRENT_TIMESTAMP\`` — never `new Date().toISOString()` (that 500s on Pg; SQLite text columns can hide the bug locally). See `docs/api-conventions.md` (Timestamps and dates).
- Use consistent status semantics:
  - `400` validation or malformed input
  - `401` authentication failure
  - `403` permission failure
  - `404` missing or hidden resource
  - `409` conflict
  - `500` or `503` server failure
- Prefer `frontend/src/api/client.ts` when an endpoint is covered by generated OpenAPI types.

## Planning Workflow

For nontrivial work, before coding:

1. Identify the existing files, components, and patterns to reuse.
2. Summarize loading, empty, error, success, and permission-denied states.
3. Note accessibility requirements.
4. Note API contracts involved.
5. Call out deviations from existing patterns.

## Golden Examples

- Authenticated shell: `frontend/src/components/AppPage.tsx`, `frontend/src/components/AppPageControlsRow.tsx`, `frontend/src/components/BackButton.tsx`, `frontend/src/components/AppStateCard.tsx`, `frontend/src/components/InlineStateMessage.tsx`, `frontend/src/index.css` (includes `app-input` and legacy native `<select>` focus parity)
- Choice and autocomplete inputs: `frontend/src/components/ChoiceInput.tsx`, `frontend/src/components/ChoiceInput.stories.tsx`, `frontend/src/components/AutocompleteInput.tsx`, `frontend/src/contexts/MemberOptionsContext.tsx`, `frontend/src/components/MemberAutocomplete.tsx`, `frontend/src/components/MemberMultiSelect.tsx`, `frontend/src/pages/RequestSpare.tsx`, `frontend/src/pages/PublicEventRegisterPage.tsx`
- Form system: `frontend/src/components/FormField.tsx`, `frontend/src/components/FormFieldMessage.tsx`, `frontend/src/components/FormSection.tsx`, `frontend/src/components/FormCheckbox.tsx`, `frontend/src/pages/RequestSpare.tsx`, `frontend/src/components/CalendarEventForm.tsx`, `frontend/src/pages/PublicEventRegisterPage.tsx`, `frontend/src/pages/admin/AdminEventEditor.tsx`, `frontend/src/pages/admin/AdminArticleEditor.tsx`, `frontend/src/pages/admin/AdminContent.tsx` (label + `app-input` patterns)
- Drag and drop: `frontend/src/components/dragDrop/SortableList.tsx`, `frontend/src/components/dragDrop/SortableTree.tsx`, `frontend/src/components/dragDrop/SortableRow.tsx`, `frontend/src/components/dragDrop/DragHandle.tsx`, `frontend/src/pages/admin/AdminEventEditor.tsx`, `frontend/src/pages/admin/AdminSponsorship.tsx`, `frontend/src/pages/admin/AdminContent.tsx`
- Table system: `frontend/src/components/table/DataTable.tsx`, `frontend/src/components/table/DataTableHeaderCell.tsx`, `frontend/src/components/table/DataTablePagination.tsx`, `frontend/src/components/table/DataTableSelectionCell.tsx`, `frontend/src/hooks/useTableQueryState.ts`, `frontend/src/pages/admin/AdminContent.tsx`
- Admin list and management flows: `frontend/src/pages/admin/AdminMembers.tsx`, `frontend/src/pages/admin/AdminEvents.tsx`
- Complex admin editor flow: `frontend/src/pages/admin/AdminEventEditor.tsx`
- Public shell: `frontend/src/components/PublicLayout.tsx`, `frontend/src/components/PublicStateCard.tsx`
- Backend contract and registration: `backend/src/api/types.ts`, `backend/src/registerRoutes.ts`

## Known Layout Exceptions

- `frontend/src/pages/Calendar.tsx`
- `frontend/src/pages/CalendarEventFormPage.tsx`
- `frontend/src/pages/admin/AdminArticleEditor.tsx`
