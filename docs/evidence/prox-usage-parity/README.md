# P6 parity harness

This directory contains the original P6 synthetic plumbing evidence from PR #76,
not a live cutover verdict. That PR ran no live comparison. The later read-only
event recheck is documented in [the follow-up](../prox-usage-event-followup/README.md).
Neither database was changed, and neither systemd template was installed or enabled.

The harness is `scripts/usage-parity.ts`. Run it from the repository root with
Bun 1.4.3. It writes a JSON report and a short Markdown report to this directory;
`--output` selects another prefix. Exit 0 means the selected comparisons have no
unexplained differences. Unexplained differences or failures exit 1; UTC deadline/forbidden-window
stops exit 2 with `status=incomplete`, `complete=false` and a termination reason;
interruption exits 130 with partial evidence. A sampled run cannot establish the two clean nights/full matrices
required for cutover.

## Matrix source and accounting

The coordinator confirmed that the checked-in Go generators are authoritative.
They were read from `/home/swerve/Projects/CPA-Manager-Plus`, clean at commit
`52b12b45e010a766bd69ff55a55e566263d8bede`, under
`apps/manager-server/internal/service/monitoring/`:

- `prox_provider_rollup_test.go`, blob `2afc0df2b51c53f78baa4df9c2f201f92aaf0808`.
- `prox_search_test.go`, blob `0b739689d4f647356ea79aabaf0de4418127a1c4`.

| Mode | Plan count | Generated base queries | Pages and actual maximum | Reconciliation |
| --- | ---: | --- | --- | --- |
| Quick | 720 | 5 providers × 2 models × 3 outcomes × 2 searches × 4 rotating spans + 24 searches × 3 providers × 2 models × 3 outcomes × 1 rotating span = 240 + 432 = **672** | 672 × 2 pages = **1,344 pairs**; × 2 servers = **2,688 HTTP responses** | No source cases removed. Plan count cannot be reproduced from this version. |
| Full | 22,464 | 5 × 2 × 3 × 2 × 12 spans + 24 × 3 × 2 × 3 × 12 spans = 720 + 5,184 = **5,904** | 5,904 × 2 pages = **11,808 pairs**; × 2 servers = **23,616 HTTP responses** | No source cases removed. Plan count cannot be reproduced from this version. |

The plan calls its figures responses; this table distinguishes base queries,
pairs and HTTP responses. No historical version explaining 720/22,464 was identified;
these are not percentage reductions in the same unit. UTC mapping removes zero
query cases. Granularity/time-zone slots rotate within existing cases and are
not independent factors. Page 2 is an addition to the Go generators.

| Axis | CPAMP rollup generator | CPAMP search generator | Harness |
| --- | --- | --- | --- |
| Ranges | 1, 6, 24, 168, 720, 744 hours × aligned/unaligned = 12; quick chooses 4 with `(floor(span/2)+combination)%3 == 0` | Same 12; quick chooses `combination%12` | Identical selections; requested-window clipping counted separately |
| Buckets/granularities | Hour/day in 8 rotating view slots, 4/4 | Hour/day in 5 rotating slots, 3/2 | Same slot/granularity rotation; factor 1 |
| Outcomes | 3: all, success, failed | Same 3 | Same 3 |
| Providers | 5: empty, claude, CODEX, gemini, nobody | 3: empty, claude, CODEX | Same 5 / 3 |
| Models | 2: empty, shared-model | Same 2 | Same 2 |
| Search terms | 2: empty, needle | 24 | Same 2 / 24 slots; three fixture-only terms replaced as below |
| Time zones | 5 distinct zones across 8 view slots | 5 distinct zones across 5 view slots | Every slot mapped to UTC; **0 cases dropped**, factor 1 |
| Pages | 1 | 1 | First page plus second when both have it; each backend's own cursor |

The rollup catalog entry (`instance`, `Instance`, `claude`, `claude-only`) is also
preserved. Search slots targeting CPAMP-only project/failure data are replaced:
`acct-needle` → `session-needle`, `proj-needle ` → `trace-needle `, and `team ` →
`priority`. All 24 search slots remain, including LIKE wildcards, quotes, Unicode,
case variants and no-match terms. These are column probes; live data need not
contain every fixture term.

