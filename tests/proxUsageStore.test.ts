import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { createHash } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { normalizeUsagePayload } from '../server/usage/normalize';
import { READER_PRAGMAS_SQL, USAGE_MIGRATIONS, WRITER_PRAGMAS_SQL } from '../server/usage/schema';
import { migrateUsageDatabase, openUsageReader, UsageStore } from '../server/usage/store';
import { INGEST, USAGE_FLAG, type IngestItem } from '../server/usage/types';
import { FAIL_BODY, SECRET, usagePayload, usagePayloadNumber } from './fixtures/usagePayloads';

const NOW = 1_800_000_000_000;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function open(options: { raw?: boolean; root?: string } = {}) {
  const root = options.root ?? mkdtempSync('/dev/shm/prox-usage-store-');
  if (!options.root) cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const events = join(root, 'usage.sqlite');
  const raw = options.raw === false ? null : join(root, 'usage-raw.sqlite');
  const store = new UsageStore({ events, raw }, () => NOW);
  let closed = false;
  const close = () => {
    if (!closed) store.close();
    closed = true;
  };
  cleanups.push(close);
  const reader = () => {
    const db = openUsageReader(events);
    cleanups.push(() => db.close());
    return db;
  };
  return { root, events, raw, store, close, reader };
}

function item(payload: Record<string, unknown>): IngestItem {
  const result = normalizeUsagePayload(JSON.stringify(payload));
  if (result.kind !== 'event') throw new Error(`expected an event, got ${result.kind}`);
  return { event: result.event, raw: result.raw };
}
const count = (db: Database, table: string) =>
  (db.query(`SELECT count(*) AS rows FROM ${table}`).get() as { rows: number }).rows;

