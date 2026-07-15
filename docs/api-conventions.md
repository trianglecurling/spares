# API Conventions

These conventions exist to keep the frontend, backend, and generated API types aligned.

## Route registration

- The live server and OpenAPI generation must register routes from the same shared route-registration module.
- When adding a new route plugin, update the shared registration once rather than editing `index.ts` and `openapi.ts` separately.
- Keep route prefixes consistent under `/api`.

## Error envelope

- Use `ApiErrorResponse` from `backend/src/api/types.ts` as the default error shape.
- Standard error payload:

```ts
{
  error: string;
  message?: string;
  details?: unknown;
  requiresInstallation?: boolean;
}
```

- Use `error` for the user-facing summary.
- Use `details` for structured validation information.
- Do not invent route-specific top-level error keys for ordinary failures.

## Status-code expectations

- `400`: malformed input, validation failure, invalid IDs, invalid request bodies.
- `401`: authentication required or invalid token.
- `403`: authenticated but not allowed.
- `404`: resource not found or intentionally hidden.
- `409`: legitimate conflict, such as overlapping bookings.
- `500` or `503`: server or installation failures.

## Auth and permission failures

- Prefer one wording per class of failure:
- `401`: `Unauthorized` when auth is missing or invalid.
- `403`: `Forbidden` for generic permission denial, or a more specific message only when the UI genuinely benefits from it.
- If a route needs a domain-specific denial message, keep it intentional and consistent across that domain.

## Validation

- Validate request bodies with one clear path per route.
- When validation fails, return a `400` error with `details` so the frontend can show field-specific feedback.
- Avoid mixing several slightly different validation reply shapes for similar routes.

## OpenAPI and frontend typing

- OpenAPI generation is the source for `frontend/src/api/generated/types.ts`.
- Prefer `frontend/src/api/client.ts` over raw axios calls when the endpoint is covered by OpenAPI.
- Keep `frontend/src/utils/api.ts` focused on transport concerns such as interceptors and shared formatting.

## Timestamps and dates

- Use ISO timestamps for backend-to-frontend transport.
- If a value is date-only, make that clear and handle local formatting in the frontend.
- Do not introduce alternate timestamp formats for new routes.
- **Drizzle writes:** Postgres `timestamp` columns expect a `Date` (e.g. `updated_at: new Date()` or `sql\`CURRENT_TIMESTAMP\``). Do **not** write `new Date().toISOString()` into those columns — Drizzle calls `.toISOString()` on the value and strings 500 with `value.toISOString is not a function`. SQLite often stores the same fields as `text`, so ISO strings can appear to work locally and only fail on Postgres. Prefer `new Date()` (or `sql\`CURRENT_TIMESTAMP\``) for any column typed as `timestamp` in the Pg schema. ISO strings remain correct for `text` datetime columns and for query comparisons against those text columns.

## Route author checklist

- Register the route plugin through the shared route-registration module.
- Add or reuse the correct auth boundary.
- Return the standard error envelope.
- Include validation details for `400` responses when useful.
- Ensure the route is visible to OpenAPI generation if it is part of the supported surface.
