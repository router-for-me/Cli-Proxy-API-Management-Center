import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { UsageBackup } from '../server/usage/backup';
import { normalizeUsagePayload } from '../server/usage/normalize';
import { runRestoreCheck } from '../server/usage/restoreCheck';
import { UsageStore } from '../server/usage/store';
import { INGEST } from '../server/usage/types';
import { usagePayloadNumber } from './fixtures/usagePayloads';
import { fakeIo } from './helpers/usageIo';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function fixture(events = 100) {
  const scratch = mkdtempSync('/dev/shm/prox-restore-test-');
  const liveRoot = mkdtempSync('/dev/shm/prox-restore-live-');
  cleanups.push(() => rmSync(scratch, { recursive: true, force: true }));
  cleanups.push(() => rmSync(liveRoot, { recursive: true, force: true }));
  const livePath = join(liveRoot, 'usage.sqlite');
  const store = new UsageStore({ events: livePath, raw: null });
  cleanups.push(() => store.close());
  // Event n happened n seconds after the epoch below; `at` lets a late arrival carry an old time.
  const insert = (from: number, count: number, at = from) =>
    store.insert(
      Array.from({ length: count }, (_, i) => {
        const timestamp = new Date(Date.UTC(2026, 3, 25) + (at + i) * 1000).toISOString();
        const result = normalizeUsagePayload(
          JSON.stringify(usagePayloadNumber(from + i, { timestamp }))
        );
        if (result.kind !== 'event') throw new Error('invalid fixture');
        return { event: result.event, raw: null };
      }),
      INGEST.subscribed
    );
  insert(0, events);
  // An in-memory bucket: PUT stores, GET reads, ListObjectsV2 lists.
  const objects = new Map<string, Uint8Array>();
  let getStatus = 200;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const key = decodeURIComponent(url.pathname.replace(/^\/synthetic-backups\/?/, ''));
      if (request.method === 'PUT') {
        objects.set(key, new Uint8Array(await request.arrayBuffer()));
        return new Response('');
      }
      if (url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') ?? '';
        const contents = [...objects]
          .filter(([name]) => name.startsWith(prefix))
          .map(
            ([name, bytes]) => `<Contents><Key>${name}</Key><Size>${bytes.length}</Size></Contents>`
          );
        return new Response(
          `<?xml version="1.0"?><ListBucketResult><IsTruncated>false</IsTruncated>${contents.join('')}</ListBucketResult>`,
          { headers: { 'content-type': 'application/xml' } }
        );
      }
      const bytes = objects.get(key);
      return bytes && getStatus === 200
        ? new Response(bytes)
        : new Response('', { status: bytes ? getStatus : 404 });
    },
  });
  cleanups.push(() => server.stop(true));
  const config = {
    endpoint: server.url.origin,
    bucket: 'synthetic-backups',
    accessKeyId: 'SYNTHETIC-KEY',
    secretAccessKey: 'SYNTHETIC-SECRET',
    tmpfsDir: scratch,
  };
  const io = fakeIo({ bytesPerSecond: 100_000_000 });
  const backup = async (day: number) => {
    const report = await new UsageBackup(config, {
      governor: io.governor,
      now: () => Date.UTC(2026, 10, day),
      rowsPerStep: 20,
    }).run(store);
    expect(readdirSync(scratch)).toEqual([]);
    return report;
  };
  const check = (options: { key?: string; signal?: AbortSignal; rangeRows?: number } = {}) =>
    runRestoreCheck({ config, livePath, governor: io.governor, ...options });
  return {
    scratch,
    livePath,
    store,
    insert,
    objects,
    config,
    io,
    backup,
    check,
    setGetStatus: (status: number) => {
      getStatus = status;
    },
  };
}

