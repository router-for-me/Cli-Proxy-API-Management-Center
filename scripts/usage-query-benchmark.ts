// Reproducible synthetic P5 budget check. Every database/key is temporary and lives in tmpfs.
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HOUR_MS, DAY_MS } from '../server/usage/aggregate';
import { queryAnalytics } from '../server/usage/analytics';
import { validateAnalyticsQuery } from '../server/usage/validate';
import { UsageStore, openUsageReader } from '../server/usage/store';
import { createAnalyticsHandler } from '../server/usage/handler';
import { parseRateBook, priceRevision } from '../server/usage/rates';
import { event, BASE as P5_BASE } from '../tests/helpers/usageAnalytics';

// Preserve P5's UTC day/hour phase (21:20), anchoring the end in the past. Both boundary
// hours remain partial raw reads, even after every closed hour has been rebuilt.
const nowHour = Math.floor(Date.now() / HOUR_MS) * HOUR_MS;
let end = Math.floor(nowHour / DAY_MS) * DAY_MS + (P5_BASE % DAY_MS);
if (end > nowHour) end -= DAY_MS;
const BASE = end - 30 * DAY_MS;
const directory = mkdtempSync('/dev/shm/prox-query-budget-');
const dbPath = join(directory, 'usage.sqlite');
const keyFile = join(directory, 'key');
writeFileSync(keyFile, 'synthetic-benchmark-key');
const store = new UsageStore({ events: dbPath, raw: null });
const models = Array.from({ length: 40 }, (_, i) => `synthetic-model-${i}`);
const baseRates = { input: 2, output: 10, cache_read: 0.1, cache_write: 2.5 };
const book = parseRateBook({
  version: 1,
  models: Object.fromEntries(
    models.map((name) => [
      name,
      {
        ...baseRates,
        context_tiers: [
          { above_input_tokens: 272000, input: 4, output: 15, cache_read: 0.2, cache_write: 5 },
        ],
        service_tiers: [
          { names: ['priority', 'fast'], input: 4, output: 20, cache_read: 0.2, cache_write: 5 },
        ],
      },
    ])
  ),
});
const snapshot = {
  book,
  price_revision: priceRevision(book),
  loaded_at_ms: BASE,
  checked_at_ms: BASE,
  error: null,
};
const handler = createAnalyticsHandler({ dbPath, keyFile, rateBook: { load: () => snapshot } });
const rows = 32000 * 30;
const prototype = event(0);
const makeEvent = (i: number, timestamp: number) => {
  // Stable non-correlated variation across model, credential, client, tier and context band.
  const hash = Math.imul(i + 1, 2654435761) >>> 0;
  const model = models[hash % 40];
  const input =
    Math.floor(hash / 19200) % 10 === 0 ? 272001 + (hash % 200000) : 1000 + (hash % 200000);
  const output = 100 + (hash % 4000);
  return {
    ...prototype,
    executionId: `synthetic-execution-${i}`,
    tsMs: timestamp,
    model,
    billingModel: model,
    requestedModel: `${model}(high)`,
    provider: hash % 3 ? 'codex' : 'claude',
    instance: hash % 3 ? 'codex-primary' : 'claude-primary',
    account: `account-${Math.floor(hash / 40) % 6}`,
    accountLabel: `Account ${Math.floor(hash / 40) % 6}`,
    apiKeyHash: `${Math.floor(hash / 240) % 5}`.padStart(64, '0'),
    userAgent: `client-${Math.floor(hash / 240) % 5}/1.0`,
    tier:
      Math.floor(hash / 960) % 20 < 14
        ? 'standard'
        : Math.floor(hash / 960) % 20 < 18
          ? 'priority'
          : 'fast',
    latencyMs: 100 + (hash % 90000),
    ttftMs: hash % 11 ? hash % 10000 : null,
    failed: hash % 23 === 0,
    tokens: {
      inputTotal: input,
      inputUncached: input - 700,
      cacheRead: 600,
      cacheWrite: 100,
      outputTotal: output,
      reasoning: Math.floor(output / 3),
      total: input + output,
    },
  };
};
let ingestTimer: ReturnType<typeof setInterval> | undefined;
try {
  console.log(JSON.stringify({ stage: 'populate', rows, path: directory, runtime: Bun.version }));
  const start = performance.now();
  for (let i = 0; i < rows; i += 1000) {
    store.insert(
      Array.from({ length: Math.min(1000, rows - i) }, (_, n) => ({
        event: makeEvent(i + n, BASE + Math.floor(((i + n) * 30 * 86400000) / rows)),
        raw: null,
      })),
      0
    );
    if (i % 160000 === 0) {
      console.log(JSON.stringify({ stage: 'inserted', count: i + 1000 }));
      await Bun.sleep(0);
    }
  }
  console.log(JSON.stringify({ stage: 'populated', ms: performance.now() - start }));
  // Measure WAL bytes for one representative hour on a separate tiny synthetic store.
  // Closing/reopening checkpoints the seed writes, so the first rebuild starts with an empty WAL.
  const probePath = join(directory, 'write-probe.sqlite');
  const probeHour = Math.floor(BASE / HOUR_MS) * HOUR_MS;
  let probe = new UsageStore({ events: probePath, raw: null });
  try {
    const count = Math.ceil(rows / (30 * 24));
    probe.insert(
      Array.from({ length: count }, (_, i) => ({
        event: makeEvent(i, probeHour + Math.floor((i * HOUR_MS) / count)),
        raw: null,
      })),
      0
    );
    probe.close();
    probe = new UsageStore({ events: probePath, raw: null });
    let before = statSync(probePath + '-wal').size;
    const initial = probe.rebuildNextHour(book)!;
    console.log(
      JSON.stringify({
        stage: 'write-cost',
        mode: 'initial',
        ...initial,
        walBytes: statSync(probePath + '-wal').size - before,
        walBytesPerRow: (statSync(probePath + '-wal').size - before) / initial.rows,
      })
    );
    probe.insert([{ event: makeEvent(rows + 999, probeHour + 1), raw: null }], 2);
    before = statSync(probePath + '-wal').size;
    const replacement = probe.rebuildNextHour(book)!;
    console.log(
      JSON.stringify({
        stage: 'write-cost',
        mode: 'replacement',
        ...replacement,
        walBytes: statSync(probePath + '-wal').size - before,
        walBytesPerRow: (statSync(probePath + '-wal').size - before) / replacement.rows,
      })
    );
  } finally {
    probe.close();
  }
  const rollupStart = performance.now();
  let rollupRows = 0;
  let sampleBytes = 0;
  let hours = 0;
  for (;;) {
    const result = store.rebuildNextHour(book);
    if (!result) break;
    rollupRows += result.rows;
    sampleBytes += result.sampleBytes;
    if (!result.rows) continue;
    hours++;
    if (hours % 120 === 0) {
      console.log(JSON.stringify({ stage: 'rollup', hours, rollupRows }));
      await Bun.sleep(0);
    }
  }
  console.log(
    JSON.stringify({
      stage: 'rolled-up',
      ms: performance.now() - rollupStart,
      hours,
      rollupRows,
      sampleBytes,
      sampleBytesPerRow: sampleBytes / rollupRows,
    })
  );
  let inserted = rows;
  ingestTimer = setInterval(() => {
    // About 34k/day live ingest is 0.4/s; use 4/s while measuring for a conservative check.
    store.insert([{ event: makeEvent(inserted++, BASE + 30 * 86400000 - 1), raw: null }], 0);
  }, 250);
  // `--search <term>` (repeatable) measures 30-day searches for those terms instead of the views.
  const searches = process.argv.flatMap((arg, i) => (arg === '--search' ? [process.argv[i + 1]] : []));
  const request = (days: number, granularity: 'day' | 'hour', search?: string) =>
    new Request('http://127.0.0.1/v1/analytics', {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic-benchmark-key' },
      body: JSON.stringify({
        from_ms: BASE + (30 - days) * 86400000,
        to_ms: BASE + 30 * 86400000,
        time_zone: 'UTC',
        granularity,
        outcome: 'all',
        limit: 100,
        ...(search ? { search } : {}),
      }),
    });
  const views: readonly (readonly [number, 'day' | 'hour', string?])[] = searches.length
    ? searches.map((term) => [30, 'day', term] as const)
    : [
        [1, 'hour'],
        [30, 'day'],
        [30, 'hour'],
      ];
  for (const [days, granularity, search] of views) {
    if (process.argv.includes('--profile')) {
      const db = openUsageReader(dbPath);
      let phaseStart = performance.now();
      try {
        const result = queryAnalytics(
          db,
          validateAnalyticsQuery({
            from_ms: BASE + (30 - days) * DAY_MS,
            to_ms: BASE + 30 * DAY_MS,
            time_zone: 'UTC',
            granularity,
            outcome: 'all',
            limit: 100,
          }),
          snapshot,
          {
            onPhase(phase) {
              const now = performance.now();
              console.log(
                JSON.stringify({ stage: 'profile', days, granularity, phase, ms: now - phaseStart })
              );
              phaseStart = now;
            },
          }
        );
        console.log(JSON.stringify({ stage: 'profile-result', calls: result.summary.calls }));
      } finally {
        db.close();
      }
      continue;
    }
    const durations: number[] = [];
    for (let run = 0; run < 53; run++) {
      const at = performance.now();
      const response = await handler(request(days, granularity, search));
      if (response.status !== 200) throw new Error(await response.text());
      await response.text();
      const ms = performance.now() - at;
      if (run >= 3) durations.push(ms);
      if (run % 10 === 0) console.log(JSON.stringify({ stage: 'run', days, granularity, run, ms }));
    }
    durations.sort((a, b) => a - b);
    const budget_ms = days === 1 ? 150 : 1000;
    const passed = durations[47] < budget_ms;
    if (!passed) process.exitCode = 1;
    console.log(
      JSON.stringify({
        stage: 'result',
        synthetic: true,
        days,
        granularity,
        search,
        rows,
        warmRuns: 50,
        budget_ms,
        passed,
        p50_ms: durations[24],
        p95_ms: durations[47],
        max_ms: durations[49],
        concurrentIngest: inserted - rows,
      })
    );
  }
} finally {
  if (ingestTimer) clearInterval(ingestTimer);
  handler.close();
  store.close();
  rmSync(directory, { recursive: true, force: true });
}