A second page present on only one backend is an unexplained paging difference.
If neither has one, the report counts it as absent on both. `--limit` counts
pairs including page 2; `--sample` selects evenly spaced base cases. Reports
include compared/equal/unexplained pair counts, known pair counts per rule
(which can overlap), and separate counts of individual differing fields/events.

## Rules checked

Event reads start no earlier than `2026-11-12T21:16:05Z`. They force CPAMP's
`idx_usage_events_timestamp` in windows of at most five minutes, with keyset
pages of at most 1,000 rows. Both handles use `file:...?mode=ro`, read-only flags,
`PRAGMA query_only=1`, memory temp storage and disabled mmap. There is no import,
reconcile, checkpoint, backup or update operation in this harness.

The event projection compares timestamp, provider, model/requested/billing
models, tier, failure/status, latency, TTFT, seven token counters, flags, record
kind, account, account label and client-key hash. The CPAMP reference is independent
of Prox's normalizer/import mapper. Persisted columns supply every value that
CPAMP stores, including `service_tier`; the raw payload cannot replace them.
Metadata-only fields follow CPAMP's Go parser. All subscribed Prox-only events fail.

| Compared field | CPAMP reference |
| --- | --- |
| Timestamp, provider, failed, status | Persisted `timestamp_ms`, `provider`, `failed`, `fail_status_code` unchanged |
| Requested/canonical model | Persisted `requested_model` with `model` fallback; CPAMP's `AnalyticsModelForRequest` suffix contract for canonical identity |
| Billing model | Persisted `resolved_model`, else the effective persisted requested model |
| Tier | Persisted `service_tier` (`NULL` is CPAMP's empty tier); raw requested/effective/response tiers are never consulted |
| Seven token counters | Persisted normalized input/cache columns plus output/reasoning/total; never raw payload counters |
| Latency and TTFT | Persisted measurements, with only the counted CPAMP TTFT 0 → Prox null exception below |
| Account | CPAMP exporter SQL semantics: `coalesce(nullif(account_snapshot,''),auth_label_snapshot,auth_index)`; empty label remains empty |
| Account label, client-key hash | Persisted `auth_label_snapshot`, `api_key_hash` unchanged; no trimming or recasing |
| Metadata-only identifiers, flags and record kind | Allowlisted envelope metadata decoded independently under CPAMP's Go contract, including its whitespace rules |

This oracle intentionally does not reuse the Prox algorithm it audits. Column
projection and metadata-key schema facts are shared; expected accounting is not.
Forward CPAMP→Prox matches compare all fields for every ingest kind: subscribed,
drained, imported (including reconciled), and replayed. `matched_by_ingest` counts
accepted matches; `exact_matched` excludes known TTFT equivalences. Only subscribed
Prox-only rows fail the reverse check; `reverse_only_omitted_by_ingest` separately
counts other reverse-only rows, without excluding them from forward matches.
No credential-label timing exception is assumed.

Explicit counted rules:

- `ttft-zero-null`: CPAMP persisted `ttft_ms=0` and Prox `ttft_ms=null` are
  equivalent only when CPAMP's independent metadata decoder establishes
  `unknown` or `unavailable` instrumentation. Measured zero under `first-byte`,
  `substantive-content` or `fallback-packet` remains unexplained. Each difference
  is retained and counted. Reverse null→0, other
  values and all latency differences remain unexplained. CPAMP's writer preserves
  supplied zeros for both measurements; this rule deliberately covers TTFT only.
- `ingest-gap`: missing Prox event whose persisted completion (`timestamp_ms +
  latency_ms`) falls inside an existing recorded half-open gap for the same instance,
  with **zero tolerance**. Completion at the end or outside either bound fails.
  Positive safe integer latency is required. No interval is inferred from a restart.
  The recorded interval and completion stay in evidence.
- `drained-during-cpamp-outage`: optional provenance for a reverse-only drained row,
  requiring a supplied CPAMP outage with the same instance and start time. Such
  rows are outside the subscribed reverse cohort regardless of provenance.
- `detail-provider`: only `requests.items[].provider`, payload versus credential
  snapshot, as documented by P5 PR #71. Aggregate/filter differences still fail.
- `detail-trace`: only `requests.items[].trace_id`, payload versus response-header
  provenance from the same P5 documentation. Other detail fields remain exact.
- `coverage-limitations`: every CPAMP sentence except the exact successive-reads
  sentence must remain. Extras must be one of the exact §2.7 condition sentences
  (restart/in-flight, imported history, rate-book load failure, unknown provider)
  or the anchored known-gap/pruned-history form. Gap intervals must overlap the
  response range; gap/prune claims require incomplete raw coverage. Missing
  fixed sentences, arbitrary extras and duplicates remain unexplained. Sentence
  order may differ under this counted rule; both complete arrays are retained.
- `d5-pricing`: only cost/rate differences reproduced by two local read-only
  `queryAnalytics` replays over Prox: the approved deployed rate book, then that
  same book with only `claude-fable-5-2` and `gpt-6.1-terra` removed. Both observed
  values must match their replay. This prevents blanket exemptions for totals
  that contain a newly priced model. Replays also pass through the IO gate.
- `search-cpamp-only`: a deliberate product difference. CPAMP keeps one search document
  of 29 fields per event; a term matches one field at a time (a `%`/`_` wildcard never
  bridges two fields). Prox matches its stored fields, which now include the failure
  text, the response-header trace id, the credential file name and eight more fields
  (endpoint, forwarded-for, masked source, credential provider and project, quota plan,
  header error kind and code; `server/usage/RULES.md`, Search). A user still cannot find
  an event in Prox by CPAMP's internal hashes (event, source and API key hash).
  Conversely Prox also searches execution, session, parent-session
  and trace IDs by substring, which CPAMP's document lacks, so a hex-like or wildcard
  term returns events in Prox that CPAMP does not. The unsearchable fields are a
  closed list in `scripts/usage-parity/searchCpampOnly.ts`: `event_hash`, `source_hash`
  and `api_key_hash`, CPAMP's own hashes (Prox does hold the API key hash and searches it).
  `scripts/usage-search-probe.ts` proves the rest column by column.
  Adding a
  field needs a code change and a test. A search pair with unexplained differences is
  checked in three steps, all read-only. (1) CPAMP's own database lists the events in
  the range that CPAMP matches through one of those fields while no other field matches
  the term; an unexpected document layout or an event without an execution ID proves
  nothing. (2) Those events map to Prox by execution ID; any one missing from Prox
  proves nothing. (3) The same Prox query is replayed searching as CPAMP's document does
  (among identifiers only the request ID, failure text and response trace id, plus the
  credential file dimension) with exactly those events added to the match
  (provider, model and outcome filters still apply; page 2 starts at the replay's own
  cursor). A difference is known only if CPAMP's value equals the replay's and Prox's
  served value equals an independent plain replay of the same query (so drift on the
  Prox side is never excused); a one-sided second page needs both backends'
  availability to match their replays; objects compare irrespective of key order, with
  `provider` and `trace_id` of a whole request item left to their own rules. Any other
  difference in the pair stays unexplained, and an event that matches through a stored
  field is never claimed, so a Prox miss there stays a failure. Needs `--cpamp-db`,
  read-only.

Response normalization removes only `generated_at_ms`, `coverage.price_revision`,
request item `id`, and `requests.next_before_id`, and the request item members
`fail_summary`, `header_trace_id` and `auth_file_snapshot` (CPAMP's Prox-shaped response
has none; the event comparison checks those stored values); permits item reordering only
inside equal-timestamp groups; and allows relative error only at `cost.usd` (1e-9)
and `average_latency_ms` (1e-12), with no absolute epsilon at zero. Prox's mean is the
correctly rounded quotient of integer sums; CPAMP's is occasionally one ulp (about
2e-16) away, and 1e-12 is far below any real difference. Every integer, p95 and
pricing reason stays exact; other coverage fields stay exact outside the explicit limitations
rule. Known differences remain in the report with both values.

