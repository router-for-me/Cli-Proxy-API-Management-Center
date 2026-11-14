# P5 query-engine evidence

Initial benchmark measured on 2026-11-12 with Bun 1.4.3, before the S1–S4
review fixes (PR head `58b68c0c`), on the branch based on `d979473b`
(P2 and the approved rate-book PR merged). No live proxy, CPAMP API or live database was queried or changed.
`src/domain/analytics/types.ts` has no diff.

The 24-hour synthetic budget passes. **The 30-day synthetic budget fails. P5b is
required before P6**, as specified in plan §2.9. These measurements do not satisfy
the live M3 gate; the coordinator owns that check after deployment.

## Synthetic budget

Command (preceded by `cat /proc/pressure/io`, `full avg10=2.31`, below 5):

```sh
ionice -c3 nice -n10 /dev/shm/prox-bun-1.4.3/bun-linux-x64/bun scripts/usage-query-benchmark.ts
```

The script built 960,000 events (32,000/day for 30 days) through `UsageStore`,
entirely in a uniquely named `/dev/shm` directory, and removed the database,
WAL/SHM and temporary key in `finally`. No raw payload buffer was created. The
fixture has 40 uniformly distributed models, two providers/instances, six
accounts, five clients, standard/priority/fast tiers, base/long-context bands,
successes/failures and present/missing TTFT. Tier and band variation is independent
of model selection. Uniform model traffic is synthetic, not a claim about live
traffic distribution.

Each view used three excluded warmups followed by 50 uncached handler/worker
responses, including serialization and response-body consumption. Nearest-rank
p95 is sorted run 48 of 50. A concurrent main-thread synthetic writer inserted
four events per second (about ten times the live average); 869 additional events
were committed during all measured views. This checks concurrent WAL ingestion,
not production disk performance: tmpfs intentionally avoids this host's disks.

| Range and buckets | p50 | p95 | Maximum | Budget | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| 24 hours, hourly | 82.509 ms | 90.678 ms | 93.672 ms | <150 ms | PASS |
| 30 days, daily | 1777.925 ms | 1854.710 ms | 1870.135 ms | <1000 ms | FAIL |
| 30 days, hourly | 2234.952 ms | 2321.158 ms | 2357.208 ms | <1000 ms | FAIL |

No response cache or rollup is implemented. Source of truth: the committed
benchmark script; these values are its final `stage: result` output. This run
was not concurrent with `bun run verify` or a build from this worktree. Other
host activity was not controlled.

## Initial verification (before S1–S4 fixes)

- Focused: `bun test tests/proxUsageAnalytics.test.ts tests/proxUsageLatency.test.ts
  tests/proxUsageSearch.test.ts tests/proxUsageCredentialText.test.ts
  tests/proxUsageLanes.test.ts tests/proxUsageHandler.test.ts
  tests/proxUsageService.test.ts`: 59 passed, 0 failed. All are included again in
  the final full suite.
- `ionice -c3 nice -n10 env PATH=/dev/shm/prox-bun-1.4.3/bun-linux-x64:$PATH
  TMPDIR=/dev/shm/prox-query-verify-temp bun run verify`: PASS. Full `bun test`:
  3,021 passed, 0 failed, 261 files, 29,232 assertions. ESLint: 0 errors and six
  existing React Refresh warnings in unchanged source files. TypeScript,
  source-manifest check, Vite single-file build, history bundle and all three
  usage entry bundles passed. Vite also emitted its native-config-loader warning.
- Worker regression exercises both a real Worker and built child-process IPC.
  A cancellation test terminates a worker blocked in synchronous work and then
  serves another job in the same lane. The module-graph test covers the mounted
  handler and lanes, and rejects SQLite/worker-entry imports from main.
- No browser exercise: this change adds a backend endpoint; UI contract and
  markup tests run in the full suite. No live response matrix, deployment or
  runtime log baseline was taken.

## CPAMP cases retained

Paths below are relative to CPAMP's `apps/manager-server/internal`.

