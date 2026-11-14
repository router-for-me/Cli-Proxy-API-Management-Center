// The per-column search probe: term derivation, and a full run over synthetic CPAMP and Prox
// stores that agree, then over ones that do not. Synthetic data only.
import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  deriveTerms,
  distinctiveSlice,
  probeMarkdown,
  probeSearchColumns,
  SEARCH_COLUMNS,
} from '../scripts/usage-parity/searchProbe';
import { SEARCH_SEGMENTS } from '../scripts/usage-parity/searchCpampOnly';
import type { NormalizedEvent } from '../server/usage/types';
import { analyticsStore, BASE, event } from './helpers/usageAnalytics';

const window = { from_ms: BASE, to_ms: BASE + 86_400_000 };
const doc = (fields: Record<number, string>) =>
  Array.from({ length: SEARCH_SEGMENTS }, (_, i) => fields[i] ?? '').join('\x1f');

describe('term derivation', () => {
  test('a term is a slice of the longest ordinary run of the value, never a wildcard', () => {
    expect(distinctiveSlice('short')).toBe('short');
    expect(distinctiveSlice('a'.repeat(30))).toBe('a'.repeat(12));
    expect(distinctiveSlice('rate_limit')).toBe('limit');
    expect(distinctiveSlice('100%_x')).toBe('100');
    expect(distinctiveSlice('___')).toBeNull();
    expect(distinctiveSlice('  ab  cd  ')?.trim()).toBe('ab  cd');
  });
  test('it comes from the rarest value of each column and skips a column without any', () => {
    const docs = [
      { text: doc({ 2: 'common-model', 6: 'post /v1/messages' }) },
      { text: doc({ 2: 'common-model', 6: 'get /v1/responses' }) },
      { text: doc({ 2: 'rare-model-name', 6: 'get /v1/responses' }) },
    ];
    const { terms, skipped } = deriveTerms(docs);
    // Twelve characters from the middle of the rarest value.
    expect(terms.find((t) => t.column === 'model')).toMatchObject({ term: 'are-model-na', valueEvents: 1 });
    expect(terms.find((t) => t.column === 'endpoint')).toMatchObject({ term: 'st /v1/messa', valueEvents: 1 });
    expect(skipped.get(10)).toBe('no event of the window holds a value');
    expect(terms.map((t) => t.column)).not.toContain('x_forwarded_for');
    expect(SEARCH_COLUMNS).toHaveLength(SEARCH_SEGMENTS);
  });
  test('a document of any other layout is refused', () => {
    expect(() => deriveTerms([{ text: 'a\x1fb' }])).toThrow('layout');
  });
});

