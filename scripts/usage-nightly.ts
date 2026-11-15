// Serial operator job chain. No database handles; all mutations use the authenticated job API.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertLoopbackEndpoint } from './usage-parity/run';
import { QueryGate } from './usage-parity/io';
import { ExecutionWindow, IncompleteRun, parseDeadline } from './usage-parity/window';
import { ROLLUP_BACKFILL_BUSY_ERROR } from '../server/usage/writerProtocol';

// A rollup backfill holds bulk admission between hours; retry only that refusal.
const ADMISSION_RETRY_MS = 30000;
const ADMISSION_RETRY_WINDOW_MS = 15 * 60000;
const CPAMP_COLLECTORS = 2;

type JobKind = 'prune' | 'reconcile' | 'backup';
interface Job {
  id: number;
  clientToken?: string;
  kind: JobKind;
  state: 'running' | 'cancelling' | 'cancelled' | 'succeeded' | 'failed';
  startedAtMs: number;
  finishedAtMs: number | null;
}
export interface NightlyOptions {
  url: string;
  keyFile: string;
  // Enable only after the paced snapshot implementation and restore gate have landed.
  backupEnabled: boolean;
  pollMs: number;
  // CPAMP's /status (loopback) and the admin key file that authorizes it.
  cpamp: { url: string; keyFile: string };
}
export interface CpampCollector {
  mode: string;
  transport: string;
  state: string;
}
export interface NightlyReport {
  status: 'succeeded' | 'failed' | 'incomplete';
  completed: string[];
  backup: 'skipped' | 'pending' | 'completed';
  // `retired` is prox-usage's own report (GET /v1/status cpamp_retired); the skips are deliberate,
  // so a night with this field and status "succeeded" is a healthy retired night, not a failure.
  cpamp?:
    | { retired?: false; ok: boolean; collectors: CpampCollector[] }
    | { retired: true; skipped: string[] };
  // Submit POSTs per kind, counting backfill-busy retries.
  attempts: Partial<Record<JobKind, number>>;
  cancellation?: 'requested' | 'unconfirmed';
  recovery?: 'owned-job' | 'no-owned-job' | 'unavailable';
  refused?: { kind: JobKind; status: number };
  error?: string;
}
interface Dependencies {
  signal: AbortSignal;
  now?: () => number;
  gate?: QueryGate;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  parity?: (deadlineMs: number, signal: AbortSignal) => Promise<number>;
}
function jobFrom(value: unknown, kind: JobKind, id?: number, clientToken?: string): Job {
  const job = (value as { job?: Job } | null)?.job;
  if (
    !job ||
    !Number.isSafeInteger(job.id) ||
    job.id < 1 ||
    !Number.isSafeInteger(job.startedAtMs) ||
    job.startedAtMs < 0 ||
    job.kind !== kind ||
    (id !== undefined && job.id !== id) ||
    (clientToken !== undefined && job.clientToken !== clientToken) ||
    !['running', 'cancelling', 'cancelled', 'succeeded', 'failed'].includes(job.state) ||
    (job.finishedAtMs !== null && !Number.isSafeInteger(job.finishedAtMs))
  )
    throw new Error('Invalid or replaced nightly job');
  return job;
}
class JobHttpFailure extends Error {
  constructor(
    readonly status: number,
    // True only for the server's fixed rollup-backfill refusal, never another 409.
    readonly backfillBusy = false
  ) {
    super('Nightly job HTTP failure');
  }
}
async function isBackfillBusy(response: Response): Promise<boolean> {
  try {
    const text = await response.text();
    return (
      text.length <= 512 &&
      (JSON.parse(text) as { error?: unknown }).error === ROLLUP_BACKFILL_BUSY_ERROR
    );
  } catch {
    return false;
  }
}
// Closed vocabulary: CPAMP text never reaches the report.
const known = (value: unknown, allowed: string[]) =>
  typeof value === 'string' && allowed.includes(value) ? value : 'unknown';
