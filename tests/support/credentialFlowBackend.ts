/**
 * Backend for the credential-flow browser test. Run with Bun (the real store needs bun:sqlite):
 * two fake CLI-Proxy instances plus the REAL prox-history handler, store and collector pointed at
 * them, and a small control API the test uses to change credentials "from outside Prox", make an
 * instance fail, and move the server clock. Everything is synthetic and bound to loopback;
 * no real CLI-Proxy, prox-history or credential file is read.
 *
 * Prints one JSON line with the ports, then runs until stdin closes or it is signalled.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../../server/app';
import { QuotaCollector } from '../../server/quota/collector';
import { QuotaStore } from '../../server/quota/store';
import type { DeploymentSource } from '../../src/domain/providerSources/types';

type Instance = 'codex' | 'claude';
const PROVIDER_OF: Record<Instance, 'codex' | 'claude'> = { codex: 'codex', claude: 'claude' };
const KEY = 'synthetic-management-key';
const RESET = Date.now() + 86_400_000;

interface Credential {
  name: string;
  email: string;
  disabled: boolean;
  authIndex: string;
}
const credentials: Record<Instance, Credential[]> = {
  codex: [
    { name: 'alice.json', email: 'shared@example.test', disabled: false, authIndex: 'codex-alice' },
    { name: 'bob.json', email: 'bob@example.test', disabled: false, authIndex: 'codex-bob' },
  ],
  claude: [
    {
      name: 'carol.json',
      email: 'shared@example.test',
      disabled: false,
      authIndex: 'claude-carol',
    },
    { name: 'dave.json', email: 'dave@example.test', disabled: false, authIndex: 'claude-dave' },
  ],
};
const failing: Record<Instance, number | null> = { codex: null, claude: null };
/** Claude reset grants by auth index: how many resets each account holds. Off until a test grants. */
const grants = new Map<string, number>();
const claims: string[] = [];
const ORGANIZATION = '11111111-2222-3333-4444-555555555555';
const reads: Record<Instance, number> = { codex: 0, claude: 0 };
let usageCalls = 0;
let offsetMs = 0;
const now = () => Date.now() + offsetMs;

const entry = (instance: Instance, credential: Credential) => ({
  id: credential.name,
  name: credential.name,
  type: PROVIDER_OF[instance],
  provider: PROVIDER_OF[instance],
  auth_index: credential.authIndex,
  email: credential.email,
  disabled: credential.disabled,
  status: credential.disabled ? 'disabled' : 'active',
  source: 'file',
  size: 512,
  modtime: new Date(RESET - 86_400_000).toISOString(),
});
/** Spending a grant refills the account's windows, as a real reset does. */
const claudeUsage = (authIndex: string) => {
  const held = grants.get(authIndex);
  const spent = claims.includes(authIndex);
  return JSON.stringify({
    five_hour: { utilization: spent ? 0 : 25, resets_at: new Date(RESET).toISOString() },
    seven_day: { utilization: spent ? 5 : 60, resets_at: new Date(RESET).toISOString() },
    ...(held === undefined
      ? {}
      : {
          cedar_ember: {
            eligible: true,
            at_limit: true,
            grants: [
              {
                id: 'fable-grant',
                resets_total: 1,
                resets_left: held,
                usable_now: held > 0,
                gives_back_weekly: true,
                ends_at: new Date(RESET + 3 * 86_400_000).toISOString(),
              },
            ],
          },
        }),
  });
};
const usageBody = (instance: Instance, authIndex = '') =>
  instance === 'claude'
    ? claudeUsage(authIndex)
    : instance === 'codex'
    ? {
        rate_limit: {
          primary_window: {
            used_percent: 10,
            limit_window_seconds: 604800,
            reset_at: RESET / 1000,
          },
          secondary_window: {
            used_percent: 20,
            limit_window_seconds: 18000,
            reset_at: RESET / 1000,
          },
        },
      }
    : {};

