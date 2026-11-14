// The eight CPAMP search columns Prox did not hold: endpoint, x_forwarded_for, source,
// auth_provider_snapshot, auth_project_id_snapshot and the three response-header values.
// Stored, searchable, imported and backfilled. Synthetic data only.
import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { queryAnalytics } from '../server/usage/analytics';
import { runCpampJob } from '../server/usage/importCpamp';
import { maskSource, normalizeUsagePayload } from '../server/usage/normalize';
import { USAGE_MIGRATIONS } from '../server/usage/schema';
import { migrateUsageDatabase, openUsageReader, UsageStore } from '../server/usage/store';
import type { AccountLabel, NormalizedEvent } from '../server/usage/types';
import { CPAMP_ONLY_SEGMENTS } from '../scripts/usage-parity/searchCpampOnly';
import { createCpamp } from './fixtures/cpampUsage';
import { usagePayload } from './fixtures/usagePayloads';
import { analyticsStore, event, query, rateState } from './helpers/usageAnalytics';
import { fakeIo } from './helpers/usageIo';

function normalized(overrides: Record<string, unknown> = {}, label?: AccountLabel) {
  const result = normalizeUsagePayload(JSON.stringify(usagePayload(overrides)), () => label);
  if (result.kind !== 'event') throw new Error('expected an event');
  return result.event;
}
const headers = (value: Record<string, unknown>) => normalized({ response_headers: value });

describe('normalizer: endpoint', () => {
  test('is the proxy endpoint text as CPAMP stores it, and "-" when the record has none', () => {
    expect(normalized({ endpoint: 'POST /v1/messages' }).endpoint).toBe('POST /v1/messages');
    expect(normalized({ endpoint: '  GET /v1/responses ' }).endpoint).toBe('GET /v1/responses');
    // A path with no method is kept whole, although method and path stay unparsed.
    const bare = normalized({ endpoint: '/v1/models' });
    expect([bare.endpoint, bare.method, bare.path]).toEqual(['/v1/models', null, null]);
    expect(normalized({ endpoint: '' }).endpoint).toBe('-');
    expect(normalized({ endpoint: undefined }).endpoint).toBe('-');
    // Query strings can carry credentials; the stored endpoint never has one.
    expect(normalized({ endpoint: 'POST /v1/x?key=SECRETVALUE' }).endpoint).toBe('POST /v1/x');
  });
});

describe('normalizer: x_forwarded_for', () => {
  test('is the request metadata line, capped at 2048 bytes, null when absent', () => {
    expect(normalized({ x_forwarded_for: '203.0.113.5,\n 198.51.100.8' }).xForwardedFor).toBe(
      '203.0.113.5, 198.51.100.8'
    );
    expect(Buffer.byteLength(normalized({ x_forwarded_for: '1'.repeat(5000) }).xForwardedFor!)).toBeLessThanOrEqual(2048);
    expect(normalized({ x_forwarded_for: '  ' }).xForwardedFor).toBeNull();
  });
});

describe('normalizer: source', () => {
  test('masks an e-mail to its first three bytes and the domain, as CPAMP does', () => {
    expect(maskSource('wrollings@astrabit.io')).toBe('wro***@astrabit.io');
    expect(maskSource(' ab@x.test ')).toBe('ab***@x.test');
    expect(maskSource('a@b@c.test')).toBe('a***@b@c.test');
  });
  test('never keeps a credential or a key-like value: it is hashed or its ends shown, never whole', () => {
    const key = `sk-${'a1B2c3D4e5F6g7H8i9J0k1L2m3N4'}`;
    // A recognised credential is replaced by its SHA-256, as CPAMP does; a long opaque value shows its ends.
    expect(maskSource(key)).toMatch(/^h:[0-9a-f]{64}$/);
    const long = 'x'.repeat(40);
    expect(maskSource(long)).toBe('m:xxxx...xxxx');
    expect(maskSource('shortsecretvalue')).toBe('shortsecretvalue');
    expect(maskSource(`Authorization: Bearer abcdef0123456789abcdef0123456789`)).toMatch(/^h:[0-9a-f]{64}$/);
    for (const stored of [maskSource(key), maskSource(long)]) expect(stored).not.toContain(key);
    expect(maskSource('   ')).toBe('');
  });
  test('comes from the record source and is null when it is empty', () => {
    expect(normalized({ source: 'someone@example.test' }).source).toBe('som***@example.test');
    expect(normalized({ source: '' }).source).toBeNull();
    expect(JSON.stringify(normalized({ source: 'someone@example.test' }))).not.toContain('someone@');
  });
});