async function readCpampCollectors(
  cpamp: NightlyOptions['cpamp'],
  signal: AbortSignal
): Promise<CpampCollector[]> {
  // The key lives only in this call's headers.
  const response = await fetch(cpamp.url, {
    redirect: 'error',
    headers: { authorization: `Bearer ${readFileSync(cpamp.keyFile, 'utf8').trim()}` },
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('CPAMP status unavailable');
  }
  const { collectors } = (await response.json()) as { collectors?: unknown };
  if (!Array.isArray(collectors)) throw new Error('CPAMP status has no collectors');
  return collectors.map((value: { mode?: unknown; transport?: unknown; collector?: unknown }) => ({
    mode: known(value?.mode, ['auto', 'subscribe', 'http', 'resp']),
    transport: known(value?.transport, ['subscribe', 'http', 'resp', '']),
    state: known(value?.collector, ['running', 'starting', 'error', 'stopped']),
  }));
}

// The sibling entry point: source beside this file, or the installed bundle beside this bundle.
const parityScript = join(
  import.meta.dir,
  import.meta.file.endsWith('.ts') ? 'usage-parity.ts' : 'usage-parity.js'
);
async function parityProcess(deadlineMs: number, signal: AbortSignal): Promise<number> {
  signal = AbortSignal.any([signal, AbortSignal.timeout(5.5 * 3600000)]);
  signal.throwIfAborted();
  const child = Bun.spawn(
    [
      process.execPath,
      parityScript,
      '--previous-utc-day',
      '--matrix',
      'quick',
      '--level',
      'both',
      '--deadline',
      new Date(deadlineMs).toISOString(),
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  );
  let force: ReturnType<typeof setTimeout> | undefined;
  const abort = () => {
    child.kill('SIGINT');
    force = setTimeout(() => child.kill('SIGKILL'), 40000);
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  try {
    return await child.exited;
  } finally {
    signal.removeEventListener('abort', abort);
    if (force) clearTimeout(force);
  }
}
export async function runNightly(
  options: NightlyOptions,
  dependencies: Dependencies
): Promise<NightlyReport> {
  const now = dependencies.now ?? Date.now;
  const deadline = parseDeadline('12:00Z', now());
  const window = new ExecutionWindow(dependencies.signal, deadline, now);
  const gate = dependencies.gate ?? new QueryGate(dependencies.signal);
  gate.setWindow(window);
  const wait =
    dependencies.sleep ??
    (async (ms, signal) => {
      await sleep(ms, undefined, { signal });
    });
  const report: NightlyReport = {
    status: 'failed',
    completed: [],
    backup: options.backupEnabled ? 'pending' : 'skipped',
    attempts: {},
  };
  let key = '';
  let active: Job | undefined;
  const request = async (
    path: string,
    body?: object,
    mode: 'query' | 'submit' | 'cleanup' = 'query'
  ): Promise<unknown> => {
    const response = await fetch(new URL(path, options.url), {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      // Once submitted, read the accepted ID even if the run is interrupted at noon.
      signal:
        mode === 'query'
          ? AbortSignal.any([window.signal, AbortSignal.timeout(15000)])
          : AbortSignal.timeout(mode === 'cleanup' ? 5000 : 15000),
    });
    if (!response.ok) {
      const read = mode === 'submit' && response.status === 409;
      const busy = read && (await isBackfillBusy(response));
      if (!read) await response.body?.cancel();
      throw new JobHttpFailure(response.status, busy);
    }
    return response.json();
  };
  try {
    window.check();
    assertLoopbackEndpoint(options.url);
    assertLoopbackEndpoint(options.cpamp.url);
    if (!Number.isSafeInteger(options.pollMs) || options.pollMs < 1)
      throw new Error('Invalid poll interval');
    key = readFileSync(options.keyFile, 'utf8').trim();
    if (!key) throw new Error('Empty nightly credential');
    // prox-usage alone says whether CPAMP is retired, so no second switch can disagree with it.
    // Only an explicit true retires it; an older server without the field keeps the guard.
    let retired = false;
    await gate.run(async () => {
      retired =
        ((await request('/v1/status')) as { cpamp_retired?: unknown } | null)?.cpamp_retired ===
        true;
    });
    if (retired) {
      // Nothing below touches CPAMP: no port, no admin key, no reconcile, no parity against it.
      report.cpamp = { retired: true, skipped: ['guard', 'reconcile', 'parity'] };
    } else {
      // A polling CPAMP would silently lose history once Prox holds the subscription.
      const guard = { ok: false, collectors: [] as CpampCollector[] };
      report.cpamp = guard;
      try {
        guard.collectors = await gate.run(() => readCpampCollectors(options.cpamp, window.signal));
      } catch {
        throw new Error('CPAMP status unreachable');
      }
      guard.ok =
        guard.collectors.length >= CPAMP_COLLECTORS &&
        guard.collectors.every(
          (collector) => collector.transport === 'subscribe' && collector.state === 'running'
        );
      if (!guard.ok) throw new Error('CPAMP collectors are not all subscribed');
    }
    for (const kind of [
      'prune',
      ...(retired ? [] : ['reconcile']),
      ...(options.backupEnabled ? ['backup'] : []),
    ] as JobKind[]) {
      window.check();
      const retryUntil = now() + ADMISSION_RETRY_WINDOW_MS;
      let busy: JobHttpFailure | undefined;
      for (;;) {
        try {
          // A fresh token per attempt: a backfill refusal admitted nothing, and any
          // ambiguous failure below is recovered by its own token and never retried.
          await gate.run(async () => {
            // Gate waits can outlast the retry bound; give up with the last refusal.
            if (busy && now() > retryUntil) throw busy;
            report.attempts[kind] = (report.attempts[kind] ?? 0) + 1;
            delete report.refused;
            const clientToken = crypto.randomUUID();
            try {
              active = jobFrom(
                await request('/v1/jobs', { kind, clientToken }, 'submit'),
                kind,
                undefined,
                clientToken
              );
            } catch (error) {
              // Only the server-echoed token proves ownership after a lost response.
              // A newer same-kind operator job and HTTP 409 never grant ownership.
              if (error instanceof JobHttpFailure) {
                report.refused = { kind, status: error.status };
              } else {
                try {
                  const value = await request('/v1/jobs', undefined, 'cleanup');
                  report.recovery = 'no-owned-job';
                  const candidate = jobFrom(value, kind);
                  if (
                    candidate.clientToken === clientToken &&
                    candidate.state === 'running' &&
                    candidate.finishedAtMs === null
                  ) {
                    active = candidate;
                    report.recovery = 'owned-job';
                  } else report.recovery = 'no-owned-job';
                } catch {
                  report.recovery ??= 'unavailable';
                }
              }
              throw error;
            }
          });
          break;
        } catch (error) {
          if (error instanceof JobHttpFailure && error.backfillBusy) busy = error;
          if (
            !(error instanceof JobHttpFailure && error.backfillBusy) ||
            now() + ADMISSION_RETRY_MS > retryUntil
          )
            throw error;
          await wait(Math.min(ADMISSION_RETRY_MS, window.remainingMs()), window.signal);
          window.check();
        }
      }
      if (!active) throw new Error('Missing admitted nightly job');
      for (;;) {
        window.check();
        if (
          active.state === 'failed' ||
          active.state === 'cancelled' ||
          active.state === 'cancelling'
        )
          throw new Error('Nightly job did not succeed');
        // State can change before asynchronous source cleanup releases the bulk-job slot.
        if (active.state === 'succeeded' && active.finishedAtMs !== null) break;
        await wait(Math.min(options.pollMs, window.remainingMs()), window.signal);
        window.check();
        const id = active.id;
        active = jobFrom(await gate.run(() => request('/v1/jobs')), kind, id, active.clientToken);
      }
      report.completed.push(kind);
      if (kind === 'backup') report.backup = 'completed';
      active = undefined;
    }
    window.check();
    if (!retired) {
      const exit = await (dependencies.parity ?? parityProcess)(deadline, window.signal);
      window.check();
      if (exit === 2) {
        report.status = 'incomplete';
        report.error = 'Nightly parity stopped with incomplete evidence';
        return report;
      }
      if (exit !== 0) throw new Error('Nightly parity did not pass');
      report.completed.push('parity');
    }
    report.status = 'succeeded';
  } catch {
    report.status = window.signal.reason instanceof IncompleteRun ? 'incomplete' : 'failed';
    const attempts = report.refused && report.attempts[report.refused.kind];
    report.error =
      report.status === 'incomplete'
        ? 'UTC cutoff or forbidden window; chain incomplete'
        : report.refused
          ? `Nightly ${report.refused.kind} admission refused (HTTP ${report.refused.status})` +
            (attempts && attempts > 1 ? ` after ${attempts} attempts` : '')
          : report.cpamp && !report.cpamp.retired && !report.cpamp.ok
            ? report.cpamp.collectors.length
              ? 'CPAMP collectors are not all subscribed; no job started'
              : 'CPAMP status unreachable; no job started'
            : 'Nightly chain stopped; a step failed, was interrupted or could not be verified';
    if (report.recovery === 'no-owned-job')
      report.error += '; no job with the submission token was recovered';
    if (active && active.finishedAtMs === null) {
      // Cancellation is control traffic, admitted even at the stop boundary. Never start more work.
      try {
        await request(
          '/v1/jobs/cancel',
          { jobId: active.id, clientToken: active.clientToken },
          'cleanup'
        );
        report.cancellation = 'requested';
      } catch {
        report.cancellation = 'unconfirmed';
      }
    }
  } finally {
    window.close();
  }
  return report;
}
if (import.meta.main && process.argv.includes('--check-install')) {
  // Deploy self-check: no network, no keys. The sibling parity entry point must start.
  const ok = Bun.spawnSync([process.execPath, parityScript, '--help'], {
    stdout: 'ignore',
    stderr: 'ignore',
  }).success;
  console.log(JSON.stringify({ parity: parityScript, ok }));
  process.exit(ok ? 0 : 1);
}
if (import.meta.main) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  const report = await runNightly(
    {
      url: 'http://127.0.0.1:18320',
      keyFile: join(homedir(), '.config/cli-proxy-rerank/management-key'),
      backupEnabled: process.env.PROX_USAGE_ENABLE_PACED_BACKUP === '1',
      pollMs: 10000,
      cpamp: {
        url: 'http://127.0.0.1:18317/status',
        keyFile: join(homedir(), '.config/prox/cpa-admin-key'),
      },
    },
    { signal: controller.signal }
  );
  console.log(JSON.stringify(report));
  process.exitCode =
    report.status === 'succeeded'
      ? 0
      : report.status === 'incomplete'
        ? 2
        : controller.signal.aborted
          ? 130
          : 1;
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
