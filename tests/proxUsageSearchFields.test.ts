// Failure text, response trace id and credential file name: stored, searchable, returned,
// imported and backfilled. Synthetic data only; the keys below are not real credentials.
import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { compareResponses } from '../scripts/usage-parity/compare';
import { queryAnalytics } from '../server/usage/analytics';
import { runCpampJob } from '../server/usage/importCpamp';
import { failSummaryFromBody, normalizeUsagePayload, scrubTraceId } from '../server/usage/normalize';
import { USAGE_MIGRATIONS } from '../server/usage/schema';
import { migrateUsageDatabase, openUsageReader, UsageStore } from '../server/usage/store';
import { INGEST, type AccountLabel, type NormalizedEvent } from '../server/usage/types';
import { createCpamp } from './fixtures/cpampUsage';
import { usagePayload, usagePayloadNumber } from './fixtures/usagePayloads';
import { analyticsStore, event, query, rateState } from './helpers/usageAnalytics';
import { fakeIo } from './helpers/usageIo';

const KEY = `sk-${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'}`;
const AIZA = `AIza${'SyD-1234567890abcdefghijklmnopqrstu'}`;
const BEARER = 'Bearer abcdef0123456789abcdef0123456789';

function normalized(overrides: Record<string, unknown> = {}, label?: AccountLabel) {
  const result = normalizeUsagePayload(JSON.stringify(usagePayload(overrides)), () => label);
  if (result.kind !== 'event') throw new Error('expected an event');
  return result;
}