/** One fake CLI-Proxy: only the credential routes and the usage proxy the collector needs. */
function fakeCliProxy(instance: Instance) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url);
      const path = url.pathname.replace('/v8/management', '');
      const list = credentials[instance];
      if (path === '/credentials' && request.method === 'GET') {
        reads[instance]++;
        if (failing[instance] !== null) {
          return new Response('unavailable', { status: failing[instance]! });
        }
        return Response.json({ files: list.map((credential) => entry(instance, credential)) });
      }
      if (path === '/credentials' && request.method === 'DELETE') {
        const body = (await request.json()) as { names?: string[] };
        const names = body.names ?? [];
        const deleted = names.filter((name) => list.some((credential) => credential.name === name));
        credentials[instance] = list.filter((credential) => !deleted.includes(credential.name));
        return Response.json({ status: 'ok', deleted: deleted.length, files: deleted, failed: [] });
      }
      if (path === '/credentials' && request.method === 'POST') {
        const form = await request.formData();
        const files = form.getAll('file').filter((value): value is File => value instanceof File);
        const added: string[] = [];
        for (const file of files) {
          const parsed = JSON.parse(await file.text()) as { email?: string };
          credentials[instance].push({
            name: file.name,
            email: parsed.email ?? `${file.name}@example.test`,
            disabled: false,
            authIndex: `${instance}-${file.name.replace(/\.json$/, '')}`,
          });
          added.push(file.name);
        }
        return Response.json({ status: 'ok', uploaded: added.length, files: added, failed: [] });
      }
      if (path === '/requests/api-call' && request.method === 'POST') {
        usageCalls++;
        const body = (await request.json()) as { url?: string; authIndex?: string };
        const authIndex = String(body.authIndex ?? '');
        if (instance === 'claude' && String(body.url).endsWith('/reset_rate_limits')) {
          const held = grants.get(authIndex) ?? 0;
          if (held === 0) return Response.json({ status_code: 200, body: { result: 'no_credit' } });
          grants.set(authIndex, held - 1);
          claims.push(authIndex);
          return Response.json({ status_code: 200, body: { result: 'reset' } });
        }
        if (instance === 'claude' && grants.has(authIndex) && String(body.url).includes('profile')) {
          return Response.json({ status_code: 200, body: { organization: { uuid: ORGANIZATION } } });
        }
        // Plan and profile lookups answer with an empty body; the usage URL answers the windows.
        const isUsage =
          !String(body.url).includes('profile') && !String(body.url).includes('subscription');
        return Response.json({
          status_code: 200,
          body: isUsage ? usageBody(instance, authIndex) : {},
        });
      }
      return new Response('not found', { status: 404 });
    },
  });
}

const root = mkdtempSync(join(tmpdir(), 'prox-credential-flow-'));
const keyFile = join(root, 'management-key');
writeFileSync(keyFile, `${KEY}\n`, { mode: 0o600 });
const cli = { codex: fakeCliProxy('codex'), claude: fakeCliProxy('claude') };
const source = (instance: Instance): DeploymentSource => ({
  instanceId: `${instance}-primary`,
  label: instance === 'codex' ? 'GPT / Codex' : 'Claude / Claude Code',
  publicBasePath: `/${instance}`,
  aliases: instance === 'codex' ? [''] : [],
  authScope: 'homelab-management',
  providers: [PROVIDER_OF[instance]],
  upstreamOrigin: `http://127.0.0.1:${cli[instance].port}`,
  managementKeyFile: keyFile,
});
const store = new QuotaStore(join(root, 'data', 'quota.sqlite'), now);
const collector = new QuotaCollector(store, {
  sources: [source('codex'), source('claude')],
  revision: 'credential-flow',
  now,
});
const history = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: createHandler({ store, collector, keyFile, now }),
});

const json = (value: unknown, status = 200) => Response.json(value, { status });
const control = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: async (request) => {
    const url = new URL(request.url);
    const body =
      request.method === 'POST'
        ? ((await request.json().catch(() => ({}))) as Record<string, unknown>)
        : {};
    const instance = url.pathname.split('/')[2] as Instance | undefined;
    if (url.pathname === '/state') {
      return json({
        accounts: store.listAccounts().map((account) => ({
          id: account.id,
          instanceId: account.instanceId,
          provider: account.provider,
          retired: account.retired,
          name: account.name,
          email: account.email,
        })),
        samples: store.listSamples(0, now() + 1).length,
        reads,
        usageCalls,
        claims: [...claims],
        cli: {
          codex: credentials.codex.map((credential) => credential.name),
          claude: credentials.claude.map((credential) => credential.name),
        },
      });
    }
    if (url.pathname === '/advance') {
      offsetMs += Number(body.ms ?? 0);
      return json({ ok: true });
    }
    if (url.pathname === '/collect') {
      await collector.refresh();
      return json({ ok: true });
    }
    if (instance && instance in cli) {
      if (url.pathname.endsWith('/add')) {
        credentials[instance].push({
          name: String(body.name),
          email: String(body.email),
          disabled: false,
          authIndex: `${instance}-${String(body.name).replace(/\.json$/, '')}`,
        });
        return json({ ok: true });
      }
      if (url.pathname.endsWith('/remove')) {
        credentials[instance] = credentials[instance].filter(
          (credential) => credential.name !== body.name
        );
        return json({ ok: true });
      }
      if (url.pathname.endsWith('/grant')) {
        grants.set(String(body.authIndex), Number(body.left));
        return json({ ok: true });
      }
      if (url.pathname.endsWith('/fail')) {
        failing[instance] = (body.status as number | null) ?? null;
        return json({ ok: true });
      }
    }
    return json({ error: 'not found' }, 404);
  },
});

const shutdown = () => {
  collector.stop();
  for (const server of [history, control, cli.codex, cli.claude]) void server.stop(true);
  store.close();
  rmSync(root, { recursive: true, force: true });
  process.exit(0);
};
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
process.stdin.on('end', shutdown);
process.stdin.resume();
console.log(
  JSON.stringify({
    history: history.port,
    control: control.port,
    codex: cli.codex.port,
    claude: cli.claude.port,
  })
);
