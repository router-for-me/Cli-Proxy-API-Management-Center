// Worker-owned bulk orchestration. No sockets or HTTP; database work goes through bounded chunks.
import { loadBackupConfig, UsageBackup } from './backup';
import { runCpampJob } from './importCpamp';
import type { RollupWriteResult } from './rollup';
import { IoGovernor, runIoChunk, type ChunkScheduler, type IoGovernorOptions } from './ioGovernor';
import {
  CPAMP_SOURCE_NOT_QUIET,
  openCpampSource,
  type RawPruneCursor,
  type UsageStore,
} from './store';
import {
  BULK_JOB_KINDS,
  CPAMP_JOB_KINDS,
  CPAMP_RETIRED_ERROR,
  cpampRetiredFromEnv,
  ROLLUP_BACKFILL_BUSY_ERROR,
  type RollupBackfillReport,
  isBulkJobClientToken,
  type BulkJobConfig,
  type BulkJobHealth,
  type BulkJobKind,
  type BulkJobReport,
} from './writerProtocol';

interface JobOutcome {
  lastSuccessAtMs: number | null;
  lastFailureAtMs: number | null;
}
const outcomeKey = (kind: BulkJobKind) => `job-outcome:${kind}`;

export class UsageBulkJobs {
  readonly outcomeError: boolean = false;
  private readonly outcomes = new Map<BulkJobKind, JobOutcome>();
  private governor: IoGovernor | null = null;
  /** Governor totals when the running job started; null once its IO is frozen in the report. */
  private ioBase: BulkJobReport['io'] | null = null;
  private backup: UsageBackup | null = null;
  private latest: BulkJobReport | null = null;
  private active: { controller: AbortController; settled: Promise<void> } | null = null;
  private nextId = 0;
  private closing = false;
  private rollupBackfill = false;
  private readonly completedRollupHours = new Set<number>();
  private readonly backfill: RollupBackfillReport = {
    state: 'running',
    currentHour: null,
    hoursCompleted: 0,
    hoursTotal: null,
    pauseReason: null,
    lastFailure: null,
  };

  constructor(
    private readonly store: UsageStore,
    private readonly scheduleChunk: ChunkScheduler,
    private readonly config: BulkJobConfig = {},
    private readonly governorOptions: IoGovernorOptions = {}
  ) {
    for (const kind of BULK_JOB_KINDS) {
      const saved = store.getMeta(outcomeKey(kind));
      const outcome: JobOutcome = { lastSuccessAtMs: null, lastFailureAtMs: null };
      if (saved !== null) {
        try {
          const parsed: unknown = JSON.parse(saved);
          if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('Invalid job outcome');
          for (const field of ['lastSuccessAtMs', 'lastFailureAtMs'] as const) {
            const value = (parsed as Record<string, unknown>)[field];
            if (
              value === null ||
              (typeof value === 'number' && Number.isInteger(value) && value >= 0)
            )
              outcome[field] = value;
            else this.outcomeError = true;
          }
        } catch {
          // Health metadata must not prevent collection or expose stored text in diagnostics.
          this.outcomeError = true;
        }
      }
      this.outcomes.set(kind, outcome);
    }
  }

  health(): BulkJobHealth {
    return Object.fromEntries(
      [...this.outcomes].map(([kind, outcome]) => [
        kind,
        {
          last_success_seconds:
            outcome.lastSuccessAtMs === null ? null : outcome.lastSuccessAtMs / 1000,
          last_failure_seconds:
            outcome.lastFailureAtMs === null ? null : outcome.lastFailureAtMs / 1000,
        },
      ])
    ) as BulkJobHealth;
  }

  report(): BulkJobReport | null {
    if (!this.latest) return null;
    return {
      ...this.latest,
      io: this.ioBase ? this.ioSince(this.ioBase) : this.latest.io,
      lastBackupSuccessAtMs: this.backup?.lastSuccessAtMs ?? null,
    };
  }

  /** The governor lives as long as the process and counts every governed chunk. A job reports its own. */
  private ioSince(base: BulkJobReport['io']): BulkJobReport['io'] {
    const now = this.governor?.counters ?? base;
    return {
      bytesRead: now.bytesRead - base.bytesRead,
      bytesWritten: now.bytesWritten - base.bytesWritten,
      pauseSeconds: now.pauseSeconds - base.pauseSeconds,
      longPauses: now.longPauses - base.longPauses,
    };
  }

