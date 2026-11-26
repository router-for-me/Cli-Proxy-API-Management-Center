# Fork customizations (PDiTO)

This fork adds a Quota Overview page and supports the CLIProxyAPI fork's quota-aware routing.
The upstream sync workflow merges and verifies both sets of changes before releasing.

## Rules

- Fork-only code lives in `src/custom/` and `tests/custom*.test.ts`. Upstream never touches
  these paths.
- Page integration touches upstream in two places, one line each plus an import:
  - `src/router/MainRoutes.tsx`: `...customRoutes,` before the catch-all route.
  - `src/components/layout/MainLayout.tsx`: `...customObserveNavItems,` at the top of the
    Observe group.
- The routing contract also needs small upstream changes in `types/visualConfig.ts`,
  `hooks/useVisualConfig.ts`, `services/api/routing.ts`, the network strategy selector,
  `features/routing/components/PolicyPanel.tsx`, `types/routing.ts`, config search
  and routing preview logic. These preserve `soonest-reset-first` in both editors and avoid
  showing round-robin or invented traffic shares. Keep these edits narrow when resolving
  upstream conflicts. The routing page and visual config editor both offer the custom
  strategy in their normal dropdowns, alongside the upstream strategies.
  Quota Overview has no routing or transport configuration controls.
- Text strings are registered at runtime in `src/custom/i18n.ts` under `pd_overview.*`,
  plus the routing editor's two custom strategy labels. Do not
  edit upstream locale files.
- The dashboard is branded **Prox**. `src/custom/brand.ts` holds the name and icon and overrides
  the brand-name locale keys at runtime. Upstream files that hard-code the name or logo
  (`index.html`, `main.tsx`, `LoginPage.tsx`, `DotMatrixHero.tsx`, `MainLayout.tsx`,
  `SystemPage.tsx`) import `BRAND_NAME` and `BRAND_ICON` instead. The icon's source files live
  in `brand/` at the repository root. The login and splash screens use brand colors set
  directly in upstream's `src/pages/login/_palette.scss` and `LoginRevealVeil.scss` (upstream's
  contrast tests read those files). `DotMatrixHero.tsx` paints the dot field as a gradient when
  the palette sets `--login-dot-color-end`. Upstream's `src/assets/logoInline.ts` is left in place
  but unused, so upstream edits to it merge cleanly. Strings naming the backend, CLI Proxy API, stay as they are.
- Reuse upstream data hooks, stores and components by importing them. If an upstream rename
  breaks the build, fix the import here rather than editing upstream code.

## Pages

- **Quota Overview** (`#/quota-overview`): one pool chart with every provider's weekly
  capacity, recorded and projected. A row of tiles above it gives each pool's remaining
  quota and next reset, and toggles its line. Lines show a share of each pool by default,
  or pooled percent. Below it sits a ledger of
  credentials in backend routing order with its next new-session choice marked, and
  upstream's cards and quota-window timeline. It shares the quota cache with the official
  Quota Management page, loads unloaded credentials on open and refreshes every 15 minutes
  while visible.
  - Between those refreshes it uses what CLIProxy already knows. CLIProxy reads the
    rate-limit headers of every response it proxies and returns
    the latest set per credential from `GET /credentials` (`quota.signals`);
    `quotaOverview/passiveQuota.ts` parses those. The page re-reads `/credentials`, which
    CLIProxy answers locally, every two minutes while visible. The newer of a live and a
    proxy reading wins.
  - CLIProxy keeps only the latest reading, so `quotaOverview/history.ts` saves each new one
    in `localStorage` (per backend address, three weeks) while the page is open. The
    recorded line has gaps wherever no browser had the page open.
  - The projection drains the pool at the chosen burn rate the way CPA routes: highest
    priority tier first, one credential at a time under `fill-first`, by the soonest weekly
    reset under `soonest-reset-first`, and spread evenly otherwise. Projections simulate new
    unbound traffic using displayed windows. They do not predict the effect of live affinity
    bindings, future quota freshness or model-specific limits.
  - Claude's Fable allowance has a separate golden-yellow history and projection line. It is never
    added to shared weekly capacity, and shared weekly and five-hour limits still apply.
    Both remaining totals appear together, with matching Claude and Fable legend keys.
    Golden reset markers and credit badges identify Fable resets when the reported label
    names Fable. Shared-window grants have a regular badge; unclear grants stay unclassified.

## Backend routing status

The `PDiTO/CLIProxyAPI` backend exposes authenticated
`GET /v8/management/routing/status?provider=...&model=...&transport=...` with schema version 1.
The page reads its cached status every 30 seconds while visible; the backend independently
refreshes supported OAuth quotas every five minutes, even without an open dashboard. This
read never polls upstream. The ledger uses provider-wide status with a blank model,
WebSocket for Codex and HTTP for other providers. It does not infer
model-specific eligibility. The next-session badge tooltip explains this fixed context.
Transport support is configured in the existing provider and credential editors; the client
chooses its own connection transport.

Join the result to credentials by opaque `auth_index`, never filename or email. Backend rank,
eligibility, skipped reasons, selected reset window, observation age and fallback reasons are
shown in the credential ledger. The next badge means a new session in that provider-wide
context; no bound session is inferred. Status reads use a captured connection and
session-generation guards. Failed,
unsupported or expired snapshots show no prediction. Snapshots expire after 90 seconds,
checked on the shared minute clock. Older v8 backends still work and
fall back to priority/name display order without claiming that it is the backend's choice.
Home/plugin authority and non-predictable strategies also suppress local predictions.

Routing settings use the existing routing-page save flow or visual config editor. Strategy
parsing and YAML writes preserve the custom value. Existing usable bindings remain governed
by the backend's configured affinity.

## Sync and release

`.github/workflows/pd-sync-release.yml` runs every six hours, on demand and on pushes to `main`.
It merges `router-for-me/Cli-Proxy-API-Management-Center` `main`, runs `bun run verify`, pushes
the merge and publishes `management.html` as the latest release, tagged
`pd-<upstream version>-<commit>`. A merge conflict, failed check or refused push publishes
nothing and comments on the open "Upstream sync or release failed" issue, naming which of the
three happened.

GitHub doesn't let a workflow's built-in token push changes to `.github/workflows/`, and
upstream edits its own workflows from time to time. The workflow therefore pushes with the
`SYNC_TOKEN` secret when it exists: a fine-grained personal access token for this repository
only, with Contents and Workflows set to read and write. To create or renew it, go to GitHub
Settings, Developer settings, Fine-grained tokens. Then run
`gh secret set SYNC_TOKEN -R PDiTO/cpamc` and paste it at the prompt.
When it expires, the failure issue says so.

Without the token, or to fix anything else by hand, merge locally:

```bash
git fetch upstream && git merge upstream/main && bun run verify && git push origin main
```

CLIProxyAPI serves this build when its config has
`management.panel-github-repository: "https://github.com/PDiTO/cpamc"`.
It checks for a new release every three hours. Pointing that setting back at the upstream
repository restores the official panel.