describe('usage store schema', () => {
  test('the tables, columns and keys are the ones in the design', () => {
    const { reader } = open();
    const db = reader();
    const columns = (table: string) =>
      db
        .query<{ name: string; type: string; notnull: number; pk: number }, []>(
          `PRAGMA table_info(${table})`
        )
        .all()
        .map(
          (column) =>
            `${column.name} ${column.type}${column.notnull ? ' NOT NULL' : ''}${column.pk ? ` PK${column.pk}` : ''}`
        );
    expect(columns('meta')).toEqual(['key TEXT NOT NULL PK1', 'value TEXT NOT NULL']);
    expect(columns('dim')).toEqual(['id INTEGER PK1', 'kind TEXT NOT NULL', 'value TEXT NOT NULL']);
    expect(columns('session')).toEqual([
      'id INTEGER PK1',
      'uuid TEXT NOT NULL',
      'parent_id INTEGER',
      'derived INTEGER NOT NULL',
    ]);
    expect(columns('events')).toEqual([
      'ts_ms INTEGER NOT NULL PK1',
      'seq INTEGER NOT NULL PK2',
      'instance_id INTEGER',
      'provider_id INTEGER NOT NULL',
      'model_id INTEGER NOT NULL',
      'requested_model_id INTEGER NOT NULL',
      'billing_model_id INTEGER NOT NULL',
      'response_model_id INTEGER',
      'tier_id INTEGER NOT NULL',
      'failed INTEGER NOT NULL',
      'status_code INTEGER',
      'latency_ms INTEGER',
      'ttft_ms INTEGER',
      'timing_id INTEGER NOT NULL',
      'input_total INTEGER NOT NULL',
      'input_uncached INTEGER NOT NULL',
      'cache_read INTEGER NOT NULL',
      'cache_write INTEGER NOT NULL',
      'output_total INTEGER NOT NULL',
      'reasoning INTEGER NOT NULL',
      'total INTEGER NOT NULL',
      'usage_flags INTEGER NOT NULL',
      'record_kind INTEGER NOT NULL',
      'stream INTEGER',
      'account_id INTEGER',
      'account_label_id INTEGER',
      'api_key_id INTEGER',
      'user_agent_id INTEGER',
      'client_ip_id INTEGER',
      'path_id INTEGER',
      'method_id INTEGER',
      'effort_id INTEGER',
      'executor_id INTEGER',
      'requested_tier_id INTEGER',
      'effective_tier_id INTEGER',
      'session_id INTEGER',
      'auth_index_id INTEGER',
      'ingest INTEGER NOT NULL',
      'auth_file_id INTEGER', // migration 4 appends it
      // migration 5 appends the eight CPAMP search columns
      'endpoint_id INTEGER',
      'x_forwarded_for_id INTEGER',
      'source_id INTEGER',
      'auth_provider_id INTEGER',
      'auth_project_id INTEGER',
      'quota_plan_id INTEGER',
      'error_kind_id INTEGER',
      'error_code_id INTEGER',
    ]);
    expect(columns('event_detail')).toEqual([
      'seq INTEGER PK1',
      'execution_id TEXT NOT NULL',
      'ts_ms INTEGER NOT NULL',
      'request_id TEXT',
      'parent_execution_id TEXT',
      'session_id TEXT',
      'parent_session_id TEXT',
      'trace_id TEXT',
      'upstream_start_ms INTEGER',
      'first_response_ms INTEGER',
      'first_content_ms INTEGER',
      'recorded_ms INTEGER',
      'ingested_at_ms INTEGER NOT NULL',
      'header_trace_id TEXT', // migration 4
      'fail_summary TEXT',
    ]);
    expect(columns('ingest_gaps')).toEqual([
      'id INTEGER PK1',
      'instance TEXT NOT NULL',
      'from_ms INTEGER NOT NULL',
      'to_ms INTEGER NOT NULL',
      'reason TEXT NOT NULL',
      'missed INTEGER',
      'filled_at_ms INTEGER',
      'filled_by TEXT',
    ]);
    expect(columns('import_conflicts')).toEqual([
      'execution_id TEXT NOT NULL',
      'field TEXT NOT NULL',
      'live TEXT',
      'imported TEXT',
      'seen_at_ms INTEGER NOT NULL',
    ]);
    expect(columns('client_alias')).toEqual([
      'api_key_hash TEXT NOT NULL PK1',
      'alias TEXT NOT NULL',
    ]);

    const objects = db
      .query<{ type: string; name: string; sql: string | null }, []>(
        `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name`
      )
      .all();
    expect(objects.map((object) => `${object.type} ${object.name}`)).toEqual([
      'table client_alias',
      'table dim',
      'table event_detail',
      'index event_detail_request',
      'table events',
      'table import_conflicts',
      'table ingest_gaps',
      'table meta',
      'table session',
      'table usage_hour_coverage',
      'table usage_hour_rollup',
      'table usage_hour_state',
    ]);
    const withoutRowid = objects.filter((object) => /WITHOUT ROWID/.test(object.sql ?? ''));
    expect(withoutRowid.map((object) => object.name)).toEqual([
      'client_alias',
      'events',
      'meta',
      'usage_hour_coverage',
      'usage_hour_rollup',
    ]);
    // The identity and the dictionary are enforced by the database, not only by the writer.
    const unique = (table: string) =>
      db
        .query<{ name: string; unique: number }, []>(`PRAGMA index_list(${table})`)
        .all()
        .filter((index) => index.unique)
        .map((index) =>
          db
            .query<{ name: string }, []>(`PRAGMA index_info(${index.name})`)
            .all()
            .map((column) => column.name)
            .join(',')
        );
    expect(unique('event_detail')).toEqual(['execution_id']);
    expect(unique('dim')).toEqual(['kind,value']);
    expect(unique('session')).toEqual(['uuid']);
    expect(db.query('SELECT value FROM meta WHERE key = ?').get('schema_version')).toEqual({
      value: String(USAGE_MIGRATIONS.length),
    });
  });

  test('the writer runs in WAL with synchronous NORMAL, and readers are read-only', () => {
    const { reader, root } = open();
    const db = reader();
    const pragma = (connection: Database, name: string) =>
      Object.values(connection.query(`PRAGMA ${name}`).get() as object)[0];
    // journal_mode is stored in the file, so WAL here proves the store ran its pragmas. The
    // others are per connection: check what the same statements leave on a connection.
    expect(pragma(db, 'journal_mode')).toBe('wal');
    const writer = new Database(join(root, 'pragma-check.sqlite'), { create: true });
    cleanups.push(() => writer.close());
    writer.exec(WRITER_PRAGMAS_SQL);
    expect(pragma(writer, 'journal_mode')).toBe('wal');
    expect(pragma(writer, 'synchronous')).toBe(1);
    expect(pragma(writer, 'journal_size_limit')).toBe(67_108_864);
    expect(pragma(writer, 'temp_store')).toBe(2);

    expect(READER_PRAGMAS_SQL).toContain('mmap_size = 268435456');
    expect(pragma(db, 'query_only')).toBe(1);
    expect(pragma(db, 'temp_store')).toBe(2);
    expect(() => db.exec('DELETE FROM events')).toThrow();
    expect(() => db.exec("INSERT INTO meta VALUES ('k', 'v')")).toThrow();
  });

  test('both files are private to the service user', () => {
    const { events, raw } = open();
    expect(statSync(events).mode & 0o777).toBe(0o600);
    expect(statSync(raw as string).mode & 0o777).toBe(0o600);
  });

  test('a database from another schema version is refused, not reinterpreted', () => {
    const first = open();
    first.store.setMeta('schema_version', String(USAGE_MIGRATIONS.length + 1));
    first.close();
    expect(() => open({ root: first.root })).toThrow(
      new RegExp(`schema version ${USAGE_MIGRATIONS.length + 1}`)
    );
  });
});

