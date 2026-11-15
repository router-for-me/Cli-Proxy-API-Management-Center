import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runNightly } from '../scripts/usage-nightly';
import { quietGate } from './helpers/usageParity';
import { generateParityEvidence } from './helpers/usageParityEvidence';
import { Socket, connect, createConnection } from 'node:net';
import { takeBlockedTestPorts } from './support/noLivePorts';

const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});
const subscribing = { mode: 'auto', transport: 'subscribe', collector: 'running' };
// Synthetic CPAMP /status. Never the live service; it checks the admin key it is given.
function fakeCpamp(collectors: object[] | 'down' = [subscribing, subscribing]) {
  const root = mkdtempSync('/dev/shm/prox-nightly-cpamp-');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, 'cpamp-key');
  writeFileSync(keyFile, 'synthetic-cpamp-key\n');
  const requests: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      requests.push(`${new URL(request.url).pathname} ${request.headers.get('authorization')}`);
      return request.headers.get('authorization') === 'Bearer synthetic-cpamp-key'
        ? Response.json({ collector: collectors === 'down' ? {} : collectors[0], collectors })
        : new Response(null, { status: 401 });
    },
  });
  cleanups.push(() => server.stop(true));
  if (collectors === 'down') server.stop(true);
  return { url: `http://127.0.0.1:${server.port}/status`, keyFile, requests };
}
function fixture(
  options: {
    fail?: string;
    backup?: boolean;
    at?: number;
    delay?: number;
    unfinishedSuccess?: boolean;
    postDelay?: number;
    parityExit?: number;
    cpamp?: object[] | 'down';
    // The body prox-usage answers GET /v1/status with; an old server has no cpamp_retired.
    status?: object;
    busy?: number;
    busyError?: string;
    // Advance the clock by this much as the third gated call (the first retry) waits.
    stall?: number;
  } = {}
) {
  const root = mkdtempSync('/dev/shm/prox-nightly-test-');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, 'key');
  writeFileSync(keyFile, 'synthetic-nightly-key');
  const cpamp = fakeCpamp(options.cpamp);
  const start = options.at ?? Date.UTC(2026, 10, 13, 4, 20);
  let now = start;
  let busy = 0;
  const submits: number[] = [];
  const calls: string[] = [];
  const tokens: string[] = [];
  let job: {
    id: number;
    kind: string;
    state: string;
    startedAtMs: number;
    clientToken?: string;
    finishedAtMs: number | null;
  } | null = null;
  let polls = 0;
  let statusReads = 0;
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      expect(request.headers.get('authorization')).toBe('Bearer synthetic-nightly-key');
      const path = new URL(request.url).pathname;
      if (path === '/v1/status') {
        statusReads += 1;
        return Response.json(options.status ?? { sources: [], writer: {} });
      }
      if (path === '/v1/jobs/cancel') {
        expect(await request.json()).toEqual({ jobId: job?.id, clientToken: job?.clientToken });
        calls.push('cancel');
        return Response.json({ job });
      }
      if (request.method === 'POST') {
        const { kind, clientToken } = (await request.json()) as {
          kind: string;
          clientToken: string;
        };
        tokens.push(clientToken);
        submits.push(now);
        if (options.busy !== undefined && busy++ < options.busy) {
          calls.push(`busy-${kind}`);
          return Response.json(
            { error: options.busyError ?? 'Rollup backfill in progress' },
            { status: 409 }
          );
        }
        calls.push(`start-${kind}`);
        expect(job === null || job.finishedAtMs !== null).toBe(true);
        job = {
          id: (job?.id ?? 0) + 1,
          kind,
          state: 'running',
          clientToken,
          startedAtMs: now,
          finishedAtMs: null,
        };
        polls = 0;
        now += options.postDelay ?? 0;
      } else {
        calls.push(`poll-${job?.kind}`);
        polls++;
        if (job) {
          job.state = options.fail === job.kind ? 'failed' : 'succeeded';
          job.finishedAtMs = options.unfinishedSuccess && polls === 1 ? null : now;
        }
      }
      return Response.json({ job });
    },
  });
  cleanups.push(() => server.stop(true));
  const signal = new AbortController().signal;
  const gate = quietGate(signal);
  const gated = gate.run.bind(gate);
  let gateCalls = 0;
  gate.run = (fn) => {
    // Status read, CPAMP guard, first submit, then the first retry's wait.
    if (++gateCalls === 4) now += options.stall ?? 0;
    return gated(fn);
  };
  const run = () =>
    runNightly(
      {
        url: `http://127.0.0.1:${server.port}`,
        keyFile,
        backupEnabled: options.backup ?? false,
        pollMs: options.delay ?? 1000,
        cpamp,
      },
      {
        signal,
        now: () => now,
        gate,
        sleep: async (ms) => {
          now += ms;
        },
        parity: async (deadline, abort) => {
          expect(new Date(deadline).toISOString()).toBe('2026-11-13T12:00:00.000Z');
          expect(abort.aborted).toBe(false);
          calls.push('parity');
          return options.parityExit ?? 0;
        },
      }
    );
  return {
    run,
    calls,
    tokens,
    submits,
    cpamp,
    statusReads: () => statusReads,
    elapsed: () => now - start,
  };
}
test('nightly chain waits for terminal success and cleanup before every subsequent step', async () => {
  const f = fixture({ backup: true, unfinishedSuccess: true });
  expect(await f.run()).toMatchObject({
    status: 'succeeded',
    completed: ['prune', 'reconcile', 'backup', 'parity'],
  });
  expect(new Set(f.tokens).size).toBe(f.tokens.length);
  expect(f.tokens.every((token) => /^[a-f0-9-]{36}$/.test(token))).toBe(true);
  expect(f.calls).toEqual([
    'start-prune',
    'poll-prune',
    'poll-prune',
    'start-reconcile',
    'poll-reconcile',
    'poll-reconcile',
    'start-backup',
    'poll-backup',
    'poll-backup',
    'parity',
  ]);
});
test('backup is skipped by default; parity follows completed reconcile', async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({
    status: 'succeeded',
    backup: 'skipped',
    completed: ['prune', 'reconcile', 'parity'],
  });
  expect(f.calls).toEqual([
    'start-prune',
    'poll-prune',
    'start-reconcile',
    'poll-reconcile',
    'parity',
  ]);
});
test('any failed job stops the chain before later jobs or parity', async () => {
  for (const fail of ['prune', 'reconcile', 'backup']) {
    const f = fixture({ fail, backup: true });
    expect((await f.run()).status).toBe('failed');
    expect(f.calls).not.toContain('parity');
    if (fail === 'prune') expect(f.calls).not.toContain('start-reconcile');
    if (fail !== 'backup') expect(f.calls).not.toContain('start-backup');
  }
});
test('delayed starts in forbidden windows or after noon admit no jobs', async () => {
  for (const [hour, minute] of [
    [1, 0],
    [3, 59],
    [12, 0],
    [12, 20],
    [12, 50],
    [23, 0],
  ]) {
    const f = fixture({ at: Date.UTC(2026, 10, 13, hour, minute) });
    expect((await f.run()).status).toBe('incomplete');
    expect(f.calls).toEqual([]);
  }
});
test('long polling waits stop at noon or forbidden boundary and cancel the active job', async () => {
  for (const [hour, minute] of [
    [0, 59],
    [11, 59],
  ]) {
    const f = fixture({ at: Date.UTC(2026, 10, 13, hour, minute), delay: 120000 });
    expect(await f.run()).toMatchObject({
      status: 'incomplete',
      cancellation: 'requested',
      completed: [],
    });
    expect(f.calls).toEqual(['start-prune', 'cancel']);
  }
});
test('fixture evidence contacts only its synthetic job server', async () => {
  const root = mkdtempSync('/dev/shm/prox-evidence-test-');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  await generateParityEvidence(root);
  const report = JSON.parse(readFileSync(join(root, 'synthetic-events.json'), 'utf8'));
  expect(report.reconcile.status).toBe('not-confirmed');
  expect(report.counts.unexplained).toBe(0);
  expect(report.targets.prox).not.toContain(':18320');
});
test('test network guard blocks live ports before fetch, Node or Bun TCP admission', () => {
  for (const port of [18317, 18320, 8317, 8319]) {
    expect(() => fetch(`http://127.0.0.1:${port}/v1/jobs`)).toThrow(
      'Tests must not contact live port'
    );
    expect(() => new Socket().connect(port, '127.0.0.1')).toThrow(
      'Tests must not contact live port'
    );
    expect(() =>
      Bun.connect({ hostname: '127.0.0.1', port, socket: { data() {}, open() {} } })
    ).toThrow('Tests must not contact live port');
    expect(() => connect(port, '127.0.0.1')).toThrow('Tests must not contact live port');
    expect(() => createConnection({ port, host: '127.0.0.1' })).toThrow(
      'Tests must not contact live port'
    );
    expect(takeBlockedTestPorts()).toEqual([port, port, port, port, port]);
  }
});