## Running it

```sh
# Nightly window, event comparison plus the source quick matrix.
ionice -c3 nice -n10 bun scripts/usage-parity.ts --previous-utc-day --deadline 12:00Z

# Operator-selected smoke: at most 20 response pairs, no event scan.
# Replace timestamps with a settled window; after 21:20 UTC on the dual-run day.
ionice -c3 nice -n10 bun scripts/usage-parity.ts \
  --from 2026-11-12T21:20:00Z --to 2026-11-12T21:40:00Z \
  --level responses --limit 20 --sample 10

# Full source coverage: include the earliest ALIGNED 31-day start.
# Supply settled FROM/TO values and run only when the coordinator schedules it.
ionice -c3 nice -n10 bun scripts/usage-parity.ts \
  --from "$PARITY_FROM" --to "$PARITY_TO" --matrix full --deadline "$PARITY_DEADLINE"
```

Each query waits for `/proc/pressure/io` **full avg10 < 5** and for a default
2-second gap after the previous query completes. There is one operation in
flight, no automatic expensive retry, and DB reads are additionally paced by the
shared 4 MB/s byte governor. Missing PSI fails closed. `--min-gap-ms` is configurable;
the synthetic fixtures use zero and fake PSI. Cancellation interrupts pressure,
pacing and fetch waits. HTTP queries have a 30-second deadline and do not follow
redirects. Endpoints must be loopback HTTP. Key files are read inside the process
and never enter reports, errors or command arguments.

