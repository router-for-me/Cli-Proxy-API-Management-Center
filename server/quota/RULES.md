# Quota history and forecast ownership

This package owns recorded quota history, sample quality, pooled arithmetic and
forecasts. HTTP validates requests and serializes these results. The browser
only selects views, formats values and positions chart geometry. Provider raw
window conversion belongs to `src/domain/quotaWindows`, shared with the original
credential UI. The store owns persistence; the collector uses only public APIs.

- Production membership, origins and per-instance key files come only from the
  validated deployment manifest. A collector pins a copied source list and its
  revision for its process lifetime; applying another revision requires stopping
  it and restarting. Stopping aborts in-flight requests and prevents their
  subsequent writes.
  Each instance is inventoried once, including all supported Claude/Codex kinds.
  Other kinds never trigger adapters, downloads or inference.
- Identity and complete-inventory retirement belong to an instance/provider pair.
  Failed, incomplete or malformed inventories retire nothing in that instance;
  another instance continues independently. Issues carry their owning instance.
  History for an instance removed from the manifest remains visible, but its
  pool is incomplete while that instance is absent from configuration.
- Legacy attribution uses the explicit prior-deployment mapping in `identity.ts`.
  Additive ownership and alias tables retain the original account IDs and every
  sample tuple/foreign key; migration never prunes or changes account metadata.
  All supplied mappings commit together or roll back. Conflicting mappings,
  unknown destinations and alias collisions fail. Unmapped history stays retained
  and unresolved; scoped dashboards expose its count without assigning its quota.
  New occurrences cannot claim an old ID without its persisted ownership alias.
  The original 30-day collection retention rule remains separate from migration.
- The credential inventory is one read model, versioned by a hash of the active
  `[instanceId, provider, accountId, disabled]` tuples (no names or emails), served at
  `/v1/inventory` (ETag) and echoed on `/v1/pools`. `syncInventory()` re-reads only the
  credential lists: single flight, one-second floor, outside the manual-refresh limit, never a
  usage API. Only `<name>.json` entries count. A read that fails or is malformed changes nothing.
  Reads are numbered per source, and a result older than one already applied is dropped.
- Retiring an account clears its email, replaces its name and stamps `retiredAtMs` in the same
  transaction; coming back restores them. A credential the user deleted by name (delete sync)
  that a fresh validated inventory confirms gone is purged at once, children first. Any other
  retired account is purged 24 hours after `retiredAtMs`: absence alone (an unmounted auth
  directory looks the same) is not proof of intent. The collector forgets a retired account's
  in-memory readings, aborts its polls and persists nothing for an account that is no longer live.
- Dashboard arithmetic runs separately for each instance/provider using the same
  source-local rules below. Equal emails, filenames or auth indices do not merge
  occurrences. Multiple same-provider sources expose unavailable combined values
  with `cross-source-combination-unverified`, never summed capacity or histories.
  No allowance identity or duplicate relationship is inferred from inventory.

- Each enabled account contributes 100 quota points per base-plan unit of its
  subscription (`plans.ts`): one unit is the provider's $20 plan (Claude Pro,
  ChatGPT Plus), and plans count as the providers' published multiples (Claude
  Max 5x/20x; ChatGPT Pro 10x, Pro 500 25x). A window's remaining percent times
  that weight gives pool points; resets restore each account to its own capacity.
  An unknown plan counts as one unit and is shown as unknown. Points are not tokens.
- Plans come from provider responses only: Codex's usage `plan_type`, and Claude's
  OAuth profile tier, read at most every six hours. A failed plan read changes
  nothing else.
- Weekly and five-hour windows are separate. Model-scoped, monthly, dollar and
  reset-credit balances are not added to those pools.
- Missing, expired, errored or older-than-15-minute samples are unknown, not 0.
  A successful response without a general window records an explicit missing
  observation, immediately superseding that window's previous balance.
  A failed poll marks an account errored only once its latest sample is older than
  15 minutes (or it has none); one failed poll never hides a still-fresh sample.
  Recorded charts hold the last balance flat across a stretch with no reports at
  all (the point 1 ms before the next report; rates stay unknown). An account
  missing while others report is still unknown, never held.
  Full collections are at least 4 minutes apart: Anthropic's usage endpoint returns 429
  to bursts. After a confirmed reset attempt, a targeted refresh may read only the
  affected account, at most once per 20 seconds with per-account single flight.
  It uses the same validated source inventory without recording membership or
  retiring accounts, and serializes with full collection. Each failed poll logs
  status, retry-after seconds and header names.
  Disabled/retired accounts are excluded. A failed inventory cannot look like
  an empty healthy provider. History describes the current eligible membership;
  an account joins it at its first stored sample, so adding an account never
  turns the pool's earlier history unknown.