test('a cutoff during submission retains the admitted job ID for cancellation', async () => {
  const f = fixture({ at: Date.UTC(2026, 10, 13, 11, 59, 59), postDelay: 2000 });
  expect(await f.run()).toMatchObject({ status: 'incomplete', cancellation: 'requested' });
  expect(f.calls).toEqual(['start-prune', 'cancel']);
});
test('failed or incomplete parity cannot make the nightly chain pass', async () => {
  for (const [exit, status] of [
    [1, 'failed'],
    [2, 'incomplete'],
    [130, 'failed'],
  ] as const) {
    const f = fixture({ parityExit: exit });
    const report = await f.run();
    expect(report.status).toBe(status);
    expect(report.completed).toEqual(['prune', 'reconcile']);
  }
});

// Hold a real HTTP response body in flight while the window/interrupt fires.
// The submit must finish reading its accepted ID using its own bounded signal.
for (const stop of ['noon', 'interrupt', 'broken-response'] as const) {
  test(`in-flight submission retains or recovers cancellation ownership on ${stop}`, async () => {
    const root = mkdtempSync('/dev/shm/prox-nightly-inflight-');
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const keyFile = join(root, 'key');
    writeFileSync(keyFile, 'synthetic-key');
    const controller = new AbortController();
    let now =
      stop === 'noon' ? Date.UTC(2026, 10, 13, 11, 59, 59, 990) : Date.UTC(2026, 10, 13, 4, 20);
    const job = {
      id: 71,
      kind: 'prune',
      state: 'running',
      startedAtMs: now,
      finishedAtMs: null,
      clientToken: undefined as string | undefined,
    };
    const calls: string[] = [];
    let broken = false;
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        expect(request.headers.get('authorization')).toBe('Bearer synthetic-key');
        const path = new URL(request.url).pathname;
        if (path === '/v1/status') return Response.json({});
        if (path === '/v1/jobs/cancel') {
          expect(await request.json()).toEqual({ jobId: 71, clientToken: job.clientToken });
          calls.push('cancel');
          return Response.json({ job });
        }
        if (request.method === 'GET') {
          calls.push('recover');
          return Response.json({ job });
        }
        calls.push('submit');
        job.clientToken = ((await request.json()) as { clientToken: string }).clientToken;
        return new Response(
          new ReadableStream({
            start(stream) {
              stream.enqueue(new TextEncoder().encode('{"job":'));
              setTimeout(() => {
                if (stop === 'interrupt') controller.abort();
                if (stop === 'noon') now = Date.UTC(2026, 10, 13, 12);
              }, 1);
              setTimeout(() => {
                if (stop === 'broken-response') {
                  broken = true;
                  stream.error(new Error('synthetic connection lost'));
                } else {
                  stream.enqueue(new TextEncoder().encode(`${JSON.stringify(job)}}`));
                  stream.close();
                }
              }, 40);
            },
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      },
    });
    cleanups.push(() => server.stop(true));
    const report = await runNightly(
      {
        url: `http://127.0.0.1:${server.port}`,
        keyFile,
        backupEnabled: false,
        pollMs: 1,
        cpamp: fakeCpamp(),
      },
      {
        signal: controller.signal,
        now: () => now,
        gate: quietGate(controller.signal),
        parity: async () => {
          throw new Error('Must not reach parity');
        },
      }
    );
    expect(report).toMatchObject({
      status: stop === 'noon' ? 'incomplete' : 'failed',
      cancellation: 'requested',
      completed: [],
    });
    expect(calls).toEqual(
      stop === 'broken-response' ? ['submit', 'recover', 'cancel'] : ['submit', 'cancel']
    );
    expect(broken).toBe(stop === 'broken-response');
    if (stop === 'broken-response') expect(report.recovery).toBe('owned-job');
  });
}