describe('usage store inserts', () => {
  test('one payload becomes one row with its strings interned', () => {
    const { store, reader } = open();
    expect(store.insert([item(usagePayload())], INGEST.subscribed)).toEqual({
      inserted: 1,
      duplicates: 0,
    });
    const db = reader();
    const row = db
      .query(
        `SELECT e.ts_ms, e.seq, e.failed, e.status_code, e.latency_ms, e.ttft_ms, e.input_total,
                e.input_uncached, e.cache_read, e.cache_write, e.output_total, e.reasoning, e.total,
                e.record_kind, e.stream, e.ingest,
                instance.value AS instance, provider.value AS provider, model.value AS model,
                requested.value AS requested_model, billing.value AS billing_model,
                response.value AS response_model, tier.value AS tier, timing.value AS timing,
                account.value AS account, api_key.value AS api_key, agent.value AS user_agent,
                ip.value AS client_ip, path.value AS path, method.value AS method,
                effort.value AS effort, executor.value AS executor,
                requested_tier.value AS requested_tier, e.effective_tier_id, e.account_label_id,
                auth_index.value AS auth_index, session.uuid AS session_uuid,
                d.execution_id, d.ts_ms AS detail_ts_ms, d.request_id, d.session_id, d.trace_id,
                d.parent_execution_id, d.upstream_start_ms, d.first_response_ms,
                d.first_content_ms, d.recorded_ms, d.ingested_at_ms
         FROM events e
         JOIN event_detail d ON d.seq = e.seq
         LEFT JOIN dim instance ON instance.id = e.instance_id
         JOIN dim provider ON provider.id = e.provider_id
         JOIN dim model ON model.id = e.model_id
         JOIN dim requested ON requested.id = e.requested_model_id
         JOIN dim billing ON billing.id = e.billing_model_id
         LEFT JOIN dim response ON response.id = e.response_model_id
         JOIN dim tier ON tier.id = e.tier_id
         JOIN dim timing ON timing.id = e.timing_id
         LEFT JOIN dim account ON account.id = e.account_id
         LEFT JOIN dim api_key ON api_key.id = e.api_key_id
         LEFT JOIN dim agent ON agent.id = e.user_agent_id
         LEFT JOIN dim ip ON ip.id = e.client_ip_id
         LEFT JOIN dim path ON path.id = e.path_id
         LEFT JOIN dim method ON method.id = e.method_id
         LEFT JOIN dim effort ON effort.id = e.effort_id
         LEFT JOIN dim executor ON executor.id = e.executor_id
         LEFT JOIN dim requested_tier ON requested_tier.id = e.requested_tier_id
         LEFT JOIN dim auth_index ON auth_index.id = e.auth_index_id AND auth_index.kind = 'auth_index'
         LEFT JOIN session ON session.id = e.session_id`
      )
      .get();
    expect(row).toEqual({
      ts_ms: Date.UTC(2026, 3, 25, 0, 0, 0, 123),
      seq: 1,
      failed: 0,
      status_code: 200,
      latency_ms: 1500,
      ttft_ms: 420,
      input_total: 950,
      input_uncached: 100,
      cache_read: 800,
      cache_write: 50,
      output_total: 200,
      reasoning: 60,
      total: 1150,
      record_kind: 1,
      stream: 1,
      ingest: 0,
      instance: 'claude-primary',
      provider: 'claude',
      model: 'client-claude',
      requested_model: 'client-claude',
      billing_model: 'claude-test-4',
      response_model: 'claude-test-4-20260401',
      tier: 'standard',
      timing: 'substantive-content',
      account: '3',
      api_key: createHash('sha256').update(SECRET.apiKey).digest('hex'),
      user_agent: 'test-client/1.0',
      client_ip: '192.0.2.10',
      path: '/v1/messages',
      method: 'POST',
      effort: 'medium',
      executor: 'ClaudeExecutor',
      requested_tier: 'auto',
      effective_tier_id: null,
      account_label_id: null,
      auth_index: '3',
      session_uuid: '0f0e0d0c-0b0a-4908-8706-050403020100',
      execution_id: '12345678-1234-4234-8234-123456789abc',
      detail_ts_ms: Date.UTC(2026, 3, 25, 0, 0, 0, 123),
      request_id: '000000ab',
      session_id: '0f0e0d0c-0b0a-4908-8706-050403020100',
      trace_id: '000000ab',
      parent_execution_id: null,
      upstream_start_ms: 12,
      first_response_ms: 340,
      first_content_ms: 420,
      recorded_ms: 1500,
      ingested_at_ms: NOW,
    });
    // Each dictionary kind holds a value once, whatever column refers to it.
    const kinds = db
      .query<{ kind: string; value: string }, []>(
        'SELECT kind, value FROM dim ORDER BY kind, value'
      )
      .all();
    expect(kinds.filter((dim) => dim.kind === 'model').map((dim) => dim.value)).toEqual([
      'claude-test-4',
      'claude-test-4-20260401',
      'client-claude',
    ]);
    expect(kinds.filter((dim) => dim.kind === 'tier').map((dim) => dim.value)).toEqual([
      'auto',
      'standard',
    ]);
  });

  test('the same payload inserted twice yields one row', () => {
    const { store, reader } = open();
    const payload = usagePayload();
    expect(store.insert([item(payload)], INGEST.subscribed)).toEqual({
      inserted: 1,
      duplicates: 0,
    });
    expect(store.insert([item(payload)], INGEST.subscribed)).toEqual({
      inserted: 0,
      duplicates: 1,
    });
    const db = reader();
    expect(count(db, 'events')).toBe(1);
    expect(count(db, 'event_detail')).toBe(1);
    expect(db.query('SELECT value FROM meta WHERE key = ?').get('next_seq')).toEqual({
      value: '2',
    });
  });

  test('identity is the execution id alone: across batches, sources and changed fields', () => {
    const { store, reader } = open();
    const first = item(usagePayload());
    // The same execution drained from the queue, imported later, and with other measurements.
    const again = item(
      usagePayload({ latency_ms: 9, request_id: 'other', timestamp: '2026-04-26T00:00:00Z' })
    );
    const other = item(usagePayloadNumber(2));
    expect(store.insert([first, again, other, other], INGEST.subscribed)).toEqual({
      inserted: 2,
      duplicates: 2,
    });
    expect(store.insert([again], INGEST.drained)).toEqual({ inserted: 0, duplicates: 1 });
    expect(store.insert([first, other], INGEST.imported)).toEqual({ inserted: 0, duplicates: 2 });
    const db = reader();
    expect(count(db, 'events')).toBe(2);
    expect(count(db, 'event_detail')).toBe(2);
    // The first arrival stays as it was: a stored row is never updated.
    expect(
      db
        .query(
          `SELECT e.latency_ms, e.ingest, d.request_id FROM events e JOIN event_detail d ON d.seq = e.seq
           WHERE d.execution_id = ?`
        )
        .get(first.event.executionId)
    ).toEqual({ latency_ms: 1500, ingest: 0, request_id: '000000ab' });
    // A duplicate consumes no sequence number and leaves no orphan in either table.
    expect(db.query('SELECT seq FROM events ORDER BY seq').all()).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(db.query('SELECT seq FROM event_detail ORDER BY seq').all()).toEqual([
      { seq: 1 },
      { seq: 2 },
    ]);
  });

  test('a payload without a complete token breakdown is stored and flagged', () => {
    const { store, reader } = open();
    const incomplete = item(
      usagePayloadNumber(7, {
        token_breakdown: { ...(usagePayload().token_breakdown as object), quality: 'unclassified' },
      })
    );
    expect(store.insert([item(usagePayload()), incomplete], INGEST.subscribed).inserted).toBe(2);
    const rows = reader()
      .query<
        { input_total: number; input_uncached: number; output_total: number; complete: number },
        [number]
      >(
        `SELECT input_total, input_uncached, output_total, (usage_flags & ?) != 0 AS complete
         FROM events ORDER BY seq`
      )
      .all(USAGE_FLAG.breakdownComplete);
    expect(rows).toEqual([
      { input_total: 950, input_uncached: 100, output_total: 200, complete: 1 },
      { input_total: 100, input_uncached: 100, output_total: 140, complete: 0 },
    ]);
  });

  test('sequence numbers continue after a restart and never repeat', () => {
    const first = open();
    first.store.insert(
      [item(usagePayloadNumber(1)), item(usagePayloadNumber(2))],
      INGEST.subscribed
    );
    first.close();
    const second = open({ root: first.root });
    second.store.insert([item(usagePayloadNumber(2)), item(usagePayloadNumber(3))], INGEST.drained);
    expect(second.reader().query('SELECT seq, ingest FROM events ORDER BY seq').all()).toEqual([
      { seq: 1, ingest: 0 },
      { seq: 2, ingest: 0 },
      { seq: 3, ingest: 1 },
    ]);
  });

  test('a failed batch stores nothing and the next batch is unaffected', () => {
    const { store, reader } = open();
    const broken = item(usagePayloadNumber(2, { alias: 'only-in-the-broken-batch' }));
    (broken.event.tokens as { total: unknown }).total = null;
    expect(() => store.insert([item(usagePayloadNumber(1)), broken], INGEST.subscribed)).toThrow();
    const db = reader();
    expect(count(db, 'events')).toBe(0);
    expect(count(db, 'event_detail')).toBe(0);
    expect(count(db, 'dim')).toBe(0);
    // The dictionary ids and sequence numbers handed out before the failure were rolled back.
    expect(
      store.insert([item(usagePayloadNumber(1)), item(usagePayloadNumber(3))], INGEST.subscribed)
    ).toEqual({
      inserted: 2,
      duplicates: 0,
    });
    expect(db.query('SELECT seq FROM events ORDER BY seq').all()).toEqual([{ seq: 1 }, { seq: 2 }]);
    expect(
      db
        .query(
          `SELECT count(*) AS missing FROM events e LEFT JOIN dim model ON model.id = e.model_id
           WHERE model.id IS NULL`
        )
        .get()
    ).toEqual({ missing: 0 });
    expect(count(db, "dim WHERE value = 'only-in-the-broken-batch'")).toBe(0);
  });

  test('a reader sees committed rows while the writer stays open', () => {
    const { store, reader } = open();
    const db = reader();
    expect(count(db, 'events')).toBe(0);
    store.insert([item(usagePayload())], INGEST.subscribed);
    expect(count(db, 'events')).toBe(1);
  });
});