describe('normalizer: failure text', () => {
  test('is the scrubbed failure body: keys, bearer tokens, cookies and e-mail addresses come out redacted', () => {
    const body = [
      `upstream rejected key ${KEY} and ${AIZA}`,
      `Authorization: ${BEARER}`,
      'Cookie: session=abc123',
      '{"api_key":"plain-secret-value","message":"quota exceeded"}',
      'contact ops@example.test',
    ].join('\n');
    const { event: e, raw } = normalized({ failed: true, fail: { status_code: 429, body } });
    const text = e.failSummary!;
    for (const leaked of [
      KEY,
      AIZA,
      'abcdef0123456789abcdef0123456789',
      'session=abc123',
      'plain-secret-value',
      'ops@example.test',
    ])
      expect(text).not.toContain(leaked);
    expect(text).toContain('quota exceeded');
    expect(text).toContain('o***@example.test');
    // The raw buffer still never keeps the body.
    expect(raw.json).not.toContain('quota exceeded');
  });
  test('secrets held in an array or object value are redacted whole', () => {
    const body = JSON.stringify({
      headers: { Cookie: ['sid=SECRETCOOKIE'], 'X-Api-Key': ['SECRETAPIKEY'], Accept: ['text/html'] },
      auth: { token: { nested: 'SECRETNESTED' } },
    });
    const { event: e } = normalized({ failed: true, fail: { status_code: 401, body } });
    for (const leaked of ['SECRETCOOKIE', 'SECRETAPIKEY', 'SECRETNESTED'])
      expect(e.failSummary).not.toContain(leaked);
    expect(e.failSummary).toContain('text/html');
    expect(failSummaryFromBody(e.failSummary!)).toBe(e.failSummary);
  });
  test('collection redaction is string-aware and covers unquoted keys', () => {
    for (const body of [
      '{"Cookie":["sid=prefix]SECRETVALUE"]}',
      '{"Cookie":["a\\"]SECRETVALUE"]}',
      "{'x-api-key': ['}SECRETVALUE', \"]\"]}",
      'api_key=["SECRETVALUE"]',
      '{"password":"prefix api key=[abc] SECRETVALUE"}',
      "{'password':'prefix api key=[abc] SECRETVALUE'}",
      'password="prefix token: {\\"a\\":1} SECRETVALUE"',
      'api key=["SECRETVALUE"]',
      'upstream api key=["SECRETVALUE"]',
      'the upstream api key: {"v":"SECRETVALUE"}',
      'password: {"a": ["]SECRETVALUE"]} trailing',
      '{"token":["SECRETVALUE"',
    ])
      expect(failSummaryFromBody(body), body).not.toContain('SECRETVALUE');
    expect(failSummaryFromBody('{"accept":["text/html"],"ok":{"a":[1]}}')).toBe('{"accept":["text/html"],"ok":{"a":[1]}}');
  });
  test('nothing is cut or withheld: long keys and runs are scrubbed whole', () => {
    // A key that is long keeps its suffix, so its value is still redacted.
    for (const length of [100, 140, 5000])
      expect(failSummaryFromBody(`{"${'x'.repeat(length)}_api_key":"SECRETVALUE"}`)).not.toContain('SECRETVALUE');
    expect(failSummaryFromBody(`${'-'.repeat(200)}Bearer abcdef0123456789`)).not.toContain('abcdef0123456789');
    expect(failSummaryFromBody('a.'.repeat(5000))).toBe(`${'a.'.repeat(5000).slice(0, 4093)}...`);
    // A private key is redacted first, terminated or not, even inside an assignment that would
    // otherwise rewrite its marker.
    const pem = `-----BEGIN PRIVATE KEY-----\n${'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC '.repeat(300)}`;
    for (const body of [
      pem,
      `${'k=v '.repeat(1000)}${pem}`,
      `before ${pem}-----END PRIVATE KEY----- after`,
      `password="${pem}`,
      `password="-----BEGIN PRIVATE KEY-----\nSECRETVALUE\n`,
    ])
      expect(failSummaryFromBody(body)).not.toMatch(/MIIEvQ|SECRETVALUE/);
    expect(failSummaryFromBody(`before ${pem}-----END PRIVATE KEY----- after`)).toBe('before [redacted] after');
    // Text over 16 KiB is scrubbed whole, so a quote that closes far away still counts.
    const padded = `"password": "first\nSECRETVALUE\n${'padding '.repeat(3000)}"`;
    expect(failSummaryFromBody(padded)).toBe('"password": "[redacted]"');
  });
  test('masks e-mail addresses exactly like CPAMP and in linear time', () => {
    const cpamp = (s: string) => s.replace(/([A-Za-z0-9._%+-])([A-Za-z0-9._%+-]*)(@[A-Za-z0-9.-]+\.[A-Za-z]{2,})/g, '$1***$3');
    for (const s of [
      'ops@example.test',
      'a.b+c@x.y.example.co, d@e.fg and not@valid',
      '@x.org a@b a@@x.org -x@y.zz _@a.bc',
      'a@b.cc@d.ee',
      'mail: first.last@sub.domain.example; then z@z.zz.',
      'a.b@c.de-f.gh',
    ])
      expect(failSummaryFromBody(s)).toBe(cpamp(s));
    // CPAMP's own rule is not idempotent on `a@b.cc@d.ee`; the port keeps it, and says so.
    expect(failSummaryFromBody('a@b.cc@d.ee')).toBe('a***@b.cc@d.ee');
    expect(failSummaryFromBody('a***@b.cc@d.ee')).toBe('a***@b***@d.ee');
    // Hostile upstream text: the scrubber's own patterns backtrack on long dotted words, and the
    // e-mail pattern on a long local part, so each stays bounded.
    for (const text of [
      'a'.repeat(100000),
      'a.'.repeat(50000) + '@',
      'a@'.repeat(50000),
      ('a.b-'.repeat(30) + ' ').repeat(300),
      ('a.'.repeat(60) + ' = ').repeat(130),
      '"k": '.repeat(3000),
      '{"token":['.repeat(2000),
    ]) {
      const start = performance.now();
      failSummaryFromBody(text);
      expect(performance.now() - start).toBeLessThan(500);
    }
  });
  test('is capped at 4096 bytes on a character boundary, and absent when there is no body', () => {
    const long = normalized({ failed: true, fail: { status_code: 500, body: 'é'.repeat(5000) } });
    expect(Buffer.byteLength(long.event.failSummary!)).toBeLessThanOrEqual(4096);
    expect(long.event.failSummary!.endsWith('...')).toBe(true);
    expect(normalized().event.failSummary).toBeNull();
    expect(normalized({ failed: true, fail: { status_code: 500, body: '  ' } }).event.failSummary).toBeNull();
  });
});

