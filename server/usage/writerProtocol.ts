// Structured-clone contracts shared by sockets and the writer; no database imports.
import type { AccountLabel, IngestSource } from './types';
import type { CpampProgress, CpampReport } from './importCpamp';
import type { ExporterSnapshot } from './exporter';
import type { IoPauseReason } from './ioGovernor';
import type { BackupReport } from './backup';

export const BULK_JOB_KINDS = ['import', 'reconcile', 'verify', 'backup', 'prune'] as const;
export type BulkJobKind = (typeof BULK_JOB_KINDS)[number];
export type BulkJobHealth = Record<
  BulkJobKind,
  { last_success_seconds: number | null; last_failure_seconds: number | null }
>;
export function isBulkJobKind(value: unknown): value is BulkJobKind {
  return typeof value === 'string' && BULK_JOB_KINDS.some((kind) => kind === value);
}
/** Optional caller ownership marker, not a substitute for management authentication. */
export function isBulkJobClientToken(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length >= 1 &&
    value.length <= 64 &&
    !/[^A-Za-z0-9_-]/.test(value)
  );
}
/** The kinds that read the CPAMP file; a retired CPAMP refuses them all. */
export const CPAMP_JOB_KINDS: readonly BulkJobKind[] = ['import', 'reconcile', 'verify'];
export const CPAMP_RETIRED_ERROR = 'CPAMP retired';
/** The one switch for the retired mode: set in the prox-usage quadlet, read by every consumer. */
export const cpampRetiredFromEnv = (): boolean => process.env.PROX_USAGE_CPAMP_RETIRED === '1';
export interface BulkJobConfig {
  cpampPath?: string;
  /** Open the CPAMP file with SQLite's immutable=1; only for a stopped CPAMP (see RULES.md). */
  cpampImmutable?: boolean;
  /** Overrides PROX_USAGE_CPAMP_RETIRED. */
  cpampRetired?: boolean;
  backupConfigPath?: string;
  bytesPerSecond?: number;
}
export interface BulkJobReport {
  id: number;
  clientToken?: string;
  kind: BulkJobKind;
  state: 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed';
  startedAtMs: number;
  finishedAtMs: number | null;
  progress?: CpampProgress;
  result?:
    | { kind: 'cpamp'; report: CpampReport }
    | { kind: 'backup'; report: BackupReport }
    | { kind: 'prune'; report: { beforeMs: number; deleted: number; chunks: number } };
  error?: string;
  io: { bytesRead: number; bytesWritten: number; pauseSeconds: number; longPauses: number };
  lastBackupSuccessAtMs: number | null;
}

export interface UsageCursor {
  bootId: string;
  queueSeq: number;
}
export interface SourceResume {
  cursor: UsageCursor | null;
  heartbeat: number | null;
  cursorAtMs?: number;
  recoveryFromMs?: number;
}
export interface UsagePayload {
  instance: string;
  payload: string;
  ingest: IngestSource;
  label?: AccountLabel;
  cursor?: UsageCursor;
}
export interface IngestGap {
  instance: string;
  fromMs: number;
  toMs: number;
  reason: 'stale-heartbeat' | 'subscription-dropped' | 'writer-overflow' | 'proxy-restart';
  missed?: number | null;
}
/** Event-store progress published in the same transaction as its covered events. */
export interface UsageCommit {
  cursors?: readonly { instance: string; cursor: UsageCursor }[];
  gap?: IngestGap;
  recoveredInstance?: string;
  replayInstance?: string;
}
export interface ExporterConfig {
  rateBookPath?: string;
  clientAliasesPath?: string;
}
export const ROLLUP_BACKFILL_BUSY_ERROR = 'Rollup backfill in progress';
/** Only explicitly safe command errors cross the worker and HTTP boundaries. */
export function bulkJobFailureMessage(error: unknown): string {
  return error instanceof Error &&
    (error.message === ROLLUP_BACKFILL_BUSY_ERROR || error.message === CPAMP_RETIRED_ERROR)
    ? error.message
    : 'Bulk job unavailable or ID differs';
}
export interface RollupBackfillReport {
  state: 'running' | 'paused' | 'waiting-for-job' | 'done' | 'failed';
  currentHour: number | null;
  hoursCompleted: number;
  hoursTotal: null;
  pauseReason: IoPauseReason | 'between-hours' | 'bulk-job' | null;
  lastFailure: { atMs: number; hour: number | null; error: string } | null;
}

export interface WriterStatus {
  rollup?: { backfill: RollupBackfillReport };
  exporter?: ExporterSnapshot & {
    jobs: BulkJobHealth;
    jobs_outcome_error: boolean;
    rate_book_error: boolean;
    client_alias_error: boolean;
    rate_book_loaded: boolean;
    client_aliases_loaded: boolean;
  };
  resume?: SourceResume;
  backlog: number;
  inserted: number;
  duplicates: number;
  rejected: number;
  rawBufferFailures: number;
  gaps: number;
  job?: BulkJobReport | null;
}
export interface CollectorWriter {
  readonly backlog: number;
  enqueue(payload: UsagePayload): void;
  resume(instance: string): Promise<SourceResume>;
  replay(
    instance: string,
    payloads: UsagePayload[],
    cursor: UsageCursor,
    gap?: IngestGap,
    complete?: boolean
  ): Promise<void>;
  recovery(gap: IngestGap, requireAnchor?: boolean): Promise<void>;
  gap(gap: IngestGap): Promise<void>;
  heartbeat(instance: string, atMs: number): Promise<void>;
}
export type WriterRequest =
  | {
      id: number;
      kind: 'init';
      body: {
        events: string;
        raw: string | null;
        sources: string[];
        nowMs: number;
        rateBookPath?: string;
        jobs?: BulkJobConfig;
        exporter?: ExporterConfig;
      };
    }
  | { id: number; kind: 'live'; body: UsagePayload[] }
  | { id: number; kind: 'resume'; body: { instance: string } }
  | {
      id: number;
      kind: 'replay';
      body: {
        instance: string;
        payloads: UsagePayload[];
        cursor: UsageCursor;
        gap?: IngestGap;
        complete?: boolean;
      };
    }
  | { id: number; kind: 'recovery'; body: { gap: IngestGap; requireAnchor: boolean } }
  | { id: number; kind: 'gap'; body: IngestGap }
  | { id: number; kind: 'heartbeat'; body: { instance: string; atMs: number } }
  | { id: number; kind: BulkJobKind; body: { clientToken?: string } | null }
  | { id: number; kind: 'cancel'; body: { jobId: number; clientToken?: string } }
  | { id: number; kind: 'job-status' | 'exporter'; body: null }
  | { id: number; kind: 'flush' | 'close'; body: null };
export type WriterReply =
  | { id: number; ok: true; body: WriterStatus }
  | { id: number; ok: false; body: { error: string; fatal: boolean } };
export const WRITER_HIGH_WATER = 50_000;