| Status/reason or behavior | Ported source/test | Prox regression |
| --- | --- | --- |
| `estimated`, `explicit-zero`; measured zero versus unknown zero | `service/pricing/analytics_test.go: TestAnalyticsEstimateMissingFreeAndMeasuredZero` | Analytics status table; existing P4 pricing tests |
| `unpriced`: `model-rate-unavailable`, `model-rates-not-configured` | Same test | Analytics status table and whole-scope subtotal |
| `unavailable`: `usage-presence-unknown`, `no-retained-events` | Same test; `service/monitoring/prox.go: metricsFromStats` empty case | Analytics status table and empty scope |
| `partial`: `input-rate-unavailable`, `output-rate-unavailable`, `cache-read-rate-unavailable`, `service-tier-rate-not-explicit` | `service/pricing/analytics.go: EstimateCost` branches (the two-test analytics suite has no dedicated test for every reason) | Analytics status table and existing P4 pricing tests; additional branch coverage |
| `partial`: `usage-components-unreported`; token nulls and visible positive counters | `service/monitoring/prox_test.go: TestProxNullableRequestTokens`; `prox.go: proxRequest` | Presence/speed/diagnostics and status table |
| `partial`: `legacy-record-kind-unknown` on aggregates | `prox_test.go: TestProxAnalyticsWholeScopePagingRatesAndSafeFields`; `prox.go: metricsFromStats` | Whole scope, empty scope, band pricing, status table |
| Known supplementary exclusion; safe diagnostics; whole-scope totals and cursor paging | `TestProxAnalyticsWholeScopePagingRatesAndSafeFields` | Whole-scope paging and safe fields |
| `usage-not-reported`, `supplementary-overlap-unknown` estimator branches | `service/pricing/analytics.go: EstimateCost`, `prox.go: proxRequest` | Existing P4 `proxUsagePricing.test.ts`; P1 stores presence as reported/unknown and P5 excludes known supplementary rows |
| Candidate resolution, explicit context bands and service rows | `prox_test.go: TestProxAliasDetailMatchesAggregatePrice`, `TestProxRateSchedulesInheritBaseAndPreserveZero`; `service/pricing/cost_test.go: TestExplicitFastPriceAppliesToBaseContextBandForFastAndPriority`, `TestCostForModelAppliesContextTierToWholeAggregate` | Band/tier price equals independent event sum; status table; P4 tests |
| Validation and cancelled admission | `prox_test.go: TestProxQueryBoundsAndCancelledAdmission` | Bounds/strict JSON, worker and lane tests; UTC narrowing tested |
| Search isolated from fast views | `prox_test.go: TestProxFastQueryIsAdmittedWhileSlowQueriesHoldGeneralSlots` | Four lane tests; new queue cap/deadline tests |
| Case, substring, wildcard and filtered search | `prox_search_test.go: TestProxSearchMatchesColumnSearch` | Shared-column search fixture (UTC only; no full/live matrix claimed) |
| Exact positive nearest rank at every dimension | `repository/usageevent/analytics_latency_groups_test.go: TestLatencyBreakdownMatchesSQLRanks`, `analytics_latency_groups.go: nearestRank` | Random data versus full sort, 1–1,000 samples; grouped ranks |
| User-agent credentials, cookies, authorization schemes, escaped/unterminated assignments | `usage/persistence_security_test.go`: 34 literal input/expected cases, each with its source test name in `usageCredentialText.json` | Credential text tests, idempotence, all PEM/token formats, safe diagnostics |
| One snapshot; gap/prune/import/rate/normalization coverage | Plan §§2.6–2.7 (new behavior; no CPAMP test falsely claimed) | Concurrent insert after aggregate; coverage conditions |

## S1–S4 review fixes

The original implementation failed these CPAMP parity cases despite the initial
suite passing. The regression suite now includes exact cost objects and ordered
reason arrays, rather than checking only monetary subtotals or reason membership.

