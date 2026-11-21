import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createUsageStatusHandler } from '../server/usage/status';

let temp = '';
afterEach(() => {
  if (temp) rmSync(temp, { recursive: true, force: true });
  temp = '';
});

test('status is bearer protected, health is public, missing/empty keys fail closed', async () => {
  temp = mkdtempSync(join('/dev/shm', 'prox-usage-status-'));
  const keyFile = join(temp, 'key');
  const handler = createUsageStatusHandler({
    keyFile,
    sources: () => [],
    healthy: () => true,
    writer: () => ({
      backlog: 3,
      gaps: 2,
      rawBufferFailures: 1,
      inserted: 5,
      duplicates: 0,
      rejected: 0,
    }),
  });
  const request = (path: string, key?: string) =>
    new Request(`http://127.0.0.1${path}`, {
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
  expect((await handler(request('/healthz'))).status).toBe(200);
  expect((await handler(request('/v1/status'))).status).toBe(401);
  expect((await handler(request('/v1/status', 'key'))).status).toBe(503);
  writeFileSync(keyFile, '  ');
  expect((await handler(request('/v1/status', 'key'))).status).toBe(503);
  writeFileSync(keyFile, 'synthetic-key');
  expect((await handler(request('/v1/status', 'wrong'))).status).toBe(401);
  const response = await handler(request('/v1/status', 'synthetic-key'));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    writer: { backlog: 3, gaps: 2, rawBufferFailures: 1 },
  });
  expect((await handler(request('/unknown'))).status).toBe(404);
  expect(
    (
      await handler(
        new Request('http://127.0.0.1/v1/status', {
          method: 'POST',
          headers: { Authorization: 'Bearer synthetic-key' },
        })
      )
    ).status
  ).toBe(405);
});

test('status and exporter report the main-thread event-loop lag when a probe is wired', async () => {
  temp = mkdtempSync(join('/dev/shm', 'prox-usage-status-lag-'));
  const keyFile = join(temp, 'key');
  writeFileSync(keyFile, 'synthetic-key');
  const writer = () => ({
    backlog: 0,
    gaps: 0,
    rawBufferFailures: 0,
    inserted: 0,
    duplicates: 0,
    rejected: 0,
  });
  const eventLoop = () => ({ maxLagMs: 1500, stallsOver1s: 2, lastStallAtMs: 5_000 });
  const get = (handler: ReturnType<typeof createUsageStatusHandler>, path: string) =>
    handler(
      new Request(`http://127.0.0.1${path}`, { headers: { Authorization: 'Bearer synthetic-key' } })
    );
  const handler = createUsageStatusHandler({
    keyFile,
    sources: () => [],
    healthy: () => true,
    writer,
    eventLoop,
    exporter: async () => ({ schema_version: 1 }) as never,
  });
  expect(await (await get(handler, '/v1/status')).json()).toMatchObject({
    eventLoop: { maxLagMs: 1500, stallsOver1s: 2, lastStallAtMs: 5_000 },
  });
  expect(await (await get(handler, '/v1/exporter')).json()).toMatchObject({
    event_loop: { max_lag_seconds: 1.5, stalls_total: 2, last_stall_time_seconds: 5 },
  });
  // Without a probe the existing responses are unchanged.
  const plain = createUsageStatusHandler({
    keyFile,
    sources: () => [],
    healthy: () => true,
    writer,
  });
  expect(await (await get(plain, '/v1/status')).json()).not.toHaveProperty('eventLoop');
});

