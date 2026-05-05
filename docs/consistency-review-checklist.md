# Consistency Review Checklist

Use this checklist in human or AI-assisted review.

- Does the change reuse the documented page shell and shared components?
- Does it avoid `event.stopPropagation()` unless integrating third-party listeners that ignore `defaultPrevented`, with an inline rationale when used?
- Does it avoid deprecated interaction patterns such as `window.confirm()` and `NotificationModal`?
- Does it follow the documented success, warning, and error feedback pattern?
- Does it preserve keyboard access and obvious labeling?
- Are labels associated with controls using **`FormField`** (or **`FormCheckbox`** / documented composite association per `docs/accessibility-checklist.md`)?
- Does focus on text fields and **native selects** match `app-input` / `index.css` (no one-off select focus CSS unless `index.css` was updated)?
- If the change touches a form, does it use the shared form shell and text-based required markers?
- If a field is disabled, readonly, or hidden, is that state semantically correct and visually explained when needed?
- If the change touches drag and drop, does it reuse the shared `frontend/src/components/dragDrop/` layer instead of hand-rolled HTML5 drag handlers?
- Do drag-and-drop surfaces keep a visible handle, keyboard path, overlay, and reduced-motion-safe behavior?
- If the change touches a sortable or paginated admin table, does it reuse the shared `frontend/src/components/table/` layer?
- Does a server-backed table keep page, sort, order, and filters in the URL when that state should be navigable?
- Are bulk row actions above the table and is the row-actions column stable enough to avoid CLS?
- Has the table avoided introducing a page-size selector without a documented exception?
- Does the backend return the standard error envelope?
- If the change adds or touches an API route, does the shared route registration include it?
- If an endpoint is covered by generated types, does the frontend use the typed client?
- Does the change invent any new interaction, terminology, or response shape without an explicit reason?
