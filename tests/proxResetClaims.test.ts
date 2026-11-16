import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../server/app';
import { ResetClaims } from '../server/quota/claims';
import { QuotaCollector } from '../server/quota/collector';
import { QuotaStore } from '../server/quota/store';
import type { DeploymentSource } from '../src/domain/providerSources/types';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_USAGE_URL,
} from '../src/utils/quota/constants';

const NOW = 1_800_000_000_000;
const KEY = 'synthetic-management-key';
const ORG = '11111111-2222-3333-4444-555555555555';
const USAGE = 'https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1';
const PROFILE = 'https://api.anthropic.com/api/oauth/profile';
const CLAIM = `https://api.anthropic.com/api/organizations/${ORG}/reset_rate_limits`;
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

type Call = { path: string; body: Record<string, unknown> | null };

/** One fake hub: the only thing these tests ever send requests to. */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'prox-claims-'));
  const keyFile = join(root, 'key');
  writeFileSync(keyFile, KEY, { mode: 0o600 });
  const source: DeploymentSource = {
    instanceId: 'hub',
    label: 'hub',
    publicBasePath: '/hub',
    aliases: [],
    authScope: 'test',
    upstreamOrigin: 'http://hub.invalid',
    managementKeyFile: keyFile,
  };
  const hub = {
    claude: { weekly: 60, five: 30, fable: 80, left: 1, atLimit: true },
    codexUsed: 90,
    codexCredits: 1,
    claimMode: 'reset' as 'reset' | 'transport-error' | 'cooldown',
    consumeCode: 'reset',
    calls: [] as Call[],
    claimGate: null as Promise<void> | null,
    org: ORG,
    /** Holds the next usage read after its body is fixed, as a slow real response would be. */
    usageGate: null as Promise<void> | null,
    usageGateHit: false,
    onOrganizationRead: null as (() => void) | null,
  };
  const reset = (ms: number) => new Date(NOW + ms).toISOString();
  const claudeUsage = () => ({
    seven_day: { utilization: hub.claude.weekly, resets_at: reset(86_400_000) },
    five_hour: { utilization: hub.claude.five, resets_at: reset(3_600_000) },
    limits: [
      {
        kind: 'weekly_scoped',
        percent: hub.claude.fable,
        resets_at: reset(86_400_000),
        is_active: true,
        scope: { model: { id: null, display_name: 'Fable' } },
      },
    ],
    cedar_ember: {
      eligible: true,
      at_limit: hub.claude.atLimit,
      grants: [
        {
          id: 'grant-fable',
          resets_total: 1,
          resets_left: hub.claude.left,
          usable_now: true,
          use_requires_limit: true,
          gives_back_weekly: true,
          ends_at: reset(7 * 86_400_000),
        },
      ],
    },
  });
  const codexUsage = () => ({
    rate_limit: {
      primary_window: {
        used_percent: hub.codexUsed,
        limit_window_seconds: 604800,
        reset_at: (NOW + 86_400_000) / 1000,
      },
      secondary_window: {
        used_percent: hub.codexUsed,
        limit_window_seconds: 18000,
        reset_at: (NOW + 3_600_000) / 1000,
      },
    },
    rate_limit_reset_credits: {
      available_count: hub.codexCredits,
      applicable_available_count: hub.codexCredits,
      credits: [],
    },
  });
  const apiCall = async (body: Record<string, unknown>) => {
    const url = String(body.url);
    if (url === USAGE) {
      const body = claudeUsage();
      const gate = hub.usageGate;
      if (gate) {
        hub.usageGate = null;
        hub.usageGateHit = true;
        await gate;
      }
      return { status_code: 200, body };
    }
    if (url === PROFILE) {
      hub.onOrganizationRead?.();
      return { status_code: 200, body: { organization: { uuid: hub.org } } };
    }
    if (url.endsWith('/reset_rate_limits')) {
      if (hub.claimGate) await hub.claimGate;
      if (hub.claimMode === 'transport-error') throw new Error('hub dropped the request');
      if (hub.claimMode === 'cooldown') return { status_code: 200, body: { result: 'cooldown' } };
      hub.claude.fable = 0;
      hub.claude.left = 0;
      return { status_code: 200, body: { result: 'reset' } };
    }
    if (url === CODEX_USAGE_URL) return { status_code: 200, body: codexUsage() };
    if (url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL) {
      hub.codexUsed = 0;
      hub.codexCredits = 0;
      return { status_code: 200, body: { code: hub.consumeCode } };
    }
    return { status_code: 404, body: {} };
  };
  const fetcher = Object.assign(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const path = new URL(String(input)).pathname.replace('/v8/management', '');
      const body = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      hub.calls.push({ path, body });
      if (path === '/credentials') {
        return Response.json({
          files: [
            {
              provider: 'claude',
              type: 'claude',
              auth_index: 'claude-idx',
              name: 'c.json',
              email: 'claude@example.test',
              disabled: false,
            },
            {
              provider: 'codex',
              type: 'codex',
              auth_index: 'codex-idx',
              name: 'x.json',
              email: 'codex@example.test',
              disabled: false,
            },
          ],
        });
      }
      if (path === '/routing/cooldown/reset') {
        return Response.json({ status: 'ok', auth_index: body?.auth_index });
      }
      if (path === '/requests/api-call') {
        try {
          return Response.json(await apiCall(body!));
        } catch {
          return new Response('bad gateway', { status: 502 });
        }
      }
      return new Response('not found', { status: 404 });
    },
    { preconnect: () => {} }
  ) satisfies typeof fetch;
  const store = new QuotaStore(':memory:');
  let clock = NOW;
  const collector = new QuotaCollector(store, {
    sources: [source],
    revision: 'test',
    fetcher,
    now: () => clock,
  });
  const claims = new ResetClaims({ store, collector, now: () => clock });
  const handler = createHandler({ store, collector, keyFile, claims, now: () => clock });
  cleanups.push(() => {
    collector.stop();
    store.close();
    rmSync(root, { recursive: true, force: true });
  });
  const send = (path: string, init: { method?: string; body?: unknown; auth?: boolean } = {}) =>
    handler(
      new Request(`http://localhost${path}`, {
        method: init.method ?? 'GET',
        headers: init.auth === false ? {} : { Authorization: `Bearer ${KEY}` },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      })
    ) as Promise<Response>;
  const claim = (body: unknown, auth = true) =>
    send('/v1/resets/claim', { method: 'POST', body, auth });
  const posts = (url: string) =>
    hub.calls.filter((call) => call.path === '/requests/api-call' && call.body?.url === url);
  return {
    hub,
    store,
    collector,
    claims,
    send,
    claim,
    posts,
    advance: (ms: number) => {
      clock += ms;
    },
    account: (provider: 'claude' | 'codex') =>
      store.listAccounts().find((account) => account.provider === provider)!,
    // Collection reads the hub's usage once per account so the collector holds a "before".
    collect: async () => {
      await collector.refresh();
      hub.calls.length = 0;
    },
  };
}
const claudeBody = (accountId: string, requestId = 'request-1') => ({
  accountId,
  grantId: 'grant-fable',
  clientRequestId: requestId,
});
const windowOf = (
  reading: { windows: { id: string; remainingPercent: number | null }[] },
  id: string
) => reading.windows.find((window) => window.id === id)?.remainingPercent;