test('the main-thread runtime module graph never imports bun:sqlite or a worker entry', () => {
  const transpiler = new Bun.Transpiler({ loader: 'ts', target: 'bun' });
  const visited = new Set<string>();
  const root = resolve(import.meta.dir, '..');
  const visit = (file: string) => {
    if (visited.has(file)) return;
    visited.add(file);
    for (const entry of transpiler.scanImports(readFileSync(file, 'utf8'))) {
      expect(entry.path).not.toBe('bun:sqlite');
      expect(entry.path).not.toContain('.worker');
      if (entry.path.startsWith('.') || entry.path.startsWith('@/')) {
        const base = entry.path.startsWith('@/')
          ? resolve(root, 'src', entry.path.slice(2))
          : resolve(dirname(file), entry.path);
        visit(`${base}.ts`);
      }
    }
  };
  visit(join(root, 'server/usage/main.ts'));
  expect(visited.size).toBeGreaterThan(10);
  for (const module of [
    'store',
    'bulkJobs',
    'importCpamp',
    'backup',
    'ioGovernor',
    'writerRuntime',
  ]) {
    expect(visited.has(join(root, `server/usage/${module}.ts`))).toBe(false);
  }
  expect([...visited].some((file) => file.endsWith('/usage/handler.ts'))).toBe(true);
  expect([...visited].some((file) => file.endsWith('/usage/lanes.ts'))).toBe(true);
  const scripts = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts;
  expect(scripts['build:usage']).toContain('./server/usage/query.worker.ts');
  expect(scripts['build:usage']).toContain('./server/usage/writer.worker.ts');
  expect(scripts['build:usage']).toContain('--entry-naming [name].js');
});