- S1: `estimateAggregateCost` passes `usagePresent: null` and uses token-sum
  component semantics, as `pricingTokensForStat`/`pricingTokensForTimelinePoint`
  do. Positive aggregate reasons begin with `usage-presence-unknown` before the
  legacy reason. Zero-only groups combine to unpriced null costs and unpriced
  call counts. Event component flags add no request-only aggregate limitation.
- S2: `estimateRequestCost` shares P4 arithmetic and preserves event presence,
  without aggregate call counts or the legacy-kind reason/status change.
- S3: `analyticsPricing.ts` ports `pricingRowLess` including resolved pricing
  model, tier, context band and UTF-8 byte ordering. Summary/model costs use
  calls-descending model stats; timeline costs use bucket/lexical order. Provider
  costs follow CPAMP's global-stat reuse or provider-specific-query ordering.
  Regressions cover cross-bucket call counts, missing versus unconfigured rates,
  both provider paths and an exact floating-point subtotal sensitive to order.
- S4: worker close/error listeners now remain for the worker lifetime. An idle
  exit invalidates the cache; a regression serves another request on a new
  worker, bounded to one second so a stale-cache failure cannot wait 30 seconds.

**P5b integration:** SQL grouping keys, row fields, schema, request contract and
read-snapshot boundary are unchanged. Pricing now folds those SQL rows into
CPAMP keys `(model, billing model, resolved pricing model, band, tier)`, adding
bucket for timeline or provider for provider-specific pricing. SQL-only flags,
record kind, outcome and the other view dimensions are folded for pricing;
retained-event counters still use the original SQL rows. P5b must feed raw/rollup
rows through this same pricing projection. The earlier benchmark was not rerun
after these fixes; its 30-day miss remains the reason for P5b, not a current-head
performance claim.

Focused follow-up validation: nine suites (the original seven plus P4 pricing
and the new pricing-parity suite), 82 passed / 0 failed, 3,499 assertions.
Targeted ESLint passed with no warnings. One follow-up full verification ran:

```sh
ionice -c3 nice -n10 env PATH=/dev/shm/prox-bun-1.4.3/bun-linux-x64:$PATH TMPDIR=/dev/shm/prox-query-review-verify-temp bun run verify
```

Result: PASS; 3,032 tests passed / 0 failed across 262 files. Lint had zero errors
and the same six existing React Refresh warnings. TypeScript, source-manifest
validation, the single-file UI, history bundle and all usage worker bundles
passed. The shared `node_modules` symlink was preserved. No new benchmark, live
query, deployment, or response-matrix claim is made for this follow-up.

## Evidence limits and integration notes

CPAMP detail assigns `Provider` from `row.AuthProviderSnapshot` and `TraceID` from
`row.HeaderTraceID` in `service/monitoring/prox.go: proxRequest`. P1 retains the
payload provider and payload `trace_id`, not those two snapshots. P5 returns
those stored values; its test names the provenance and makes no parity claim for
rows where they differ. P6 must inspect the imported/live comparison.

Search was first limited to the columns P1 stored. Later migrations store the rest of
CPAMP's search document (failure text, trace id, credential file, endpoint,
forwarded-for, masked source, credential provider and project, quota plan, header error
kind and code), so only CPAMP's three internal hashes are not searchable (`server/usage/RULES.md`,
Search). It searches the stored fields and the requested execution/session ids; no
trigram index, projection table or legacy adapter is added.

Deployment must provide an approved rate file at `/data/usage-rates.json` or set
`PROX_USAGE_RATES_PATH`; P5 does not change deploy files or install rates. The
`build:usage` edit only adds the query worker and uses `[name].js` so writer and
query outputs keep distinct names.

## Pipeline-health evidence

- **CI at merge:** NOT-RUN — this change is submitted as an open PR, not merged.
- **Post-merge validation:** NOT-RUN — no merge or deployment is part of this task.
- **Error-log baseline (live service, deployment window):** NOT-RUN — no live
  service or runtime logs were touched; no threshold result is claimed.
