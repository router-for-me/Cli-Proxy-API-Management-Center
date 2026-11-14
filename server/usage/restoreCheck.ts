// Proves a stored backup restores: download, integrity, schema version, and row counts against
// the live database. Runs in its own process (scripts/usage-restore-check.ts), never in the writer
// worker: PRAGMA integrity_check cannot be sliced. The only unpaced step is that pragma, and it
// reads a file on tmpfs. Live is opened read-only and read in paced range chunks.
import { Database } from 'bun:sqlite';
import { closeSync, mkdtempSync, openSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { filesystemInfo, type BackupConfig } from './backup';
import { IoGovernor, runIoChunk } from './ioGovernor';
import { USAGE_MIGRATIONS } from './schema';
import { openUsageReader, UsageStore } from './store';

/** Tables that only ever gain rows: `mark` is their monotonic id, `range` slices a scan. */
const APPEND_ONLY = {
  events: { range: 'ts_ms', mark: 'seq' },
  event_detail: { range: 'seq', mark: 'seq' },
  dim: { range: 'id', mark: 'id' },
  session: { range: 'id', mark: 'id' },
  import_conflicts: { range: 'rowid', mark: 'rowid' },
} as const;
type AppendOnly = keyof typeof APPEND_ONLY;
const RANGE_ROWS = 20_000;
const DOWNLOAD_CHUNK = 64 * 1024;

export interface RestoreTableVerdict {
  name: string;
  /** Only append-only tables are compared with live; rolled-up and mutable tables are not. */
  kind: 'append-only' | 'unchecked';
  backupRows: number;
  backupMax: number | null;
  /** events/event_detail: the backup's meta.next_seq - 1. Others: backupMax. */
  highWater: number | null;
  /** Live rows with id <= highWater. Must equal backupRows. */
  liveRowsAtHighWater: number | null;
  liveMax: number | null;
  ranges: number;
  ok: boolean;
}
export interface RestoreVerdict {
  ok: boolean;
  checkedAtMs: number;
  key: string;
  sizeBytes: number;
  durationMs: number;
  integrity: string;
  schema: { backup: number | null; live: number | null; build: number; match: boolean };
  /** The scratch copy opened as a service database, as a restore would. */
  opens: boolean;
  tables: RestoreTableVerdict[];
  io: IoGovernor['counters'];
  /** Closed vocabulary: no paths, credentials or SQLite text. */
  failures: string[];
}

export interface RestoreCheckOptions {
  config: BackupConfig;
  livePath: string;
  governor: IoGovernor;
  /** Default: the newest object under usage/daily/. */
  key?: string;
  signal?: AbortSignal;
  now?: () => number;
  /** Rows per live scan slice. Default 20,000. */
  rangeRows?: number;
  filesystemInfo?: (path: string) => { isTmpfs: boolean; freeBytes: number };
}

const scalar = (db: Database, sql: string, ...params: (string | number | null)[]) =>
  db.query<{ v: number | null }, (string | number | null)[]>(sql).get(...params)?.v ?? null;
const schemaVersion = (db: Database): number | null => {
  const row = db
    .query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'schema_version'`)
    .get();
  return row ? Number(row.value) : null;
};
const nextSeq = (db: Database) =>
  Number(
    db.query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'next_seq'`).get()?.value ??
      1
  );