describe('usage store sessions and credentials', () => {
  const uuid = (version: number, tail: string) =>
    `0f0e0d0c-0b0a-${version}908-8706-0000000000${tail}`;
  const sessions = (db: Database) =>
    db
      .query<{ uuid: string; parent: string | null; derived: number }, []>(
        `SELECT s.uuid, p.uuid AS parent, s.derived FROM session s
         LEFT JOIN session p ON p.id = s.parent_id ORDER BY s.id`
      )
      .all();

  test('a session is stored once, however many events and batches name it', () => {
    const { store, reader } = open();
    const session = { session_id: uuid(7, 'aa') };
    store.insert(
      [item(usagePayloadNumber(1, session)), item(usagePayloadNumber(2, session))],
      INGEST.subscribed
    );
    store.insert(
      [item(usagePayloadNumber(2, session)), item(usagePayloadNumber(3, session))],
      INGEST.drained
    );
    store.insert([item(usagePayloadNumber(4, { session_id: '' }))], INGEST.subscribed);
    const db = reader();
    expect(sessions(db)).toEqual([{ uuid: uuid(7, 'aa'), parent: null, derived: 0 }]);
    expect(
      db
        .query(
          `SELECT e.seq, s.uuid FROM events e LEFT JOIN session s ON s.id = e.session_id ORDER BY e.seq`
        )
        .all()
    ).toEqual([
      { seq: 1, uuid: uuid(7, 'aa') },
      { seq: 2, uuid: uuid(7, 'aa') },
      { seq: 3, uuid: uuid(7, 'aa') },
      { seq: 4, uuid: null },
    ]);
    // Sessions stay out of the dictionary that search scans.
    expect(count(db, `dim WHERE value = '${uuid(7, 'aa')}'`)).toBe(0);
  });

  test('a derived session is flagged, and a subagent session links to its parent', () => {
    const { store, reader } = open();
    const child = { session_id: uuid(8, 'c1'), parent_session_id: uuid(4, 'a1') };
    store.insert([item(usagePayloadNumber(1, child))], INGEST.subscribed);
    const db = reader();
    // The parent row exists before any event of its own, with its own provenance.
    expect(sessions(db)).toEqual([
      { uuid: uuid(4, 'a1'), parent: null, derived: 0 },
      { uuid: uuid(8, 'c1'), parent: uuid(4, 'a1'), derived: 1 },
    ]);
    // The parent's own event reuses that row, and can still report a parent of its own.
    store.insert(
      [
        item(
          usagePayloadNumber(2, { session_id: uuid(4, 'a1'), parent_session_id: uuid(8, 'f0') })
        ),
        item(usagePayloadNumber(3, child)),
      ],
      INGEST.subscribed
    );
    expect(sessions(db)).toEqual([
      { uuid: uuid(4, 'a1'), parent: uuid(8, 'f0'), derived: 0 },
      { uuid: uuid(8, 'c1'), parent: uuid(4, 'a1'), derived: 1 },
      { uuid: uuid(8, 'f0'), parent: null, derived: 1 },
    ]);
    // The first parent a session is reported with stays its parent.
    store.insert(
      [
        item(
          usagePayloadNumber(4, { session_id: uuid(8, 'c1'), parent_session_id: uuid(8, 'f0') })
        ),
      ],
      INGEST.subscribed
    );
    expect(sessions(db)[1]).toEqual({ uuid: uuid(8, 'c1'), parent: uuid(4, 'a1'), derived: 1 });
    // What each event itself reported stays readable for the request inspector.
    expect(
      db.query('SELECT session_id, parent_session_id FROM event_detail WHERE seq = 4').get()
    ).toEqual({ session_id: uuid(8, 'c1'), parent_session_id: uuid(8, 'f0') });
  });

  test('the auth index is interned as its own kind, apart from the account label', () => {
    const { store, reader } = open();
    const labelled = normalizeUsagePayload(JSON.stringify(usagePayloadNumber(1)), () => ({
      account: 'synthetic@example.test',
      label: 'Synthetic account',
    }));
    if (labelled.kind !== 'event') throw new Error('expected an event');
    store.insert(
      [
        labelled,
        item(usagePayloadNumber(2)),
        item(usagePayloadNumber(3, { auth_index: '' })),
        item(usagePayloadNumber(4, { auth_index: '9' })),
      ],
      INGEST.subscribed
    );
    const db = reader();
    expect(
      db
        .query(
          `SELECT e.seq, i.kind, i.value AS auth_index, a.value AS account FROM events e
           LEFT JOIN dim i ON i.id = e.auth_index_id LEFT JOIN dim a ON a.id = e.account_id
           ORDER BY e.seq`
        )
        .all()
    ).toEqual([
      { seq: 1, kind: 'auth_index', auth_index: '3', account: 'synthetic@example.test' },
      { seq: 2, kind: 'auth_index', auth_index: '3', account: '3' },
      { seq: 3, kind: null, auth_index: null, account: null },
      { seq: 4, kind: 'auth_index', auth_index: '9', account: '9' },
    ]);
    expect(count(db, `dim WHERE kind = 'auth_index'`)).toBe(2);
  });
});

