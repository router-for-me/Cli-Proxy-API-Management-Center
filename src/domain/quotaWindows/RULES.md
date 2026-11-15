# Provider quota windows

This package owns Claude and Codex payload-to-window conversion for both the
existing credential UI and the Prox history collector. Provider data modules
re-export the builders for existing callers. Keep IDs, reset parsing, periods,
fallbacks, labels, and missing values consistent here; do not add a second raw
payload parser in the history service or dashboard.

Cloud-session dollar credits are excluded from Claude quota windows, including
partial dollar payloads. Do not relabel them as Fable or use them for low-quota
warnings. Legacy percentage-only Fable windows and modern scoped Fable limits
remain supported; the OAuth usage snapshot owns any separate dollar balances.

`lanes.ts` is the one place that says which window id is the account-wide weekly or
five-hour window (`laneOf`, `poolWindowId`). The collector, the pool card and the /quota
timeline call it; do not compare window ids to `'seven-day'` or `'weekly'` elsewhere.
Same-period model windows (Fable, Opus, Sonnet, Codex Spark) are never the weekly lane.
`tests/quotaLanes.test.ts` fails when a new id appears without a lane.

A Codex payload whose only account-wide window is the weekly one (`primary_window` of 604800 s,
`secondary_window` null or absent) yields a weekly window and no `five-hour` window; the collector
records the five-hour lane as an explicit missing observation, and `server/quota/RULES.md` says
that a successful reading like this means the account has no five-hour limit.