describe('normalizer: response trace id', () => {
  const headers = (value: Record<string, unknown>) => normalized({ response_headers: value }).event.headerTraceId;
  test('takes the first present header in CPAMP priority order, any key case, string or list', () => {
    expect(headers({ 'X-Request-Id': ['req-1'], 'Cf-Ray': ['ray-1'] })).toBe('req-1');
    expect(headers({ 'CF-RAY': 'ray-1', Eagleid: ['eagle-1'] })).toBe('ray-1');
    expect(headers({ 'X-Oai-Request-Id': ['oai-1'], 'X-Request-Id': ['req-1'] })).toBe('oai-1');
    expect(headers({ 'X-Request-Id': ['  ', 'req-2'] })).toBe('req-2');
    expect(
      headers({ Traceparent: ['00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01'] })
    ).toBe('0af7651916cd43dd8448eb211c80319c');
    expect(headers({ Traceparent: ['00-00000000000000000000000000000000-b7ad6b7169203331-01'] })).toBeNull();
    expect(headers({ Traceparent: ['nonsense'] })).toBeNull();
  });
  test('ignores every other header, absent headers and a leaked key in the value', () => {
    expect(headers({ 'Set-Cookie': ['a=b'], Authorization: ['x'], 'Retry-After': ['30'] })).toBeNull();
    expect(normalized().event.headerTraceId).toBeNull();
    expect(headers({ 'X-Request-Id': [KEY] })).not.toContain(KEY);
    expect(scrubTraceId(`${BEARER} ${'x '.repeat(1000)}`)).not.toContain('abcdef0123456789');
    expect(Buffer.byteLength(scrubTraceId('y'.repeat(5000))!)).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(scrubTraceId(`${'!'.repeat(1006)} api_key=x`)!)).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(scrubTraceId(`${'ab cd '.repeat(300)}`)!)).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(headers({ 'X-Request-Id': ['x'.repeat(3000)] })!)).toBeLessThanOrEqual(1024);
    expect(Buffer.byteLength(headers({ 'X-Request-Id': ['x y '.repeat(600)] })!)).toBeLessThanOrEqual(1024);
  });
});

describe('normalizer: credential file name', () => {
  test('comes from the credential listing in force, as is, and is absent without one', () => {
    const label = { account: 'a@example.test', label: 'A', file: ' codex-a@example.test.json ' };
    expect(normalized({}, label).event.authFile).toBe('codex-a@example.test.json');
    expect(normalized({}, { account: 'a', label: '', file: '' }).event.authFile).toBeNull();
    expect(normalized({}, { account: 'a', label: '' }).event.authFile).toBeNull();
    expect(normalized().event.authFile).toBeNull();
  });
});

describe('store: schema and search', () => {
  let f: ReturnType<typeof analyticsStore>;
  afterEach(() => f?.close());
  const failed = (index: number, overrides: Partial<NormalizedEvent> = {}) =>
    event(index, { failed: true, statusCode: 502, ...overrides });
  function seed() {
    f = analyticsStore();
    f.insert([
      failed(1, {
        failSummary: 'Post "https://upstream.example.test": context canceled',
        headerTraceId: 'a59914ce6aa7e761-DEN',
        authFile: 'codex-needle@example.test.json',
      }),
      event(2, { headerTraceId: 'quiet-trace-id', authFile: 'quiet.json' }),
      event(3),
    ]);
    return f;
  }

  test('migration 4 adds nullable columns and rewinds only an existing import cursor', () => {
    for (const [cursor, expected] of [['731000', '0'], [null, null]] as const) {
      const db = new Database(':memory:');
      migrateUsageDatabase(db, USAGE_MIGRATIONS.slice(0, 3));
      if (cursor) db.query(`INSERT INTO meta VALUES ('import:cpamp:last_id', ?)`).run(cursor);
      db.exec(`INSERT INTO event_detail (seq, execution_id, ts_ms, ingested_at_ms) VALUES (1, 'old', 1, 1)`);
      // Migration 4 alone: migration 5 rewinds the cursor again (proxUsageSearchColumns).
      migrateUsageDatabase(db, USAGE_MIGRATIONS.slice(0, 4));
      expect(
        db.query<{ value: string }, []>(`SELECT value FROM meta WHERE key='import:cpamp:last_id'`).get()?.value ?? null
      ).toBe(expected);
      expect(db.query(`SELECT header_trace_id, fail_summary FROM event_detail`).get()).toEqual({
        header_trace_id: null,
        fail_summary: null,
      });
      expect(db.query(`SELECT count(*) AS n FROM pragma_table_info('events') WHERE name='auth_file_id'`).get()).toEqual({ n: 1 });
    }
  });

  test('every one of the three fields is searched by substring, any case, within the range', () => {
    seed();
    const calls = (search: string) => queryAnalytics(f.db, query({ search }), rateState()).summary.calls;
    for (const term of ['context canceled', 'CONTEXT', 'upstream.example.test']) expect(calls(term)).toBe(1);
    for (const term of ['a59914ce6aa7e761-den', 'ce6aa7', 'quiet-trace']) expect(calls(term)).toBe(1);
    for (const term of ['codex-needle@example.test.json', 'NEEDLE', '.json']) expect(calls(term)).toBeGreaterThanOrEqual(1);
    expect(calls('codex-needle')).toBe(1);
    expect(calls('quiet.json')).toBe(1);
    expect(calls('nothing-matches')).toBe(0);
    expect(
      queryAnalytics(f.db, query({ search: 'context canceled', outcome: 'success' }), rateState()).summary.calls
    ).toBe(0);
  });

  test('the request items return the three fields, optional, with the failure text scrubbed again', () => {
    seed();
    f.insert([failed(4, { failSummary: `late ${KEY}` })]);
    const items = queryAnalytics(f.db, query(), rateState()).requests.items;
    const byExecution = (index: number) => items.find((item) => item.execution_id === event(index).executionId)!;
    expect(byExecution(1)).toMatchObject({
      fail_summary: 'Post "https://upstream.example.test": context canceled',
      header_trace_id: 'a59914ce6aa7e761-DEN',
      auth_file_snapshot: 'codex-needle@example.test.json',
      error_summary: 'Upstream HTTP 502',
    });
    expect(byExecution(2)).toMatchObject({ header_trace_id: 'quiet-trace-id', auth_file_snapshot: 'quiet.json' });
    expect(byExecution(2)).not.toHaveProperty('fail_summary');
    for (const key of ['fail_summary', 'header_trace_id', 'auth_file_snapshot'])
      expect(byExecution(3)).not.toHaveProperty(key);
    expect(byExecution(4).fail_summary).not.toContain(KEY);
  });

  test('the CPAMP replay searches these three fields too, so only event_hash stays CPAMP-only', () => {
    seed();
    const replay = (search: string) =>
      queryAnalytics(f.db, query({ search }), rateState(), { cpampSearch: { alsoMatchSeqs: [] } }).summary.calls;
    expect(replay('context canceled')).toBe(1);
    expect(replay('ce6aa7')).toBe(1);
    expect(replay('codex-needle')).toBe(1);
    // The other identifiers stay outside CPAMP's document.
    expect(replay(event(1).executionId)).toBe(0);
  });
});