describe('usage store migrations', () => {
  const database = () => {
    const root = mkdtempSync('/dev/shm/prox-usage-migrate-');
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const db = new Database(join(root, 'usage.sqlite'), { create: true, strict: true });
    cleanups.push(() => db.close());
    return db;
  };
  const version = (db: Database) =>
    (db.query(`SELECT value FROM meta WHERE key = 'schema_version'`).get() as { value: string })
      .value;
  const tables = (db: Database) =>
    db
      .query<{ name: string }, []>(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
      )
      .all()
      .map((table) => table.name);
  const SECOND = 'CREATE TABLE second (id INTEGER PRIMARY KEY); INSERT INTO second VALUES (1);';
  const THIRD = 'CREATE TABLE third (id INTEGER PRIMARY KEY);';

  test('the initial schema is migration 1, and running it again changes nothing', () => {
    const db = database();
    migrateUsageDatabase(db);
    expect(version(db)).toBe(String(USAGE_MIGRATIONS.length));
    expect(USAGE_MIGRATIONS).toHaveLength(5);
    const before = tables(db);
    expect(before).toContain('events');
    // Migration 1 is plain CREATE TABLE: a second run of it would fail, so it did not run.
    migrateUsageDatabase(db);
    migrateUsageDatabase(db);
    expect(tables(db)).toEqual(before);
    expect(version(db)).toBe(String(USAGE_MIGRATIONS.length));
  });

  test('only the migrations a database has not seen are applied, in order', () => {
    const db = database();
    migrateUsageDatabase(db);
    db.exec(`INSERT INTO dim (kind, value) VALUES ('model', 'kept')`);
    migrateUsageDatabase(db, [...USAGE_MIGRATIONS, SECOND, THIRD]);
    expect(version(db)).toBe(String(USAGE_MIGRATIONS.length + 2));
    expect(tables(db)).toEqual(expect.arrayContaining(['second', 'third']));
    expect(count(db, 'dim')).toBe(1);
    // Again with the same list: the second migration's insert must not repeat.
    migrateUsageDatabase(db, [...USAGE_MIGRATIONS, SECOND, THIRD]);
    expect(count(db, 'second')).toBe(1);
    expect(version(db)).toBe(String(USAGE_MIGRATIONS.length + 2));
  });

  test('a failing migration rolls back whole and leaves the version where it was', () => {
    const db = database();
    migrateUsageDatabase(db);
    const broken = 'CREATE TABLE half (id INTEGER PRIMARY KEY); INSERT INTO missing VALUES (1);';
    expect(() => migrateUsageDatabase(db, [...USAGE_MIGRATIONS, SECOND, broken])).toThrow();
    // The one before it committed; the broken one left nothing behind.
    expect(version(db)).toBe(String(USAGE_MIGRATIONS.length + 1));
    expect(tables(db)).toContain('second');
    expect(tables(db)).not.toContain('half');
  });

  test('migrations never run backwards: a newer database is refused untouched', () => {
    const db = database();
    migrateUsageDatabase(db, [...USAGE_MIGRATIONS, SECOND]);
    const before = tables(db);
    expect(() => migrateUsageDatabase(db)).toThrow(
      new RegExp(`schema version ${USAGE_MIGRATIONS.length + 1}`)
    );
    expect(tables(db)).toEqual(before);
    expect(version(db)).toBe(String(USAGE_MIGRATIONS.length + 1));
  });

  test('the writer migrates at start and reopening is a no-op', () => {
    const first = open();
    first.store.insert([item(usagePayload())], INGEST.subscribed);
    first.close();
    const second = open({ root: first.root });
    expect(second.store.getMeta('schema_version')).toBe(String(USAGE_MIGRATIONS.length));
    expect(count(second.reader(), 'events')).toBe(1);
  });
});