describe('usage restore check', () => {
  test('latest backup restores: counts equal at the high-water mark, newer live rows allowed', async () => {
    const f = fixture();
    await f.backup(15);
    f.insert(500, 7); // The writer carried on after the snapshot.
    await f.backup(16);
    f.insert(600, 5);
    const verdict = await f.check();
    expect(verdict.failures).toEqual([]);
    expect(verdict.ok).toBe(true);
    // Newest daily object, not an older one.
    expect(verdict.key).toBe('usage/daily/usage-20261116.sqlite');
    expect(verdict.integrity).toBe('ok');
    expect(verdict.opens).toBe(true);
    expect(verdict.schema).toMatchObject({ match: true });
    expect(verdict.schema.backup).toBe(verdict.schema.live);
    const events = verdict.tables.find((t) => t.name === 'events')!;
    expect(events).toMatchObject({
      kind: 'append-only',
      backupRows: 107,
      liveRowsAtHighWater: 107,
      ok: true,
    });
    expect(events.liveMax!).toBeGreaterThan(events.backupMax!);
    // Rolled-up and mutable tables are listed, not compared.
    expect(verdict.tables.find((t) => t.name === 'usage_hour_rollup')).toMatchObject({
      kind: 'unchecked',
    });
    // Paced: the download was charged to the governor.
    expect(verdict.io.bytesWritten).toBeGreaterThanOrEqual(verdict.sizeBytes);
    // Cleans up after itself.
    expect(readdirSync(f.scratch)).toEqual([]);
  });

  test('sliced live scans: late arrivals with old timestamps are excluded, a lost row in any slice fails', async () => {
    const f = fixture(100);
    await f.backup(15);
    // Replayed after the snapshot: newer seq, but timestamps inside the backup's time range.
    f.insert(900, 10, 20);
    const sliced = await f.check({ rangeRows: 30 });
    expect(sliced.failures).toEqual([]);
    const events = sliced.tables.find((t) => t.name === 'events')!;
    expect(events.ranges).toBeGreaterThan(2);
    expect(events).toMatchObject({ backupRows: 100, liveRowsAtHighWater: 100 });
    const other = new Database(f.livePath);
    cleanups.push(() => other.close());
    // seq 70 sits in a later slice than the first.
    other.exec('DELETE FROM events WHERE seq = 70');
    const lost = await f.check({ rangeRows: 30 });
    expect(lost.ok).toBe(false);
    expect(lost.tables.find((t) => t.name === 'events')).toMatchObject({ liveRowsAtHighWater: 99 });
  });

  test('an explicit key is honoured', async () => {
    const f = fixture();
    await f.backup(15);
    f.insert(500, 3);
    await f.backup(16);
    const verdict = await f.check({ key: 'usage/daily/usage-20261115.sqlite' });
    expect(verdict.ok).toBe(true);
    expect(verdict.key).toBe('usage/daily/usage-20261115.sqlite');
    expect(verdict.tables.find((t) => t.name === 'events')).toMatchObject({ backupRows: 100 });
  });

  test('live missing a row the backup holds fails, naming the table', async () => {
    const f = fixture();
    await f.backup(15);
    const other = new Database(f.livePath);
    cleanups.push(() => other.close());
    other.exec('DELETE FROM events WHERE seq = 5');
    const verdict = await f.check();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual([
      'events: rows differ from live up to the backup high-water mark',
    ]);
    expect(verdict.tables.find((t) => t.name === 'events')).toMatchObject({
      backupRows: 100,
      liveRowsAtHighWater: 99,
      ok: false,
    });
    expect(readdirSync(f.scratch)).toEqual([]);
  });

  test('a different schema version fails the check', async () => {
    const f = fixture();
    await f.backup(15);
    const other = new Database(f.livePath);
    cleanups.push(() => other.close());
    other.exec(`UPDATE meta SET value = '99' WHERE key = 'schema_version'`);
    const verdict = await f.check();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toContain('schema_version differs between backup and live');
    expect(verdict.schema).toMatchObject({ live: 99, match: false });
  });

  test('a corrupted or non-SQLite object is a failed verdict, not a crash', async () => {
    const f = fixture();
    await f.backup(15);
    const key = 'usage/daily/usage-20261115.sqlite';
    f.objects.set(key, new TextEncoder().encode('not a database '.repeat(500)));
    const verdict = await f.check();
    expect(verdict.ok).toBe(false);
    expect(verdict.failures).toEqual(['backup is not a readable SQLite database']);
    // Flip bytes in the middle of a real backup: integrity_check or the open must object.
    await f.backup(16);
    const good = f.objects.get('usage/daily/usage-20261116.sqlite')!;
    const damaged = new Uint8Array(good);
    for (let i = 8192; i < 8192 + 4096; i += 1) damaged[i] = 0xff;
    f.objects.set('usage/daily/usage-20261117.sqlite', damaged);
    const second = await f.check({ key: 'usage/daily/usage-20261117.sqlite' });
    expect(second.ok).toBe(false);
    expect(readdirSync(f.scratch)).toEqual([]);
  });

  test('download failure and cancellation remove the scratch directory', async () => {
    const f = fixture();
    await f.backup(15);
    f.setGetStatus(503);
    await expect(f.check()).rejects.toThrow('HTTP 503');
    expect(readdirSync(f.scratch)).toEqual([]);
    f.setGetStatus(200);
    await expect(f.check({ signal: AbortSignal.abort() })).rejects.toThrow();
    expect(readdirSync(f.scratch)).toEqual([]);
    await expect(fixture().check()).rejects.toThrow('No backup found');
  });

  test('refuses a scratch directory that is not tmpfs or is too small', async () => {
    const f = fixture();
    await f.backup(15);
    await expect(
      runRestoreCheck({
        config: f.config,
        livePath: f.livePath,
        governor: f.io.governor,
        filesystemInfo: () => ({ isTmpfs: false, freeBytes: Infinity }),
      })
    ).rejects.toThrow('must be tmpfs');
    await expect(
      runRestoreCheck({
        config: f.config,
        livePath: f.livePath,
        governor: f.io.governor,
        filesystemInfo: () => ({ isTmpfs: true, freeBytes: 10 }),
      })
    ).rejects.toThrow('Insufficient tmpfs');
    expect(readdirSync(f.scratch)).toEqual([]);
  });
});
