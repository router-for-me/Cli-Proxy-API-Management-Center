// The only module of the usage service that opens SQLite. Import it from the writer worker and
// the query workers only: never from a thread that owns sockets (RULES.md).
import { Database, type Statement } from 'bun:sqlite';
import {
  chmodSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { INGEST } from './types';
import type { ExporterEvent } from './exporter';
import { gzipSync } from 'node:zlib';
import {
  META_TABLE_SQL,
  RAW_SCHEMA_SQL,
  READER_PRAGMAS_SQL,
  USAGE_MIGRATIONS,
  WRITER_PRAGMAS_SQL,
} from './schema';
import { HOUR_MS } from './aggregate';
import { rebuildNextHour } from './rollup';
import type { RateBook } from './rates';
import type { IngestGap, UsageCursor, UsageCommit } from './writerProtocol';
import type {
  DimKind,
  EventSession,
  IngestItem,
  IngestSource,
  InsertResult,
  NormalizedEvent,
  RejectReason,
  SanitizedPayload,
} from './types';

/** The one mapping from event dictionary columns to their owning dimension kind. */
const EVENT_DIMENSIONS: Record<string, DimKind> = {
  instance_id: 'instance',
  provider_id: 'provider',
  model_id: 'model',
  requested_model_id: 'model',
  billing_model_id: 'model',
  response_model_id: 'model',
  tier_id: 'tier',
  timing_id: 'timing',
  account_id: 'account',
  account_label_id: 'account_label',
  api_key_id: 'api_key',
  user_agent_id: 'user_agent',
  client_ip_id: 'client_ip',
  path_id: 'path',
  method_id: 'method',
  effort_id: 'effort',
  executor_id: 'executor',
  requested_tier_id: 'tier',
  effective_tier_id: 'tier',
  auth_index_id: 'auth_index',
  auth_file_id: 'auth_file',
};
/** The only stored fields a later CPAMP pass may fill: they are NULL on rows that predate them. */
const FILLABLE_FIELDS = ['auth_file_id', 'header_trace_id', 'fail_summary'];

export type ImportValues = Record<string, string | number | null>;
export interface RawPruneCursor {
  rejectId: number;
}
export interface RawPruneChunk {
  cursor: RawPruneCursor;
  deleted: number;
  done: boolean;
}
export const RAW_PRUNE_PAGE_SIZE = 1000;

export interface EventCursor {
  tsMs: number;
  seq: number;
}
export interface ImportDifference {
  executionId: string;
  field: string;
  live: string | null;
  imported: string | null;
}
export interface ImportInspection {
  stored: ImportValues | null;
  differences: ImportDifference[];
}

const EVENT_COLUMNS = [
  'ts_ms',
  'seq',
  'instance_id',
  'provider_id',
  'model_id',
  'requested_model_id',
  'billing_model_id',
  'response_model_id',
  'tier_id',
  'failed',
  'status_code',
  'latency_ms',
  'ttft_ms',
  'timing_id',
  'input_total',
  'input_uncached',
  'cache_read',
  'cache_write',
  'output_total',
  'reasoning',
  'total',
  'usage_flags',
  'record_kind',
  'stream',
  'account_id',
  'account_label_id',
  'api_key_id',
  'user_agent_id',
  'client_ip_id',
  'path_id',
  'method_id',
  'effort_id',
  'executor_id',
  'requested_tier_id',
  'effective_tier_id',
  'session_id',
  'auth_index_id',
  'auth_file_id',
  'ingest',
] as const;
const DETAIL_COLUMNS = [
  'seq',
  'execution_id',
  'ts_ms',
  'request_id',
  'parent_execution_id',
  'session_id',
  'parent_session_id',
  'trace_id',
  'header_trace_id',
  'fail_summary',
  'upstream_start_ms',
  'first_response_ms',
  'first_content_ms',
  'recorded_ms',
  'ingested_at_ms',
] as const;
type Row<Columns extends readonly string[]> = Record<Columns[number], string | number | null>;

const insertSql = (table: string, columns: readonly string[]) =>
  `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `$${c}`).join(', ')})`;

function openWritable(path: string, schemaSql: string): Database {
  if (path !== ':memory:') {
    const file = resolve(path);
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
    closeSync(openSync(file, 'a', 0o600));
    chmodSync(file, 0o600);
  }
  const db = new Database(path, { create: true, strict: true });
  db.exec(WRITER_PRAGMAS_SQL);
  db.exec(schemaSql);
  return db;
}

/**
 * Bring usage.sqlite forward, one migration at a time. A migration and its version number
 * commit together, so a failure leaves the database at the last version that fully applied.
 */
export function migrateUsageDatabase(
  db: Database,
  migrations: readonly string[] = USAGE_MIGRATIONS
): void {
  db.exec(META_TABLE_SQL);
  const stored = db
    .query<{ value: string }, []>(`SELECT value FROM meta WHERE key = 'schema_version'`)
    .get();
  const version = Number(stored?.value ?? 0);
  if (version > migrations.length) {
    throw new Error(
      `usage database has schema version ${version}; this build reads up to ${migrations.length}`
    );
  }
  for (let next = version; next < migrations.length; next += 1) {
    db.transaction(() => {
      db.exec(migrations[next]);
      db.query(
        `INSERT INTO meta (key, value) VALUES ('schema_version', ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`
      ).run(String(next + 1));
    }).immediate();
  }
}

/** A read-only connection for a query worker. The writer must have created the file. */
export function openUsageReader(path: string): Database {
  const db = new Database(path, { readonly: true, strict: true });
  try {
    db.exec(READER_PRAGMAS_SQL);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/** The only job error text that names why the CPAMP file was refused; it holds no path. */
export const CPAMP_SOURCE_NOT_QUIET = 'CPAMP source is not quiet: -wal, -shm or -journal present';
// SQLITE_OPEN_READONLY | SQLITE_OPEN_URI. Bun's string form of the constructor does not enable
// URI filenames, so the flags are passed as a number.
const OPEN_READONLY_URI = 0x01 | 0x40;

/**
 * Open the CPAMP source for import, reconcile or verify.
 * `immutable` is for a CPAMP that has stopped, read through a `:ro` mount: a read-only open of a
 * WAL database must create `-shm`, which that mount forbids. immutable=1 takes no locks and never
 * looks at `-wal` or `-shm`, so frames still in the `-wal` would be silently skipped. It therefore
 * refuses any `-shm`, any non-empty `-wal` and any `-journal` (a hot rollback journal of a crashed
 * non-WAL writer would also be skipped); all are gone after a clean stop or after
 * `PRAGMA wal_checkpoint(TRUNCATE)` run on the host with CPAMP stopped. The path is resolved
 * through symlinks first, because SQLite looks for the sidecars beside the real file.
 */
export function openCpampSource(path: string, immutable: boolean): Database {
  if (!immutable) return openUsageReader(path);
  const real = realpathSync(path);
  const wal = `${real}-wal`;
  if (
    existsSync(`${real}-shm`) ||
    existsSync(`${real}-journal`) ||
    (existsSync(wal) && statSync(wal).size > 0)
  )
    throw new Error(CPAMP_SOURCE_NOT_QUIET);
  const uri = `file:${real.replace(/[%?#]/g, encodeURIComponent)}?immutable=1`;
  const db = new Database(uri, OPEN_READONLY_URI as never);
  try {
    db.exec(READER_PRAGMAS_SQL);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

/**
 * The single write connection of usage.sqlite, and of the raw payload buffer beside it.
 * Inserts are idempotent on `execution_id`; a stored row is never updated.
 */
export class UsageStore {
  rawBufferFailures = 0;
  /** Newly inserted events, published only after the outer transaction commits. */
  onCommit: ((events: readonly NormalizedEvent[]) => void) | null = null;
  private readonly db: Database;
  private readonly raw: Database | null;
  private readonly dims = new Map<string, number>();
  private nextSeq: number;
  private readonly insertDim: Statement;
  private readonly selectDim: Statement<{ id: number }, [string, string]>;
  private readonly insertSession: Statement;
  private readonly selectSession: Statement<{ id: number }, [string]>;
  private readonly adoptParent: Statement;
  private readonly insertDetail: Statement;
  private readonly insertEvent: Statement;
  private readonly insertAll: {
    immediate(items: readonly IngestItem[], ingest: IngestSource, progress?: UsageCommit): Stored[];
  };

  /** `raw: null` runs without the raw payload buffer (imported history brings no payloads). */
  constructor(
    paths: { events: string; raw: string | null },
    private readonly now: () => number = Date.now
  ) {
    this.db = openWritable(paths.events, META_TABLE_SQL);
    try {
      migrateUsageDatabase(this.db);
    } catch (error) {
      this.db.close();
      throw error;
    }
    this.nextSeq = Number(this.getMeta('next_seq') ?? 1);
    this.raw = paths.raw === null ? null : openWritable(paths.raw, RAW_SCHEMA_SQL);

    this.insertDim = this.db.query(
      'INSERT INTO dim (kind, value) VALUES (?, ?) ON CONFLICT (kind, value) DO NOTHING'
    );
    this.selectDim = this.db.query('SELECT id FROM dim WHERE kind = ? AND value = ?');
    this.insertSession = this.db.query(
      'INSERT INTO session (uuid, parent_id, derived) VALUES (?, ?, ?) ON CONFLICT (uuid) DO NOTHING'
    );
    this.selectSession = this.db.query('SELECT id FROM session WHERE uuid = ?');
    this.adoptParent = this.db.query(
      'UPDATE session SET parent_id = ? WHERE id = ? AND parent_id IS NULL'
    );
    this.insertDetail = this.db.query(
      `${insertSql('event_detail', DETAIL_COLUMNS)} ON CONFLICT (execution_id) DO NOTHING`
    );
    this.insertEvent = this.db.query(insertSql('events', EVENT_COLUMNS));

    this.insertAll = this.db.transaction(
      (items: readonly IngestItem[], ingest: IngestSource, progress: UsageCommit = {}) => {
        // Check before inserts: a new record on this page is not a pre-outage receipt.
        if (progress.replayInstance) this.anchorRecovery(progress.replayInstance, items);
        const stored: Stored[] = [];
        const dirtyHours = new Set<number>();
        for (const item of items) {
          const seq = this.nextSeq;
          // The identity check and the write are one statement: a known execution_id writes nothing.
          if (this.insertDetail.run(this.detailRow(item.event, seq)).changes === 0) continue;
          this.nextSeq += 1;
          this.insertEvent.run(this.eventRow(item.event, seq, ingest));
          stored.push({ seq, item });
          dirtyHours.add(Math.floor(item.event.tsMs / HOUR_MS) * HOUR_MS);
        }
        const markDirty = this.db.query(`INSERT INTO usage_hour_state (hour_ms) VALUES (?)
          ON CONFLICT (hour_ms) DO UPDATE SET dirty = 1`);
        for (const hour of dirtyHours) markDirty.run(hour);
        for (const { instance, cursor } of progress.cursors ?? []) {
          const previous = this.getCursor(instance);
          if (
            !previous ||
            previous.bootId !== cursor.bootId ||
            previous.queueSeq < cursor.queueSeq
          ) {
            this.setMeta(`cursor:${instance}`, JSON.stringify(cursor));
            this.setMeta(`cursor-at:${instance}`, String(this.now()));
          }
        }
        if (progress.gap) this.recordGap(progress.gap);
        if (progress.recoveredInstance) this.clearRecovery(progress.recoveredInstance);
        this.setMeta('next_seq', String(this.nextSeq));
        return stored;
      }
    );
  }

  /** Store the events that are not yet known, in one transaction. */
  insert(
    items: readonly IngestItem[],
    ingest: IngestSource,
    progress: UsageCommit = {}
  ): InsertResult {
    const firstSeq = this.nextSeq;
    let stored: Stored[];
    try {
      stored = this.insertAll.immediate(items, ingest, progress);
    } catch (error) {
      // The rollback also undid the sequence numbers and dictionary rows handed out above.
      this.nextSeq = firstSeq;
      this.dims.clear();
      throw error;
    }
    this.onCommit?.(stored.map(({ item }) => item.event));
    this.writeRaw(() => {
      if (!this.raw) return;
      const insertPayload = this.raw.query(
        'INSERT INTO payloads (seq, ts_ms, dropped_keys, payload) VALUES (?, ?, ?, ?)'
      );
      this.raw.transaction(() => {
        for (const { seq, item } of stored) {
          if (!item.raw) continue;
          insertPayload.run(seq, item.event.tsMs, item.raw.droppedKeys, gzipSync(item.raw.json));
        }
      })();
    });
    return { inserted: stored.length, duplicates: items.length - stored.length };
  }

  /** One bounded maintenance job; imports use insert(), so their hours invalidate atomically. */
  rebuildNextHour(book: RateBook, nowMs = this.now(), onHour?: (hour: number) => void) {
    return rebuildNextHour(this.db, book, nowMs, onHour);
  }

  /** Keep what can be kept of a payload that did not become an event. */
  recordRejected(reason: RejectReason, raw: SanitizedPayload | null): void {
    this.writeRaw(() =>
      this.raw
        ?.query(
          'INSERT INTO rejects (received_at_ms, reason, dropped_keys, payload) VALUES (?, ?, ?, ?)'
        )
        .run(this.now(), reason, raw?.droppedKeys ?? null, raw ? gzipSync(raw.json) : null)
    );
  }

  /** Select expired payload keys via the covering time index, without reading fresh BLOB pages.
   * Rejects keyset by id so their scan stays bounded without a startup index build. */
  pruneRawBefore(beforeMs: number, cursor: RawPruneCursor = { rejectId: 0 }): RawPruneChunk {
    if (!this.raw) return { cursor, deleted: 0, done: true };
    return this.raw.transaction(() => {
      const page = (table: string, key: string, after: number) =>
        this.raw!.query<{ id: number }, [number, number]>(
          `SELECT ${key} AS id FROM ${table} WHERE ${key} > ? ORDER BY ${key} LIMIT ?`
        ).all(after, RAW_PRUNE_PAGE_SIZE);
      const payloads = this.raw!.query<{ seq: number }, [number, number]>(
        'SELECT seq FROM payloads WHERE ts_ms < ? ORDER BY ts_ms, seq LIMIT ?'
      ).all(beforeMs, RAW_PRUNE_PAGE_SIZE);
      const rejects = page('rejects', 'id', cursor.rejectId);
      const next = {
        rejectId: rejects[rejects.length - 1]?.id ?? cursor.rejectId,
      };
      const payloadDeleted = payloads.length
        ? this.raw!.query(
            `DELETE FROM payloads WHERE seq IN (${payloads.map(() => '?').join(',')})`
          ).run(...payloads.map((row) => row.seq)).changes
        : 0;
      const deleted =
        payloadDeleted +
        this.raw!.query('DELETE FROM rejects WHERE id > ? AND id <= ? AND received_at_ms < ?').run(
          cursor.rejectId,
          next.rejectId,
          beforeMs
        ).changes;
      return {
        cursor: next,
        deleted,
        done: payloads.length < RAW_PRUNE_PAGE_SIZE && rejects.length < RAW_PRUNE_PAGE_SIZE,
      };
    })();
  }

  getCursor(instance: string): UsageCursor | null {
    const value = this.getMeta(`cursor:${instance}`);
    return value === null ? null : JSON.parse(value);
  }

  getMeta(key: string): string | null {
    const row = this.db
      .query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?')
      .get(key);
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .query(
        'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
      )
      .run(key, value);
  }

  /** Gaps and heartbeats share the event store's sole writer connection. */
  recordGap(gap: IngestGap): void {
    this.db
      .query(
        'INSERT INTO ingest_gaps (instance, from_ms, to_ms, reason, missed) VALUES (?, ?, ?, ?, ?)'
      )
      .run(gap.instance, gap.fromMs, gap.toMs, gap.reason, gap.missed ?? null);
  }

  /** A provisional coverage gap stays visible until replay establishes continuity. */
  recordRecovery(gap: IngestGap, requireAnchor = false): void {
    this.db
      .transaction(() => {
        // Clock regressions must not make a provisional interval end before its start.
        const toMs = Math.max(gap.fromMs, gap.toMs);
        const key = `recovery-gap:${gap.instance}`;
        const existing = this.getMeta(key);
        if (existing !== null) {
          this.db
            .query('UPDATE ingest_gaps SET to_ms = MAX(to_ms, from_ms, ?) WHERE id = ?')
            .run(toMs, Number(existing));
        } else {
          this.recordGap({ ...gap, toMs, missed: null });
          const row = this.db.query<{ id: number }, []>('SELECT last_insert_rowid() AS id').get()!;
          this.setMeta(key, String(row.id));
          // Capture receipt order with the gap, before any recovery traffic can qualify.
          // nextSeq is the authoritative monotonic allocator, including pruned history.
          const checkpointKey = `recovery-checkpoint:${gap.instance}`;
          if (this.getMeta(checkpointKey) === null) {
            this.setMeta(checkpointKey, String(this.nextSeq - 1));
          }
        }
        if (requireAnchor) this.setMeta(`recovery-unanchored:${gap.instance}`, '1');
      })
      .immediate();
  }

  recoveryFromMs(instance: string): number | null {
    const id = this.getMeta(`recovery-gap:${instance}`);
    if (id === null) return null;
    return (
      this.db
        .query<{ from_ms: number }, [number]>('SELECT from_ms FROM ingest_gaps WHERE id = ?')
        .get(Number(id))?.from_ms ?? null
    );
  }

  /** Only a receipt at or before the gap's durable ingestion checkpoint proves coverage. */
  private anchorRecovery(instance: string, items: readonly IngestItem[]): void {
    const key = `recovery-unanchored:${instance}`;
    if (this.getMeta(key) === null) return;
    const saved = this.getMeta(`recovery-checkpoint:${instance}`);
    if (saved === null) return; // Older pending gaps have no safe receipt-order baseline.
    const checkpoint = Number(saved);
    if (!Number.isSafeInteger(checkpoint) || checkpoint < 0) return;
    const prior = this.db.query<{ seq: number }, [string, string]>(`
      SELECT event.seq FROM event_detail detail
      JOIN events event ON event.ts_ms = detail.ts_ms AND event.seq = detail.seq
      JOIN dim instance ON instance.id = event.instance_id
      WHERE detail.execution_id = ? AND instance.kind = 'instance' AND instance.value = ?
    `);
    if (
      items.some(({ event }) => {
        const receipt = prior.get(event.executionId, instance);
        return receipt !== null && receipt.seq <= checkpoint;
      })
    )
      this.db.query('DELETE FROM meta WHERE key = ?').run(key);
  }

  private clearRecovery(instance: string): void {
    const key = `recovery-gap:${instance}`;
    const id = this.getMeta(key);
    if (id === null) return;
    const unanchored = `recovery-unanchored:${instance}`;
    // Without a pre-outage anchor the provisional interval becomes a permanent
    // unknown gap. Detach its metadata so later reconnects cannot erase it.
    if (this.getMeta(unanchored) === null) {
      this.db.query('DELETE FROM ingest_gaps WHERE id = ?').run(Number(id));
    }
    this.db
      .query('DELETE FROM meta WHERE key IN (?, ?, ?)')
      .run(key, unanchored, `recovery-checkpoint:${instance}`);
  }

  /** Open gaps; a provisional one still waits for replay evidence and is never fillable. */
  unfilledGaps(): {
    id: number;
    instance: string;
    from_ms: number;
    to_ms: number;
    provisional: boolean;
  }[] {
    return this.db
      .query<
        { id: number; instance: string; from_ms: number; to_ms: number; provisional: number },
        []
      >(
        `SELECT g.id, g.instance, g.from_ms, g.to_ms, EXISTS (
           SELECT 1 FROM meta m WHERE m.key = 'recovery-gap:' || g.instance
             AND m.value = CAST(g.id AS TEXT)) AS provisional
         FROM ingest_gaps g WHERE g.filled_at_ms IS NULL ORDER BY g.id`
      )
      .all()
      .map((row) => ({ ...row, provisional: !!row.provisional }));
  }

  /** Record which job accounted for these gaps. A gap that is already filled keeps its record. */
  markGapsFilled(ids: readonly number[], by: string, atMs: number): number {
    const update = this.db.query(
      'UPDATE ingest_gaps SET filled_at_ms = ?, filled_by = ? WHERE id = ? AND filled_at_ms IS NULL'
    );
    return this.db
      .transaction(() => ids.reduce((count, id) => count + update.run(atMs, by, id).changes, 0))
      .immediate();
  }

  gapCount(): number {
    return this.db.query<{ count: number }, []>('SELECT count(*) AS count FROM ingest_gaps').get()!
      .count;
  }

  private writeRaw(write: () => unknown): void {
    try {
      write();
    } catch {
      // The event transaction has already committed. Retrying it cannot restore the raw buffer.
      this.rawBufferFailures += 1;
      console.error('Usage raw-buffer write failed; committed events were retained');
    }
  }

  /** Compare through the store contract; callers never reach into the write connection. */
  inspectImportEvents(events: readonly NormalizedEvent[]): ImportInspection[] {
    const projection = Object.keys(EVENT_DIMENSIONS).map(
      (column) => `${column}_dim.value AS ${column}`
    );
    const joins = Object.keys(EVENT_DIMENSIONS).map(
      (column) => `LEFT JOIN dim ${column}_dim ON ${column}_dim.id = e.${column}`
    );
    const select = this.db.query<ImportValues, [string]>(`
      SELECT e.*, d.*, ${projection.join(', ')}, s.uuid AS session_id
      FROM event_detail d JOIN events e ON e.ts_ms = d.ts_ms AND e.seq = d.seq
      ${joins.join(' ')} LEFT JOIN session s ON s.id = e.session_id
      WHERE d.execution_id = ?
    `);
    return events.map((event) => {
      const stored = select.get(event.executionId);
      if (!stored) return { stored: null, differences: [] };
      const expected = {
        ...this.eventRow(event, 0, INGEST.imported, false),
        ...this.detailRow(event, 0),
      };
      // The joined session UUID and the per-event detail UUID agree for valid stored events.
      const differences: ImportDifference[] = [];
      for (const [field, value] of Object.entries(expected)) {
        if (field === 'seq' || field === 'ingest' || field === 'ingested_at_ms') continue;
        if (stored[field] !== value) {
          differences.push({
            executionId: event.executionId,
            field,
            live: stored[field] === null ? null : String(stored[field]),
            imported: value === null ? null : String(value),
          });
        }
      }
      return { stored, differences };
    });
  }

  /** Freeze the end of an independent, bounded scan of the target event cohort. */
  verificationBoundary(fromMs: number, toMs: number): EventCursor | null {
    return this.db
      .query<EventCursor, [number, number]>(
        `
      SELECT ts_ms AS tsMs, seq FROM events WHERE ts_ms >= ? AND ts_ms < ?
      ORDER BY ts_ms DESC, seq DESC LIMIT 1
    `
      )
      .get(fromMs, toMs);
  }

  /** Scan the primary key in bounded pages, including live rows so sparse imports cannot
   * turn one chunk into a scan of an unbounded live table. The caller filters ingest. */
  readVerificationChunk(
    after: EventCursor,
    through: EventCursor,
    fromMs: number,
    toMs: number
  ): ImportValues[] {
    return this.db
      .query<ImportValues, [number, number, number, number, number, number]>(
        `
      SELECT e.*, d.execution_id FROM events e
      LEFT JOIN event_detail d ON d.seq = e.seq AND d.ts_ms = e.ts_ms
      WHERE (e.ts_ms, e.seq) > (?, ?) AND (e.ts_ms, e.seq) <= (?, ?)
        AND e.ts_ms >= ? AND e.ts_ms < ?
      ORDER BY e.ts_ms, e.seq LIMIT 1000
    `
      )
      .all(after.tsMs, after.seq, through.tsMs, through.seq, fromMs, toMs);
  }

  /** Rows, deduplicated conflicts and the source cursor are one crash-safe commit. */
  importChunk(
    events: readonly NormalizedEvent[],
    lastId: number
  ): InsertResult & { conflicts: number; filled: number } {
    const firstSeq = this.nextSeq;
    let committed: Stored[] = [];
    try {
      const result = this.db
        .transaction(() => {
          const inspections = this.inspectImportEvents(events);
          const conflict = this.db.query(`
          INSERT INTO import_conflicts (execution_id, field, live, imported, seen_at_ms)
          SELECT ?, ?, ?, ?, ? WHERE NOT EXISTS (
            SELECT 1 FROM import_conflicts
            WHERE execution_id = ? AND field = ? AND live IS ? AND imported IS ?
          )
        `);
          let conflicts = 0;
          let filled = 0;
          for (const inspection of inspections) {
            for (const diff of inspection.differences) {
              // The one update of a stored row: a NULL search field CPAMP has a value for.
              // A stored value is never replaced; a different one is a conflict like any other.
              if (FILLABLE_FIELDS.includes(diff.field) && diff.live === null && diff.imported !== null) {
                filled += this.fillSearchField(inspection.stored!, diff.field, diff.imported);
                continue;
              }
              conflicts += conflict.run(
                diff.executionId,
                diff.field,
                diff.live,
                diff.imported,
                this.now(),
                diff.executionId,
                diff.field,
                diff.live,
                diff.imported
              ).changes;
            }
          }
          const stored = this.insertAll.immediate(
            events.map((event) => ({ event, raw: null })),
            INGEST.imported
          );
          committed = stored;
          this.setMeta('import:cpamp:last_id', String(lastId));
          return {
            inserted: stored.length,
            duplicates: events.length - stored.length,
            conflicts,
            filled,
          };
        })
        .immediate();
      this.onCommit?.(committed.map(({ item }) => item.event));
      return result;
    } catch (error) {
      this.nextSeq = firstSeq;
      this.dims.clear();
      throw error;
    }
  }

  private fillSearchField(stored: ImportValues, field: string, value: string): number {
    if (field === 'auth_file_id') {
      return this.db
        .query('UPDATE events SET auth_file_id = ? WHERE ts_ms = ? AND seq = ? AND auth_file_id IS NULL')
        .run(this.dim('auth_file', value), Number(stored.ts_ms), Number(stored.seq)).changes;
    }
    return this.db
      .query(`UPDATE event_detail SET ${field} = ? WHERE seq = ? AND ${field} IS NULL`)
      .run(value, Number(stored.seq)).changes;
  }

  /** Canonical events for the startup/threshold fold; ordinary scrapes use no SQL. */
  scanExporterEvents(visit: (event: ExporterEvent) => void): void {
    const rows = this.db.query<
      {
        provider: string;
        model: string;
        requestedModel: string;
        billingModel: string;
        account: string | null;
        apiKeyHash: string | null;
        tier: string;
        failed: number;
        tsMs: number;
        latencyMs: number | null;
        ttftMs: number | null;
        recordKind: number;
        inputTotal: number;
        inputUncached: number;
        cacheRead: number;
        cacheWrite: number;
        outputTotal: number;
        reasoning: number;
        total: number;
      },
      []
    >(`SELECT p.value AS provider, m.value AS model, r.value AS requestedModel,
      b.value AS billingModel, a.value AS account, k.value AS apiKeyHash, t.value AS tier,
      e.failed, e.ts_ms AS tsMs, e.latency_ms AS latencyMs, e.ttft_ms AS ttftMs,
      e.record_kind AS recordKind,
      e.input_total AS inputTotal, e.input_uncached AS inputUncached, e.cache_read AS cacheRead,
      e.cache_write AS cacheWrite, e.output_total AS outputTotal, e.reasoning, e.total
      FROM events e JOIN dim p ON p.id=e.provider_id JOIN dim m ON m.id=e.model_id
      JOIN dim r ON r.id=e.requested_model_id JOIN dim b ON b.id=e.billing_model_id
      JOIN dim t ON t.id=e.tier_id LEFT JOIN dim a ON a.id=e.account_id
      LEFT JOIN dim k ON k.id=e.api_key_id`);
    for (const row of rows.iterate()) {
      visit({
        ...row,
        recordKind: row.recordKind as ExporterEvent['recordKind'],
        failed: row.failed === 1,
        tokens: {
          inputTotal: row.inputTotal,
          inputUncached: row.inputUncached,
          cacheRead: row.cacheRead,
          cacheWrite: row.cacheWrite,
          outputTotal: row.outputTotal,
          reasoning: row.reasoning,
          total: row.total,
        },
      });
    }
  }

  /** Logical database size includes pages not yet checkpointed from WAL. */
  databaseSizeBytes(): number {
    const pages = this.db.query<{ page_count: number }, []>('PRAGMA page_count').get()!.page_count;
    const size = this.db.query<{ page_size: number }, []>('PRAGMA page_size').get()!.page_size;
    return pages * size;
  }

  /** Caller supplies a new path on tmpfs. This must run as a serialized writer job. */
  vacuumInto(path: string): void {
    this.db.query('VACUUM INTO ?').run(path);
  }

  close(): void {
    this.raw?.close();
    this.db.close();
  }

  private dim(kind: DimKind, value: string): number {
    const key = `${kind}\u0000${value}`;
    let id = this.dims.get(key);
    if (id === undefined) {
      this.insertDim.run(kind, value);
      id = this.selectDim.get(kind, value)!.id;
      this.dims.set(key, id);
    }
    return id;
  }

  /** One row per session uuid. The first parent a session is reported with stays its parent. */
  private session(session: EventSession | null, parent: EventSession | null): number | null {
    if (!session) return null;
    const parentId = this.session(parent, null);
    this.insertSession.run(session.uuid, parentId, session.derived ? 1 : 0);
    const { id } = this.selectSession.get(session.uuid)!;
    // The row may be older than this report: a session first seen as another one's parent.
    if (parentId !== null) this.adoptParent.run(parentId, id);
    return id;
  }

  private eventRow(
    event: NormalizedEvent,
    seq: number,
    ingest: IngestSource,
    intern = true
  ): Row<typeof EVENT_COLUMNS> {
    const row: Row<typeof EVENT_COLUMNS> = {
      ts_ms: event.tsMs,
      seq,
      instance_id: event.instance,
      provider_id: event.provider,
      model_id: event.model,
      requested_model_id: event.requestedModel,
      billing_model_id: event.billingModel,
      response_model_id: event.responseModel,
      tier_id: event.tier,
      failed: event.failed ? 1 : 0,
      status_code: event.statusCode,
      latency_ms: event.latencyMs,
      ttft_ms: event.ttftMs,
      timing_id: event.timingMethod,
      input_total: event.tokens.inputTotal,
      input_uncached: event.tokens.inputUncached,
      cache_read: event.tokens.cacheRead,
      cache_write: event.tokens.cacheWrite,
      output_total: event.tokens.outputTotal,
      reasoning: event.tokens.reasoning,
      total: event.tokens.total,
      usage_flags: event.usageFlags,
      record_kind: event.recordKind,
      stream: event.stream === null ? null : event.stream ? 1 : 0,
      account_id: event.account,
      account_label_id: event.accountLabel,
      api_key_id: event.apiKeyHash,
      user_agent_id: event.userAgent,
      client_ip_id: event.clientIp,
      path_id: event.path,
      method_id: event.method,
      effort_id: event.effort,
      executor_id: event.executor,
      requested_tier_id: event.requestedTier,
      effective_tier_id: event.effectiveTier,
      session_id: intern
        ? this.session(event.session, event.parentSession)
        : (event.session?.uuid ?? null),
      auth_index_id: event.authIndex,
      auth_file_id: event.authFile,
      ingest,
    };
    if (intern) {
      for (const [column, kind] of Object.entries(EVENT_DIMENSIONS)) {
        const key = column as keyof typeof row;
        const value = row[key] as string | null;
        row[key] = value === null ? null : this.dim(kind, value);
      }
    }
    return row;
  }

  private detailRow(event: NormalizedEvent, seq: number): Row<typeof DETAIL_COLUMNS> {
    return {
      seq,
      execution_id: event.executionId,
      ts_ms: event.tsMs,
      request_id: event.requestId,
      parent_execution_id: event.parentExecutionId,
      session_id: event.session?.uuid ?? null,
      parent_session_id: event.parentSession?.uuid ?? null,
      trace_id: event.traceId,
      header_trace_id: event.headerTraceId,
      fail_summary: event.failSummary,
      upstream_start_ms: event.timing?.upstreamStartMs ?? null,
      first_response_ms: event.timing?.firstResponseMs ?? null,
      first_content_ms: event.timing?.firstContentMs ?? null,
      recorded_ms: event.timing?.recordedMs ?? null,
      ingested_at_ms: this.now(),
    };
  }
}

type Stored = { seq: number; item: IngestItem };