UTC admission is forbidden during **01:00–04:00** and **12:20–12:50**. A run
stops at the next forbidden boundary, even after a large wall-clock jump. An
optional `--deadline` can stop it earlier; `12:00Z` means today's noon UTC,
including for a delayed start after noon. Deadlines abort in-flight fetches and
PSI/pacing waits. Already executing synchronous SQLite work reaches its next
check before the run closes; no subsequent harness query is admitted. Reports
retain partial counts and `complete=false`; exit 2 distinguishes this from a
completed comparison with unexplained differences (exit 1). `complete=true`
only describes the selected run, not full cutover coverage.

Default DBs are `~/.local/share/cpa-manager-plus/usage.sqlite` and
`~/.local/share/prox-usage/usage.sqlite`; bearer files are
`~/.config/prox/cpa-admin-key` and
`~/.config/cli-proxy-rerank/management-key`. The default D5 witness book is
`~/.local/share/prox-usage/usage-rates.json`; use `--rate-book` for another deployed path.
`--cpamp-outages` accepts a JSON array of
`{from_ms,to_ms,instance,reason}`; an interval needs an operational reason, not a
guessed gap. All paths/endpoints have documented `--help` overrides.

The sole nightly timer is `deploy/prox-usage-nightly.timer`, at **04:20 UTC** with
`Persistent=false`, calling the oneshot `prox-usage-nightly.service` under
`ionice -c3 nice -n10`. `scripts/usage-nightly.ts` runs **prune → reconcile →
optional backup → parity**, polling `GET /v1/jobs` every ten seconds until each
job succeeds and finishes cleanup. Failed/cancelled jobs, replaced IDs, HTTP
errors and nonzero parity stop the chain. It uses the existing PSI/serial query
gate and UTC guard: every step and wait stops at today's **12:00 UTC** or a
forbidden boundary; active jobs receive a bounded cancellation request. Delayed
starts never roll noon into tomorrow. Cancellation cannot prove a stopped job
until its terminal report is observed; an unsuccessful request is reported as
unconfirmed and no subsequent work starts.

Backup is **off by default** (`PROX_USAGE_ENABLE_PACED_BACKUP=0`); only set it to
`1` via a service override after the paced snapshot and restore gates land.
The standalone parity service remains manual, with `RuntimeMaxSec=5h30min`;
the chain applies that same parity runtime cap and passes an absolute noon
cutoff. `TimeoutStartSec=7h40min` backs the whole oneshot chain. The previous
prune/reconcile/backup/parity timers are no longer shipped. The deploy script
copies the sole timer disabled and retires legacy timers on upgrades: disable/stop,
remove unit/enable link, then daemon-reload. Missing units are tolerated; manager
errors stop deployment. Per-job manual units remain available. The units run the
bundles deploy installs in `~/.local/share/prox/usage-jobs/` (see `docs/PROX-SETUP.md`), with
evidence written to `~/.local/share/prox/usage-evidence/`. This work enables nothing.