const tableNames = (db: Database) =>
  db
    .query<{ name: string }, []>(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`
    )
    .all()
    .map(({ name }) => name);

export async function latestBackupKey(config: BackupConfig, signal?: AbortSignal) {
  const client = new Bun.S3Client({ ...config, region: config.region ?? 'us-east-1' });
  signal?.throwIfAborted();
  const listing = await client.list({ prefix: 'usage/daily/' });
  // Retention keeps about 14 daily objects; a truncated page means the prefix is not what we expect.
  if (listing.isTruncated) throw new Error('Backup listing is truncated; pass an explicit key');
  const keys = (listing.contents ?? []).map((entry) => entry.key).sort();
  const key = keys[keys.length - 1];
  if (!key) throw new Error('No backup found under usage/daily/');
  return key;
}

async function download(
  config: BackupConfig,
  key: string,
  path: string,
  options: RestoreCheckOptions
): Promise<number> {
  const { governor, signal } = options;
  const client = new Bun.S3Client({ ...config, region: config.region ?? 'us-east-1' });
  let response: Response;
  try {
    response = await fetch(client.presign(key, { method: 'GET', expiresIn: 3600 }), {
      redirect: 'error',
      signal,
    });
  } catch {
    signal?.throwIfAborted();
    throw new Error('Restore download failed');
  }
  if (!response.ok || !response.body) {
    await response.body?.cancel();
    throw new Error(`Restore download failed: HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length'));
  const info = (options.filesystemInfo ?? filesystemInfo)(join(path, '..'));
  if (!info.isTmpfs) throw new Error('Restore scratch directory must be tmpfs');
  if (Number.isFinite(declared) && info.freeBytes < declared + declared / 10) {
    await response.body.cancel();
    throw new Error('Insufficient tmpfs space for the restore check');
  }
  const fd = openSync(path, 'w', 0o600);
  let received = 0;
  try {
    for await (const part of response.body) {
      for (let at = 0; at < part.length; at += DOWNLOAD_CHUNK) {
        const piece = part.subarray(at, at + DOWNLOAD_CHUNK);
        await governor.waitForQuietIo(signal);
        writeSync(fd, piece);
        received += piece.length;
        // Network read plus tmpfs write, paced before the next piece is accepted.
        await governor.reportBytes({ read: piece.length, written: piece.length }, signal);
      }
    }
  } finally {
    closeSync(fd);
  }
  if (Number.isFinite(declared) && declared > 0 && received !== declared)
    throw new Error('Restore download ended early');
  return received;
}

/** Backup-side boundaries so the live scan is cut into ~RANGE_ROWS slices with equal predicates. */
function boundaries(backup: Database, table: AppendOnly, rangeRows: number): number[] {
  const { range } = APPEND_ONLY[table];
  const cuts: number[] = [];
  let seen = 0;
  for (const row of backup
    .query<{ v: number }, []>(`SELECT ${range} AS v FROM ${table} ORDER BY ${range}`)
    .iterate()) {
    seen += 1;
    if (seen % rangeRows === 0 && row.v > (cuts[cuts.length - 1] ?? -Infinity)) cuts.push(row.v);
  }
  return cuts;
}

async function compareTable(
  table: AppendOnly,
  backup: Database,
  live: Database,
  options: RestoreCheckOptions
): Promise<RestoreTableVerdict> {
  const { range, mark } = APPEND_ONLY[table];
  const backupRows = scalar(backup, `SELECT count(*) AS v FROM ${table}`)!;
  const backupMax = scalar(backup, `SELECT max(${mark}) AS v FROM ${table}`);
  // The `seq` tables' high-water mark is meta.next_seq - 1, which the snapshot copied atomically
  // with the rows: a backup missing its newest rows (or all of them) cannot hide behind its own
  // surviving max. events.seq has no index, so live's mark comes from meta too.
  const highWater = mark === 'seq' ? nextSeq(backup) - 1 : backupMax;
  const verdict: RestoreTableVerdict = {
    name: table,
    kind: 'append-only',
    backupRows,
    backupMax,
    highWater,
    liveRowsAtHighWater: 0,
    liveMax:
      mark === 'seq' ? nextSeq(live) - 1 : scalar(live, `SELECT max(${mark}) AS v FROM ${table}`),
    ranges: 0,
    ok: true,
  };
  // Without a seq mark, an empty table has no high-water mark; live may hold anything newer.
  if (highWater === null) return verdict;
  const cuts = boundaries(backup, table, options.rangeRows ?? RANGE_ROWS);
  const edges: (number | null)[] = [null, ...cuts, null];
  const sql = (low: boolean, high: boolean) =>
    `SELECT count(*) AS v FROM ${table} WHERE ${mark} <= ?` +
    (low ? ` AND ${range} >= ?` : '') +
    (high ? ` AND ${range} < ?` : '');
  let liveRows = 0;
  for (let i = 0; i + 1 < edges.length; i += 1) {
    const [low, high] = [edges[i], edges[i + 1]];
    const params = [highWater, ...(low === null ? [] : [low]), ...(high === null ? [] : [high])];
    const query = sql(low !== null, high !== null);
    const want = backup.query<{ v: number }, number[]>(query).get(...params)!.v;
    const got = await runIoChunk(
      'restore-check',
      () => live.query<{ v: number }, number[]>(query).get(...params)!.v,
      { governor: options.governor, signal: options.signal }
    );
    liveRows += got;
    verdict.ranges += 1;
    // A slice that differs is the evidence; keep scanning only to total the table.
    if (got !== want) verdict.ok = false;
  }
  verdict.liveRowsAtHighWater = liveRows;
  verdict.ok &&= liveRows === backupRows && (verdict.liveMax ?? -Infinity) >= highWater;
  return verdict;
}

