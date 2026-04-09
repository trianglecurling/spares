# Golden Examples

Use these files as the first place to look when implementing related work.

## Authenticated page shell

- `frontend/src/components/AppPage.tsx`
- `frontend/src/components/AppPageControlsRow.tsx`
- `frontend/src/components/BackButton.tsx`
- `frontend/src/components/AppStateCard.tsx`
- `frontend/src/components/InlineStateMessage.tsx`
- `frontend/src/index.css`
- `frontend/src/components/PageTabs.tsx`

Why:
- These files define the default spacing, headings, secondary control rows, sentence-case back actions, standard page-level and inline states, tables, and page-level tabs used across the authenticated app.

## Admin list and management flow

- `frontend/src/pages/admin/AdminMembers.tsx`
- `frontend/src/pages/admin/AdminEvents.tsx`

Why:
- These are strong examples of list-heavy admin pages that use the established shell and interaction patterns.

## Complex admin editor flow

- `frontend/src/pages/admin/AdminEventEditor.tsx`

Why:
- This page is the primary golden example for a reasonably complex authenticated form. It demonstrates the shared form shell, section structure, helper text, required text treatment, custom field editing, confirmations, alerts, and multiple async states in one place.

## Drag and drop

- `frontend/src/components/dragDrop/SortableList.tsx`
- `frontend/src/components/dragDrop/SortableTree.tsx`
- `frontend/src/components/dragDrop/SortableRow.tsx`
- `frontend/src/components/dragDrop/DragHandle.tsx`
- `frontend/src/pages/admin/AdminEventEditor.tsx`
- `frontend/src/pages/admin/AdminSponsorship.tsx`
- `frontend/src/pages/admin/AdminContent.tsx`

Why:
- These files define the shared drag-and-drop foundation for flat lists and hierarchical editors, including handle treatment, drag overlays, keyboard reordering, screen-reader announcements, and reduced-motion-aware behavior.

## Form system

- `frontend/src/components/FormField.tsx`
- `frontend/src/components/FormFieldMessage.tsx`
- `frontend/src/components/FormSection.tsx`
- `frontend/src/components/FormCheckbox.tsx`
- `frontend/src/pages/RequestSpare.tsx`
- `frontend/src/components/CalendarEventForm.tsx`
- `frontend/src/pages/PublicEventRegisterPage.tsx`
- `frontend/src/pages/admin/AdminEventEditor.tsx`

Why:
- These files define the canonical field shell, helper and error messaging, section layout, required text treatment, disabled and readonly behavior, and representative authenticated and public form usage. Start with `frontend/src/pages/admin/AdminEventEditor.tsx` when you need a complex form reference.

## Member picking and autocomplete

- `frontend/src/components/AutocompleteInput.tsx`
- `frontend/src/contexts/MemberOptionsContext.tsx`
- `frontend/src/components/MemberAutocomplete.tsx`
- `frontend/src/components/MemberMultiSelect.tsx`
- `frontend/src/components/ArticleAutocomplete.tsx`
- `frontend/src/pages/RequestSpare.tsx`
- `frontend/src/pages/leagues/LeagueDetail.tsx`
- `frontend/src/pages/PublicEventRegisterPage.tsx`

Why:
- These files define the canonical generic autocomplete primitive, the cached member source, the member-specific wrappers, and the remaining direct non-member autocomplete usages.

## Public shell

- `frontend/src/components/PublicLayout.tsx`
- `frontend/src/components/PublicStateCard.tsx`

Why:
- These files define the canonical public-site wrapper and its default page-level state treatment.

## Backend error contract and route registration

- `backend/src/api/types.ts`
- `backend/src/registerRoutes.ts`

Why:
- These files define the shared error shape and the single source of truth for route registration.

## Exceptions

- `frontend/src/pages/Calendar.tsx`
- `frontend/src/pages/CalendarEventFormPage.tsx`
- `frontend/src/pages/admin/AdminArticleEditor.tsx`

Why:
- These are intentional exceptions to the standard inner page shell because they need full-width or editor-specific layouts.