A read-only `GET /v1/jobs` observation before event comparison reports whether the
latest retained job confirms completed exact import/reconcile covering this window's
CPAMP IDs, started at least ten minutes after its end. Missing, overwritten, stale
or unavailable reports mean **not confirmed/unknown**, never proof that no reconcile
ran. This note cannot turn event differences into matches or block comparison.

Live follow-up evidence for TTFT and ingest matching is in
[../prox-usage-event-followup/README.md](../prox-usage-event-followup/README.md).

## Verification

Focused tests use only temporary `/dev/shm` databases and ephemeral fake HTTP
servers, then delete them. They cover every event field (including exporter
labels), 1,001 tied timestamps across a keyset boundary, read-only enforcement,
both event directions, bounded index enforcement, each exception rule, second
page disagreement and backend-specific cursors, exact normalization, IO gating,
serialization, cancellation, failed responses, private credentials, nightly sequencing and CLI/unit
contracts. The committed JSON/Markdown examples below are generated by these
same harness functions. The fixture passes its fake job-server URL and synthetic key
explicitly, and asserts both job-status requests arrive. A test preload blocks
ports 18317/18320/8317/8319 through fetch and TCP, failing the test even if the
caller catches the network error. The server calculations are synthetic plumbing checks,
not an independent validation of CPAMP arithmetic.

| Committed synthetic artifact | Compared / equal pairs | Known rules | Unexplained | Expected result |
| --- | --- | --- | ---: | --- |
| `synthetic-equal.{json,md}` | 2 / 2 | None | 0 | Pass |
| `synthetic-known.{json,md}` | 2 / 0 | 2 pairs each for D5, provider, trace and coverage; 86 D5 fields, 6 provider fields, 6 trace fields, 2 coverage fields | 0 | Pass with counted exceptions |
| `synthetic-unexplained.{json,md}` | 1 / 0 | None | 1 pair / 4 fields, including one-sided page 2 | Fail, intentionally injected |
| `synthetic-incomplete.{json,md}` | 0 / 0 | Expired UTC deadline, no queries | 0 | Incomplete, exit code 2 |
| `synthetic-persisted-tier.{json,md}` | Event fixture; 1 matched | Same gap/drain exceptions as the event fixture | 1 persisted-tier difference (`priority` / `standard`) | Fail, intentionally injected |
| `synthetic-events.{json,md}` | 3 source rows / 3 target rows; 2 matched | 1 ingest-gap event and 1 documented drain event | 0 | Pass with counted exceptions |

The helpers use an injected clock and fake PSI. Reproduce the artifacts with:

```sh
ionice -c3 nice -n10 bun tests/helpers/usageParityEvidence.ts
```

Initial implementation checks used Bun **1.4.3** (`c6da4a4d3`). The existing locked dependencies
were reused via a symlink to `/dev/shm/prox-rollup-deps-yskids/node_modules`, after
confirming the lockfiles matched; no install or deletion was performed.

- Focused `bun test tests/proxUsageParity{Compare,Io,Events,Runner}.test.ts`:
  **26 passed, 0 failed**, 6,047 assertions.
- One `ionice -c3 nice -n10 env PATH=/dev/shm/prox-bun-1.4.3/bun-linux-x64:$PATH bun run verify`:
  **3,096 tests passed, 0 failed** across 269 files; lint had 0 errors;
  TypeScript, Vite single-file build, history server and all usage-worker bundles passed.
- That verify run reported eight lint warnings: six existing React Refresh
  warnings and two new unused bindings. The two bindings were then removed
  without changing the comparison. Focused tests, standalone TypeScript and
  changed-file ESLint were rerun successfully; changed-file lint has no warnings.
  The full verify command was run once, as requested.
- Standalone TypeScript also covers the CLI, script modules, four new test
  suites and the evidence generator, which are outside the main application
  tsconfig. Command: `bun x --no-install tsc --ignoreConfig --noEmit --target
  ES2022 --module ESNext --moduleResolution bundler --strict --skipLibCheck
  --types bun scripts/usage-parity.ts tests/proxUsageParity*.test.ts
  tests/helpers/usageParityEvidence.ts` (prefixed with `ionice -c3 nice -n10`).
- A separate real CLI process against ephemeral fake servers received SIGINT:
  **exit 130**, `status=aborted`, partial report written. IO full avg10 was 2.81;
  the temporary script, databases and keys were deleted. An earlier manual
  preflight stopped before any query because PSI was at least 5.