export async function runRestoreCheck(options: RestoreCheckOptions): Promise<RestoreVerdict> {
  const now = options.now ?? Date.now;
  const started = now();
  const { signal } = options;
  const failures: string[] = [];
  const key = options.key ?? (await latestBackupKey(options.config, signal));
  const directory = mkdtempSync(join(options.config.tmpfsDir ?? '/dev/shm', 'prox-usage-restore-'));
  let backup: Database | undefined;
  let live: Database | undefined;
  try {
    const path = join(directory, 'restore.sqlite');
    const sizeBytes = await download(options.config, key, path, options);
    live = openUsageReader(options.livePath);
    // Governed scans count read() bytes; mmap would hide them.
    live.exec('PRAGMA mmap_size = 0');
    let integrity: string;
    try {
      backup = new Database(path, { readonly: true });
      integrity = backup
        .query<{ integrity_check: string }, []>('PRAGMA integrity_check(10)')
        .all()
        .map((row) => row.integrity_check)
        .join('; ');
    } catch {
      // Not a database at all: that is a verdict, not a crash.
      failures.push('backup is not a readable SQLite database');
      return {
        ok: false,
        checkedAtMs: now(),
        key,
        sizeBytes,
        durationMs: now() - started,
        integrity: 'unreadable',
        schema: {
          backup: null,
          live: schemaVersion(live),
          build: USAGE_MIGRATIONS.length,
          match: false,
        },
        opens: false,
        tables: [],
        io: options.governor.counters,
        failures,
      };
    }
    if (integrity !== 'ok') failures.push('integrity_check failed');

    const schema = {
      backup: schemaVersion(backup),
      live: schemaVersion(live),
      build: USAGE_MIGRATIONS.length,
      match: false,
    };
    schema.match = schema.backup !== null && schema.backup === schema.live;
    if (!schema.match) failures.push('schema_version differs between backup and live');

    const backupTables = tableNames(backup);
    const liveTables = tableNames(live);
    if (backupTables.join() !== liveTables.join()) failures.push('table set differs from live');
    const tables: RestoreTableVerdict[] = [];
    for (const name of backupTables) {
      signal?.throwIfAborted();
      if (name in APPEND_ONLY && liveTables.includes(name)) {
        const verdict = await compareTable(name as AppendOnly, backup, live, options);
        if (!verdict.ok)
          failures.push(`${name}: rows differ from live up to the backup high-water mark`);
        tables.push(verdict);
      } else {
        tables.push({
          name,
          kind: 'unchecked',
          backupRows: scalar(backup, `SELECT count(*) AS v FROM "${name}"`)!,
          backupMax: null,
          highWater: null,
          liveRowsAtHighWater: null,
          liveMax: null,
          ranges: 0,
          ok: true,
        });
      }
    }
    for (const name of Object.keys(APPEND_ONLY))
      if (!backupTables.includes(name)) failures.push(`${name}: missing from the backup`);

    // The restore itself: the service's own open, which migrates forward and sets WAL mode.
    backup.close();
    backup = undefined;
    let opens = false;
    try {
      new UsageStore({ events: path, raw: null }).close();
      opens = true;
    } catch {
      failures.push('backup does not open as a usage database');
    }
    return {
      ok: failures.length === 0,
      checkedAtMs: now(),
      key,
      sizeBytes,
      durationMs: now() - started,
      integrity,
      schema,
      opens,
      tables,
      io: options.governor.counters,
      failures,
    };
  } finally {
    backup?.close();
    live?.close();
    rmSync(directory, { recursive: true, force: true });
  }
}
