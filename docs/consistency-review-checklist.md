# Consistency Review Checklist

Use this checklist in human or AI-assisted review.

- Does the change reuse the documented page shell and shared components?
- Does it avoid deprecated interaction patterns such as `window.confirm()` and `NotificationModal`?
- Does it follow the documented success, warning, and error feedback pattern?
- Does it preserve keyboard access and obvious labeling?
- If the change touches a form, does it use the shared form shell and text-based required markers?
- If a field is disabled, readonly, or hidden, is that state semantically correct and visually explained when needed?
- If the change touches drag and drop, does it reuse the shared `frontend/src/components/dragDrop/` layer instead of hand-rolled HTML5 drag handlers?
- Do drag-and-drop surfaces keep a visible handle, keyboard path, overlay, and reduced-motion-safe behavior?
- Does the backend return the standard error envelope?
- If the change adds or touches an API route, does the shared route registration include it?
- If an endpoint is covered by generated types, does the frontend use the typed client?
- Does the change invent any new interaction, terminology, or response shape without an explicit reason?
