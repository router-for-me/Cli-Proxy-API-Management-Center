// Queue these jobs in the writer worker. No sockets, worker lifecycle or connection opening here.
import type { Database } from 'bun:sqlite';
import { checkCpampRollups } from './cpampRollupCheck';
import { IoGovernor, runIoChunk, type ChunkScheduler, type IoBytes } from './ioGovernor';
import {
  endpointText,
  failSummaryFromBody,
  isKeySource,
  maskSource,
  normalizeUsagePayload,
  projectSnapshot,
  requestMetadata,
  scrubHeaderValue,
  scrubTraceId,
} from './normalize';
import type { ImportValues, UsageStore } from './store';
import { INGEST, USAGE_FLAG, type NormalizedEvent } from './types';

export type CpampMode = 'import' | 'reconcile' | 'verify';
export interface CpampJobOptions {
  mode: CpampMode;
  governor: IoGovernor;
  signal?: AbortSignal;
  /** P2 yields here to service live batches before the next bulk chunk. No transaction is open. */
  betweenChunks?: () => Promise<void>;
  /** A diagnostic limit also bounds verification; never use it for the final migration check. */
  maxRows?: number;
  ioBytes?: () => IoBytes;
  scheduleChunk?: ChunkScheduler;
  onProgress?: (progress: CpampProgress) => void;
  /** Wall clock captured before the source maximum; open hours are not rollup-comparable. */
  nowMs?: number;
}

export interface CpampProgress {
  phase: 'import' | 'verify';
  read: number;
  inserted: number;
  lastId: number;
  chunks: number;
}
export type CpampReport = Awaited<ReturnType<typeof runCpampJob>>;

export interface Preconditions {
  missingExecutionId: number;
  duplicateExecutionId: number;
  invalidTimestamp: number;
  invalidTokens: number;
  incompleteBreakdown: number;
  invalidBreakdownIdentity: number;
  nonPositiveLatency: number;
  invalidJson: number;
}

export const cpampPreconditions = (): Preconditions => ({
  missingExecutionId: 0,
  duplicateExecutionId: 0,
  invalidTimestamp: 0,
  invalidTokens: 0,
  incompleteBreakdown: 0,
  invalidBreakdownIdentity: 0,
  nonPositiveLatency: 0,
  invalidJson: 0,
});

// Only missing metadata is decoded from raw_json. CPAMP's normalized columns stay authoritative.
// Do not select raw_json itself: it contains headers, client keys and failure bodies.
export const CPAMP_METADATA_KEYS = [
  'execution_id',
  'instance_id',
  'record_kind',
  'usage_presence',
  'usage_fields',
  'accounting_version',
  'token_breakdown',
  'ttft_method',
  'timing',
  'service_tier',
  'effective_service_tier',
  'response_service_tier',
  'parent_execution_id',
  'trace_id',
] as const;
// A single multi-path extraction avoids fetching overflow pages once per metadata field.
const metadataSql = `json_extract(
  CASE WHEN json_valid(raw_json) THEN raw_json ELSE '{}' END,
  ${CPAMP_METADATA_KEYS.map((key) => `'$.${key}'`).join(', ')}
)`;
export const CPAMP_EVENT_COLUMNS = `
  id, timestamp_ms, provider, model, requested_model, resolved_model, response_model,
  auth_index, account_snapshot, auth_label_snapshot, auth_file_snapshot, fail_summary,
  header_trace_id, endpoint, x_forwarded_for, source, auth_provider_snapshot,
  auth_project_id_snapshot, header_quota_plan_type, header_error_kind, header_error_code,
  auth_type, api_key_hash, user_agent, client_ip,
  path, method, reasoning_effort, executor_type, request_id, session_id, parent_session_id,
  stream, failed, fail_status_code, latency_ms, ttft_ms,
  normalized_total_input_tokens AS input_total,
  normalized_uncached_input_tokens AS input_uncached,
  normalized_cache_read_tokens AS cache_read,
  normalized_cache_creation_tokens AS cache_write,
  output_tokens AS output_total, reasoning_tokens AS reasoning, total_tokens AS total,
  json_valid(raw_json) AS valid_json, ${metadataSql} AS metadata
`;
const SELECT_CHUNK = `SELECT ${CPAMP_EVENT_COLUMNS}
  FROM usage_events WHERE id > ? AND id <= ? ORDER BY id LIMIT ?`;

