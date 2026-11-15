# Prox iteration workspace

This is a fork of [CLI Proxy API Management Center](https://github.com/router-for-me/Cli-Proxy-API-Management-Center),
independent of CPA-Manager-Plus at `usage.swervelab.xyz`. Upstream is MIT licensed;
keep its license and attribution. Base commit: `64b4f5aed19b8f791eb21eb9e785ea379ea05b44`.

The upstream navigation matches the supplied Prox screenshot, including Quota
Management, Quick Start, Auth Files, Plugin Store, and Management Center Info.
Theo's exact private changes have not been obtained. The screenshot is a design
reference, not proof that upstream supplies pooled forecasts.

## Run and deploy

- Fork: `https://github.com/SwiggitySwerve/prox`
- Checkout on homelab: `/home/swerve/src/prox`
- Setup merged in PR #1; pooled dashboard branch: `feat/pooled-quota-dashboard`.
- Public UI: `https://prox.swervelab.xyz`
- Local UI: `http://127.0.0.1:18318`
- Service: `systemctl --user status prox`
- Quota history: `systemctl --user status prox-history`, loopback port 18319,
  persistent SQLite at `~/.local/share/prox-history/quota.sqlite`.
- Runtime: rootless Podman, `localhost/prox:dev`, host networking, listeners only
  on loopback and the existing cluster bridge `10.42.0.1`.

Use the Bun version pinned by `package.json` (currently 1.4.3). For local changes,
run `bun install --frozen-lockfile`, `bun run dev`, and `bun run verify`.
To publish the current working tree to this homelab preview:

```sh
bash scripts/deploy-homelab.sh
```

This verifies and builds the single-file UI and quota-history server, checks
Nginx configuration, installs their user services, and restarts only Prox and
Prox history. The script uses the pinned Bun via npm
exec, so it does not replace a machine's global Bun. Commit first when the image
revision must identify an exact source tree.

The script also installs and enables the lock janitor: `prox-auth-janitor.timer`
(a user unit in `~/.config/systemd/user/`) runs
`~/.local/share/prox/prox-auth-janitor.sh` every 10 minutes. (An earlier
`prox-auth-janitor.path` watcher fired on nearly every proxy request, because
the proxy rewrites its cooldown-state files there; the deploy removes it.) CLI-Proxy deletes a credential's
`.json` but never its `.json.lock`; the janitor removes only `*.json.lock` files
that have no `.json` and are over 10 minutes old (a fresh one can belong to a
write in progress), and never touches a `.json`.

Initial routing setup (operator access on homelab):

```sh
kubectl apply -f deploy/kubernetes.yaml
bash ~/swervebox/scripts/authentik-proxy-app.sh prox.swervelab.xyz 'Prox' prox
```

The new namespace, service, EndpointSlice, and ingress are managed by this fork's
manifest for now, not by the swervebox Flux tree. Cert-manager supplies TLS;
existing wildcard DNS or external-dns supplies resolution. Authentik must be
registered before public access works. Retain the existing Authentik gate and
the proxy management-key check. Never add management keys to Git or the bundle.

## Connect to the existing providers

After Authentik sign-in, use the existing proxy management key at the UI's login:

| API address in the login form | Existing backend |
| --- | --- |
| `https://prox.swervelab.xyz` or `https://prox.swervelab.xyz/codex` | GPT/Codex, port 8317 |
| `https://prox.swervelab.xyz/claude` | Claude, port 8319 |

The checked-in source manifest, `deploy/provider-sources.json`, owns instance
membership, ports, paths, aliases, and explicit authentication-sharing scopes.
Run `bun run sources:generate` after editing it. `bun run sources:check` and the
build reject stale generated Nginx routes or public discovery. The browser reads
the sanitized `/prox/sources.json`; upstream origins and key-file references are
excluded. History collection reads the same manifest once at process start.

Each source's `providers` list says which instance takes new credentials of that
type. Every proxy accepts every provider, so OAuth logins go to the declared owner
whichever source is selected, and an auth file uploaded to another source is refused
with the owner's name. Undeclared providers stay on the selected source. Move a
misplaced credential; never copy it, because both instances would rotate one token.

These paths forward `/v8/management/` requests and the client-authenticated
`/v1/models` catalog. Management authentication passes through from the browser;
Nginx never injects it. Catalog requests use client API keys, not management keys.
No inference endpoint or catch-all backend proxy is exposed by this UI routing.

Auth Files, detailed quotas (`/quota/accounts`), provider configuration, dashboard
and installed plugins enumerate source sections. Equal filenames or account
indices remain separate occurrences. Config, OAuth, logs and system information
use an explicit source destination. Editors, confirmations, queued writes and
nested quota operations retain that destination until completion or cancellation.
Inventory refresh does not automatically run quota probes or download auth files.
An unavailable source remains visible without erasing healthy sibling results.

The `/quota` dashboard reads source-owned pools from the history service. Multiple
instances containing the same provider get separate pools; their allowances are
not added until an account-identity and combination policy can prove that sum
valid. An external, standalone management connection remains a single source.
Deployment plugin embedding is explicitly unsupported until nested asset/request
routing is verified; standalone external plugin-resource behavior is preserved.

Neither inference service, account auth directory, nor usage dashboard is changed.
No second usage-queue consumer is started. The existing queue must retain its
single consumer to avoid splitting usage history.

## Start the UI iteration here

The setup pass left `src/` unchanged. The pooled-dashboard implementation extends
it through these entry points:

- `src/features/quota/`: quota page, provider quota cards and refresh behavior.
- `src/features/quotaPool/`: combined provider pool UI and chart presentation.
- `server/quota/`: collection, persistence and forecast rules (see `RULES.md`).
- `src/domain/quotaWindows/`: existing provider parsing, shared with collection.
- `src/components/layout/`: shell and sidebar.
- `src/styles/themes.scss`: shared visual tokens.
- `src/services/api/`: v8 API boundary and provider requests.

Target: the supplied dark Prox layout, provider tabs, separate Claude/Codex pool
cards, recorded versus projected lines, burn/drain intervals, account reset
markers, and pool/first-account depletion estimates. Show stale/missing data
explicitly; projections must remain distinguishable from observations.

The quota history service collects current provider quota windows every five
minutes and retains 30 days of observations. It does not open CPA-Manager-Plus's
database or consume its queue. The service reads the existing management key
from a read-only mount, and checks that key before returning any quota data.
It never reads OAuth files or stores access tokens. Internal account metadata
and quota samples live only in the private SQLite directory. Email/name fields
are omitted from responses unless the authenticated caller explicitly reveals them.

Each enabled account contributes 100 points per base plan (Claude Pro or ChatGPT
Plus) times its plan's published multiple: Claude Max 20x = 2,000, ChatGPT Pro
200 = 1,000, Pro 500 = 2,500. Unknown plans count as 100 and are labelled.
Points are not tokens. Weekly and five-hour windows are separate.
Rates need at least ten minutes of current measured observations; until then the
view reports that it is collecting history. Forecasts assume each account keeps
its recent burn rate (or the selected multiplier) and resets on its reported
cycle. Missing/stale/error balances remain unknown, and history gaps break the
recorded line. No historical samples or plan multipliers are fabricated.

For each subsequent UI change: run `bun run verify`, deploy Prox only, and inspect
the affected route at desktop and mobile widths against the screenshot. Keep
browser screenshots free of credentials and account identities.

## Rollback

Before the first deployment of source-aware history, take a consistent SQLite
backup and retain the previous UI/history images. Stop `prox-history` before
copying its database directory (including any WAL files), or use SQLite's online
backup API while it runs. Do not copy only a live `.sqlite` file. Store backups
privately; they contain account metadata. This is an operator prerequisite, not
an automated backup in `scripts/deploy-homelab.sh`.

Source attribution adds ownership/alias tables in one transaction. The explicit
prior-deployment mapping in `server/quota/identity.ts` retains legacy account IDs
and sample tuples. Conflicts fail startup; unmapped history stays retained and is
reported as unresolved. Keep instance IDs stable when editing labels or paths.
To roll back, stop history first, restore the consistent backup and previous
images together, then restart. Never run old and new collectors concurrently.
Synthetic migration tests cover rollback, repeated startup and unknown provenance;
they do not certify the production database or replace its backup.

Stop the new UI and collector with `systemctl --user stop prox prox-history`.
Keep the data directory for later recovery. To remove its cluster
routes, run `kubectl delete -f deploy/kubernetes.yaml`. This manifest contains only
the new Prox namespace/resources. Existing proxy and usage services are untouched.
Remove the Prox Authentik application/provider separately if retiring the service.

## Setup verification (2026-10-27)

The initial upstream test run had one failure: a cooldown hint assertion compared
an unescaped apostrophe against React's escaped HTML. Shared test escaping now
handles that assertion; no application UI source changed. The pinned Bun run
passes all 1,662 tests, ESLint, TypeScript, and the production build.

The deployed Nginx configuration passes `nginx -t`; Kubernetes accepts the
manifest in a server-side dry run. The local health endpoint returns 200, while
an unauthenticated management request returns 401. The new TLS certificate is
ready and public requests redirect to Authentik.

Chromium checks at 1440×1000 and 390×844 loaded the quota page and refreshed all
two Codex and three Claude quotas through their respective routes. Public SSO
redirect was checked in Chromium, but a complete public Authentik sign-in was
not performed. Local authenticated checks exercised the same deployed UI and
Nginx API routes. Screenshots were redacted before capture.

T3 preview is blocked by this host's AppArmor sandbox configuration. The fallback
used an isolated headless Chromium profile, closed after verification. Chromium
and its missing libcups, libcairo, and libpango runtime libraries were installed
for those checks. The original inference and usage container start times are
unchanged. This records the setup baseline before the pooled dashboard.

## Pooled dashboard verification (2026-10-27)

The full verification passes 1,716 tests, ESLint, both TypeScript configurations,
and the single-file frontend plus Bun server build. The deployed history API
loads all three Claude and two Codex accounts with no collection issues, through
each of the root, `/codex`, and `/claude` management routes.

Authenticated Chromium checks passed provider filters, rate modes, quota-window
and usage-scenario controls, privacy toggling, and all five account rows.
Desktop (1440×1100) and mobile (390×844) have no page overflow or browser errors.
Initial live charts correctly show collection in progress; forecasts require
real observation history. A full public Authentik sign-in remains unverified.

Independent review found a fractional-timestamp depletion loop that returned
HTTP 503 for valid quota observations. Depletion events now set the balance to
zero exactly; regression tests cover the reported HTTP failure and sub-millisecond
depletion. Missing-window observations also suppress rates immediately. The
reviewer's original reproducer now returns HTTP 200.

Remote CI was unavailable for the setup merge; these verification results are
local checks. Inference and CPA-Manager-Plus container start timestamps remain
unchanged from before the Prox work.
# Analytics

The Observe sidebar's **Analytics** page reads retained request events from
prox-usage. It includes Overview, Tokens & Cache, Cost, Performance, Requests and
Model Rates. Filters and chart drilldowns share the same server-side query; request
pages use stable timestamp/ID cursors. The request inspector shows an allowlisted
projection, never raw request bodies, headers or credential files.

`deploy/provider-sources.json` explicitly grants the history management key access
to the complete `homelab` usage dataset. The `analytics` entry fixes the prox-usage
origin (`http://127.0.0.1:18320`, loopback only; `prox-history` reaches it over
`Network=host`, as it reached CPA-Manager-Plus on 18317) and references
`/run/secrets/proxy-management-key`, the management key the container already
mounts for `history`. prox-usage checks the same key, so no second secret is
mounted and nothing new is exposed. The key is never sent to the browser. This grant
is for the trusted homelab administrator, not for tenants with different data
permissions.

The existing `/v8/management/prox/analytics` route reaches the authenticated Prox
server, which calls prox-usage's `/v0/management/monitoring/prox-analytics`, an
alias of its `/v1/analytics` kept for this switch and removed in plan P10. The
response contract is unchanged. The inference instances remain on v8. prox-usage
and CPA-Manager-Plus both consume the usage queue until CPA-Manager-Plus is stopped.

**Rollback:** `git revert` the P7 merge and run `scripts/deploy-homelab.sh`. That
restores the old `analytics` values (`"upstreamOrigin": "http://127.0.0.1:18317"`,
`"adminKeyFile": "/run/secrets/cpa-admin-key"`) and the key mount line
`Volume=%h/.config/prox/cpa-admin-key:/run/secrets/cpa-admin-key:ro` in
`deploy/prox-history.container`. `~/.config/prox/cpa-admin-key` stays on the host:
the nightly and parity jobs read it for the CPAMP guard and comparison until
CPA-Manager-Plus is retired, so rollback needs no new secret.

Registered model lists are read independently from every configured source using
that source's client key. Source failures remain visible in the rate table.

Prices are **equivalent API estimates at the currently configured rates**, not
subscription bills or historical invoice prices. Unpriced models and incomplete
measurements remain explicitly unavailable. Retained events do not establish
coverage of every inbound request: old missing-usage records, pre-admission failures
and queue/process losses cannot be reconstructed. Timing methods are displayed;
full-duration output rate must not be presented as pure generation speed.


## Name an API key for usage metrics

Client names now belong to prox-usage's private local file; CPAMP's UI is not
needed. Edit `~/.config/prox-usage/client-aliases.json` with mode `0600`:

```json
{"client_alias":[{"api_key_hash":"<64 lowercase SHA-256 hex characters>","alias":"Work laptop"}]}
```

The P4 export produces this format as `<book.json>.client-aliases.json`; copy it
to that private path once. Preserve existing rows when adding a key. Hash the
exact API key bytes with SHA-256 (without a trailing newline), using a local tool
that reads secret input from stdin; never put the key in a shell command or git.
Save the updated file with `0600` permissions. The existing read-only `/config`
mount exposes it to prox-usage, which reloads it on its next exporter read. No
restart is needed. An unknown key appears as `key <first 8 hash characters>`;
traffic without a key is `unknown`. Invalid edits retain the last good labels and
set `client_alias_error` in the authenticated `/v1/exporter` response.

The monitoring rollout first adds Prox source-health gauges beside the unchanged
CPAMP counters. At cutover Step E, require Step B's full history import to finish,
then require `/v1/exporter` to report `rate_book_loaded: true` and
`client_aliases_loaded: true`. A last-good reload error may retain valid values;
first-load failure must suppress the shim's usage counters. Use an explicit empty
`client_alias` array if no friendly names are wanted.

The cutover adds `source="prox-usage"` to usage counters and gauges. Their values
become the canonical tokens and current-rate costs shown in Prox analytics, with
requested-model/account/provider/client label values preserved. New series' first
samples are not counted by Prometheus rate/increase; lifetime-total dashboards
jump once. Fable/Terra pricing and removal of the old generic-cache, `-fast` and
billing-only policies affect costs. Apply the Sonnet 5.5 cache-read correction at
this identity change; any later price decrease needs a new source identity.
Importing history after the swap would appear as a huge increase. Rolling back
resumes old counters and can double-count traffic already counted by the new ones.


## Nightly usage maintenance (operator enablement only)

The shipped `prox-usage-nightly.timer` is disabled by default and starts one
oneshot chain at **04:20 UTC**, without catch-up. The units run self-contained
bundles, not a checkout: `scripts/deploy-homelab.sh` builds `dist/usage-jobs/usage-nightly.js`
and `usage-parity.js` (`bun run build:usage-jobs`, part of `bun run verify`) from the commit it
deploys, installs both by temp-file-and-rename into `~/.local/share/prox/usage-jobs/`, and
runs `usage-nightly.js --check-install` (starts the sibling parity bundle with `--help`; no
network or keys) before reloading systemd. The nightly bundle spawns `usage-parity.js` from
its own directory. Both units use that directory as `WorkingDirectory` and write parity evidence
to `~/.local/share/prox/usage-evidence/` (`PROX_USAGE_EVIDENCE_DIR`); a manual repo run keeps
the `docs/evidence/prox-usage-parity/` default. `scripts/usage-nightly.ts` waits for **prune → reconcile →
optional backup → quick/event parity**, observing each job's terminal success
and completed cleanup before starting the next. It reads the management bearer
inside the process, polls `/v1/jobs` every ten seconds through the shared PSI gate,
and stops on job/API/parity failure. It enforces today's absolute **12:00 UTC**
cutoff and the 01:00–04:00 / 12:20–12:50 forbidden windows on every admission and
wait; at cutoff/interruption it requests active-job cancellation. A submit POST has its own 15-second timeout so a cutoff
cannot discard its accepted job ID. On an ambiguous response failure, a bounded
status read recovers only a running job echoing the exact unique `clientToken`
sent before that submission. Cancellation carries that token and the server
refuses mismatches. A newer same-kind operator job is never sufficient proof;
no match stops the chain with `recovery=no-owned-job`. HTTP rejections, including
409, grant no ownership. While a rollup backfill holds bulk admission, the submit
answers 409 `Rollup backfill in progress`; the chain retries only that refusal
every 30 s for up to 15 minutes (new token each attempt, still inside the noon
cutoff) and reports the `attempts` count. Any other 409, such as an active bulk
job, is not retried, and giving up keeps `refused: {kind, status}`.
Unless prox-usage reports `cpamp_retired: true` on `GET /v1/status` (see "Retiring
CPA-Manager-Plus" below), before any job the chain reads CPAMP's `/status` (port 18317)
with the key in `~/.config/prox/cpa-admin-key` and fails the night, starting nothing, with
`cpamp: {ok: false, collectors}` unless every collector (at least two) reports
transport `subscribe` and state `running`, or if CPAMP is unreachable. A polling
CPAMP would otherwise lose history silently. The nightly runs as the same user,
so the key needs no extra mount. Restart CPAMP after its proxies are up; a failed
guard night does not count toward the two-clean-nights gate. Manual job commands may omit the optional token;
provided tokens must contain 1–64 ASCII letters/digits/underscore/hyphen.
Incomplete
parity exits 2 and cannot pass the chain. Parity has a 5h30min runtime cap; the
whole oneshot has a 7h40min start timeout as a backstop.

Backup stays **skipped** with `PROX_USAGE_ENABLE_PACED_BACKUP=0`. Only set it to
`1` through a nightly-service override after the paced snapshot implementation
and restore gate land. Upload pacing does not make the existing VACUUM snapshot
bounded. The old independent prune/reconcile/backup/parity timers are no longer
shipped. On upgrades, deployment disables/stops each retired timer, removes its
unit and enable link, then reloads systemd; missing timers are tolerated, manager
failures stop deployment. The sole nightly timer remains disabled. `prox-usage-job@.service` and `prox-usage-parity.service` remain for
manual use. The deployment script copies templates without enabling them; this
change installs, enables and runs no live maintenance unit.

## Retiring CPA-Manager-Plus (Step G runbook)

`PROX_USAGE_CPAMP_RETIRED` in `deploy/prox-usage.container` is the single switch. While it is
`0`, nothing changes. At `1`, prox-usage refuses `import`, `reconcile` and `verify` (409 `CPAMP
retired`) and reports `cpamp_retired: true` on `/v1/status` and `/v1/exporter`; the nightly chain
reads that field, skips the CPAMP guard, reconcile and parity, never reads
`~/.config/prox/cpa-admin-key` or contacts port 18317, and prints
`"cpamp":{"retired":true,"skipped":["guard","reconcile","parity"]}` with status `succeeded`.
A retired night is healthy; a failed one still has `"status":"failed"`.

The final reconcile must happen before the switch, because retired mode refuses it. The `:ro`
mount cannot create the `-shm` a read-only open of CPAMP's WAL database needs, so the final
reconcile opens the stopped file with SQLite's `immutable=1` (`PROX_USAGE_CPAMP_IMMUTABLE=1`).
immutable=1 ignores the `-wal`, so the open refuses a non-empty `-wal`, any `-shm` and any `-journal`.

1. `systemctl --user stop cpa-manager-plus`, then mask the unit.
2. Confirm nothing holds the file: `fuser ~/.local/share/cpa-manager-plus/usage.sqlite*` and
   `lsof ~/.local/share/cpa-manager-plus/usage.sqlite*` print nothing.
3. Confirm `ls -l ~/.local/share/cpa-manager-plus/usage.sqlite*` shows no `-shm` and no `-journal`
   and no `-wal`, or an empty `-wal`. If either remains, with nothing holding the file run
   `sqlite3 ~/.local/share/cpa-manager-plus/usage.sqlite 'PRAGMA wal_checkpoint(TRUNCATE)'` on
   the host (this rewrites the file, so take its cold copy first) and check again.
4. Set `PROX_USAGE_CPAMP_IMMUTABLE=1` in `deploy/prox-usage.container`, deploy, then run
   `systemctl --user restart prox-usage.service`. The deploy script restarts it only when its
   JavaScript bundle changed, so a quadlet-only change needs this explicit restart.
5. Start `systemctl --user start prox-usage-job@reconcile.service`, then read the result with
   `printf 'Authorization: Bearer %s\n' "$(cat ~/.config/cli-proxy-rerank/management-key)" | curl -sS --header @- http://127.0.0.1:18320/v1/jobs`.
6. Accept only `state: "succeeded"` with `result.report.verification.exact: true` and
   `result.report.conflicts: 0`. An error `CPAMP source is not quiet: -wal, -shm or -journal present`
   means go back to step 3. Anything else stops the retirement; CPAMP can be unmasked and started.
7. Set `PROX_USAGE_CPAMP_RETIRED=1` and `PROX_USAGE_CPAMP_IMMUTABLE=0` in the quadlet, deploy, run
   `systemctl --user restart prox-usage.service` (same reason as step 4), and check `/v1/status`
   shows `cpamp_retired: true`. Until it does, the nightly still runs the CPAMP guard.
8. The next night's journal JSON carries the `retired` skip record and `status: succeeded`.

Step H (separate change) removes the `/cpamp` mount and `PROX_USAGE_CPAMP_DB_PATH` from the
quadlet and the CPAMP-only scripts. The mount stays until then because the final reconcile above
needs it. Alert rules must stop requiring `reconcile` outcomes once `cpamp_retired` is true.