describe('server-owned reset claims', () => {
  test('a Claude claim records one event with before/after readings and one targeted refresh', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    const refresh = spyOn(f.collector, 'refreshAccount');

    const response = await f.claim(claudeBody(account.id));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.outcome).toBe('reset');
    expect(result.replayed).toBe(false);
    expect(result.refreshed).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The claim reached the hub exactly once, with the client's request id.
    const sent = f.posts(CLAIM);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(String(sent[0].body?.data))).toEqual({
      program: 'cedar_ember',
      grant_id: 'grant-fable',
      request_id: 'request-1',
    });
    // The organization is read before the claim is sent.
    const order = f.hub.calls.map((call) => String(call.body?.url ?? call.path));
    expect(order.indexOf(PROFILE)).toBeGreaterThan(-1);
    expect(order.indexOf(PROFILE)).toBeLessThan(order.indexOf(CLAIM));

    expect(result.event).toMatchObject({
      accountId: account.id,
      provider: 'claude',
      kind: 'fable',
      grantId: 'grant-fable',
      clientRequestId: 'request-1',
      outcome: 'reset',
      requestedAtMs: NOW,
      settledAtMs: NOW,
    });
    expect(windowOf(result.event.before, 'seven-day-fable')).toBe(20);
    expect(windowOf(result.event.before, 'seven-day')).toBe(40);
    expect(windowOf(result.event.before, 'five-hour')).toBe(70);
    expect(result.event.before.resets).toMatchObject({ available: 1, usable: 1 });
    expect(windowOf(result.event.after, 'seven-day-fable')).toBe(100);
    expect(windowOf(result.event.after, 'seven-day')).toBe(40);
    expect(result.event.after.resets).toMatchObject({ available: 0 });
    // The response carries the fresh reading, not the one held before the claim.
    expect(windowOf(result.account, 'seven-day-fable')).toBe(100);

    const events = await (await f.send('/v1/resets/events')).json();
    expect(events.events).toHaveLength(1);
    expect(events.events[0]).toEqual(result.event);
  });

  test('a spent Claude claim clears the hub cooldown for that credential', async () => {
    // The proxy keeps a quota cooldown until its probe says "allowed"; a confirmed claim clears it,
    // as for Codex, so the account is routed again at once (a still-limited one costs one 429).
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    const result = await (await f.claim(claudeBody(account.id))).json();
    expect(result.outcome).toBe('reset');
    expect(result.event.cooldownCleared).toBe(true);
    const resets = f.hub.calls.filter((call) => call.path === '/routing/cooldown/reset');
    expect(resets).toHaveLength(1);
    expect(resets[0].body).toEqual({ auth_index: expect.any(String) });
  });

  test('a Claude claim the provider refused does not touch the hub cooldown', async () => {
    const f = fixture();
    await f.collect();
    f.hub.claimMode = 'cooldown';
    const account = f.account('claude');
    const result = await (await f.claim(claudeBody(account.id))).json();
    expect(result.outcome).toBe('cooldown');
    expect(result.event.cooldownCleared).toBeNull();
    expect(f.hub.calls.some((call) => call.path === '/routing/cooldown/reset')).toBe(false);
  });

  test('a retry with the same request id neither claims nor records twice', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    const first = await (await f.claim(claudeBody(account.id))).json();
    const refresh = spyOn(f.collector, 'refreshAccount');

    const retry = await f.claim(claudeBody(account.id));
    expect(retry.status).toBe(200);
    const again = await retry.json();
    expect(again.replayed).toBe(true);
    expect(again.outcome).toBe('reset');
    expect(again.event.id).toBe(first.event.id);
    expect(f.posts(CLAIM)).toHaveLength(1);
    expect(refresh).not.toHaveBeenCalled();
    expect((await (await f.send('/v1/resets/events')).json()).events).toHaveLength(1);

    // The same request id for another account or grant is a mistake, not a retry.
    const other = await f.claim({ ...claudeBody(account.id), grantId: 'other-grant' });
    expect(other.status).toBe(409);
    expect(f.posts(CLAIM)).toHaveLength(1);
  });

  test('an unknown outcome is recorded as unknown and a retry can settle it without a second record', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    f.hub.claimMode = 'transport-error';

    const response = await f.claim(claudeBody(account.id));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.outcome).toBe('unknown');
    expect(result.event.outcome).toBe('unknown');
    expect(result.event.settledAtMs).toBeNull();
    expect(f.posts(CLAIM)).toHaveLength(1);

    // A different request id cannot start while the earlier one is unresolved.
    const blocked = await f.claim(claudeBody(account.id, 'request-2'));
    expect(blocked.status).toBe(409);
    expect(f.posts(CLAIM)).toHaveLength(1);

    // The same request id is sent again (the provider deduplicates it) and settles the one event.
    f.hub.claimMode = 'reset';
    f.advance(30_000);
    const retry = await (await f.claim(claudeBody(account.id))).json();
    expect(retry.outcome).toBe('reset');
    expect(retry.event.id).toBe(result.event.id);
    expect(f.posts(CLAIM)).toHaveLength(2);
    expect((await (await f.send('/v1/resets/events')).json()).events).toHaveLength(1);
  });

  test('a refusal on retry cannot prove the first send did not spend, so it stays unknown', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    f.hub.claimMode = 'transport-error';
    await f.claim(claudeBody(account.id));
    f.hub.claimMode = 'cooldown';
    f.advance(30_000);
    const retry = await (await f.claim(claudeBody(account.id))).json();
    expect(retry.outcome).toBe('unknown');
    expect(retry.event.outcome).toBe('unknown');
  });

  test('a refusal before anything is sent records no event', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    f.hub.claude.atLimit = false;
    const response = await f.claim(claudeBody(account.id));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      stage: 'eligibility',
      reason: 'blocked_not_limited',
    });
    expect(f.posts(CLAIM)).toHaveLength(0);
    expect((await (await f.send('/v1/resets/events')).json()).events).toEqual([]);
  });

  test('one claim per account at a time', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    let open: () => void = () => {};
    f.hub.claimGate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const first = f.claim(claudeBody(account.id, 'request-1'));
    for (let i = 0; i < 200 && f.posts(CLAIM).length === 0; i++) await Bun.sleep(2);
    const second = await f.claim(claudeBody(account.id, 'request-2'));
    expect(second.status).toBe(409);
    open();
    expect((await first).status).toBe(200);
    expect(f.posts(CLAIM)).toHaveLength(1);
  });

  test('a Codex claim redeems with the client request id and clears the hub cooldown', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('codex');
    const response = await f.claim({ accountId: account.id, clientRequestId: 'codex-request-1' });
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.outcome).toBe('reset');
    expect(result.event).toMatchObject({
      provider: 'codex',
      kind: 'codex_rate_limits',
      grantId: null,
      cooldownCleared: true,
    });
    expect(
      JSON.parse(String(f.posts(CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL)[0].body?.data))
    ).toEqual({
      redeem_request_id: 'codex-request-1',
    });
    expect(f.hub.calls.some((call) => call.path === '/routing/cooldown/reset')).toBe(true);
    expect(windowOf(result.event.before, 'weekly')).toBe(10);
    expect(windowOf(result.event.after, 'weekly')).toBe(100);
    expect(result.event.before.resets).toMatchObject({ available: 1 });
    expect(result.event.after.resets).toMatchObject({ available: 0 });
  });

  test('requests without the management key get 401 and reach no hub', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    expect((await f.claim(claudeBody(account.id), false)).status).toBe(401);
    expect((await f.send('/v1/resets/events', { auth: false })).status).toBe(401);
    expect(f.hub.calls).toEqual([]);
  });

  test('malformed claim bodies are rejected before any hub call', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    for (const body of [
      null,
      {},
      { accountId: account.id },
      { ...claudeBody(account.id), clientRequestId: 'has space' },
      { ...claudeBody(account.id), clientRequestId: 'x'.repeat(65) },
      { accountId: account.id, clientRequestId: 'request-1' },
      { ...claudeBody(account.id), grantId: 'BAD GRANT' },
      { ...claudeBody('a'.repeat(513)) },
    ]) {
      expect((await f.claim(body)).status).toBe(400);
    }
    expect((await f.claim(claudeBody('unknown-account'))).status).toBe(404);
    expect(f.hub.calls).toEqual([]);
  });

  test('events filter by provider and time and reveal names only when asked', async () => {
    const f = fixture();
    await f.collect();
    await f.claim(claudeBody(f.account('claude').id));
    f.advance(60_000);
    await f.claim({ accountId: f.account('codex').id, clientRequestId: 'codex-request-1' });

    const all = (await (await f.send('/v1/resets/events')).json()).events;
    expect(all.map((event: { provider: string }) => event.provider)).toEqual(['codex', 'claude']);
    const claude = (await (await f.send('/v1/resets/events?provider=claude')).json()).events;
    expect(claude).toHaveLength(1);
    const since = (await (await f.send(`/v1/resets/events?sinceMs=${NOW + 1}`)).json()).events;
    expect(since.map((event: { provider: string }) => event.provider)).toEqual(['codex']);
    expect((await f.send('/v1/resets/events?provider=other')).status).toBe(400);
    expect((await f.send('/v1/resets/events?sinceMs=-1')).status).toBe(400);

    expect(JSON.stringify(all)).not.toContain('example.test');
    const revealed = (await (await f.send('/v1/resets/events?reveal=true')).json()).events;
    expect(JSON.stringify(revealed)).toContain('claude@example.test');
  });

  test('pools expose model-scoped windows per account, apart from the weekly and five-hour points', async () => {
    const f = fixture();
    await f.collect();
    const pools = await (await f.send('/v1/pools')).json();
    const claude = pools.pools
      .flatMap((pool: { accounts: unknown[] }) => pool.accounts)
      .find((entry: { id: string }) => entry.id === f.account('claude').id);
    expect(windowOf(claude, 'seven-day-fable')).toBe(20);
    expect(windowOf(claude, 'seven-day')).toBe(40);
  });

  test('a claim still pending when the process stops is unknown after a restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'prox-claims-db-'));
    cleanups.push(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, 'quota.sqlite');
    const first = new QuotaStore(path, () => NOW);
    first.insertResetEvent({
      accountId: 'a',
      provider: 'claude',
      kind: 'weekly',
      grantId: 'g',
      clientRequestId: 'r',
      requestedAtMs: NOW,
      before: null,
    });
    first.close();
    const second = new QuotaStore(path, () => NOW + 1000);
    const [event] = second.listResetEvents({});
    expect(event).toMatchObject({ outcome: 'unknown', settledAtMs: null });
    second.close();
  });

  test('the refresh after a claim is a new read, not a poll that started before the spend', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    let release: () => void = () => {};
    f.hub.usageGate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const early = f.collector.refreshAccount(account.id);
    for (let i = 0; i < 200 && !f.hub.usageGateHit; i++) await Bun.sleep(2);
    expect(f.hub.usageGateHit).toBe(true);
    const claim = f.claim(claudeBody(account.id));
    for (let i = 0; i < 200 && f.posts(CLAIM).length === 0; i++) await Bun.sleep(2);
    await Bun.sleep(20);
    release();
    await early;
    const result = await (await claim).json();
    expect(result.outcome).toBe('reset');
    expect(windowOf(result.event.after, 'seven-day-fable')).toBe(100);
    expect(windowOf(result.account, 'seven-day-fable')).toBe(100);
  });

  test('a retry is refused when the account now reads another organization', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    f.hub.claimMode = 'transport-error';
    await f.claim(claudeBody(account.id));
    f.hub.claimMode = 'reset';
    f.hub.org = '99999999-2222-3333-4444-555555555555';
    f.advance(30_000);
    const retry = await f.claim(claudeBody(account.id));
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ stage: 'operation', reason: 'identity' });
    expect(f.posts(CLAIM)).toHaveLength(1);
    expect(f.hub.calls.some((call) => String(call.body?.url).includes('99999999'))).toBe(false);
    expect(f.store.resetEventByRequestId('request-1')?.outcome).toBe('unknown');
  });

  test('a retry that ran out of window while its preflight was running is not sent', async () => {
    const f = fixture();
    await f.collect();
    const account = f.account('claude');
    f.hub.claimMode = 'transport-error';
    await f.claim(claudeBody(account.id));
    f.hub.claimMode = 'reset';
    f.advance(599_000);
    f.hub.onOrganizationRead = () => f.advance(2000);
    const retry = await f.claim(claudeBody(account.id));
    expect(retry.status).toBe(409);
    expect(await retry.json()).toMatchObject({ reason: 'expired' });
    expect(f.posts(CLAIM)).toHaveLength(1);
    expect(f.store.resetEventByRequestId('request-1')?.outcome).toBe('unknown');
  });
});