export type CpampSourceRow = ImportValues & { id: number; metadata: string; valid_json: number };
const tokenColumns = [
  'input_total',
  'input_uncached',
  'cache_read',
  'cache_write',
  'output_total',
  'reasoning',
  'total',
] as const;
const nonempty = (value: string | number | null): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

/** Copy persisted accounting; reuse the normalizer for metadata validation and session provenance. */
export function mapCpampRow(
  row: CpampSourceRow,
  checks: Preconditions,
  seen: Set<string>
): NormalizedEvent | null {
  if (!row.valid_json) checks.invalidJson += 1;
  const extracted = JSON.parse(row.metadata) as unknown[];
  const metadata = Object.fromEntries(
    CPAMP_METADATA_KEYS.map((key, index) => [key, extracted[index]])
  );
  const executionId = typeof metadata.execution_id === 'string' ? metadata.execution_id.trim() : '';
  const duplicate = !!executionId && seen.has(executionId);
  if (!executionId) checks.missingExecutionId += 1;
  else {
    if (duplicate) checks.duplicateExecutionId += 1;
    seen.add(executionId);
  }
  const validTimestamp =
    Number.isSafeInteger(row.timestamp_ms) && Math.abs(Number(row.timestamp_ms)) <= 8.64e15;
  const validTokens = tokenColumns.every(
    (key) => Number.isSafeInteger(row[key]) && Number(row[key]) >= 0
  );
  if (!validTimestamp) checks.invalidTimestamp += 1;
  if (!validTokens) checks.invalidTokens += 1;
  if (typeof row.latency_ms !== 'number' || row.latency_ms <= 0) checks.nonPositiveLatency += 1;
  if (!executionId || duplicate || !validTimestamp || !validTokens) return null;
  const result = normalizeUsagePayload(
    JSON.stringify({
      ...metadata,
      timestamp: new Date(Number(row.timestamp_ms)).toISOString(),
      provider: row.provider,
      executor_type: row.executor_type,
      model: nonempty(row.resolved_model) ?? nonempty(row.model) ?? '-',
      alias: nonempty(row.requested_model) ?? nonempty(row.model) ?? '-',
      latency_ms: row.latency_ms,
      ttft_ms: row.ttft_ms,
      session_id: row.session_id,
      parent_session_id: row.parent_session_id,
      endpoint: row.path ? `${row.method || 'POST'} ${row.path}` : '',
      user_agent: row.user_agent,
      client_ip: row.client_ip,
    })
  );
  if (result.kind !== 'event') {
    checks.invalidTimestamp += 1;
    return null;
  }
  const event = result.event;
  event.provider = nonempty(row.provider) ?? 'unknown';
  event.billingModel = nonempty(row.resolved_model) ?? event.model;
  event.responseModel = nonempty(row.response_model);
  const canonicalTokens = event.tokens;
  event.tokens = {
    inputTotal: Number(row.input_total),
    inputUncached: Number(row.input_uncached),
    cacheRead: Number(row.cache_read),
    cacheWrite: Number(row.cache_write),
    outputTotal: Number(row.output_total),
    reasoning: Number(row.reasoning),
    total: Number(row.total),
  };
  if (!(event.usageFlags & USAGE_FLAG.breakdownComplete)) checks.incompleteBreakdown += 1;
  else if (
    (Object.keys(event.tokens) as Array<keyof typeof event.tokens>).some(
      (key) => event.tokens[key] !== canonicalTokens[key]
    )
  ) {
    // The normalizer already checked the canonical identities; copying a different persisted
    // value must not claim that same complete breakdown. Keep CPAMP's values and price partial.
    checks.invalidBreakdownIdentity += 1;
    event.usageFlags &= ~USAGE_FLAG.breakdownComplete;
  }
  event.authIndex = nonempty(row.auth_index);
  event.accountLabel = nonempty(row.auth_label_snapshot);
  // CPAMP's persisted search fields. The failure text and trace id pass the scrubbers again, so
  // a value that was ever stored unscrubbed upstream cannot reach this store.
  const failText = nonempty(row.fail_summary);
  event.failSummary = failText === null ? null : failSummaryFromBody(failText);
  const traceText = nonempty(row.header_trace_id);
  event.headerTraceId = traceText === null ? null : scrubTraceId(traceText);
  event.authFile = nonempty(row.auth_file_snapshot);
  // The eight other search columns, as CPAMP persisted them, through the same functions the live
  // path uses. The source passes the mask again (it keeps a value that is already masked), and
  // the header values pass the scrubber again, so nothing unmasked or unscrubbed can enter.
  event.endpoint = endpointText(String(row.endpoint ?? ''));
  event.xForwardedFor = requestMetadata(row.x_forwarded_for, 2048);
  const source = String(row.source ?? '');
  event.source =
    maskSource(
      source,
      isKeySource(source, String(row.auth_type ?? ''), '', String(row.api_key_hash ?? ''))
    ) || null;
  event.authProvider = nonempty(row.auth_provider_snapshot);
  event.authProject = projectSnapshot(
    event.authProvider ?? event.provider,
    nonempty(row.auth_project_id_snapshot)
  );
  event.quotaPlan = scrubHeaderValue(String(row.header_quota_plan_type ?? '')) || null;
  event.errorKind = scrubHeaderValue(String(row.header_error_kind ?? '')) || null;
  event.errorCode = scrubHeaderValue(String(row.header_error_code ?? '')) || null;
  event.account = nonempty(row.account_snapshot) ?? event.accountLabel ?? event.authIndex;
  // Accept only the persisted SHA-256, never a key or a source identity from raw_json.
  const hash = nonempty(row.api_key_hash);
  event.apiKeyHash = hash && /^[a-f0-9]{64}$/i.test(hash) ? hash.toLowerCase() : null;
  event.effort = nonempty(row.reasoning_effort);
  event.executor = nonempty(row.executor_type);
  event.requestId = nonempty(row.request_id);
  event.failed = row.failed === 1;
  event.statusCode = Number(row.fail_status_code) > 0 ? Number(row.fail_status_code) : null;
  event.stream = row.stream === null ? null : row.stream === 1;
  return event;
}

