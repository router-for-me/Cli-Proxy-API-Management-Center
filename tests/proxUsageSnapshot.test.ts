import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeUsagePayload } from '../server/usage/normalize';
import { UsageSnapshot } from '../server/usage/snapshot';
import { openUsageReader, UsageStore } from '../server/usage/store';
import { INGEST } from '../server/usage/types';
import { usagePayloadNumber } from './fixtures/usagePayloads';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function insert(store: UsageStore, from: number, count: number) {
  store.insert(
    Array.from({ length: count }, (_, i) => {
      const result = normalizeUsagePayload(JSON.stringify(usagePayloadNumber(from + i)));
      if (result.kind !== 'event') throw new Error('invalid fixture');
      return { event: result.event, raw: null };
    }),
    INGEST.subscribed
  );
}
function fixture(events: number) {
  const root = mkdtempSync('/dev/shm/prox-snapshot-test-');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const live = join(root, 'usage.sqlite');
  const store = new UsageStore({ events: live, raw: null });
  cleanups.push(() => store.close());
  insert(store, 0, events);
  const reader = openUsageReader(live);
  cleanups.push(() => reader.close());
  return { root, live, store, reader, dest: join(root, 'snapshot.sqlite') };
}
const tables = (db: Database) =>
  db
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map(({ name }) => name);
const counts = (db: Database) =>
  Object.fromEntries(
    tables(db).map((name) => [
      name,
      db.query<{ n: number }, []>(`SELECT count(*) AS n FROM "${name}"`).get()!.n,
    ])
  );

describe('paced usage snapshot', () => {
  test('commits written during the copy never enter the snapshot and never restart it', () => {
    const f = fixture(300);
    const before = counts(f.reader);
    const snapshot = new UsageSnapshot(f.live, f.dest, { rowsPerStep: 40 });
    cleanups.push(() => snapshot.close());
    let steps = 0;
    let maxRows = 0;
    for (let done = false; !done; steps += 1) {
      done = snapshot.step();
      maxRows = Math.max(maxRows, snapshot.lastStepRows);
      // The live writer keeps committing between steps, as it does while the writer queue runs.
      insert(f.store, 1000 + steps * 5, 5);
      expect(steps).toBeLessThan(500);
    }
    expect(maxRows).toBeLessThanOrEqual(40);
    expect(steps).toBeGreaterThan(8);
    const copy = new Database(f.dest, { readonly: true });
    cleanups.push(() => copy.close());
    expect(counts(copy)).toEqual(before);
    expect(copy.query('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
    const version = `SELECT value FROM meta WHERE key = 'schema_version'`;
    expect(copy.query(version).get()).toEqual(f.reader.query(version).get());
    // The live database kept every later commit.
    expect(counts(f.reader).events).toBeGreaterThan(before.events);
  });

  test('the copy reopens as a service database and keeps rows, keys and indexes', () => {
    const f = fixture(120);
    const snapshot = new UsageSnapshot(f.live, f.dest, { rowsPerStep: 25 });
    cleanups.push(() => snapshot.close());
    while (!snapshot.step());
    const restored = new UsageStore({ events: f.dest, raw: null });
    cleanups.push(() => restored.close());
    const live = f.reader;
    const copy = new Database(f.dest, { readonly: true });
    cleanups.push(() => copy.close());
    for (const query of [
      'SELECT * FROM events ORDER BY ts_ms, seq',
      'SELECT * FROM event_detail ORDER BY seq',
      'SELECT * FROM dim ORDER BY id',
      'SELECT name FROM sqlite_master ORDER BY name',
    ]) {
      expect(copy.query(query).all()).toEqual(live.query(query).all());
    }
    // A rowid table without an integer key keeps its row ids.
    expect(copy.query('SELECT rowid FROM import_conflicts ORDER BY rowid').all()).toEqual(
      live.query('SELECT rowid FROM import_conflicts ORDER BY rowid').all()
    );
  });

  test('taking a snapshot leaves the live database and its WAL byte-identical', () => {
    const f = fixture(150);
    const bytes = () => [f.live, `${f.live}-wal`].map((path) => readFileSync(path));
    const before = bytes();
    const snapshot = new UsageSnapshot(f.live, f.dest, { rowsPerStep: 30 });
    cleanups.push(() => snapshot.close());
    while (!snapshot.step());
    expect(bytes()).toEqual(before);
  });

  test('refuses an in-memory source instead of backing up an empty database', () => {
    const f = fixture(1);
    expect(() => new UsageSnapshot(':memory:', f.dest)).toThrow('needs a file');
  });

  test('closing an unfinished snapshot releases the read mark so the WAL can reset', () => {
    const f = fixture(200);
    const snapshot = new UsageSnapshot(f.live, f.dest, { rowsPerStep: 10 });
    snapshot.step();
    insert(f.store, 5000, 5);
    const other = new Database(f.live);
    cleanups.push(() => other.close());
    const checkpoint = () =>
      other.query<{ busy: number }, []>('PRAGMA wal_checkpoint(RESTART)').get()!;
    expect(checkpoint().busy).toBe(1);
    snapshot.close();
    snapshot.close();
    expect(checkpoint().busy).toBe(0);
    expect(existsSync(f.live)).toBe(true);
  });
});
