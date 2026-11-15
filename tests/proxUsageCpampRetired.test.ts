import { afterEach, expect, test } from 'bun:test';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { UsageWriter } from '../server/usage/writer';
import { createUsageStatusHandler } from '../server/usage/status';
import { CPAMP_SOURCE_NOT_QUIET, openCpampSource } from '../server/usage/store';
import type { BulkJobConfig, BulkJobReport } from '../server/usage/writerProtocol';
import { createCpamp, cpampRow } from './fixtures/cpampUsage';

const cleanups: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const clean of cleanups.splice(0).reverse()) await clean();
});

function scratch() {
  const root = mkdtempSync('/dev/shm/prox-cpamp-retired-');
  // An unwritable directory must be made writable again before it can be removed.
  cleanups.push(() => {
    for (const dir of [root, join(root, 'cpamp')]) {
      try {
        chmodSync(dir, 0o700);
      } catch {
        // The directory is only created by some tests.
      }
    }
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}

// Status and exporter presentation.
function handler(cpampRetired?: boolean) {
  const root = scratch();
  const keyFile = join(root, 'key');
  writeFileSync(keyFile, 'synthetic-key');
  return createUsageStatusHandler({
    keyFile,
    sources: () => [],
    healthy: () => true,
    writer: () => ({
      backlog: 0,
      gaps: 0,
      rawBufferFailures: 0,
      inserted: 0,
      duplicates: 0,
      rejected: 0,
    }),
    exporter: async () => ({
      schema_version: 1,
      groups: [],
      newest_event_time_seconds: 0,
      models_priced: 0,
      jobs: {} as never,
      jobs_outcome_error: false,
      rate_book_error: false,
      rate_book_loaded: true,
      client_alias_error: false,
      client_aliases_loaded: true,
    }),
    ...(cpampRetired === undefined ? {} : { cpampRetired }),
  });
}
const get = (path: string) =>
  new Request(`http://127.0.0.1${path}`, { headers: { Authorization: 'Bearer synthetic-key' } });

test('status and exporter report a retired CPAMP as a flag, and never as a source failure', async () => {
  for (const path of ['/v1/status', '/v1/exporter']) {
    const retired = await (await handler(true)(get(path))).json();
    expect(retired.cpamp_retired).toBe(true);
    // The collector sources are only the proxies; retirement adds no failing source.
    expect(retired.sources).toEqual([]);
    expect((await (await handler(false)(get(path))).json()).cpamp_retired).toBe(false);
    // Unset means a server started without the switch: reported false, never absent.
    expect((await (await handler()(get(path))).json()).cpamp_retired).toBe(false);
  }
});

// Bulk jobs through the real writer worker.
async function writerFixture(config: BulkJobConfig, setup?: (cpampDir: string) => void) {
  const root = scratch();
  const cpampDir = join(root, 'cpamp');
  mkdirSync(cpampDir);
  setup?.(cpampDir);
  const entry = join(root, 'writer.ts');
  writeFileSync(
    entry,
    `
    import { startUsageWriterWorker } from ${JSON.stringify(join(import.meta.dir, '../server/usage/writerRuntime.ts'))};
    startUsageWriterWorker({ readPsi: () => 'full avg10=0 avg60=0' });
  `
  );
  const writer = new UsageWriter(entry);
  cleanups.push(() => writer.close());
  await writer.init({ events: join(root, 'usage.sqlite'), raw: null }, [], Date.now(), {
    cpampPath: join(cpampDir, 'usage.sqlite'),
    backupConfigPath: join(root, 'missing-config.json'),
    bytesPerSecond: 1e15,
    ...config,
  });
  return { root, cpampDir, writer };
}
async function finished(writer: UsageWriter): Promise<BulkJobReport> {
  for (let i = 0; i < 1000; i += 1) {
    const report = await writer.jobReport();
    if (report && report.finishedAtMs !== null) return report;
    await Bun.sleep(10);
  }
  throw new Error('Timed out waiting for bulk job');
}
// Admission can wait for the hourly rollup backfill, as in proxUsageJobs.test.ts.
async function start(writer: UsageWriter, kind: 'import' | 'reconcile' | 'verify' | 'prune') {
  for (let i = 0; i < 1000; i += 1) {
    try {
      return await writer.startJob(kind);
    } catch (error) {
      if (!String(error).includes('Rollup backfill in progress')) throw error;
      await Bun.sleep(20);
    }
  }
  throw new Error(`Timed out waiting for backfill before ${kind}`);
}

test('a retired CPAMP refuses import, reconcile and verify without opening the source; prune runs', async () => {
  // The source path would fail any open attempt with a different, generic job error.
  const f = await writerFixture({
    cpampPath: '/nonexistent/cpamp/usage.sqlite',
    cpampRetired: true,
  });
  for (const kind of ['import', 'reconcile', 'verify'] as const) {
    let message = '';
    try {
      await start(f.writer, kind);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('CPAMP retired');
  }
  expect(await f.writer.jobReport()).toBeNull();
  await start(f.writer, 'prune');
  expect(await finished(f.writer)).toMatchObject({ kind: 'prune', state: 'succeeded' });
});

// Immutable open of a stopped CPAMP file.
function stoppedWalCpamp(dir: string, rows = 5) {
  const path = join(dir, 'usage.sqlite');
  const source = createCpamp(path, rows);
  source.db.exec('PRAGMA journal_mode=WAL');
  // The last close checkpoints and deletes -wal and -shm, as CPAMP's own stop does.
  source.db.close();
  return path;
}

test('immutable=1 reads a stopped WAL database in a directory SQLite cannot write to', () => {
  const dir = join(scratch(), 'cpamp');
  mkdirSync(dir);
  const path = stoppedWalCpamp(dir);
  chmodSync(dir, 0o500); // what the :ro mount does: no -shm can be created
  // The ordinary read-only open is the reason immutable is needed.
  expect(() =>
    openCpampSource(path, false).query('SELECT count(*) FROM usage_events').get()
  ).toThrow();
  const db = openCpampSource(path, true);
  expect(db.query<{ n: number }, []>('SELECT count(*) AS n FROM usage_events').get()).toEqual({
    n: 5,
  });
  expect(db.query('PRAGMA query_only').get()).toEqual({ query_only: 1 });
  db.close();
});

test('immutable=1 refuses a database that is not quiet, because it would skip the -wal', () => {
  const dir = join(scratch(), 'cpamp');
  mkdirSync(dir);
  const path = join(dir, 'usage.sqlite');
  const source = createCpamp(path, 3);
  source.db.exec('PRAGMA journal_mode=WAL');
  // A live writer: its -wal holds frames the immutable open would silently skip.
  source.add(cpampRow(4));
  let message = '';
  try {
    openCpampSource(path, true);
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toBe(CPAMP_SOURCE_NOT_QUIET);
  source.db.close();
  // Closed cleanly, it is quiet again.
  openCpampSource(path, true).close();
  // A stale -shm alone is also refused; an empty -wal is fine.
  writeFileSync(`${path}-wal`, '');
  openCpampSource(path, true).close();
  writeFileSync(`${path}-shm`, '');
  expect(() => openCpampSource(path, true)).toThrow(CPAMP_SOURCE_NOT_QUIET);
});

test('immutable=1 checks the sidecars of the real file behind a symlink, and a hot -journal', () => {
  const root = scratch();
  const real = join(root, 'cpamp');
  mkdirSync(real);
  const path = join(real, 'usage.sqlite');
  const source = createCpamp(path, 3);
  source.db.exec('PRAGMA journal_mode=WAL');
  source.add(cpampRow(4)); // committed, but only in the -wal
  const alias = join(root, 'alias.sqlite');
  symlinkSync(path, alias);
  // The alias has no sidecars beside it; the target's -wal still holds a committed row.
  expect(() => openCpampSource(alias, true)).toThrow(CPAMP_SOURCE_NOT_QUIET);
  source.db.close();
  openCpampSource(alias, true).close();
  // A crashed rollback-journal writer leaves a hot -journal that immutable would skip.
  writeFileSync(`${path}-journal`, 'hot');
  expect(() => openCpampSource(path, true)).toThrow(CPAMP_SOURCE_NOT_QUIET);
});

const stopped =
  (rows = 5, leftover?: string) =>
  (dir: string) => {
    const path = stoppedWalCpamp(dir, rows);
    if (leftover) writeFileSync(`${path}${leftover}`, '');
    chmodSync(dir, 0o500);
  };

test('the final reconcile is exact with 0 conflicts through the immutable open', async () => {
  const f = await writerFixture({ cpampImmutable: true }, stopped(7));
  await start(f.writer, 'reconcile');
  expect(await finished(f.writer)).toMatchObject({
    state: 'succeeded',
    result: {
      kind: 'cpamp',
      report: {
        mode: 'reconcile',
        read: 7,
        inserted: 7,
        conflicts: 0,
        verification: { exact: true },
      },
    },
  });
}, 30_000);

test('without immutable the same stopped file fails the job; a non-quiet file reports why', async () => {
  const plain = await writerFixture({}, stopped());
  await start(plain.writer, 'reconcile');
  expect(await finished(plain.writer)).toMatchObject({ state: 'failed' });

  const busy = await writerFixture({ cpampImmutable: true }, stopped(5, '-shm'));
  await start(busy.writer, 'reconcile');
  expect(await finished(busy.writer)).toMatchObject({
    state: 'failed',
    error: CPAMP_SOURCE_NOT_QUIET,
  });
}, 30_000);