test('ambiguous recovery never cancels newer operator jobs without the exact token or terminal jobs', async () => {
  for (const variant of [
    'operator-no-token',
    'operator-other-token',
    'no-job',
    'different-kind',
    'terminal',
    '409',
  ] as const) {
    const root = mkdtempSync('/dev/shm/prox-nightly-recovery-');
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const keyFile = join(root, 'key');
    writeFileSync(keyFile, 'synthetic-key');
    const now = Date.UTC(2026, 10, 13, 4, 20);
    const calls: string[] = [];
    let submittedToken = '';
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname === '/v1/status') return Response.json({});
        if (new URL(request.url).pathname.endsWith('/cancel')) {
          calls.push('cancel');
          return Response.json({});
        }
        if (request.method === 'POST') {
          calls.push('submit');
          submittedToken = ((await request.json()) as { clientToken: string }).clientToken;
          return variant === '409' ? new Response(null, { status: 409 }) : new Response('{"job":');
        }
        calls.push('recover');
        if (variant === 'no-job') return Response.json({ job: null });
        return Response.json({
          job: {
            id: 99,
            clientToken:
              variant === 'operator-other-token'
                ? 'operator-token'
                : variant === 'operator-no-token'
                  ? undefined
                  : submittedToken,
            kind: variant === 'different-kind' ? 'backup' : 'prune',
            startedAtMs: now + 500,
            state: variant === 'terminal' ? 'succeeded' : 'running',
            finishedAtMs: variant === 'terminal' ? now : null,
          },
        });
      },
    });
    cleanups.push(() => server.stop(true));
    const signal = new AbortController().signal;
    const report = await runNightly(
      {
        url: `http://127.0.0.1:${server.port}`,
        keyFile,
        backupEnabled: false,
        pollMs: 1,
        cpamp: fakeCpamp(),
      },
      { signal, now: () => now, gate: quietGate(signal) }
    );
    expect(report.status).toBe('failed');
    if (
      variant === 'operator-no-token' ||
      variant === 'operator-other-token' ||
      variant === 'no-job'
    ) {
      expect(report.recovery).toBe('no-owned-job');
      expect(report.error).toContain('no job with the submission token');
    }
    if (variant === '409') {
      expect(report.refused).toEqual({ kind: 'prune', status: 409 });
      expect(report.error).toBe('Nightly prune admission refused (HTTP 409)');
      expect(report.recovery).toBeUndefined();
      expect(report.cancellation).toBeUndefined();
    }
    expect(calls).toEqual(variant === '409' ? ['submit'] : ['submit', 'recover']);
  }
});