/** BigInt sums stay exact even above JS's integer range; reports serialize them as decimals. */
const SUM_COLUMNS = [
  'rows',
  'failed',
  ...tokenColumns,
  'latency_ms',
  'ttft_sum',
  'ttft_count',
] as const;
type Hour = Record<(typeof SUM_COLUMNS)[number], bigint>;
type Hours = Map<number, Hour>;
function addHour(hours: Hours, values: ImportValues): void {
  const hour = Math.floor(Number(values.ts_ms) / 3_600_000) * 3_600_000;
  const sums = hours.get(hour) ?? (Object.fromEntries(SUM_COLUMNS.map((key) => [key, 0n])) as Hour);
  sums.rows += 1n;
  for (const key of ['failed', ...tokenColumns, 'latency_ms'] as const) {
    sums[key] += BigInt(values[key] ?? 0);
  }
  if (Number(values.ttft_ms) > 0) {
    sums.ttft_sum += BigInt(values.ttft_ms!);
    sums.ttft_count += 1n;
  }
  hours.set(hour, sums);
}
function compareHours(source: Hours, target: Hours) {
  return [...new Set([...source.keys(), ...target.keys()])]
    .sort((a, b) => a - b)
    .map((hourMs) => {
      const values = (hours: Hours) =>
        Object.fromEntries(SUM_COLUMNS.map((key) => [key, String(hours.get(hourMs)?.[key] ?? 0n)]));
      const expected = values(source);
      const actual = values(target);
      return {
        hourMs,
        source: expected,
        target: actual,
        equal: SUM_COLUMNS.every((key) => expected[key] === actual[key]),
      };
    });
}

/**
 * import/reconcile continue the atomic cursor; verify starts at id 0 and writes nothing.
 * A mutating pass ends with a full, governed verification up to its captured source maximum.
 * Verification includes matched live overlaps and independently scans all imported target rows.
 * Target-only live traffic is excluded. Independent CPAMP rollups check fully covered hours.
 */
