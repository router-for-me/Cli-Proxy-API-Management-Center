# Poller / timer inventory

Captured during Stage 1 Phase A of the staged refactor. This is the input to
the `usePoll` migration in Phase B — only the entries marked **network** are
migration targets. UI timers stay where they are.

Captured commit: 5a56733 (refactor/upstream-bound vs upstream/dev).

## Network pollers (Phase B migration targets)

| File:line | Cadence | What it polls | Notes |
|---|---|---|---|
| `src/pages/AuthFilesPage.tsx:342` | 240 s | `authFilesApi.loadFiles()` | via `useInterval`; gated on `isCurrentLayer` |
| `src/pages/LogsPage.tsx:276` | 8 s | `logsApi.loadLogs(true)` | raw `setInterval`; gated on `autoRefresh` and `connectionStatus === 'connected'` |
| `src/pages/OAuthPage.tsx:179` | 3 s | `oauthApi.getAuthStatus(state)` | raw `setInterval`; per-provider; cleared on success/error |
| `src/components/providers/hooks/useProviderRecentRequests.ts:116` | `PROVIDER_RECENT_REQUESTS_STALE_TIME_MS` | `refreshRecentRequests()` | via `useInterval`; gated on `enabled` |

**Phase B migration:** introduce `src/hooks/usePoll.ts` backed by
`AbortController` + `document.visibilityState`. Each call site moves from
`setInterval`/`useInterval` to `usePoll(callback, intervalMs, { enabled })`.
Visibility-paused pollers stop firing on hidden tabs and cancel in-flight
requests on unmount or interval change.

## UI / animation timers (leave alone)

These are not network calls and do not need `usePoll`.

| File:line | What it does |
|---|---|
| `src/components/common/NotificationContainer.tsx:43,54` | notification exit animation timing |
| `src/components/common/SplashScreen.tsx:18` | splash-screen fade-out completion |
| `src/components/ui/Modal.tsx:133,149,212` | modal close animation + focus delay |
| `src/hooks/useDebounce.ts:11` | debounce helper (consumed by various inputs) |
| `src/pages/DashboardPage.tsx:81` | time-of-day clock update every 60 s (no network) |
| `src/pages/LogsPage.tsx:390` | long-press detection timer |
| `src/pages/LoginPage.tsx:119` | post-login redirect delay (UX) |
| `src/pages/OAuthPage.tsx:172` | success-message auto-reset delay |
| `src/pages/SystemPage.tsx:98,244` | version-tap easter-egg counter timer |
| `src/stores/useNotificationStore.ts:60` | auto-dismiss notification after duration |
| `src/utils/download.ts:17` | `URL.revokeObjectURL` after blob download |
| `src/utils/helpers.ts:22,26,43,87` | `debounce`, `throttle`, `sleep` helper primitives |

## Wrappers worth knowing

| Wrapper | File | Purpose |
|---|---|---|
| `useInterval(callback, delay\|null)` | `src/hooks/useInterval.ts` | Stable-callback wrapper around `setInterval`; pass `delay=null` to pause. **Network-poll consumers replace with `usePoll`. Other consumers stay.** |
| `useDebounce(value, delay)` | `src/hooks/useDebounce.ts` | Pure value-debounce; not a poller. |
| `useHeaderRefresh(handler[, enabled])` | `src/hooks/useHeaderRefresh.ts` | User-triggered (header refresh button), not interval-based. Out of scope for `usePoll`. |

## What this list does NOT include

- Page-level `useEffect` data fetches that fire once per mount/dependency change. Those are not pollers.
- `vi.useFakeTimers` setups in tests (none yet — added by the Vitest scaffold commit).
- React Suspense / transition timers — none in use today.