- Burn is measured depletion per hour within matching reset cycles, excluding
  increasing balances and intervals longer than 15 minutes. At least ten
  minutes of eligible observations within the selected lookback are required.
  Drain is signed net depletion, including observed replenishment.
- Forecasts require current samples, rates and future reset timestamps for
  every eligible account. The pool forecast models fill-first routing: the sum of
  the accounts' recent burn rates, scaled by the selected scenario, is drawn from
  one account at a time, the one with quota whose window resets soonest, moving
  on when it drains. Per-account "predicted empty" still uses that account's own
  rate. Resets repeat on the reported period, restoring 100 points per plan
  unit. No future activity spike is inferred. Actual providers can change
  windows and limits; these are scenarios.
- Recorded lines break across collection gaps. No history is backfilled or
  fabricated. Refresh does not consume usage queues, mutate auth or reset limits.
- Only authenticated requests receive results. Account names/emails are omitted
  unless explicitly requested; default labels and opaque IDs are sufficient.

Regression coverage lives in `tests/proxPoolDomain.test.ts` and the collector,
store and HTTP tests; `tests/proxQuotaSources.test.ts` covers source isolation and
transactional migration with synthetic data. Samples are private local data;
never log credentials, upstream bodies or account identifiers.

The combined chart can show separate provider lines or stacked provider bands. Total
recorded values reuse the account history, plan weighting, expiry and gap rules
above on a shared observation timeline. Forecast totals add the independent
piecewise-linear provider projections at every event, preserving both sides of
reset jumps. They never transfer demand between providers or extrapolate beyond
a provider's trace. Missing constituent values remain unknown. Multiple eligible
sources for the same provider still withhold the total until allowance identity
is proven; disabled, retired and unresolved accounts add no capacity.

The server also exposes each provider's contribution on the total's exact history
and forecast event timeline. Those layer traces contain no account metadata.
The browser renders these results without quota arithmetic: stack offsets are
presentation geometry, and each band's thickness and readout retain its original
provider value. Any unknown contributor breaks all stacked bands. Signed drain
uses positive and negative stacks on opposite sides of zero. The former single
total line is replaced by these distinct layers.

Minimize controls shrink the plot only; the account roster is unchanged (a
behaviour change, user-approved 2026-11-05). Completion polling reads dashboard status every second
while collection is running, without requesting additional collections.

- Reset claims (`POST /v1/resets/claim`, `claims.ts`) are the server's source of truth for
  spending a Claude grant or a Codex credit. The server performs a claim only on an explicit
  authenticated user request, never on its own: no collection, refresh, sync or retry loop ever
  claims. Refresh itself still does not consume usage queues, mutate auth or reset limits; claims
  are the only write, and each is recorded in `quota_reset_events` (opaque account id, provider,
  kind, grant/credit id, the client's request id, outcome, requested/settled times, and the
  readings just before and after: every usage window the collector held, Fable's
  `seven-day-fable` included, plus reset counts). Events are history: no pruning, no names, and an
  account purge leaves them. `GET /v1/resets/events` returns them without names or emails unless
  `reveal=true`, like `/v1/pools`.
- A claim resolves the account to its validated source and auth index as the collector does,
  sends through that source's management `/requests/api-call` with the instance key file, and
  reuses the shared `src/` claim and parse helpers (Claude reads the organization first). It is
  single flight per account, starts after a full collection in flight and holds the next one back,
  like a targeted refresh. The row is written as `pending` before anything is sent. The client
  request id is unique: a settled one replays its event and sends nothing. A claim that may have
  been sent and got no answer is `unknown`, never failed; the same request id may be sent again
  for ten minutes (providers deduplicate it) and settles the one event only on a definite spend.
  A refusal on that retry stays `unknown`. A `pending` row left by a stopped process becomes
  `unknown` at startup. Anything refused before the send (eligibility, organization, status read)
  records no event. After every claim one targeted refresh reads the account, past the 20-second
  floor, and its reading is the event's `after` (null when the refresh could not read).
- Per-account model-scoped windows (Fable) are exposed beside, never inside, the pool points:
  `/v1/pools` carries each account's latest `windows`. Usage (prox-usage) is not joined to claims.
  A "tokens since last reset" view is a documented follow-up that would come through prox-usage's
  existing `/v1/analytics` keyed by the event times, not through a second usage store here.
- Billing readings and ChatGPT account IDs are memory-only. Never persist or log the provider account ID or send it to the browser. Codex subscription attempts and Claude profile attempts are gated per account for six hours, including failures and targeted refreshes. Claude reads once after restart even with a fresh stored plan. Billing failures preserve the previous reading.