export async function runCpampJob(store: UsageStore, source: Database, options: CpampJobOptions) {
  if (
    options.maxRows !== undefined &&
    (!Number.isSafeInteger(options.maxRows) || options.maxRows < 1)
  ) {
    throw new Error('maxRows must be a positive safe integer');
  }
  const nowMs = options.nowMs ?? Date.now();
  async function chunk<T>(work: () => T): Promise<T> {
    await options.betweenChunks?.();
    return runIoChunk(options.mode, work, options);
  }
  const { maxId, lastId, select } = await chunk(() => {
    if (source.query<{ query_only: number }, []>('PRAGMA query_only').get()?.query_only !== 1) {
      throw new Error('CPAMP handle must be read-only with PRAGMA query_only=1');
    }
    // mmap reads are invisible to syscall byte counters.
    source.exec('PRAGMA mmap_size=0');
    return {
      maxId: Number(
        source
          .query<{ id: number }, []>('SELECT coalesce(max(id), 0) AS id FROM usage_events')
          .get()!.id
      ),
      lastId: Number(store.getMeta('import:cpamp:last_id') ?? 0),
      select: source.query<CpampSourceRow, [number, number, number]>(SELECT_CHUNK),
    };
  });
  const report = {
    mode: options.mode,
    maxId,
    lastId,
    read: 0,
    inserted: 0,
    duplicates: 0,
    conflicts: 0,
    /** NULL search fields of existing rows that this pass filled from CPAMP. */
    filled: 0,
    chunks: 0,
    preconditions: cpampPreconditions(),
  };
  if (
    !Number.isSafeInteger(maxId) ||
    maxId < 0 ||
    (options.mode !== 'verify' &&
      (!Number.isSafeInteger(report.lastId) || report.lastId < 0 || report.lastId > maxId))
  ) {
    throw new Error('Invalid CPAMP ID or import cursor; source may differ from the saved import');
  }
  const map = (rows: CpampSourceRow[], checks: Preconditions, seen: Set<string>) => {
    const mapped: { event: NormalizedEvent; row: CpampSourceRow }[] = [];
    for (const row of rows) {
      const event = mapCpampRow(row, checks, seen);
      if (event) mapped.push({ event, row });
    }
    return mapped;
  };
  if (options.mode !== 'verify') {
    const seen = new Set<string>();
    while (report.lastId < maxId && report.read < (options.maxRows ?? Infinity)) {
      const size = Math.min(1000, (options.maxRows ?? Infinity) - report.read);
      const count = await chunk(() => {
        const rows = select.all(report.lastId, maxId, size);
        if (!rows.length) return 0;
        const events = map(rows, report.preconditions, seen).map(({ event }) => event);
        const lastId = rows[rows.length - 1].id;
        const result = store.importChunk(events, lastId);
        report.lastId = lastId;
        report.read += rows.length;
        report.inserted += result.inserted;
        report.duplicates += result.duplicates;
        report.conflicts += result.conflicts;
        report.filled += result.filled;
        report.chunks += 1;
        options.onProgress?.({
          phase: 'import',
          read: report.read,
          inserted: report.inserted,
          lastId: report.lastId,
          chunks: report.chunks,
        });
        return rows.length;
      });
      if (!count) break;
    }
  }
  const verification = {
    read: 0,
    missing: 0,
    different: 0,
    targetOnlyImported: 0,
    preconditions: cpampPreconditions(),
    hours: [] as ReturnType<typeof compareHours>,
    exact: false,
  };
  const sourceHours: Hours = new Map();
  const sourceMaxIds = new Map<number, number>();
  const targetHours: Hours = new Map();
  const seen = new Set<string>();
  let cursor = 0;
  // A limited import verifies only the prefix it was allowed to import.
  const verifyMax = options.mode === 'verify' ? maxId : Math.min(maxId, report.lastId);
  while (cursor < verifyMax && verification.read < (options.maxRows ?? Infinity)) {
    const count = await chunk(() => {
      const rows = select.all(
        cursor,
        verifyMax,
        Math.min(1000, (options.maxRows ?? Infinity) - verification.read)
      );
      if (!rows.length) return 0;
      for (const row of rows) {
        if (!Number.isSafeInteger(row.timestamp_ms)) continue;
        const hour = Math.floor(Number(row.timestamp_ms) / 3_600_000) * 3_600_000;
        sourceMaxIds.set(hour, Math.max(sourceMaxIds.get(hour) ?? 0, row.id));
      }
      const mapped = map(rows, verification.preconditions, seen);
      const inspected = store.inspectImportEvents(mapped.map(({ event }) => event));
      mapped.forEach(({ event, row }, index) => {
        // Sum source accounting directly, independently of the event-to-store column encoder.
        addHour(sourceHours, {
          ...row,
          ts_ms: row.timestamp_ms,
          latency_ms: event.latencyMs,
          ttft_ms: event.ttftMs,
        });
        const { stored, differences } = inspected[index];
        if (stored) {
          // Imported rows are accounted independently below; include only matched live overlaps here.
          if (stored.ingest !== INGEST.imported) addHour(targetHours, stored);
        } else verification.missing += 1;
        if (differences.length) verification.different += 1;
      });
      cursor = rows[rows.length - 1].id;
      verification.read += rows.length;
      options.onProgress?.({
        phase: 'verify',
        read: verification.read,
        inserted: report.inserted,
        lastId: cursor,
        chunks: Math.ceil(verification.read / 1000),
      });
      return rows.length;
    });
    if (!count) break;
  }
  // A full verification checks the whole imported cohort, including extra hours at either edge.
  // Diagnostic prefixes count only verified identities within their source UTC-hour range.
  const sourceBuckets = [...sourceHours.keys()];
  const fromMs =
    options.maxRows === undefined
      ? -Number.MAX_SAFE_INTEGER
      : sourceBuckets.length
        ? Math.min(...sourceBuckets)
        : 0;
  const toMs =
    options.maxRows === undefined
      ? Number.MAX_SAFE_INTEGER
      : sourceBuckets.length
        ? Math.max(...sourceBuckets) + 3_600_000
        : 0;
  const boundary = await chunk(() => store.verificationBoundary(fromMs, toMs));
  let after = { tsMs: fromMs, seq: -1 };
  while (boundary) {
    const rows = await chunk(() => store.readVerificationChunk(after, boundary, fromMs, toMs));
    for (const row of rows) {
      if (row.ingest !== INGEST.imported) continue;
      const verifiedIdentity = typeof row.execution_id === 'string' && seen.has(row.execution_id);
      if (options.maxRows !== undefined && !verifiedIdentity) continue;
      addHour(targetHours, row);
      if (!verifiedIdentity) verification.targetOnlyImported += 1;
    }
    if (rows.length < 1000) break;
    const last = rows[rows.length - 1];
    after = { tsMs: Number(last.ts_ms), seq: Number(last.seq) };
  }
  verification.hours = compareHours(sourceHours, targetHours);
  const rollups = await checkCpampRollups(source, targetHours, sourceMaxIds, {
    verifiedMaxId: verifyMax,
    limited: options.maxRows !== undefined,
    nowMs,
    chunk,
  });
  verification.exact =
    verification.missing === 0 &&
    verification.different === 0 &&
    verification.targetOnlyImported === 0 &&
    rollups.mismatches.length === 0 &&
    verification.hours.every((hour) => hour.equal) &&
    verification.preconditions.missingExecutionId === 0 &&
    verification.preconditions.duplicateExecutionId === 0 &&
    verification.preconditions.invalidTimestamp === 0 &&
    verification.preconditions.invalidTokens === 0 &&
    verification.preconditions.invalidJson === 0;
  const filledGaps =
    options.mode !== 'verify' && options.maxRows === undefined && verification.exact
      ? await chunk(() => fillCoveredGaps(store, source, options.mode, verifyMax, sourceMaxIds))
      : [];
  return { ...report, filledGaps, verification: { ...verification, rollups } };
}

