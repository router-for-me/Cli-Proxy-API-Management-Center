import { test as base, expect, type BrowserContext, type Page, type Route } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { AnalyticsQuery } from '../../src/domain/analytics/types';
import { analyticsScenario } from '../fixtures/analyticsUi';

const config = parse(
  readFileSync(new URL('../fixtures/visualConfig-v8.yaml', import.meta.url), 'utf8')
);
// The production discovery document: two sources, codex as the default alias.
const discovery = JSON.parse(
  readFileSync(new URL('../../deploy/provider-discovery.json', import.meta.url), 'utf8')
);

interface Ports {
  history: number;
  control: number;
  codex: number;
  claude: number;
}
export interface BackendState {
  accounts: {
    id: string;
    instanceId: string;
    provider: string;
    retired: boolean;
    name: string;
    email: string | null;
  }[];
  samples: number;
  reads: { codex: number; claude: number };
  usageCalls: number;
  /** Auth indexes whose fake reset grant was claimed, in order. */
  claims: string[];
  cli: { codex: string[]; claude: string[] };
}

const bunBinary = () => {
  const local = join(homedir(), '.local', 'bin', 'bun');
  return process.env.BUN_BIN ?? (existsSync(local) ? local : 'bun');
};

/** The real prox-history over two fake CLI-Proxies, reached through the browser's routes. */
export class CredentialFlow {
  readonly unexpected: string[] = [];
  readonly errors: string[] = [];
  /** Every request to prox-history, so tests can see what the screens asked for. */
  readonly proxRequests: string[] = [];
  analytics: AnalyticsQuery[] = [];
  /** When set, every hub says it supports plugins and answers `/plugins` with an empty list. */
  pluginSupport = false;
  /** Every `/plugins` list request, by path, so tests can count the reads per hub. */
  readonly pluginRequests: string[] = [];
  private child!: ChildProcess;
  private ports!: Ports;

  constructor(readonly origin: string) {}

  async start() {
    const backend = new URL('../support/credentialFlowBackend.ts', import.meta.url).pathname;
    this.child = spawn(bunBinary(), [backend], { stdio: ['pipe', 'pipe', 'inherit'] });
    this.ports = await new Promise<Ports>((resolve, reject) => {
      let buffer = '';
      this.child.stdout!.on('data', (chunk: Buffer) => {
        buffer += chunk.toString();
        const line = buffer.split('\n')[0];
        if (buffer.includes('\n')) resolve(JSON.parse(line) as Ports);
      });
      this.child.once('error', reject);
      this.child.once('exit', (code) => reject(new Error(`backend exited with ${code}`)));
    });
  }

  stop() {
    this.child?.stdin?.end();
    this.child?.kill('SIGTERM');
  }