describe('normalizer: response-header values', () => {
  test('quota plan is x-codex-plan-type, any key case, scrubbed and capped', () => {
    expect(headers({ 'X-Codex-Plan-Type': ['promax'] }).quotaPlan).toBe('promax');
    expect(headers({ 'x-codex-plan-type': 'pro' }).quotaPlan).toBe('pro');
    expect(headers({ 'X-Request-Id': ['r'] }).quotaPlan).toBeNull();
    expect(Buffer.byteLength(headers({ 'x-codex-plan-type': 'p'.repeat(3000) }).quotaPlan!)).toBeLessThanOrEqual(1024);
  });
  test('error kind and code follow CPAMP classifyHeaderError in its order', () => {
    const kc = (value: Record<string, unknown>) => {
      const e = headers(value);
      return [e.errorKind, e.errorCode];
    };
    expect(kc({ 'X-Openai-Ide-Root-Error-Code': ['Token_Revoked'] })).toEqual(['auth', 'token_revoked']);
    expect(kc({ 'x-openai-ide-error-code': '401' })).toEqual(['auth', '401']);
    expect(kc({ 'x-openai-authorization-error': 'account_deactivated' })).toEqual(['auth', 'account_deactivated']);
    expect(kc({ 'x-openai-ide-error-code': 'identity_edge_internal_error' })).toEqual([
      'identity',
      'identity_edge_internal_error',
    ]);
    // The first code of root, ide, authorization that classifies wins; one that does not is skipped.
    expect(
      kc({ 'x-openai-ide-root-error-code': 'other', 'x-openai-authorization-error': 'token_invalidated' })
    ).toEqual(['auth', 'token_invalidated']);
    expect(kc({ 'x-ratelimit-bypass': 'Internal' })).toEqual(['rate_limit', 'Internal']);
    expect(kc({ 'retry-after': '30' })).toEqual(['rate_limit', 'retry_after']);
    expect(kc({ 'retry-after': 'Mon, 02 Jan 2006 15:04:05 GMT' })).toEqual(['rate_limit', 'retry_after']);
    expect(kc({ 'retry-after': '0' })).toEqual(['rate_limit', 'retry_after']);
    expect(kc({ 'retry-after': 'soon' })).toEqual([null, null]);
    expect(kc({ 'retry-after': '-5' })).toEqual([null, null]);
    expect(kc({ 'x-request-id': 'r' })).toEqual([null, null]);
    // The bypass header outranks Retry-After; an auth code outranks both.
    expect(kc({ 'x-ratelimit-bypass': 'b', 'retry-after': '3' })).toEqual(['rate_limit', 'b']);
    expect(kc({ 'x-openai-ide-error-code': '401', 'retry-after': '3' })).toEqual(['auth', '401']);
  });
});

describe('normalizer: credential snapshot', () => {
  test('provider and project come from the credential listing in force; absent without one', () => {
    const label = { account: 'a', label: 'A', provider: 'codex', project: ' proj-1 ' };
    const e = normalized({}, label);
    expect([e.authProvider, e.authProject]).toEqual(['codex', 'proj-1']);
    const none = normalized({}, { account: 'a', label: '' });
    expect([none.authProvider, none.authProject]).toEqual([null, null]);
    expect(normalized().authProvider).toBeNull();
  });
});