/**
 * An exact, full import or reconcile pass accounts for every source event up to `verifyMax`.
 * A gap is filled only when its whole interval lies between the first and a later UTC hour
 * of those source events, and no source event that started or completed inside it has a
 * higher ID: the pass then cannot have missed a CPAMP row there. Open (provisional) gaps are never filled. Verify
 * writes nothing, so it never calls this.
 */
function fillCoveredGaps(
  store: UsageStore,
  source: Database,
  mode: CpampMode,
  verifyMax: number,
  sourceMaxIds: ReadonlyMap<number, number>
): number[] {
  const hours = [...sourceMaxIds.keys()];
  if (!hours.length) return [];
  const first = Math.min(...hours);
  const last = Math.max(...hours);
  // A collection gap holds the events that completed in it, so an unverified event counts when
  // it started or completed inside the interval. Only IDs above the verified maximum are read.
  const later = source.query<{ found: number }, [number, number, number, number, number]>(
    `SELECT 1 AS found FROM usage_events WHERE id > ?
       AND ((timestamp_ms >= ? AND timestamp_ms < ?)
         OR (latency_ms > 0 AND timestamp_ms + latency_ms >= ? AND timestamp_ms + latency_ms < ?))
     LIMIT 1`
  );
  const hour = (ms: number) => Math.floor(ms / 3_600_000) * 3_600_000;
  const covered = store
    .unfilledGaps()
    .filter(
      (gap) =>
        !gap.provisional &&
        gap.from_ms < gap.to_ms &&
        hour(gap.from_ms) >= first &&
        hour(gap.to_ms - 1) < last &&
        !later.get(verifyMax, gap.from_ms, gap.to_ms, gap.from_ms, gap.to_ms)
    )
    .map((gap) => gap.id);
  store.markGapsFilled(covered, mode, Date.now());
  return covered;
}