test('a transient rollup-backfill 409 is retried with a fresh token until admitted', async () => {
  const f = fixture({ busy: 3 });
  const report = await f.run();
  expect(report).toMatchObject({
    status: 'succeeded',
    completed: ['prune', 'reconcile', 'parity'],
    attempts: { prune: 4, reconcile: 1 },
  });
  expect(report.refused).toBeUndefined();
  expect(report.error).toBeUndefined();
  expect(new Set(f.tokens).size).toBe(f.tokens.length);
  expect(f.elapsed()).toBe(3 * 30000 + 1000 * 2);
  expect(f.calls.slice(0, 5)).toEqual([
    'busy-prune',
    'busy-prune',
    'busy-prune',
    'start-prune',
    'poll-prune',
  ]);
});
test('a persistent rollup-backfill 409 gives up inside 15 minutes with the refused report', async () => {
  const f = fixture({ busy: Infinity });
  const report = await f.run();
  expect(report).toMatchObject({
    status: 'failed',
    completed: [],
    refused: { kind: 'prune', status: 409 },
    attempts: { prune: 31 },
    error: 'Nightly prune admission refused (HTTP 409) after 31 attempts',
  });
  expect(f.elapsed()).toBeLessThanOrEqual(15 * 60000);
  expect(f.calls.every((call) => call === 'busy-prune')).toBe(true);
  expect(report.cancellation).toBeUndefined();
  expect(report.recovery).toBeUndefined();
});
test('a 409 from another bulk job is never retried', async () => {
  for (const busyError of ['Bulk job unavailable or ID differs', 'Rollup backfill in progress.']) {
    const f = fixture({ busy: Infinity, busyError });
    expect(await f.run()).toMatchObject({
      status: 'failed',
      refused: { kind: 'prune', status: 409 },
      attempts: { prune: 1 },
      error: 'Nightly prune admission refused (HTTP 409)',
    });
    expect(f.calls).toEqual(['busy-prune']);
  }
});
test('the noon cutoff during a backfill retry stops without another submit', async () => {
  const f = fixture({ busy: Infinity, at: Date.UTC(2026, 10, 13, 11, 58) });
  const report = await f.run();
  expect(report).toMatchObject({ status: 'incomplete', completed: [], attempts: { prune: 4 } });
  expect(report.error).toBe('UTC cutoff or forbidden window; chain incomplete');
  expect(f.submits).toHaveLength(4);
  expect(f.submits.every((at) => at < Date.UTC(2026, 10, 13, 12))).toBe(true);
  expect(f.calls).not.toContain('cancel');
  expect(f.calls).not.toContain('parity');
});