describe('usage store secrets and the raw buffer', () => {
  const hostile = () =>
    usagePayload({
      failed: true,
      fail: { status_code: 502, body: `${FAIL_BODY} ${SECRET.failKey}`, code: 'upstream_error' },
      endpoint: `POST /v1/messages?key=${SECRET.query}`,
      brand_new_field: SECRET.unknownField,
    });
  const payloads = (path: string) => {
    const db = new Database(path, { readonly: true });
    try {
      return db
        .query<{ seq: number; ts_ms: number; dropped_keys: number; payload: Uint8Array }, []>(
          'SELECT seq, ts_ms, dropped_keys, payload FROM payloads ORDER BY seq'
        )
        .all()
        .map((row) => ({ ...row, payload: gunzipSync(row.payload).toString('utf8') }));
    } finally {
      db.close();
    }
  };

  test('no secret reaches either file', () => {
    const { store, close, root, raw } = open();
    store.insert([item(hostile())], INGEST.subscribed);
    const rejected = normalizeUsagePayload(JSON.stringify({ ...hostile(), execution_id: '' }));
    if (rejected.kind !== 'rejected') throw new Error('expected a rejection');
    store.recordRejected(rejected.reason, rejected.raw);
    store.recordRejected('not-json', null);

    const scan = () => {
      const files = readdirSync(root);
      for (const file of files) {
        const bytes = readFileSync(join(root, file));
        for (const [name, secret] of Object.entries(SECRET)) {
          expect({ file, name, found: bytes.includes(secret) }).toEqual({
            file,
            name,
            found: false,
          });
        }
      }
      return files;
    };
    // While open (database, write-ahead log) and after the final checkpoint.
    expect(scan()).toContain('usage.sqlite-wal');
    const stored = payloads(raw as string);
    close();
    expect(scan().sort()).toEqual(['usage-raw.sqlite', 'usage.sqlite']);

    // The buffered payload is compressed, so look inside it too. It still holds the event.
    expect(stored).toHaveLength(1);
    for (const secret of Object.values(SECRET)) expect(stored[0].payload).not.toContain(secret);
    expect(stored[0]).toMatchObject({
      seq: 1,
      ts_ms: Date.UTC(2026, 3, 25, 0, 0, 0, 123),
      dropped_keys: 1,
    });
    const kept = JSON.parse(stored[0].payload);
    expect(kept.execution_id).toBe('12345678-1234-4234-8234-123456789abc');
    expect(kept.fail).toEqual({ status_code: 502, code: 'upstream_error' });
    for (const key of ['api_key', 'source', 'access_token_sha256', 'response_headers']) {
      expect(Object.keys(kept)).not.toContain(key);
    }

    const db = new Database(raw as string, { readonly: true });
    cleanups.push(() => db.close());
    const rejects = db
      .query<{ reason: string; received_at_ms: number; payload: Uint8Array | null }, []>(
        'SELECT reason, received_at_ms, payload FROM rejects ORDER BY id'
      )
      .all();
    expect(rejects.map((row) => [row.reason, row.received_at_ms, row.payload === null])).toEqual([
      ['missing-execution-id', NOW, false],
      ['not-json', NOW, true],
    ]);
    const rejectedText = gunzipSync(rejects[0].payload as Uint8Array).toString('utf8');
    for (const secret of Object.values(SECRET)) expect(rejectedText).not.toContain(secret);
  });

  test('the client key is findable only by its hash', () => {
    const { store, reader } = open();
    store.insert([item(usagePayload())], INGEST.subscribed);
    expect(
      reader().query<{ value: string }, []>(`SELECT value FROM dim WHERE kind = 'api_key'`).all()
    ).toEqual([{ value: createHash('sha256').update(SECRET.apiKey).digest('hex') }]);
  });

  test('the raw buffer holds a payload only for an event that was stored', () => {
    const { store, raw } = open();
    const imported: IngestItem = { event: item(usagePayloadNumber(2)).event, raw: null };
    store.insert([item(usagePayloadNumber(1)), imported], INGEST.subscribed);
    store.insert([item(usagePayloadNumber(1))], INGEST.drained);
    expect(payloads(raw as string).map((row) => row.seq)).toEqual([1]);
  });

  test('the raw buffer is pruned by age and events are kept', () => {
    const { store, raw, reader } = open();
    store.insert(
      [
        item(usagePayloadNumber(1, { timestamp: '2026-04-01T00:00:00Z' })),
        item(usagePayloadNumber(2, { timestamp: '2026-05-01T00:00:00Z' })),
      ],
      INGEST.subscribed
    );
    store.recordRejected('not-json', null);
    expect(store.pruneRawBefore(Date.UTC(2026, 3, 15)).deleted).toBe(1);
    expect(payloads(raw as string).map((row) => row.seq)).toEqual([2]);
    expect(store.pruneRawBefore(NOW + 1).deleted).toBe(2);
    expect(count(reader(), 'events')).toBe(2);
  });

  test('raw prune scans bounded keyset pages even when all rejects are fresh', () => {
    const { store, raw } = open();
    const db = new Database(raw as string);
    cleanups.push(() => db.close());
    db.transaction(() => {
      const put = db.query("INSERT INTO rejects VALUES (?, ?, 'not-json', NULL, NULL)");
      for (let id = 1; id <= 1001; id += 1) put.run(id, id === 1001 ? NOW - 1 : NOW);
    })();
    const first = store.pruneRawBefore(NOW);
    expect(first).toEqual({ cursor: { rejectId: 1000 }, deleted: 0, done: false });
    const second = store.pruneRawBefore(NOW, first.cursor);
    expect(second).toEqual({ cursor: { rejectId: 1001 }, deleted: 1, done: true });
    expect(count(db, 'rejects')).toBe(1000); // exactly at cutoff is retained
  });

  test('payload expiry is a covering index search even when every payload is fresh', () => {
    const { store, raw } = open();
    const db = new Database(raw as string);
    cleanups.push(() => db.close());
    db.transaction(() => {
      const insert = db.query('INSERT INTO payloads VALUES (?, ?, 0, ?)');
      for (let id = 1; id <= 2001; id += 1) insert.run(id, NOW, new Uint8Array(4096));
    })();
    const plan = db
      .query<{ detail: string }, [number, number]>(
        'EXPLAIN QUERY PLAN SELECT seq FROM payloads WHERE ts_ms < ? ORDER BY ts_ms, seq LIMIT ?'
      )
      .all(NOW, 1000)
      .map((row) => row.detail)
      .join(' ');
    expect(plan).toContain('SEARCH payloads USING COVERING INDEX payloads_ts (ts_ms<?)');
    expect(plan).not.toContain('SCAN');
    expect(plan).not.toContain('TEMP B-TREE');
    expect(store.pruneRawBefore(NOW)).toMatchObject({ deleted: 0, done: true });
    // Late expired traffic can have a greater seq than every fresh payload.
    db.query('INSERT INTO payloads VALUES (2002, ?, 0, ?)').run(NOW - 1, new Uint8Array());
    expect(store.pruneRawBefore(NOW)).toMatchObject({ deleted: 1, done: true });
    // EXPLAIN can retain this connection's read snapshot on Bun; observe a fresh reader.
    const latest = new Database(raw as string);
    cleanups.push(() => latest.close());
    expect(count(latest, 'payloads')).toBe(2001);
  });

  test('without a raw buffer, events are still stored and nothing else is written', () => {
    const { store, reader, root } = open({ raw: false });
    expect(store.insert([item(usagePayload())], INGEST.imported).inserted).toBe(1);
    store.recordRejected('not-json', null);
    expect(store.pruneRawBefore(NOW).deleted).toBe(0);
    expect(count(reader(), 'events')).toBe(1);
    expect(readdirSync(root).filter((file) => file.includes('raw'))).toEqual([]);
  });
});
