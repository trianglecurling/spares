# Accessibility Checklist

Use this checklist for new pages and for reviewing AI-generated changes.

## Labels and names

- Every interactive control has an accessible name.
- Inputs are associated with visible labels.
- Icon-only buttons have accessible text.

## Required fields and validation

- Required fields are marked with text, not color alone.
- Validation messages explain what needs to change.
- Validation state is preserved when submission fails.

## Keyboard support

- Primary actions are reachable and usable with the keyboard.
- Dialogs and overlays can be dismissed and navigated without a mouse.
- Focus does not disappear when a modal opens or closes.

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
