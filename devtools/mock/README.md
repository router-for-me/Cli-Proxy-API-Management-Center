# Quota board mock harness

Renders the quota page with realistic data, headlessly, without a live backend.

The real server's management key is bcrypt-hashed in config, so the panel can't
be logged into unattended. This serves the built panel next to a stand-in
management API that accepts any bearer token.

```bash
bun run build                    # dist/index.html is what gets served
bun devtools/mock/serve.ts &     # http://localhost:8899
devtools/mock/shoot.sh out.png
```

`shoot.sh` looks for Chrome in the default macOS location and then for
`google-chrome` / `chromium` on PATH; set `CHROME=/path/to/binary` to override.

`shoot.sh` starts headless Chrome, `drive.ts` logs in over the DevTools
Protocol, navigates to `#/quota`, waits for cards to render, and screenshots.
It prints a summary first — card count, the percentages found on the page, and
how many errors or "not loaded" states are showing — so a broken run is obvious
without opening the PNG.

`drive-filter.ts` asserts the provider chips filter the board (4/1/2/1 of 8) and
that the density picker changes the column count. Run it against an already-open
Chrome from `shoot.sh`.

## Why the fake data is in upstream shape

Every quota fetch funnels through `POST /api-call`, so the fixtures are written
in each provider's *upstream* JSON and go through the app's real parsers. That's
the point: injecting store state directly would render something pretty while
proving nothing about parsing or percentage polarity — which differs per
provider and is the single easiest thing to get backwards.

Shapes that cost time to get right, in case you extend this:

- **Claude** — named window keys (`five_hour`, `seven_day`, `seven_day_opus`),
  each `{utilization, resets_at}`. `utilization` is percent **used**. Per-model
  weekly limits arrive separately in `limits[]` as `weekly_scoped` entries.
- **Codex** — `rate_limit.primary_window` / `secondary_window`, `used_percent`.
  Reset credits must be `{available_count, credits}` at the **root** — the
  normalizer rejects a payload without one of those keys at the top level.
- **Antigravity** — `groups[].buckets[]` with `displayName` and
  `remainingFraction` as a **0..1 remaining** fraction — the opposite polarity
  to Claude/Codex. The auth file also needs `project_id`, or the card errors
  before it fetches.
- **Kimi** — `limits[].detail` with raw `used`/`limit` counts; remaining is
  derived, never reported.