describe('migration 5', () => {
  test('adds nullable event columns, no rewrite, and rewinds only an existing import cursor', () => {
    expect(USAGE_MIGRATIONS).toHaveLength(5);
    for (const [cursor, expected] of [['731000', '0'], [null, null]] as const) {
      const db = new Database(':memory:');
      migrateUsageDatabase(db, USAGE_MIGRATIONS.slice(0, 4));
      if (cursor) db.query(`INSERT INTO meta VALUES ('import:cpamp:last_id', ?)`).run(cursor);
      db.exec(
        `INSERT INTO events (ts_ms, seq, provider_id, model_id, requested_model_id, billing_model_id, tier_id, failed,
           timing_id, input_total, input_uncached, cache_read, cache_write, output_total, reasoning, total,
           usage_flags, record_kind, ingest) VALUES (1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0)`
      );
      migrateUsageDatabase(db);
      expect(
        db.query<{ value: string }, []>(`SELECT value FROM meta WHERE key='import:cpamp:last_id'`).get()?.value ?? null
      ).toBe(expected);
      expect(
        db
          .query<{ name: string }, []>(`SELECT name FROM pragma_table_info('events') WHERE name IN (
            'endpoint_id','x_forwarded_for_id','source_id','auth_provider_id','auth_project_id',
            'quota_plan_id','error_kind_id','error_code_id') ORDER BY name`)
          .all()
          .map((row) => row.name)
      ).toHaveLength(8);
      expect(
        db.query(`SELECT endpoint_id, source_id, error_code_id FROM events`).get()
      ).toEqual({ endpoint_id: null, source_id: null, error_code_id: null });
    }
  });
});

describe('store: search of the eight columns', () => {
  let f: ReturnType<typeof analyticsStore>;
  afterEach(() => f?.close());
  const calls = (search: string, replay = false) =>
    queryAnalytics(f.db, query({ search }), rateState(), replay ? { cpampSearch: { alsoMatchSeqs: [] } } : undefined)
      .summary.calls;
  function seed() {
    f = analyticsStore();
    const base: Partial<NormalizedEvent> = {
      endpoint: '-',
      xForwardedFor: null,
      source: null,
      authProvider: null,
      authProject: null,
      quotaPlan: null,
      errorKind: null,
      errorCode: null,
    };
    f.insert([
      event(1, {
        ...base,
        endpoint: 'POST /v1/messages',
        xForwardedFor: '203.0.113.77, 198.51.100.8',
        source: 'zed***@fleet.example',
        authProvider: 'zprovider',
        authProject: 'proj-needle-9',
        quotaPlan: 'promaxplan',
        errorKind: 'rate_limit',
        errorCode: 'retry_after',
      }),
      event(2, base),
    ]);
  }

  test('each column is searched by substring, any case, and the two events stay distinct', () => {
    seed();
    for (const term of [
      'POST /v1/messages',
      'post /v1',
      '203.0.113.77',
      'zed***@fleet',
      'FLEET.EXAMPLE',
      'zprovider',
      'needle-9',
      'promaxplan',
      'rate_limit',
      'retry_af',
    ])
      expect(calls(term), term).toBe(1);
    // The "-" CPAMP stores for a missing endpoint is searched too: event 2 has it.
    expect(calls('-')).toBe(2);
    expect(calls('nothing-matches')).toBe(0);
  });
  test('the CPAMP replay document holds them too', () => {
    seed();
    for (const term of ['post /v1/mess', '203.0.113.77', 'zed***', 'zprovider', 'needle-9', 'promaxplan', 'retry_after'])
      expect(calls(term, true), term).toBe(1);
  });
  test('only the three internal hashes stay CPAMP-only', () => {
    expect([...CPAMP_ONLY_SEGMENTS]).toEqual([
      [1, 'event_hash'],
      [13, 'source_hash'],
      [14, 'api_key_hash'],
    ]);
  });
});