test('deploy uses the history image, hashes both bundles and keeps the API on loopback', () => {
  const root = resolve(import.meta.dir, '..');
  const read = (path: string) => readFileSync(join(root, path), 'utf8');
  const script = read('scripts/deploy-homelab.sh');
  expect(script.match(/podman build /g)).toHaveLength(2);
  expect(script).toContain('sha256sum dist/usage/*.js');
  // The manifest is baked into the image and the quadlet holds the key mount: either one changing
  // must restart the collector, or it keeps the old sources and mount.
  expect(script).toMatch(
    /usage_hash=\$\(sha256sum dist\/usage\/\*\.js deploy\/provider-sources\.json deploy\/prox-usage\.container\s/
  );
  expect(script).toContain('if [[ "$usage_hash" != "$previous_usage_hash" ]]');
  expect(script.match(/restart prox-usage.service/g)).toHaveLength(1);
  expect(read('deploy/prox-usage.container')).toContain('Image=localhost/prox-history:dev');
  expect(read('deploy/prox-usage.container')).toContain('Exec=bun /app/usage/main.js');
  // CPA-Manager-Plus is retired: no mount of its data, and retired mode stays on.
  expect(read('deploy/prox-usage.container')).not.toContain('cpa-manager-plus');
  expect(read('deploy/prox-usage.container')).toContain('Environment=PROX_USAGE_CPAMP_RETIRED=1');
  expect(script).toContain(
    'install -m 644 deploy/usage-rates.json "$HOME/.local/share/prox-usage/usage-rates.json"'
  );
  expect(read('deploy/Dockerfile.history')).toContain('COPY dist/usage /app/usage');
  expect(read('server/usage/main.ts')).toContain("hostname: '127.0.0.1'");
});

test('job commands require the shared bearer, validate bounded input and expose progress in status', async () => {
  temp = mkdtempSync('/dev/shm/prox-usage-admin-');
  const keyFile = join(temp, 'key');
  writeFileSync(keyFile, 'synthetic-admin');
  const calls: unknown[] = [];
  const report = {
    id: 1,
    kind: 'import' as const,
    state: 'running' as const,
    startedAtMs: 1,
    finishedAtMs: null,
    progress: { phase: 'import' as const, read: 1000, inserted: 999, lastId: 1000, chunks: 1 },
    io: { bytesRead: 100, bytesWritten: 50, pauseSeconds: 1, longPauses: 0 },
    lastBackupSuccessAtMs: null,
  };
  const handler = createUsageStatusHandler({
    keyFile,
    healthy: () => true,
    sources: () => [],
    writer: () => ({
      backlog: 0,
      gaps: 0,
      inserted: 0,
      duplicates: 0,
      rejected: 0,
      rawBufferFailures: 0,
    }),
    jobs: {
      startJob: async (kind) => {
        calls.push(kind);
        return report;
      },
      cancelJob: async (jobId) => {
        calls.push(jobId);
        return { ...report, state: 'cancelling' };
      },
      jobReport: async () => report,
    },
  });
  const request = (path: string, method = 'GET', body?: unknown, key = 'synthetic-admin') =>
    new Request(`http://127.0.0.1${path}`, {
      method,
      headers: key ? { Authorization: `Bearer ${key}` } : {},
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  for (const key of ['', 'wrong']) {
    for (const path of ['/v1/jobs', '/v1/jobs/cancel']) {
      expect((await handler(request(path, 'POST', { kind: 'import' }, key))).status).toBe(401);
      expect((await handler(request(path, 'GET', undefined, key))).status).toBe(401);
    }
  }
  expect(calls).toEqual([]);
  for (const kind of ['import', 'reconcile', 'verify', 'backup', 'prune']) {
    expect((await handler(request('/v1/jobs', 'POST', { kind }))).status).toBe(202);
  }
  expect((await handler(request('/v1/jobs/cancel', 'POST', { jobId: 1 }))).status).toBe(202);
  expect(calls).toEqual(['import', 'reconcile', 'verify', 'backup', 'prune', 1]);
  expect(await (await handler(request('/v1/jobs'))).json()).toEqual({ job: report });
  expect(await (await handler(request('/v1/status'))).json()).toMatchObject({
    writer: { job: report },
  });
  for (const body of [
    {},
    { kind: 'vacuum' },
    { kind: 'import', path: '/forbidden' },
    { kind: { toString: 'import' } },
    [],
    null,
    { kind: 'x'.repeat(1025) },
  ]) {
    expect((await handler(request('/v1/jobs', 'POST', body))).status).toBe(400);
  }
  for (const jobId of [0, -1, 1.5, '1', null]) {
    expect((await handler(request('/v1/jobs/cancel', 'POST', { jobId }))).status).toBe(400);
  }
  expect((await handler(request('/v1/jobs', 'DELETE'))).status).toBe(405);
  expect((await handler(request('/v1/jobs', 'POST', undefined))).status).toBe(400);
  const malformed = new Request('http://127.0.0.1/v1/jobs', {
    method: 'POST',
    body: '{',
    headers: { Authorization: 'Bearer synthetic-admin' },
  });
  expect((await handler(malformed)).status).toBe(400);
  const missingKey = createUsageStatusHandler({
    keyFile: join(temp, 'missing'),
    sources: () => [],
    healthy: () => true,
    writer: () => ({
      backlog: 0,
      gaps: 0,
      inserted: 0,
      duplicates: 0,
      rejected: 0,
      rawBufferFailures: 0,
    }),
  });
  expect((await missingKey(request('/v1/jobs', 'POST', { kind: 'import' }))).status).toBe(503);
});

test('usage schedules are UTC, nonpersistent and only installed by deploy', () => {
  const root = resolve(import.meta.dir, '..');
  const script = readFileSync(join(root, 'scripts/deploy-homelab.sh'), 'utf8');
  const timer = readFileSync(join(root, 'deploy/prox-usage-nightly.timer'), 'utf8');
  expect(timer).toContain('OnCalendar=*-*-* 04:20:00 UTC');
  expect(timer).toContain('Persistent=false');
  expect(timer).toContain('Unit=prox-usage-nightly.service');
  expect(script).toContain('install -D -m 644 deploy/prox-usage-nightly.timer');
  expect(script).not.toContain('deploy/prox-usage-$job.timer');
  expect(script).not.toMatch(/systemctl[^\n]*(?:enable|start)[^\n]*prox-usage-/);
  const service = readFileSync(join(root, 'deploy/prox-usage-job@.service'), 'utf8');
  expect(service).toContain('Type=oneshot');
  expect(service).toContain('ExecStart=/bin/sh %h/.local/share/prox/prox-usage-job.sh %i');
  expect(script).toContain('install -D -m 755 deploy/prox-usage-job.sh');
});
