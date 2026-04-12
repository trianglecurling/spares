# Accessibility Checklist

Use this checklist for new pages and for reviewing AI-generated changes.

## Labels and names

- Every interactive control has an accessible name.
- Inputs are associated with visible labels.
- Icon-only buttons have accessible text.

### Label–control association

Use **`FormField`** (`frontend/src/components/FormField.tsx`) for every labeled field: pass **`label`**, **`htmlFor`**, and the same **`id`** on the focusable control (`<input>`, `<select>`, `<textarea>`, etc.). Use **`useId()`** from React when you need a stable id (especially in modals and lists).

- **`FormCheckbox`** — Use for standalone checkbox rows (same form-shell family); it wraps the control and label correctly.
- **Choice inputs / autocomplete / combobox** — Wrap with **`FormField`** and pass **`inputId`** (same value as **`htmlFor`**) into `ChoiceInput` or wrappers such as `ArticleAutocomplete` / `AutocompleteInput` so the label targets the real textbox.
- **Composite regions** (no single native control: rich text, split controls) — Use **`role="group"`** with **`aria-labelledby`** pointing at a visible label’s **`id`**, or **`fieldset` / `legend`** when the spec allows (legend must be a direct child of `fieldset`).

Do **not** leave a visible `app-label` (or plain text) that only *looks* like a label without **`FormField`** (or **`FormCheckbox`** / composite association above).

## Visible focus

- Default text-like controls use **`app-input`** from `frontend/src/index.css` so focus matches the rest of the app (`focus:border-primary-teal` + ring).
- **`ChoiceInput`** and autocomplete wrappers should use the same visible focus treatment as other `app-input` controls.
- Legacy native **`<select class="app-input">`** — Browsers often skip painting Tailwind’s ring; the app relies on **shared rules in `index.css`** (`select.app-input:focus`, etc.) that replicate the same ring with `box-shadow`. **Do not invent separate select focus styles in page CSS**; extend `index.css` if the token or pattern changes.
- **Public / one-off form strings** — If you cannot use `app-input`, match the same ring treatment (see `PublicEventRegisterPage` `publicSelect`, `PublicContactPage` `public-contact-select`, and comments in `index.css`).
- Prefer **`:focus-visible`**-friendly behavior already baked into utilities; avoid removing focus outlines without a replacement that meets WCAG contrast.

## Required fields and validation

- Required fields are marked with text, not color alone.
- Validation messages explain what needs to change.
- Validation state is preserved when submission fails.

## Keyboard support

- Focusable controls show a **visible focus** indicator consistent with `app-input` / `index.css` (see **Visible focus** above).
- Primary actions are reachable and usable with the keyboard.
- Dialogs and overlays can be dismissed and navigated without a mouse.
- Focus does not disappear when a modal opens or closes.
- New choice-picking fields should use the shared `ChoiceInput` foundation instead of introducing fresh native `<select>` or ad hoc dropdown implementations.

## Dialogs and confirmations

- Use the shared confirm and alert patterns instead of ad hoc overlays.
- Destructive actions explain what will happen before confirmation.
- Focus returns somewhere sensible after dismissal.

## Status and feedback

- Do not rely only on color to communicate success, warning, or error state.
- Empty and error states include readable copy, not just icons.
- Loading states should not trap users without context.

## Content and structure

- Page headings should make sense in outline order.
- Tables should only be used for tabular data.
- Links and buttons should match their behavior.

## Review question

- If a keyboard-only user or screen-reader user tried the main flow, is there an obvious blocker?
