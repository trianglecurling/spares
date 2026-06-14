# Homepage performance

## Target

Time to Interactive (TTI) on `/` under **500 ms** for both anonymous and signed-in visitors (Lighthouse mobile, throttled Fast 3G + 4x CPU slowdown).

Images and other non-blocking assets are excluded from the TTI target as long as they do not cause CLS.

## What changed

### Backend

- `GET /api/public/bootstrap` is served from an in-memory cache (`backend/src/services/publicBootstrapCache.ts`).
- Cache warms on database startup and rebuilds in the background after invalidation.
- Successful mutations under `/api/content/`, `/api/sponsorship/`, `/api/calendar/`, `/api/events`, `/api/config`, and `/api/governance/settings` invalidate the cache via `backend/src/services/publicBootstrapCacheInvalidation.ts`.
- Time-based invalidation covers announcement expiry, sponsorship date boundaries, and upcoming bonspiel boundaries.

### Frontend

- Route-level code splitting in `frontend/src/App.tsx` — homepage entry chunk is ~91 KB minified (~25 KB gzip) instead of a single ~3.4 MB bundle.
- Vendor libraries split into `vendor`, `otel`, `monaco`, `toast-ui`, and `dnd-kit` chunks (`frontend/vite.config.ts`).
- OTEL initializes after first paint via dynamic import (`frontend/src/main.tsx`).
- Auth verify on public marketing paths is non-blocking (`frontend/src/contexts/AuthContext.tsx` + `frontend/src/utils/publicLightPaths.ts`).
- `LeagueOptionsProvider` is scoped to authenticated routes only; leagues load when entering the member shell (`Layout.tsx`).

## Expected network on `/`

| Visitor | Critical path |
|---------|----------------|
| Anonymous | `index.html`, `index-*.js`, `index.css`, `vendor-*.js` (parse/eval), `GET /api/public/bootstrap?includeHome=true` |
| Signed-in | Same as anonymous, plus background `GET /api/auth/verify` and deferred OTEL chunk + `/api/public-config` |

Should **not** appear on homepage load: `/api/registration/window`, `/api/leagues`, blocking `/api/public-config`.

## How to measure

1. Build production assets: `bun run build:frontend`
2. Serve preview: `bun run --filter frontend preview` (with backend running for bootstrap API).
3. Chrome DevTools → Lighthouse → Mobile → Performance (or “Timespan” trace on Performance panel).
4. Record TTI and confirm bootstrap responds in &lt;50 ms when cache is warm (Network tab).

### Production build baseline (post-change)

| Asset | Size (gzip) |
|-------|-------------|
| `index-*.js` (homepage entry) | ~25 KB |
| `vendor-*.js` | ~381 KB (parsed after initial route; lazy routes load on navigation) |
| `index.css` | ~19 KB |

## Acceptance checklist

- [ ] Anonymous `/` TTI &lt; 500 ms (Lighthouse mobile throttled)
- [ ] Signed-in `/` TTI &lt; 500 ms with valid session token
- [ ] Warm `GET /api/public/bootstrap?includeHome=true` does not query the database
- [ ] Admin site-config / featured article / sponsor edit updates homepage within cache rebuild window
- [ ] Announcement banner disappears after expiry without manual admin action
- [ ] Navigating to `/dashboard` loads leagues (registration window + summary leagues) — not on homepage

## Multi-instance note

Bootstrap cache is per backend process. Each replica warms on startup and invalidates locally on writes. No shared cache layer is required for v1.
