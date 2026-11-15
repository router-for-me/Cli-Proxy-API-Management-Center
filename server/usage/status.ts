// Loopback HTTP presentation of collection and writer state; all database work is elsewhere.
import { authorized } from '../http/auth';
import type { EventLoopLagSnapshot } from '../eventLoopLag';
import type { SourceStatus } from './collector';
import {
  isBulkJobKind,
  bulkJobFailureMessage,
  isBulkJobClientToken,
  type BulkJobKind,
  type BulkJobReport,
  type WriterStatus,
} from './writerProtocol';

interface JobControls {
  startJob(kind: BulkJobKind, clientToken?: string): Promise<BulkJobReport>;
  cancelJob(jobId: number, clientToken?: string): Promise<BulkJobReport>;
  jobReport(): Promise<BulkJobReport | null>;
}

/** Admin commands are small objects; bound streamed bodies too, regardless of Content-Length. */
async function command(request: Request): Promise<Record<string, unknown>> {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('Missing command');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 1024) throw new Error('Command too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error('Invalid command');
  return parsed as Record<string, unknown>;
}

export function createUsageStatusHandler(options: {
  keyFile: string;
  sources: () => readonly SourceStatus[];
  writer: () => WriterStatus;
  healthy: () => boolean;
  jobs?: JobControls;
  exporter?: () => Promise<NonNullable<WriterStatus['exporter']>>;
  /** Main-thread event-loop lag since start; absent in tests that do not wire a probe. */
  eventLoop?: () => EventLoopLagSnapshot;
  /** PROX_USAGE_CPAMP_RETIRED: CPAMP is gone on purpose. A flag, never a failing source. */
  cpampRetired?: boolean;
  now?: () => number;
}): (request: Request) => Promise<Response> {
  const cpamp_retired = options.cpampRetired === true;
  return async (request) => {
    const path = new URL(request.url).pathname;
    const json = (body: unknown, status = 200) =>
      Response.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
      });
    if (path === '/healthz') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      return json({ ok: options.healthy() }, options.healthy() ? 200 : 503);
    }
    if (!['/v1/status', '/v1/jobs', '/v1/jobs/cancel', '/v1/exporter'].includes(path)) {
      return json({ error: 'Not found' }, 404);
    }
    try {
      if (!authorized(request, options.keyFile)) return json({ error: 'Unauthorized' }, 401);
    } catch {
      return json({ error: 'Management key unavailable' }, 503);
    }
    if (path === '/v1/exporter') {
      if (request.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
      if (!options.healthy() || !options.exporter)
        return json({ error: 'Exporter unavailable' }, 503);
      try {
        const snapshot = await options.exporter();
        const now = (options.now ?? Date.now)();
        const lag = options.eventLoop?.();
        return json({
          ...snapshot,
          ...(lag
            ? {
                event_loop: {
                  max_lag_seconds: lag.maxLagMs / 1000,
                  stalls_total: lag.stallsOver1s,
                  last_stall_time_seconds:
                    lag.lastStallAtMs === null ? null : lag.lastStallAtMs / 1000,
                },
              }
            : {}),
          cpamp_retired,
          sources: options.sources().map((source) => ({
            instance: source.instance,
            state: source.state,
            subscribed: source.state === 'subscribed',
            last_event_age_seconds:
              source.lastEventAtMs === null
                ? null
                : Math.max(0, (now - source.lastEventAtMs) / 1000),
          })),
        });
      } catch {
        return json({ error: 'Usage exporter unavailable' }, 503);
      }
    }
    if (request.method === 'GET' && path !== '/v1/jobs/cancel') {
      try {
        const job = (await options.jobs?.jobReport()) ?? null;
        if (path === '/v1/jobs') return json({ job });
        const { rollup, ...writer } = options.writer();
        return json({
          cpamp_retired,
          sources: options.sources(),
          writer: { ...writer, job },
          ...(options.eventLoop ? { eventLoop: options.eventLoop() } : {}),
          ...(rollup ? { rollup } : {}),
        });
      } catch {
        return json({ error: 'Usage writer unavailable' }, 503);
      }
    }
    if (request.method !== 'POST' || path === '/v1/status') {
      return json({ error: 'Method not allowed' }, 405);
    }
    if (!options.healthy() || !options.jobs) return json({ error: 'Jobs unavailable' }, 503);
    let body: Record<string, unknown>;
    try {
      body = await command(request);
      const field = path === '/v1/jobs' ? 'kind' : 'jobId';
      if (Object.keys(body).some((key) => key !== field && key !== 'clientToken'))
        throw new Error('Unknown command fields');
      if (
        Object.prototype.hasOwnProperty.call(body, 'clientToken') &&
        !isBulkJobClientToken(body.clientToken)
      )
        throw new Error('Invalid client token');
      if (path === '/v1/jobs') {
        if (!isBulkJobKind(body.kind)) {
          throw new Error('Invalid job kind');
        }
      } else if (!Number.isSafeInteger(body.jobId) || Number(body.jobId) < 1) {
        throw new Error('Invalid job ID');
      }
    } catch {
      return json({ error: 'Invalid job command' }, 400);
    }
    try {
      const job =
        path === '/v1/jobs'
          ? await options.jobs.startJob(
              body.kind as BulkJobKind,
              body.clientToken as string | undefined
            )
          : await options.jobs.cancelJob(
              body.jobId as number,
              body.clientToken as string | undefined
            );
      return json({ job }, 202);
    } catch (error) {
      return json({ error: bulkJobFailureMessage(error) }, 409);
    }
  };
}
