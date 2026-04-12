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
- These files define the default spacing, headings, secondary control rows, sentence-case back actions, standard page-level and inline states, tables, and page-level tabs used across the authenticated app. `index.css` defines **`app-input`** and legacy **native `<select>`** focus rules so focus stays consistent while older screens are migrated.

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

## Table system

- `frontend/src/components/table/DataTable.tsx`
- `frontend/src/components/table/DataTableHeaderCell.tsx`
- `frontend/src/components/table/DataTablePagination.tsx`
- `frontend/src/components/table/DataTableSelectionCell.tsx`
- `frontend/src/hooks/useTableQueryState.ts`
- `frontend/src/pages/admin/AdminContent.tsx`

Why:
- These files define the canonical admin table system for server-backed sorting, URL-synced filters and pagination, stable selection behavior, fixed-width action columns, and the default `Showing x-y of n` footer. Start with the Files table in `frontend/src/pages/admin/AdminContent.tsx` when you need a full reference.

## Form system

- `frontend/src/components/FormField.tsx`
- `frontend/src/components/FormFieldMessage.tsx`
- `frontend/src/components/FormSection.tsx`
- `frontend/src/components/FormCheckbox.tsx`
- `frontend/src/pages/RequestSpare.tsx`
- `frontend/src/components/CalendarEventForm.tsx`
- `frontend/src/pages/PublicEventRegisterPage.tsx`
- `frontend/src/pages/admin/AdminEventEditor.tsx`
- `frontend/src/pages/admin/AdminArticleEditor.tsx`
- `frontend/src/pages/admin/AdminContent.tsx`

Why:
- These files define the canonical field shell, helper and error messaging, section layout, required text treatment, disabled and readonly behavior, and representative authenticated and public form usage. Start with `frontend/src/pages/admin/AdminEventEditor.tsx` when you need a complex form reference. **`AdminArticleEditor`** and **`AdminContent`** (e.g. Files tab, showcase modal) illustrate **`FormField`** + **`app-input`**, `useId()` ids with **`htmlFor`**, and composite **`role="group"`** labeling for the article body editor.

## Choice inputs and autocomplete

- `frontend/src/components/ChoiceInput.tsx`
- `frontend/src/components/ChoiceInput.stories.tsx`
- `frontend/src/components/AutocompleteInput.tsx`
- `frontend/src/contexts/MemberOptionsContext.tsx`
- `frontend/src/components/MemberAutocomplete.tsx`
- `frontend/src/components/MemberMultiSelect.tsx`
- `frontend/src/components/ArticleAutocomplete.tsx`
- `frontend/src/pages/RequestSpare.tsx`
- `frontend/src/pages/leagues/LeagueDetail.tsx`
- `frontend/src/pages/PublicEventRegisterPage.tsx`

Why:
- These files define the canonical shared choice-input foundation, its Storybook review surface, the generic autocomplete wrapper, the cached member source, the member-specific wrappers, and the remaining direct non-member autocomplete usages.

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
