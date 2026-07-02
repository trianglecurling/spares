# UX Constitution

This is the default product contract for new UI work in this app. Reuse existing patterns before inventing new ones.

## Terminology

- Prefer `Member` over `User` in product-facing UI.
- Use `spare request` consistently for sparing flows.
- Keep existing curling-domain terms stable. Do not rename league, sheet, draw, bonspiel, or event concepts casually.

## Copy and casing

- Default to sentence case for product-facing UI copy, including headings, button labels, tabs, field labels, and navigation labels.
- Preserve intentional casing for proper nouns, acronyms, and external product names.
- When editing mixed legacy copy, move the touched surface toward sentence case instead of introducing another variation.

## Authenticated page shell

- Pages rendered inside `Layout` should use `AppPage`.
- Pages should use `AppPageHeader` unless the screen is intentionally immersive or full-width.
- Use `frontend/src/components/AppPageControlsRow.tsx` for secondary controls below the page header.
- Use `app-card`, `app-section-title`, `app-label`, `app-input`, `app-table-*`, and `app-alert-*` before adding new one-off wrappers.

Exceptions:
- Full-width and editor-like screens may skip `AppPageHeader` when that produces a clearly better experience.
- Current known exceptions include `frontend/src/pages/Calendar.tsx`, `frontend/src/pages/CalendarEventFormPage.tsx`, and `frontend/src/pages/admin/AdminArticleEditor.tsx`.

## Public page shell

- Use `PublicLayout` for public-site pages by default.
- Use `frontend/src/components/PublicStateCard.tsx` for standard public-page loading, empty, and not-found/error states unless the page needs a richer purpose-built marketing treatment.
- If a page intentionally diverges, document the reason in the file or in the consistency docs before treating it as a new pattern.

## Forms

- Keep labels above inputs.
- **Associate every visible label with its control** using **`FormField`** (`label` + `htmlFor` + matching control `id`, prefer `useId()`), **`FormCheckbox`** for standalone checkbox rows, **`inputId`** on `ChoiceInput` and autocomplete children when wrapped by `FormField`, or **`role="group"`** / **`aria-labelledby`** / **`fieldset`–`legend`** only for composite regions. Details: `docs/accessibility-checklist.md` (Label–control association).
- **Focus styling** — Use `app-input` for default fields; `ChoiceInput` should match the same focus treatment. Legacy native `<select>` focus remains centralized in `frontend/src/index.css` while older screens are migrated. Do not add page-local select focus styles; extend `index.css` if tokens change. Details: `docs/accessibility-checklist.md` (Visible focus).
- Mark required fields with text, not color alone.
- Use `frontend/src/components/FormField.tsx`, `frontend/src/components/FormFieldMessage.tsx`, `frontend/src/components/FormSection.tsx`, and `frontend/src/components/FormCheckbox.tsx` as the default shared form shell for new or edited forms.
- Do not introduce a form library by default. Reach for the shared primitives first, and only revisit a library for unusually dynamic, nested, validation-heavy workflows.
- Reuse `app-label` and `app-input` for authenticated controls, and keep public forms on the same structural pattern even when they use a lighter visual skin.
- Use `disabled` only when a field is temporarily unavailable because of loading, permissions, unmet prerequisites, or a mutually exclusive state.
- Use `readOnly` when the value should stay visible and selectable but should not be edited directly.
- Hide fields only when they do not currently apply. Do not leave irrelevant fields visible and disabled when the better experience is to remove them until they matter.
- Disabled fields should use muted styling with no hover or focus affordance, and should explain why they are unavailable when the reason is not obvious.
- Readonly fields should keep the normal field shell so the value remains legible, but use a calmer non-editable treatment.
- Preserve entered values on validation or save failure.
- Prefer inline guidance and clear field labels over placeholder-only instructions.

## Choice inputs, autocomplete, and member selection

- Use `frontend/src/components/ChoiceInput.tsx` as the default shared selection primitive for select, dropdown, combobox, radiogroup, and checkboxgroup scenarios.
- Do not introduce new native `<select>` inputs for standard choice picking. If browser-native select behavior is truly required, document the exception before implementing it.
- Use `frontend/src/components/AutocompleteInput.tsx` only as the generic autocomplete wrapper built on top of `ChoiceInput` for suggestion-based text inputs.
- For member or user picking, prefer `frontend/src/components/MemberAutocomplete.tsx` for single-select and `frontend/src/components/MemberMultiSelect.tsx` for multi-select.
- Use `frontend/src/contexts/MemberOptionsContext.tsx` as the shared member source. Member pickers should read from the cached `useMemberOptions()` flow by default instead of fetching their own member lists in page components.
- `MemberAutocomplete` is the standard member-specific single-select wrapper built on top of the shared choice-input foundation.
- For non-member suggestion inputs such as article lookup or street/address lookup, use `AutocompleteInput` directly or through a thin domain wrapper.
- Treat the private spare request flow in `frontend/src/pages/RequestSpare.tsx` as the behavioral reference for member-picking UX.
- Show member name first and email as secondary context when available.
- Selected members in `MemberMultiSelect` should use the standard muted pill treatment.
- Do not introduce new hand-rolled member search dropdowns or checkbox-list invite pickers when the shared member picker components fit.

## Feedback