- After PR creation, integrated newer `main` at `7741214b` (P3 worker wiring and
  deployment paths). The import-helper conflict preserves preparation inside the
  governed chunk and uses the exported row type there. **85 tests across nine
  affected parity/import/governor/jobs/writer/service suites passed** (6,443
  assertions), as did `bun run type-check`, standalone script/test TypeScript,
  changed-file ESLint and `bun run build:usage`. The harness default rate book
  now matches deployment at `~/.local/share/prox-usage/usage-rates.json`; its CLI
  regression passed with all nine runner tests after that path adjustment.
- Integrated the subsequent raw-expiry/schedule update at `dbd54039` (PR #74).
  Its only conflict was appended rules documentation; both sections were kept,
  with parity rules moved before the analytics section. **73 tests across eight
  affected parity/store/jobs/service/job-script suites passed** (6,462 assertions).
  Application/server typecheck, standalone script/test TypeScript and usage
  production builds passed again. The harness runtime was unchanged by this
  documentation resolution.
- `git diff --check` passed. No UI route changed, so browser checks do not apply.
No browser route changed. Live smoke, full matrix, two-night evidence and unit
installation remain for the coordinator.


## Review corrections (S1, S2 and coverage)

S1 now compares persisted CPAMP values directly through an independent reference.
Regressions reproduce the previously hidden tier mismatch and cover trimmed,
recased, clamped and substituted values in the other persisted fields. Metadata
parsing is independent too; a CPAMP/JavaScript whitespace difference cannot be
hidden by calling Prox's normalizer on both sides.

S2 adds the absolute UTC deadline, forbidden-window admission and explicit
incomplete result. Fake-clock tests cover delayed starts, long PSI waits, pacing,
both forbidden boundaries and wall-clock jumps. A real CLI subprocess verifies
exit 2 and a written incomplete report before any DB/key/query access. The unit
remains uninstalled and disabled.

The coverage compatibility rule is counted separately and checks required
sentences and every extra condition. Its tests reject missing fixed sentences,
unknown or duplicated extras, malformed/out-of-range gap claims and incompatible
raw-completeness claims. No live comparison was run for these corrections.

Review validation at `649ef21e` used Bun 1.4.3, with every heavy command prefixed by
`ionice -c3 nice -n10`:

- Harness: **43 passed, 0 failed**, 6,162 assertions across the four parity suites.
- Standalone script/test TypeScript and changed-file ESLint: passed, no warnings.
- One new `bun run verify` for this review request: **3,135 passed, 0 failed**
  across 271 files. Lint: 0 errors and the same six existing React Refresh warnings.
  Application/server TypeScript, Vite single-file output, history server and all
  usage-worker builds passed.
- Regenerated synthetic JSON/Markdown through the actual harness functions.
  The persisted-tier fixture fails with `cpamp=priority`, `prox=standard`; the
  cutoff fixture reports `status=incomplete`, `complete=false`, no queries and
  deadline termination; known coverage changes are counted separately.
- `git diff --check` passed. No live comparisons, DB writes, unit installs,
  timer activation or deployment were performed.


## Round 2 correction (N1)

The oracle now fails closed on case aliases or incorrect JSON types in the known
decoded metadata objects (`usage_fields`, timing and token-breakdown subobjects),
and on wrong types in selected metadata values. Such a row is an unexplained
comparison with the fixed reason `non-canonical CPAMP metadata encoding`. It
cannot count as matched or be overwritten by a later valid duplicate. The report
includes the corresponding Prox row without copying the rejected raw metadata.
Canonical nullable timing offsets and unrelated extension keys remain supported.

Validation on Bun 1.4.3: **48 harness tests passed**, 6,233 assertions. The new
regressions include mixed-case/duplicate-case field aliases, the zero-token case
where Prox returns null, wrong types across the decoded objects, nullable/extension
compatibility, and a later duplicate. Standalone script/test TypeScript,
changed-file ESLint and `git diff --check` passed. The last full verification is
the 3,135-test run at `649ef21e` recorded above; this focused N1 request reran the
harness checks. No live comparison, database change or unit activation occurred.