describe('probe', () => {
  let f: ReturnType<typeof analyticsStore>;
  let cpamp: Database;
  afterEach(() => {
    f?.close();
    cpamp?.close();
  });
  const document = (e: NormalizedEvent, requestEvent = e): string =>
    [
      requestEvent.requestId,
      `hash-of-${e.executionId}`,
      e.requestedModel,
      e.requestedModel,
      e.model,
      e.billingModel,
      e.endpoint,
      e.method,
      e.path,
      e.clientIp,
      e.xForwardedFor,
      e.userAgent,
      e.source,
      `source-hash-${e.account}`,
      e.apiKeyHash,
      e.authIndex,
      e.account,
      e.accountLabel,
      e.authFile,
      e.authProvider,
      e.authProject,
      e.effort,
      e.tier,
      e.executor,
      e.failSummary,
      e.quotaPlan,
      e.errorKind,
      e.errorCode,
      e.headerTraceId,
    ]
      .map((value) => (value ?? '').toLowerCase())
      .join('\x1f');
  function setup(events: NormalizedEvent[], cpampDocs = events.map((e) => document(e))) {
    f = analyticsStore();
    f.insert(events);
    cpamp = new Database(':memory:');
    cpamp.exec(`CREATE TABLE usage_events (id INTEGER PRIMARY KEY, raw_json TEXT);
      CREATE TABLE usage_monitoring_event_projection_v1 (event_id INTEGER PRIMARY KEY,
        timestamp_ms INTEGER NOT NULL, search_text TEXT NOT NULL);`);
    events.forEach((e, i) => {
      cpamp.query('INSERT INTO usage_events VALUES (?, ?)').run(i + 1, JSON.stringify({ execution_id: e.executionId }));
      cpamp
        .query('INSERT INTO usage_monitoring_event_projection_v1 VALUES (?, ?, ?)')
        .run(i + 1, e.tsMs, cpampDocs[i]);
    });
  }
  const full = (index: number): NormalizedEvent =>
    event(index, {
      requestId: `req-needle-${index}`,
      endpoint: `POST /v1/route-${index}`,
      xForwardedFor: `203.0.113.${index}, 198.51.100.8`,
      source: `src***@fleet${index}.example`,
      authProvider: `provider${index}x`,
      authProject: `project-${index}-z`,
      quotaPlan: `plan${index}pro`,
      errorKind: `kind${index}`,
      errorCode: `code${index}`,
      headerTraceId: `trace-${index}-abc`,
      failSummary: `failure number ${index}`,
      authFile: `file-${index}.json`,
    });

  test('Prox and CPAMP agree on every probed column: nothing is unexplained', () => {
    setup([full(1), full(2), full(3)]);
    const report = probeSearchColumns(cpamp, f.db, window);
    const unexplained = report.columns.filter((c) => c.unexplained);
    expect(unexplained).toEqual([]);
    expect(report.unexplained).toBe(0);
    expect(report.events).toBe(3);
    // Every column the events fill is probed and finds the same events on both sides.
    for (const column of ['endpoint', 'x_forwarded_for', 'source', 'auth_provider_snapshot', 'auth_project_id_snapshot', 'header_quota_plan_type', 'header_error_kind', 'header_error_code']) {
      const result = report.columns.find((c) => c.column === column)!;
      expect(result.skipped, column).toBeUndefined();
      expect(result.cpamp, column).toBeGreaterThan(0);
      expect([result.prox, result.both], column).toEqual([result.cpamp, result.cpamp]);
    }
    expect(probeMarkdown(report)).toContain('0 unexplained');
    expect(probeMarkdown(report)).not.toContain('fleet1');
  });

  test('a field CPAMP holds and Prox lacks is unexplained, a hash only CPAMP holds is not', () => {
    const events = [full(1), full(2)];
    setup(events);
    // Prox loses the source of event 1: CPAMP still matches on it.
    f.db.close();
    const writer = new Database(f.path);
    writer.exec(`UPDATE events SET source_id = NULL WHERE seq = 1`);
    writer.close();
    f.db = new Database(f.path, { readonly: true });
    const report = probeSearchColumns(cpamp, f.db, window);
    expect(report.columns.find((c) => c.column === 'source')).toMatchObject({ cpampOnlyUnexplained: 1, unexplained: 1 });
    expect(report.unexplained).toBe(1);
    // The hash columns match through documents only: all of that is explained.
    const hash = report.columns.find((c) => c.column === 'event_hash')!;
    expect(hash.cpampOnlyByHash).toBeGreaterThan(0);
    expect(hash.unexplained).toBe(0);
    expect(report.columns.find((c) => c.column === 'source_hash')!.unexplained).toBe(0);
  });

  test('a Prox match through a field CPAMP lacks is explained, any other extra match is not', () => {
    // Event 3 holds the term of auth_provider_snapshot in its record provider, which CPAMP's
    // document does not carry (it has the credential's provider instead).
    const quiet = { requestId: null, endpoint: '-', source: null, accountLabel: null, authFile: null };
    const ev3 = event(3, { ...quiet, provider: 'provider1x' });
    const events = [full(1), full(2), ev3];
    setup(events);
    const explained = probeSearchColumns(cpamp, f.db, window);
    expect(explained.columns.find((c) => c.column === 'auth_provider_snapshot')).toMatchObject({
      term: 'provider1x',
      proxOnlyByProxOnlyField: 1,
      proxOnlyUnexplained: 0,
    });
    expect(explained.unexplained).toBe(0);
    f.close();
    cpamp.close();
    // The same extra match through the account label, which CPAMP's document drops here, is not.
    const labelled = event(3, { ...quiet, accountLabel: 'provider1x label' });
    setup(
      [full(1), full(2), labelled],
      [full(1), full(2), labelled].map((e, i) => document(i === 2 ? { ...e, accountLabel: null } : e))
    );
    const unexplained = probeSearchColumns(cpamp, f.db, window);
    expect(unexplained.columns.find((c) => c.column === 'auth_provider_snapshot')).toMatchObject({
      proxOnlyUnexplained: 1,
    });
    expect(unexplained.unexplained).toBeGreaterThan(0);
  });
});
