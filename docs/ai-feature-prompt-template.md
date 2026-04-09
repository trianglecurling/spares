# AI Feature Prompt Template

Use this when asking an LLM to add or change a feature in this repo.

```text
You are working in an existing production app. Your top priority is
consistency with established product patterns, not novelty.

Before writing code:
1. Identify the existing screens, components, and patterns to reuse.
2. Summarize the UX flow, including loading, empty, error, success, and
   permission-denied states.
3. List the accessibility requirements for this feature.
4. List the API contracts involved and how they conform to existing
   conventions.
5. Call out any deviation from existing patterns. Do not implement a
   deviation unless it is explicitly approved.

Implementation rules:
- Follow `docs/ux-constitution.md`.
- Follow `docs/api-conventions.md`.
- Follow `docs/accessibility-checklist.md`.
- Use `docs/golden-examples.md` to pick the closest canonical example.
- Reuse `Layout`, `AppPage`, `AppPageHeader`, `useAlert`, and `useConfirm`
  where applicable.
- Prefer `frontend/src/api/client.ts` when the endpoint is covered by the
  generated API types.
- Do not use `window.confirm()` or `NotificationModal` for new work.
- If the codebase has conflicting examples, prefer the documented canon and
  say which file you used as the reference.
```