  start(kind: BulkJobKind, clientToken?: string): BulkJobReport {
    if (clientToken !== undefined && !isBulkJobClientToken(clientToken))
      throw new Error('Invalid client token');
    // A retired CPAMP is a fixed refusal; its file and port are never touched again.
    if ((this.config.cpampRetired ?? cpampRetiredFromEnv()) && CPAMP_JOB_KINDS.includes(kind))
      throw new Error(CPAMP_RETIRED_ERROR);
    if (this.closing || this.active) throw new Error('Bulk job unavailable');
    if (this.rollupBackfill) throw new Error(ROLLUP_BACKFILL_BUSY_ERROR);
    this.ioBase = this.governor?.counters ?? {
      bytesRead: 0,
      bytesWritten: 0,
      pauseSeconds: 0,
      longPauses: 0,
    };
    this.latest = {
      id: ++this.nextId,
      ...(clientToken === undefined ? {} : { clientToken }),
      kind,
      state: 'running',
      startedAtMs: Date.now(),
      finishedAtMs: null,
      io: { bytesRead: 0, bytesWritten: 0, pauseSeconds: 0, longPauses: 0 },
      lastBackupSuccessAtMs: this.backup?.lastSuccessAtMs ?? null,
    };
    const controller = new AbortController();
    // Defer orchestration until active is installed, even for a synchronous config failure.
    const settled = Promise.resolve().then(() => this.run(kind, controller.signal));
    this.active = { controller, settled };
    return this.report()!;
  }

  cancel(jobId: number, clientToken?: string): BulkJobReport {
    if (!this.latest || this.latest.id !== jobId) throw new Error('Bulk job ID differs');
    if (
      clientToken !== undefined &&
      (!isBulkJobClientToken(clientToken) || this.latest.clientToken !== clientToken)
    )
      throw new Error('Bulk job client token differs');
    if (this.active) {
      this.latest.state = 'cancelling';
      this.active.controller.abort();
    }
    return this.report()!;
  }

  async close(): Promise<void> {
    this.closing = true;
    if (this.active) {
      this.cancel(this.latest!.id);
      await this.active.settled;
    }
  }

  backfillReport(): RollupBackfillReport {
    const pauseReason = this.backfill.state === 'running' ? this.governor?.pauseReason : null;
    return {
      ...this.backfill,
      ...(pauseReason ? { state: 'paused' as const, pauseReason } : {}),
      lastFailure: this.backfill.lastFailure ? { ...this.backfill.lastFailure } : null,
    };
  }

  /** Reserve admission across the entire backfill, including IO waits and between hours.
   * A previously admitted manual job pauses maintenance without advancing its stored cursor.
   * Only a null work result releases the reservation: that pass has drained all closed hours.
   */
  async runRollupChunk(
    work: (onHour: (hour: number) => void) => RollupWriteResult | null,
    signal: AbortSignal
  ): Promise<void> {
    if (this.closing) throw new Error('Bulk jobs are closing');
    if (this.active) {
      this.backfill.state = 'waiting-for-job';
      this.backfill.pauseReason = 'bulk-job';
      return;
    }
    this.rollupBackfill = true;
    this.backfill.state = 'running';
    this.backfill.pauseReason = null;
    try {
      const result = await runIoChunk(
        'rollup',
        () => {
          const result = work((hour) => {
            this.backfill.currentHour = hour;
          });
          if (result) {
            this.backfill.currentHour = result.hour;
            this.completedRollupHours.add(result.hour);
            this.backfill.hoursCompleted = this.completedRollupHours.size;
          }
          return result;
        },
        {
          governor: this.getGovernor(),
          signal,
          scheduleChunk: this.scheduleChunk,
        }
      );
      if (result === null) {
        this.rollupBackfill = false;
        this.backfill.state = 'done';
        this.backfill.currentHour = null;
        this.backfill.pauseReason = null;
      } else {
        this.backfill.state = 'paused';
        this.backfill.pauseReason = 'between-hours';
      }
    } catch (error) {
      this.backfill.pauseReason = null;
      if (signal.aborted) {
        this.rollupBackfill = false;
        this.backfill.state = 'paused';
      } else {
        this.backfill.state = 'failed';
        this.backfill.lastFailure = {
          atMs: Date.now(),
          hour: this.backfill.currentHour,
          error: 'Usage hourly rollup rebuild failed; raw events retained',
        };
      }
      throw error;
    }
  }