describe('response parity', () => {
  test('request items with the three fields match CPAMP items that have no such members', () => {
    const f = analyticsStore();
    try {
      f.insert([
        event(1, { failed: true, failSummary: 'context canceled', headerTraceId: 'h1', authFile: 'a.json' }),
        event(2, { headerTraceId: 'h2', authFile: 'a.json' }),
      ]);
      const prox = queryAnalytics(f.db, query(), rateState());
      const cpamp = structuredClone(prox);
      for (const item of cpamp.requests.items) {
        delete item.fail_summary;
        delete item.header_trace_id;
        delete item.auth_file_snapshot;
      }
      expect(prox.requests.items.some((item) => item.fail_summary)).toBe(true);
      expect(compareResponses(cpamp, prox)).toEqual([]);
    } finally {
      f.close();
    }
  });
});

describe('CPAMP import, reconcile and backfill', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });
  function fixture(count = 3) {
    const root = mkdtempSync('/dev/shm/prox-search-fields-');
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const sourcePath = join(root, 'cpamp.sqlite');
    const writable = createCpamp(sourcePath, count);
    cleanups.push(() => writable.db.close());
    const source = openUsageReader(sourcePath);
    cleanups.push(() => source.close());
    const path = join(root, 'usage.sqlite');
    const store = new UsageStore({ events: path, raw: null });
    cleanups.push(() => store.close());
    const reader = openUsageReader(path);
    cleanups.push(() => reader.close());
    return { source, writable, store, reader };
  }
  const run = (f: ReturnType<typeof fixture>, mode: 'import' | 'reconcile' | 'verify' = 'import') =>
    runCpampJob(f.store, f.source, { mode, governor: fakeIo().governor });
  const fields = (db: Database) =>
    db
      .query(
        `SELECT d.execution_id, d.header_trace_id, d.fail_summary, a.value AS auth_file
         FROM event_detail d JOIN events e ON e.seq = d.seq LEFT JOIN dim a ON a.id = e.auth_file_id
         ORDER BY d.seq`
      )
      .all();

  test('a fresh import carries the three persisted fields, scrubbing the failure text again', async () => {
    const f = fixture();
    f.writable.db.exec(
      `UPDATE usage_events SET fail_summary='denied ${KEY}' WHERE id = 1`
    );
    const report = await run(f);
    expect(report.verification).toMatchObject({ different: 0, exact: true });
    const rows = fields(f.reader) as Record<string, string | null>[];
    expect(rows[0].fail_summary).not.toContain(KEY);
    expect(rows[0]).toMatchObject({ header_trace_id: 'trace-header-1', auth_file: 'synthetic-auth.json' });
    expect(rows[1]).toMatchObject({ fail_summary: null });
  });

  test('reconcile after the migration rewind fills NULL fields of existing rows once, paced like any pass', async () => {
    const f = fixture();
    await run(f);
    // Rows as they were before migration 4: the three fields NULL, the cursor rewound.
    f.store.setMeta('import:cpamp:last_id', '0');
    const db = new Database(f.reader.filename);
    db.exec(`UPDATE event_detail SET header_trace_id = NULL, fail_summary = NULL; UPDATE events SET auth_file_id = NULL`);
    db.close();
    const verifyOnly = await run(f, 'verify');
    expect(verifyOnly.verification.different).toBe(3);
    expect(verifyOnly.verification.exact).toBe(false);
    expect(fields(f.reader).every((row) => (row as { header_trace_id: unknown }).header_trace_id === null)).toBe(true);

    const filled = await run(f, 'reconcile');
    expect(filled).toMatchObject({ read: 3, inserted: 0, duplicates: 3, conflicts: 0 });
    expect(filled.verification).toMatchObject({ different: 0, exact: true });
    expect(fields(f.reader)).toEqual([
      { execution_id: expect.any(String), header_trace_id: 'trace-header-1', fail_summary: 'upstream said no', auth_file: 'synthetic-auth.json' },
      { execution_id: expect.any(String), header_trace_id: 'trace-header-2', fail_summary: null, auth_file: 'synthetic-auth.json' },
      { execution_id: expect.any(String), header_trace_id: 'trace-header-3', fail_summary: 'upstream said no', auth_file: 'synthetic-auth.json' },
    ]);
    // Running it again changes nothing.
    const before = f.reader.serialize();
    f.store.setMeta('import:cpamp:last_id', '0');
    await run(f, 'reconcile');
    expect(Buffer.from(f.reader.serialize()).equals(Buffer.from(before))).toBe(true);
  });

  test('an imported trace id passes the same scrubber and cap, and is scrubbed again when served', async () => {
    const f = fixture(1);
    f.writable.db.exec(`UPDATE usage_events SET header_trace_id = '${BEARER} ${'z '.repeat(1000)}'`);
    await run(f);
    const stored = (fields(f.reader) as { header_trace_id: string }[])[0].header_trace_id;
    expect(stored).not.toContain('abcdef0123456789');
    expect(Buffer.byteLength(stored)).toBeLessThanOrEqual(1024);
    // A leak that reached the store some other way is not served.
    const db = new Database(f.reader.filename);
    db.query('UPDATE event_detail SET header_trace_id = ?, fail_summary = ?').run(
      `${BEARER}`,
      `${'x'.repeat(4078)} api_key=x`
    );
    db.close();
    const item = queryAnalytics(f.reader, query({ from_ms: Date.UTC(2026, 10, 1), to_ms: Date.UTC(2026, 10, 2) }), rateState())
      .requests.items[0];
    expect(item.header_trace_id).not.toContain('abcdef0123456789');
    expect(Buffer.byteLength(item.fail_summary!)).toBeLessThanOrEqual(4096);
  });

  test('a value the live path already holds is never overwritten: it is a conflict and a difference', async () => {
    const f = fixture(1);
    const live = normalizeUsagePayload(
      JSON.stringify(usagePayloadNumber(1, { failed: true, fail: { status_code: 502, body: 'live text' } })),
      () => ({ account: 'a', label: '', file: 'live-file.json' })
    );
    if (live.kind !== 'event') throw new Error('expected an event');
    f.store.insert([{ event: live.event, raw: null }], INGEST.subscribed);
    const report = await run(f);
    expect(report.conflicts).toBeGreaterThan(0);
    expect(report.verification.different).toBe(1);
    expect(report.verification.exact).toBe(false);
    expect(fields(f.reader)[0]).toMatchObject({ fail_summary: 'live text', auth_file: 'live-file.json' });
    const conflicts = f.reader.query<{ field: string }, []>('SELECT field FROM import_conflicts').all().map((r) => r.field);
    expect(conflicts).toEqual(expect.arrayContaining(['fail_summary', 'auth_file_id']));
  });
});