test('both CPAMP collectors subscribing lets the chain run, using the admin key', async () => {
  const f = fixture();
  expect(await f.run()).toMatchObject({
    status: 'succeeded',
    cpamp: {
      ok: true,
      collectors: [
        { mode: 'auto', transport: 'subscribe', state: 'running' },
        { mode: 'auto', transport: 'subscribe', state: 'running' },
      ],
    },
  });
  expect(f.cpamp.requests).toEqual(['/status Bearer synthetic-cpamp-key']);
});
test('a CPAMP collector that is polling, errored or missing fails before any job', async () => {
  for (const collectors of [
    [subscribing, { mode: 'auto', transport: 'http', collector: 'running' }],
    [subscribing, { mode: 'auto', transport: 'resp', collector: 'running' }],
    [subscribing, { mode: 'auto', transport: 'subscribe', collector: 'error' }],
    [subscribing, { mode: 'auto', transport: '', collector: 'starting', lastError: 'secret' }],
    [subscribing],
    [],
  ]) {
    const f = fixture({ cpamp: collectors });
    const report = await f.run();
    expect(report).toMatchObject({
      status: 'failed',
      completed: [],
      cpamp: { ok: false },
    });
    expect(report.error).toContain('CPAMP');
    expect(JSON.stringify(report)).not.toContain('secret');
    expect(JSON.stringify(report)).not.toContain('synthetic-cpamp-key');
    expect(f.calls).toEqual([]);
  }
});
test('an unreachable or unauthorized CPAMP fails before any job', async () => {
  const down = fixture({ cpamp: 'down' });
  expect(await down.run()).toMatchObject({
    status: 'failed',
    cpamp: { ok: false, collectors: [] },
    error: 'CPAMP status unreachable; no job started',
  });
  expect(down.calls).toEqual([]);
  const denied = fixture();
  writeFileSync(denied.cpamp.keyFile, 'wrong-key');
  expect(await denied.run()).toMatchObject({
    status: 'failed',
    cpamp: { ok: false, collectors: [] },
    error: 'CPAMP status unreachable; no job started',
  });
  expect(denied.calls).toEqual([]);
});
test('a retired CPAMP skips guard, reconcile and parity, records the skip, and succeeds', async () => {
  const f = fixture({ status: { cpamp_retired: true } });
  // Any read of the admin key or call to CPAMP would now fail the night.
  rmSync(f.cpamp.keyFile);
  const report = await f.run();
  expect(report).toMatchObject({
    status: 'succeeded',
    completed: ['prune'],
    cpamp: { retired: true, skipped: ['guard', 'reconcile', 'parity'] },
  });
  expect(report.error).toBeUndefined();
  expect(f.calls).toEqual(['start-prune', 'poll-prune']);
  expect(f.cpamp.requests).toEqual([]);
  expect(f.statusReads()).toBe(1);
  expect(JSON.parse(JSON.stringify(report)).cpamp).toEqual({
    retired: true,
    skipped: ['guard', 'reconcile', 'parity'],
  });
});
test('a retired CPAMP still runs the backup when it is enabled, and failures still fail', async () => {
  const backup = fixture({ status: { cpamp_retired: true }, backup: true });
  expect(await backup.run()).toMatchObject({
    status: 'succeeded',
    backup: 'completed',
    completed: ['prune', 'backup'],
    cpamp: { retired: true },
  });
  const failed = fixture({ status: { cpamp_retired: true }, fail: 'prune' });
  expect(await failed.run()).toMatchObject({
    status: 'failed',
    completed: [],
    cpamp: { retired: true },
  });
});
test('only an explicit true retires CPAMP; an old server without the field runs the guard', async () => {
  for (const status of [{}, { cpamp_retired: false }, { cpamp_retired: 'true' }, { cpamp_retired: 1 }]) {
    const f = fixture({ status });
    expect(await f.run()).toMatchObject({
      status: 'succeeded',
      completed: ['prune', 'reconcile', 'parity'],
      cpamp: { ok: true },
    });
    expect(f.cpamp.requests).toEqual(['/status Bearer synthetic-cpamp-key']);
  }
});
test('I/O-gate waits cannot push a backfill retry past the 15-minute bound', async () => {
  const f = fixture({ busy: Infinity, stall: 16 * 60000 });
  expect(await f.run()).toMatchObject({
    status: 'failed',
    refused: { kind: 'prune', status: 409 },
    attempts: { prune: 1 },
    error: 'Nightly prune admission refused (HTTP 409)',
  });
  expect(f.submits).toHaveLength(1);
});
test('attempts count only sent POSTs when a gate wait runs into the noon cutoff', async () => {
  const f = fixture({ busy: Infinity, at: Date.UTC(2026, 10, 13, 11, 50), stall: 11 * 60000 });
  expect(await f.run()).toMatchObject({ status: 'incomplete', attempts: { prune: 1 } });
  expect(f.submits).toHaveLength(1);
});
test('a refusal from an earlier attempt is not reported when a later submit needs recovery', async () => {
  const root = mkdtempSync('/dev/shm/prox-nightly-stale-refusal-');
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, 'key');
  writeFileSync(keyFile, 'synthetic-key');
  let now = Date.UTC(2026, 10, 13, 4, 20);
  const calls: string[] = [];
  let token = '';
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === '/v1/status') return Response.json({});
      if (new URL(request.url).pathname.endsWith('/cancel')) {
        calls.push('cancel');
        return Response.json({});
      }
      if (request.method === 'POST') {
        token = ((await request.json()) as { clientToken: string }).clientToken;
        calls.push('submit');
        return calls.length === 1
          ? Response.json({ error: 'Rollup backfill in progress' }, { status: 409 })
          : new Response('{"job":');
      }
      calls.push('recover');
      return Response.json({
        job: {
          id: 5,
          kind: 'prune',
          state: 'running',
          startedAtMs: now,
          finishedAtMs: null,
          clientToken: token,
        },
      });
    },
  });
  cleanups.push(() => server.stop(true));
  const signal = new AbortController().signal;
  const report = await runNightly(
    {
      url: `http://127.0.0.1:${server.port}`,
      keyFile,
      backupEnabled: false,
      pollMs: 1,
      cpamp: fakeCpamp(),
    },
    {
      signal,
      now: () => now,
      gate: quietGate(signal),
      sleep: async (ms) => {
        now += ms;
      },
    }
  );
  expect(report).toMatchObject({
    status: 'failed',
    recovery: 'owned-job',
    cancellation: 'requested',
    attempts: { prune: 2 },
  });
  expect(report.refused).toBeUndefined();
  expect(report.error).not.toContain('refused');
  expect(calls).toEqual(['submit', 'submit', 'recover', 'cancel']);
});