  private async control<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetch(`http://127.0.0.1:${this.ports.control}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return (await response.json()) as T;
  }
  state = () => this.control<BackendState>('/state');
  /** Asks the real prox-history directly, as another client would. */
  async history<T>(path: string): Promise<T> {
    const response = await fetch(`http://127.0.0.1:${this.ports.history}${path}`, {
      headers: { Authorization: 'Bearer synthetic-management-key' },
    });
    return (await response.json()) as T;
  }
  /** A change made to a CLI-Proxy directly, the way an outside edit or another device would. */
  addOutside = (instance: 'codex' | 'claude', name: string, email: string) =>
    this.control(`/cli/${instance}/add`, { name, email });
  removeOutside = (instance: 'codex' | 'claude', name: string) =>
    this.control(`/cli/${instance}/remove`, { name });
  /** Gives a fake Claude account that many reset grants (its usage then lists them). */
  grantClaudeResets = (authIndex: string, left: number) =>
    this.control('/cli/claude/grant', { authIndex, left });
  failCredentials = (instance: 'codex' | 'claude', status: number | null) =>
    this.control(`/cli/${instance}/fail`, { status });
  advanceServerClock = (ms: number) => this.control('/advance', { ms });
  collect = () => this.control('/collect', {});

  private async forward(route: Route, port: number, path: string) {
    const url = new URL(route.request().url());
    try {
      const response = await route.fetch({ url: `http://127.0.0.1:${port}${path}${url.search}` });
      return await route.fulfill({ response });
    } catch {
      // The backend or the page went away mid-request (teardown); there is nobody to answer.
      return route.abort().catch(() => undefined);
    }
  }

  /** Routes every request of the context: local assets, the backends, and explicit mocks only. */
  async install(context: BrowserContext) {
    const origin = this.origin;
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const reply = (json: unknown, status = 200) =>
        route.fulfill({
          status,
          json,
          headers: {
            'X-CPA-Version': 'v8.0.44',
            ...(this.pluginSupport ? { 'X-CPA-Support-Plugin': 'true' } : {}),
          },
        });
      if (url.origin !== origin) {
        this.unexpected.push(`${request.method()} ${url.origin}${url.pathname}`);
        return route.abort();
      }
      if (url.pathname === '/prox/sources.json') return reply(discovery);
      const match = url.pathname.match(/^(?:\/(codex|claude))?\/v8\/management(\/.*)$/);
      if (match) {
        const [, prefix, path] = match;
        const instance = (prefix ?? 'codex') as 'codex' | 'claude';
        if (path.startsWith('/prox/')) {
          const rest = path.slice('/prox/'.length);
          if (rest === 'analytics') {
            const query = request.postDataJSON() as AnalyticsQuery;
            this.analytics.push(query);
            const response = analyticsScenario('ready', query);
            response.coverage.raw_complete = true;
            return reply(response);
          }
          this.proxRequests.push(`${request.method()} ${rest.split('?')[0]}`);
          return this.forward(route, this.ports.history, `/v1/${rest}`);
        }
        if (path === '/credentials') {
          return this.forward(route, this.ports[instance], `/v8/management${path}`);
        }
        // Quota reads and reset claims go to the loopback fake CLI-Proxy and nowhere else.
        if (path === '/requests/api-call' && request.method() === 'POST') {
          return this.forward(route, this.ports[instance], `/v8/management${path}`);
        }
        if (request.method() === 'GET') {
          if (path === '/config') return reply(config);
          if (path === '/auth-files') return reply({ files: [] });
          if (path === '/config/access/api-keys') return reply(['synthetic-client-key']);
          if (path === '/usage') return reply({ usage: { total_requests: 0, apis: {} } });
          if (path === '/api-key-usage') return reply({});
          if (path === '/observability/usage/api-keys') return reply({});
          if (path === '/config/oauth/excluded-models') return reply({});
          if (path === '/config/oauth/model-alias') return reply({});
          // The shared model-access store reads these for the accounts it lists (the Models
          // screen and the OAuth pages): each hub's catalog, each credential's own file (for its
          // own exclusion list) and the models the hub registered for it. Nothing is excluded.
          if (path.startsWith('/routing/model-definitions/')) return reply({ models: [] });
          if (path === '/credentials/download') return reply({});
          if (path === '/credentials/models') return reply({ models: [] });
          if (path === '/plugins' && this.pluginSupport) {
            this.pluginRequests.push(url.pathname);
            return reply({ plugins_enabled: true, plugins_dir: 'plugins', plugins: [] });
          }
        }
      }
      if (
        /^(?:\/(?:codex|claude))?\/v1\/models$/.test(url.pathname) &&
        request.method() === 'GET'
      ) {
        return reply({ data: [] });
      }
      if (
        !url.pathname.includes('/management') &&
        !url.pathname.startsWith('/v1/') &&
        request.method() === 'GET' &&
        (url.pathname === '/' ||
          /^\/(src|node_modules|@vite|@react-refresh|@fs)\b/.test(url.pathname))
      ) {
        return route.continue();
      }
      this.unexpected.push(`${request.method()} ${url.pathname}`);
      return route.abort();
    });
  }

  /** Opens a page on a hash route, logging in first if this context has no session yet. */
  async open(context: BrowserContext, hash: string): Promise<Page> {
    const page = await context.newPage();
    page.on('pageerror', (error) => this.errors.push(error.message));
    await page.goto('/');
    const password = page.locator('input[type=password]');
    const nav = page.getByRole('link', { name: 'Auth Files' }).first();
    // A later tab of the same context may already hold the session; wait for whichever shows.
    await password.or(nav).first().waitFor({ state: 'attached' });
    if (await password.isVisible()) {
      await password.fill('synthetic-management-key');
      await page.getByRole('button', { name: 'Login', exact: true }).click();
    }
    // Login lands on the default route and forgets the requested one. That redirect fires after
    // the shell mounts, so wait for it to finish or it would overwrite the route set below.
    await nav.waitFor({ state: 'attached' });
    // Poll the hash itself: waitForURL also waits for a page "load" that a hash change never
    // fires again, which a slow first compile can leave pending.
    const currentHash = () => page.evaluate(() => window.location.hash);
    await expect.poll(currentHash, { timeout: 60_000 }).toBe('#/quota');
    await page.evaluate((target) => void (window.location.hash = target), hash);
    // Some routes (Analytics) append their own query to the hash, so match the route as a prefix.
    await expect
      .poll(async () => (await currentHash()).startsWith(`#${hash}`), { timeout: 60_000 })
      .toBe(true);
    return page;
  }
}

export const test = base.extend<{ flow: CredentialFlow }>({
  flow: async ({ baseURL, context }, run) => {
    const flow = new CredentialFlow(new URL(baseURL!).origin);
    await flow.start();
    await flow.install(context);
    await run(flow);
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    flow.stop();
    expect(flow.unexpected, 'No unmocked API or external request may reach a backend').toEqual([]);
    expect(flow.errors, 'No browser runtime errors').toEqual([]);
  },
});
export { expect };