- Use `useAlert()` for routine success, warning, and error feedback.
- Do not introduce new `NotificationModal` usages.
- Use inline `app-alert-*` blocks when the message belongs to the page itself rather than a completed action.

## Confirmations

- Use `useConfirm()` for in-app confirmations.
- Do not use `window.confirm()` for normal navigation or destructive flows.
- Destructive actions must say what is being deleted, canceled, or converted.

## Loading, empty, and error states

- Render page-level loading and empty states inside the normal page shell.
- Use `frontend/src/components/AppStateCard.tsx` for standard authenticated loading and empty states unless the screen needs a richer purpose-built empty state.
- Use `frontend/src/components/PublicStateCard.tsx` for standard public-page loading, empty, and not-found/error states.
- Use `frontend/src/components/InlineStateMessage.tsx` for compact loading, empty, and explanatory states inside cards, modals, and subsection panels.
- Empty states should explain what is missing and, when useful, provide the next action.
- Prefer actionable error copy over generic failure copy.

## Tables and lists

- Prefer `app-table-shell`, `app-table`, `app-table-th`, and `app-table-td` for dense administrative data.
- Keep search, filters, and bulk actions near the table they affect.
- Use the shared table layer in `frontend/src/components/table/` for sortable, paginated, selectable admin tables instead of hand-rolling table mechanics per page.
- Keep table fetching page-owned. Shared table components should render rows, headers, selection, and pagination, while the page still owns API calls and filter definitions.
- For server-backed tables, keep page, sort, order, and filters in the URL through a shared query-state hook.
- Put filters on the left and primary create or bulk actions on the right of `frontend/src/components/AppPageControlsRow.tsx`.
- Reserve the last column for row actions at a stable width. Do not add or remove the actions column based on selection state.
- Put selected-row bulk actions in the controls row above the table rather than inside the table header to avoid layout shift.
- Do not add page-size selectors by default. Each table should use a single page size unless a clear exception is documented.
- Show `Showing x-y of n` below paginated tables by default.
- Prefer truncation and richer stacked cells over horizontal scrolling when possible.

## Drag and drop

- Use `@dnd-kit/core`, `@dnd-kit/sortable`, and the shared components under `frontend/src/components/dragDrop/` as the default drag-and-drop foundation.
- Do not introduce new native HTML5 drag-and-drop implementations for row reordering.
- Use a visible drag handle instead of making the whole row accidentally draggable by default.
- Reorder surfaces must support keyboard interaction, screen-reader announcements, and focus retention after drop.
- Use a real drag overlay and animated sibling displacement so the destination order is obvious.
- Respect reduced-motion preferences when configuring drag animations or drop effects.
- Keep item identity, move rules, and persistence page-owned even when the interaction layer is shared.
- For hierarchical editors, prefer the shared tree wrapper and encode explicit move constraints instead of hand-rolling tree drag logic in-page.

## Tabs and section navigation

- Use `frontend/src/components/PageTabs.tsx` for page-level tabs and section switching.
- The canonical visual treatment is the underline style used on the event-management page.
- Do not introduce new pill or button-style page tabs unless the variation is documented as an intentional exception.

## Back navigation

- For authenticated page-level back actions, prefer `frontend/src/components/BackButton.tsx`.
- Use a leading left-arrow icon plus the destination label, such as `Events`, `Leagues`, or `Server config`.
- Avoid mixing similar patterns like `Back to events`, raw arrow characters, and icon-plus-label buttons on equivalent screens.

## Page headers and secondary controls

- Keep `AppPageHeader` focused on page identity: title, optional description, and tight page-level actions.
- Put search inputs, filters, view controls, utility links, and dense action clusters in `frontend/src/components/AppPageControlsRow.tsx` below the header instead of inside `AppPageHeader.actions`.
- When a page has both a primary creation action and secondary utilities, keep the primary action in the header and move the rest into the controls row.

## Accessibility defaults

- Every control must have an accessible name.
- Navigation to another route or URL must use a real link: native `<a>` for normal URLs or React Router `Link`/`NavLink` for app routes. Do not use `<button>` plus programmatic navigation for content links, list item titles, table names, cards, menu items, or other interactions users expect to open in a new tab, copy as a link, or discover as link semantics.
- Reserve `<button>` for actions that change state on the current page, submit forms, open dialogs/menus, or trigger commands without changing location.
- Required state cannot rely on color alone.
- Destructive and confirmation dialogs must remain keyboard operable.
- Focus should land somewhere meaningful after dialogs open and close.

## DOM events and bubbling

- Prefer **`event.preventDefault()`** when canceling default browser behavior or marking an interaction as handled; rely on **`event.defaultPrevented`** in ancestor or delegated listeners instead of **`event.stopPropagation()`**.
- Container handlers for **`click`**, **`keydown`**, **`pointerdown`**, **`wheel`**, and similar bubbled events should **return early when `event.defaultPrevented`** so nested controls can opt out without cutting off the rest of the tree.
- **`stopPropagation()`** is reserved for narrow exceptions—typically third-party code that attaches native DOM listeners which ignore **`defaultPrevented`**. When it is truly necessary, document the reason inline at the callsite (see **`MarkdownDescriptionEditor`** managed-image **`dblclick`** on Toast UI’s editing surface).

## New pattern rule

- If an existing component or flow is close, use it.
- If you need a new interaction pattern, call it out explicitly in review and explain why the existing system was not sufficient.