  private getGovernor(): IoGovernor {
    return (this.governor ??= new IoGovernor({
      bytesPerSecond:
        this.config.bytesPerSecond ??
        (process.env.PROX_USAGE_BULK_BYTES_PER_SECOND
          ? Number(process.env.PROX_USAGE_BULK_BYTES_PER_SECOND)
          : undefined),
      ...this.governorOptions,
    }));
  }

  private async run(kind: BulkJobKind, signal: AbortSignal): Promise<void> {
    let source: ReturnType<typeof openCpampSource> | undefined;
    const report = this.latest!;
    try {
      this.governor = this.getGovernor();
      const options = { governor: this.governor, signal, scheduleChunk: this.scheduleChunk };
      if (kind === 'prune') {
        const prune = {
          beforeMs: report.startedAtMs - 30 * 24 * 60 * 60 * 1000,
          deleted: 0,
          chunks: 0,
        };
        report.result = { kind: 'prune', report: prune };
        let cursor: RawPruneCursor = { rejectId: 0 };
        for (;;) {
          const chunk = await runIoChunk(
            'prune',
            () => this.store.pruneRawBefore(prune.beforeMs, cursor),
            options
          );
          prune.deleted += chunk.deleted;
          prune.chunks += 1;
          cursor = chunk.cursor;
          if (chunk.done) break;
        }
      } else if (kind === 'backup') {
        this.backup ??= new UsageBackup(loadBackupConfig(this.config.backupConfigPath), {
          governor: this.governor,
          scheduleChunk: this.scheduleChunk,
        });
        // The backup instance retains last-success state; each run receives its own signal.
        report.result = { kind: 'backup', report: await this.backup.run(this.store, signal) };
      } else {
        const path = this.config.cpampPath ?? process.env.PROX_USAGE_CPAMP_DB_PATH;
        if (!path) throw new Error('CPAMP source not configured');
        const immutable =
          this.config.cpampImmutable ?? process.env.PROX_USAGE_CPAMP_IMMUTABLE === '1';
        await runIoChunk(
          kind,
          () => {
            source = openCpampSource(path, immutable);
          },
          options
        );
        report.result = {
          kind: 'cpamp',
          report: await runCpampJob(this.store, source!, {
            ...options,
            mode: kind,
            onProgress: (progress) => {
              report.progress = progress;
            },
          }),
        };
      }
      signal.throwIfAborted();
      report.state = 'succeeded';
    } catch (error) {
      report.state = signal.aborted ? 'cancelled' : 'failed';
      // SQLite paths and S3 credentials/errors must never reach HTTP or logs. The one exception is
      // the fixed text that tells the operator the immutable open refused a CPAMP that is not quiet.
      if (!signal.aborted)
        report.error =
          error instanceof Error && error.message === CPAMP_SOURCE_NOT_QUIET
            ? CPAMP_SOURCE_NOT_QUIET
            : 'Usage bulk job failed; check job configuration and source';
    } finally {
      // Later governed chunks (rollup backfill, the next job) must not change a finished report.
      report.io = this.ioSince(this.ioBase!);
      this.ioBase = null;
      try {
        if (source) await this.scheduleChunk(kind, () => source!.close());
      } catch {
        report.state = 'failed';
        report.error = 'Usage bulk source cleanup failed';
      }
      try {
        // Publish completion only after its metadata commits on the sole write connection.
        await this.scheduleChunk(kind, () => {
          if (signal.aborted && report.state !== 'failed') report.state = 'cancelled';
          const finishedAtMs = Date.now();
          if (report.state === 'succeeded' || report.state === 'failed') {
            const outcome = {
              ...this.outcomes.get(kind)!,
              [report.state === 'succeeded' ? 'lastSuccessAtMs' : 'lastFailureAtMs']: finishedAtMs,
            };
            this.store.setMeta(outcomeKey(kind), JSON.stringify(outcome));
            this.outcomes.set(kind, outcome);
          }
          report.finishedAtMs = finishedAtMs;
        });
      } catch {
        report.state = 'failed';
        report.error = 'Usage bulk outcome persistence failed';
        report.finishedAtMs = Date.now();
      } finally {
        this.active = null;
      }
    }
  }
}