describe('CPAMP import, reconcile and backfill', () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
  });
  const CPAMP_FIELDS = {
    endpoint: 'POST /v1/messages',
    x_forwarded_for: '203.0.113.5, 198.51.100.8',
    source: 'syn***@example.test',
    auth_provider_snapshot: 'claude',
    auth_project_id_snapshot: 'proj-1',
    header_quota_plan_type: 'pro',
    header_error_kind: 'rate_limit',
    header_error_code: 'retry_after',
  };
  function fixture(count = 3) {
    const root = mkdtempSync('/dev/shm/prox-search-columns-');
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
  const stored = (db: Database) =>
    db
      .query(
        `SELECT (SELECT value FROM dim WHERE id = e.endpoint_id) AS endpoint,
                (SELECT value FROM dim WHERE id = e.x_forwarded_for_id) AS x_forwarded_for,
                (SELECT value FROM dim WHERE id = e.source_id) AS source,
                (SELECT value FROM dim WHERE id = e.auth_provider_id) AS auth_provider,
                (SELECT value FROM dim WHERE id = e.auth_project_id) AS auth_project,
                (SELECT value FROM dim WHERE id = e.quota_plan_id) AS quota_plan,
                (SELECT value FROM dim WHERE id = e.error_kind_id) AS error_kind,
                (SELECT value FROM dim WHERE id = e.error_code_id) AS error_code
         FROM events e ORDER BY e.seq`
      )
      .all();
  const EXPECTED = {
    endpoint: 'POST /v1/messages',
    x_forwarded_for: '203.0.113.5, 198.51.100.8',
    source: 'syn***@example.test',
    auth_provider: 'claude',
    auth_project: 'proj-1',
    quota_plan: 'pro',
    error_kind: 'rate_limit',
    error_code: 'retry_after',
  };

  test('a fresh import carries the eight CPAMP columns and verifies exact', async () => {
    const f = fixture();
    for (const [column, value] of Object.entries(CPAMP_FIELDS))
      f.writable.db.exec(`UPDATE usage_events SET ${column} = '${value}'`);
    f.writable.db.exec(`UPDATE usage_events SET endpoint = '-' WHERE id = 2`);
    const report = await run(f);
    expect(report.verification).toMatchObject({ different: 0, exact: true });
    expect(stored(f.reader)).toEqual([EXPECTED, { ...EXPECTED, endpoint: '-' }, EXPECTED]);
  });

  test('a row with empty CPAMP columns stores nothing; an empty endpoint is "-"', async () => {
    const f = fixture(1);
    for (const column of Object.keys(CPAMP_FIELDS)) f.writable.db.exec(`UPDATE usage_events SET ${column} = ''`);
    await run(f);
    expect(stored(f.reader)).toEqual([
      {
        endpoint: '-',
        x_forwarded_for: null,
        source: null,
        auth_provider: null,
        auth_project: null,
        quota_plan: null,
        error_kind: null,
        error_code: null,
      },
    ]);
  });

  test('reconcile after the migration rewind fills the NULL columns of existing rows once', async () => {
    const f = fixture();
    for (const [column, value] of Object.entries(CPAMP_FIELDS))
      f.writable.db.exec(`UPDATE usage_events SET ${column} = '${value}'`);
    await run(f);
    f.store.setMeta('import:cpamp:last_id', '0');
    const db = new Database(f.reader.filename);
    db.exec(
      `UPDATE events SET endpoint_id = NULL, x_forwarded_for_id = NULL, source_id = NULL, auth_provider_id = NULL,
         auth_project_id = NULL, quota_plan_id = NULL, error_kind_id = NULL, error_code_id = NULL`
    );
    db.close();
    const verifyOnly = await run(f, 'verify');
    expect(verifyOnly.verification.different).toBe(3);
    const filled = await run(f, 'reconcile');
    expect(filled).toMatchObject({ read: 3, inserted: 0, duplicates: 3, conflicts: 0 });
    expect(filled.verification).toMatchObject({ different: 0, exact: true });
    expect(stored(f.reader)).toEqual([EXPECTED, EXPECTED, EXPECTED]);
    const before = f.reader.serialize();
    f.store.setMeta('import:cpamp:last_id', '0');
    await run(f, 'reconcile');
    expect(Buffer.from(f.reader.serialize()).equals(Buffer.from(before))).toBe(true);
  });

  test('a Codex project that is only an account marker is not stored as a project', async () => {
    const f = fixture(1);
    f.writable.db.exec(
      `UPDATE usage_events SET auth_provider_snapshot = 'codex', auth_project_id_snapshot = 'codex-account-id:v1:abc'`
    );
    await run(f);
    expect((stored(f.reader)[0] as { auth_project: unknown }).auth_project).toBeNull();
  });
});
