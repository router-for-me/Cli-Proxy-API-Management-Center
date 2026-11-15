/**
 * GET /v1/accounts: prox-history's account read model, through the real store, collector and HTTP
 * handler over fake hubs. Synthetic identities only.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TFunction } from 'i18next';
import { createHandler } from '../server/app';
import { QuotaCollector } from '../server/quota/collector';
import { QuotaStore } from '../server/quota/store';
import type { ServerAccount, ServerAccounts } from '../src/domain/quotaPool/accounts';
import { createCodexQuotaConfig } from '../src/features/quota/providers/codex/data';
import { poolSourceAccountId } from '../src/features/quotaPool/resetAccounts';
import { serverCodexState } from '../src/features/quotaPool/serverQuota';
import { apiCallApi } from '../src/services/api';
import { testQuotaDependencies } from './helpers/quotaDependencies';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CODEX_USAGE_URL,
} from '../src/utils/quota/constants';

const NOW = 1_800_000_000_000;
const KEY = 'synthetic-key';
const iso = (ms: number) => new Date(ms).toISOString();
const WEEK_RESET = NOW + 3 * 86_400_000;
const FIVE_RESET = NOW + 3 * 3_600_000;

const claudeUsage = (weeklyUsed: number, fiveHour = true) => ({
  ...(fiveHour ? { five_hour: { utilization: 10, resets_at: iso(FIVE_RESET) } } : {}),
  seven_day: { utilization: weeklyUsed, resets_at: iso(WEEK_RESET) },
  seven_day_opus: { utilization: 70, resets_at: iso(WEEK_RESET) },
  extra_usage: {
    is_enabled: true,
    monthly_limit: 5000,
    used_credits: 1234,
    utilization: 24.7,
    currency: 'USD',
    disabled_reason: null,
    user_disabled: false,
    spend_limit_reached: false,
  },
  iguana_necktie: {
    limit_dollars: 100,
    used_dollars: 40,
    remaining_dollars: 60,
    utilization: 40,
    resets_at: iso(WEEK_RESET),
  },
  cedar_ember: {
    eligible: true,
    at_limit: false,
    grants: [
      {
        id: 'grant-1',
        resets_total: 2,
        resets_left: 2,
        usable_now: false,
        ends_at: iso(NOW + 4 * 86_400_000),
      },
    ],
  },
});
const codexUsage = {
  plan_type: 'plus',
  rate_limit: {
    primary_window: { used_percent: 30, limit_window_seconds: 604800, reset_at: WEEK_RESET / 1000 },
    secondary_window: { used_percent: 5, limit_window_seconds: 18000, reset_at: FIVE_RESET / 1000 },
  },
  code_review_rate_limit: {
    primary_window: { used_percent: 90, limit_window_seconds: 604800, reset_at: WEEK_RESET / 1000 },
  },
};

const cleanups: Array<() => void> = [];
const originalApiCallRequest = apiCallApi.request;
afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
});

function stack() {
  let clock = NOW;
  let weeklyUsed = 60;
  let usageFails = false;
  let claudeFiveHour = true;
  let codexBody: unknown = codexUsage;
  let credits: unknown = { has_credits: true, unlimited: false, balance: '8.75' };
  const disabled = new Set<string>();
  const root = mkdtempSync(join(tmpdir(), 'prox-accounts-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, 'key');
  writeFileSync(keyFile, `${KEY}\n`, { mode: 0o600 });
  const file = (provider: string, index: string, email: string) => ({
    name: `${index}.json`,
    type: provider,
    provider,
    auth_index: index,
    email,
    disabled: disabled.has(index),
  });
  const fetcher = Object.assign(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const host = new URL(input instanceof Request ? input.url : input.toString()).hostname;
      if (!init.body) {
        return Response.json({
          files:
            host === 'claude-primary.invalid'
              ? [
                  file('claude', 'ann-index', 'ann@example.test'),
                  file('claude', 'bob-index', 'bob@example.test'),
                ]
              : [file('codex', 'cy-index', 'cy@example.test')],
        });
      }
      const call = JSON.parse(String(init.body)) as { url: string };
      if (call.url.startsWith(CLAUDE_USAGE_URL) && usageFails)
        return Response.json({ status_code: 500, body: {} });
      if (call.url.startsWith(CLAUDE_USAGE_URL))
        return Response.json({ status_code: 200, body: claudeUsage(weeklyUsed, claudeFiveHour) });
      if (call.url === CLAUDE_PROFILE_URL)
        return Response.json({
          status_code: 200,
          body: { organization: { rate_limit_tier: 'default_claude_max_20x' } },
        });
      if (call.url === CODEX_USAGE_URL)
        return Response.json({ status_code: 200, body: { ...(codexBody as object), credits } });
      return Response.json({ status_code: 404, body: {} });
    },
    { preconnect: () => {} }
  );
  const source = (instanceId: string, provider: 'claude' | 'codex') => ({
    instanceId,
    label: instanceId,
    publicBasePath: `/${instanceId}`,
    aliases: [],
    authScope: 'synthetic',
    providers: [provider],
    upstreamOrigin: `http://${instanceId}.invalid`,
    managementKeyFile: keyFile,
  });
  const store = new QuotaStore(':memory:', () => clock);
  cleanups.push(() => store.close());
  const collector = new QuotaCollector(store, {
    sources: [source('claude-primary', 'claude'), source('codex-primary', 'codex')],
    revision: 'synthetic',
    fetcher,
    now: () => clock,
  });
  cleanups.push(() => collector.stop());
  const handler = createHandler({ store, collector, keyFile, now: () => clock });
  const call = (path: string, init: RequestInit & { auth?: boolean } = {}) =>
    Promise.resolve(
      handler(
        new Request(`http://localhost${path}`, {
          ...init,
          headers: {
            ...(init.auth === false ? {} : { Authorization: `Bearer ${KEY}` }),
            ...(init.headers as Record<string, string> | undefined),
          },
        })
      )
    );
  const accounts = async (path = '/v1/accounts') =>
    (await (await call(path)).json()) as ServerAccounts;
  return {
    store,
    collector,
    call,
    accounts,
    advance: (ms: number) => (clock += ms),
    setWeeklyUsed: (value: number) => (weeklyUsed = value),
    failUsage: (value: boolean) => (usageFails = value),
    setCredits: (value: unknown) => (credits = value),
    setCodexUsage: (value: unknown) => (codexBody = value),
    setClaudeFiveHour: (value: boolean) => (claudeFiveHour = value),
    disable: (index: string) => disabled.add(index),
  };
}
const byIndex = (
  list: ServerAccounts,
  instanceId: string,
  provider: 'claude' | 'codex',
  index: string
) =>
  list.accounts.find(
    (account) => account.sourceAccountId === poolSourceAccountId(instanceId, provider, index)
  ) as ServerAccount;

describe('GET /v1/accounts', () => {
  test('is authenticated like /v1/pools', async () => {
    const s = stack();
    expect((await s.call('/v1/accounts', { auth: false })).status).toBe(401);
    expect((await s.call('/v1/accounts')).status).toBe(200);
    expect((await s.call('/v1/accounts', { method: 'POST' })).status).toBe(404);
  });

  test('one entry per account with lane-tagged windows, plan, resets, billing and balances', async () => {
    const s = stack();
    await s.collector.refresh();
    const list = await s.accounts();
    expect(list.accounts).toHaveLength(3);
    const ann = byIndex(list, 'claude-primary', 'claude', 'ann-index');
    expect(ann).toMatchObject({
      instanceId: 'claude-primary',
      provider: 'claude',
      disabled: false,
      status: 'ok',
      observedAtMs: NOW,
      plan: { label: 'Ultra', known: true },
    });
    expect(ann.id).toBeString();
    const window = (id: string) => ann.windows.find((entry) => entry.id === id);
    expect(window('seven-day')).toMatchObject({
      lane: 'weekly',
      remainingPercent: 40,
      resetAtMs: WEEK_RESET,
      periodHours: 168,
    });
    expect(window('five-hour')).toMatchObject({
      lane: 'five-hour',
      remainingPercent: 90,
      periodHours: 5,
    });
    // Every other limit stays in its own lane, never the weekly one.
    expect(window('seven-day-opus')).toMatchObject({ lane: 'model', remainingPercent: 30 });
    expect(ann.resets).toMatchObject({ available: 2, usable: 0 });
    expect(ann.extraUsage).toMatchObject({
      isEnabled: true,
      monthlyLimit: 5000,
      usedCredits: 1234,
      currency: 'USD',
    });
    expect(ann.dollarWindows).toEqual([
      expect.objectContaining({ key: 'iguana_necktie', limitDollars: 100, remainingDollars: 60 }),
    ]);
    const cy = byIndex(list, 'codex-primary', 'codex', 'cy-index');
    expect(cy).toMatchObject({ provider: 'codex', plan: { label: 'Plus', known: true } });
    expect(cy.windows.find((entry) => entry.lane === 'weekly')).toMatchObject({
      id: 'weekly',
      remainingPercent: 70,
      periodHours: 168,
    });
    expect(cy.windows.find((entry) => entry.lane === 'five-hour')).toMatchObject({
      remainingPercent: 95,
    });
    expect(cy.windows.filter((entry) => entry.lane === 'model').length).toBeGreaterThan(0);
    // Balances belong to Claude's usage payload only.
    expect(cy.extraUsage).toBeUndefined();
  });

  test('marks an account whose provider reports no five-hour window, and only that one', async () => {
    const s = stack();
    await s.collector.refresh();
    const first = await s.accounts();
    expect(byIndex(first, 'codex-primary', 'codex', 'cy-index').noFiveHourLimit).toBeFalsy();
    expect(byIndex(first, 'claude-primary', 'claude', 'ann-index').noFiveHourLimit).toBeFalsy();
    // A Pro account answers with its weekly window only (primary 604800 s, no secondary).
    s.setCodexUsage({
      plan_type: 'pro',
      rate_limit: {
        primary_window: {
          used_percent: 83,
          limit_window_seconds: 604800,
          reset_at: WEEK_RESET / 1000,
        },
        secondary_window: null,
      },
    });
    s.setClaudeFiveHour(false);
    s.advance(5 * 60_000);
    await s.collector.refresh();
    const list = await s.accounts();
    const cy = byIndex(list, 'codex-primary', 'codex', 'cy-index');
    expect(cy.noFiveHourLimit).toBe(true);
    expect(cy.windows.find((entry) => entry.lane === 'weekly')?.remainingPercent).toBe(17);
    expect(byIndex(list, 'claude-primary', 'claude', 'ann-index').noFiveHourLimit).toBe(true);
    // The pool and the served account agree: the five-hour pool leaves it out.
    const pools = (await (await s.call('/v1/pools?window=five-hour')).json()) as {
      pools: Array<{ provider: string; accounts: Array<{ status: string }> }>;
    };
    expect(pools.pools.find((pool) => pool.provider === 'codex')?.accounts[0].status).toBe(
      'no-limit'
    );
    // After a restart the stored samples still say so.
    for (const id of s.store.listAccounts().map((account) => account.id)) s.collector.forget([id]);
    const restarted = byIndex(await s.accounts(), 'codex-primary', 'codex', 'cy-index');
    expect(restarted.noFiveHourLimit).toBe(true);
  });

  test('a failed read does not mark an account as having no five-hour limit', async () => {
    const s = stack();
    await s.collector.refresh();
    s.failUsage(true);
    s.advance(5 * 60_000);
    await s.collector.refresh();
    const list = await s.accounts();
    for (const account of list.accounts) expect(account.noFiveHourLimit).toBeFalsy();
  });

  test('names and emails only with reveal=true', async () => {
    const s = stack();
    await s.collector.refresh();
    const hidden = JSON.stringify(await s.accounts());
    expect(hidden).not.toContain('example.test');
    expect(hidden).not.toContain('ann-index');
    expect(hidden).not.toContain('"email"');
    const revealed = await s.accounts('/v1/accounts?reveal=true');
    expect(revealed.accounts.map((account) => account.email).sort()).toEqual([
      'ann@example.test',
      'bob@example.test',
      'cy@example.test',
    ]);
    expect((await s.call('/v1/accounts?reveal=maybe')).status).toBe(400);
  });

  test('ETag is a hash of the body; If-None-Match answers 304 until something changes', async () => {
    const s = stack();
    await s.collector.refresh();
    const first = await s.call('/v1/accounts');
    const etag = first.headers.get('etag')!;
    expect(etag).toMatch(/^"[0-9a-f]{16,}"$/);
    // The version is in the body too, so a browser needs no access to the header to ask again.
    expect(`"${((await first.json()) as { version: string }).version}"`).toBe(etag);
    const again = await s.call('/v1/accounts', { headers: { 'If-None-Match': etag } });
    expect(again.status).toBe(304);
    expect(again.headers.get('etag')).toBe(etag);
    expect(await again.text()).toBe('');
    // The same reading read twice is the same tag; a new reading is a new one.
    expect((await s.call('/v1/accounts')).headers.get('etag')).toBe(etag);
    s.advance(5 * 60_000);
    s.setWeeklyUsed(10);
    await s.collector.refresh();
    const changed = await s.call('/v1/accounts', { headers: { 'If-None-Match': etag } });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    // reveal is part of the body, so it is part of the tag.
    expect((await s.call('/v1/accounts?reveal=true')).headers.get('etag')).not.toBe(
      changed.headers.get('etag')
    );
  });

  test('a disabled account keeps its last stored weekly and five-hour sample, with its age', async () => {
    const s = stack();
    await s.collector.refresh();
    s.advance(10 * 60_000);
    s.disable('bob-index');
    await s.collector.syncInventory();
    s.advance(60_000);
    const list = await s.accounts();
    const bob = byIndex(list, 'claude-primary', 'claude', 'bob-index');
    expect(bob).toMatchObject({ disabled: true, status: 'disabled', observedAtMs: NOW });
    expect(bob.windows.map((entry) => [entry.lane, entry.remainingPercent]).sort()).toEqual([
      ['five-hour', 90],
      ['weekly', 40],
    ]);
    // The collector never polls it: nothing newer than its last sample appears.
    s.setWeeklyUsed(1);
    await s.collector.refresh();
    const later = byIndex(await s.accounts(), 'claude-primary', 'claude', 'bob-index');
    expect(later.observedAtMs).toBe(NOW);
    expect(later.windows.find((entry) => entry.lane === 'weekly')?.remainingPercent).toBe(40);
  });

  test('extra usage and dollar balances are never pooled', async () => {
    const s = stack();
    await s.collector.refresh();
    const pools = JSON.stringify(await (await s.call('/v1/pools')).json());
    expect(pools).not.toContain('extraUsage');
    expect(pools).not.toContain('dollarWindows');
    expect(pools).not.toContain('iguana_necktie');
  });

  test('before a collection after a restart, the stored weekly and five-hour sample is served', async () => {
    const s = stack();
    await s.collector.refresh();
    // The collector's memory is what is lost on restart; the store keeps the samples.
    for (const id of s.store.listAccounts().map((account) => account.id)) s.collector.forget([id]);
    const ann = byIndex(await s.accounts(), 'claude-primary', 'claude', 'ann-index');
    expect(ann.windows.map((entry) => entry.lane).sort()).toEqual(['five-hour', 'weekly']);
    expect(ann.windows.find((entry) => entry.lane === 'weekly')?.remainingPercent).toBe(40);
    expect(ann.extraUsage).toBeUndefined();
    expect(ann.dollarWindows).toBeUndefined();
    expect(ann.resets).toBeNull();
  });
});

describe('Codex credit balance on /v1/accounts', () => {
  const t = ((key: string) => key) as unknown as TFunction;

  test('is served for Codex accounts, in memory only, and matches the hub-direct card', async () => {
    const s = stack();
    await s.collector.refresh();
    const list = await s.accounts();
    const cy = byIndex(list, 'codex-primary', 'codex', 'cy-index');
    expect(cy.credits).toEqual({ balance: '8.75', unlimited: false });
    expect(byIndex(list, 'claude-primary', 'claude', 'ann-index').credits).toBeUndefined();
    expect(JSON.stringify(await (await s.call('/v1/pools')).json())).not.toContain('8.75');

    // The served card shows what the hub-direct adapter shows for the same usage payload.
    apiCallApi.request = async (payload) => {
      const body =
        payload.url === CODEX_USAGE_URL
          ? { ...codexUsage, credits: { has_credits: true, unlimited: false, balance: '8.75' } }
          : { available_count: 0, credits: [] };
      return { statusCode: 200, header: {}, bodyText: JSON.stringify(body), body };
    };
    const config = createCodexQuotaConfig(testQuotaDependencies);
    const direct = config.buildSuccessState(
      await config.fetchQuota({ name: 'cy.json', type: 'codex', auth_index: 'cy-index' }, t)
    );
    const served = serverCodexState(cy, t);
    expect(direct.creditBalance).toBe('8.75');
    expect(served.creditBalance).toBe(direct.creditBalance);
    expect(served.creditsUnlimited).toBe(direct.creditsUnlimited);
  });

  test('carries the unlimited flag', async () => {
    const s = stack();
    s.setCredits({ has_credits: true, unlimited: true, balance: null });
    await s.collector.refresh();
    const cy = byIndex(await s.accounts(), 'codex-primary', 'codex', 'cy-index');
    expect(cy.credits).toEqual({ balance: null, unlimited: true });
    const served = serverCodexState(cy, t);
    expect(served.creditsUnlimited).toBe(true);
    expect(served.creditBalance).toBeNull();
  });

  test('a payload without credits reads as no balance, and a restart forgets it', async () => {
    const s = stack();
    s.setCredits(undefined);
    await s.collector.refresh();
    const cy = byIndex(await s.accounts(), 'codex-primary', 'codex', 'cy-index');
    expect(cy.credits).toEqual({ balance: null, unlimited: false });
    s.setCredits({ balance: '3' });
    s.advance(11 * 60_000);
    await s.collector.refresh();
    expect(byIndex(await s.accounts(), 'codex-primary', 'codex', 'cy-index').credits?.balance).toBe(
      '3'
    );
    for (const id of s.store.listAccounts().map((account) => account.id)) s.collector.forget([id]);
    expect(
      byIndex(await s.accounts(), 'codex-primary', 'codex', 'cy-index').credits
    ).toBeUndefined();
  });
});

describe('POST /v1/refresh {accountId}', () => {
  test('says when the next read may happen once the 20 s floor skips one', async () => {
    const s = stack();
    await s.collector.refresh();
    s.advance(11 * 60_000);
    const accountId = poolSourceAccountId('claude-primary', 'claude', 'ann-index');
    const post = async () =>
      (await (
        await s.call('/v1/refresh', { method: 'POST', body: JSON.stringify({ accountId }) })
      ).json()) as { refreshed: boolean; retryAtMs: number | null };
    const read = s.advance(0);
    expect(await post()).toEqual({ refreshed: true, retryAtMs: null });
    s.advance(5_000);
    expect(await post()).toEqual({ refreshed: false, retryAtMs: read + 20_000 });
    s.advance(16_000);
    expect(await post()).toEqual({ refreshed: true, retryAtMs: null });
  });

  test('a read that ran and failed is a failure, not a wait', async () => {
    const s = stack();
    await s.collector.refresh();
    s.advance(11 * 60_000);
    s.failUsage(true);
    const accountId = poolSourceAccountId('claude-primary', 'claude', 'ann-index');
    const post = async () =>
      (await (
        await s.call('/v1/refresh', { method: 'POST', body: JSON.stringify({ accountId }) })
      ).json()) as { refreshed: boolean; retryAtMs: number | null };
    expect(await post()).toEqual({ refreshed: false, retryAtMs: null });
    // The attempt is now inside the floor: the next request is skipped by it, and says when.
    s.advance(5_000);
    const result = await post();
    expect(result.refreshed).toBe(false);
    expect(result.retryAtMs).toBeNumber();
  });

  test('an account the server does not know has no retry time', async () => {
    const s = stack();
    await s.collector.refresh();
    const response = await s.call('/v1/refresh', {
      method: 'POST',
      body: JSON.stringify({
        accountId: poolSourceAccountId('claude-primary', 'claude', 'nobody'),
      }),
    });
    expect(await response.json()).toEqual({ refreshed: false, retryAtMs: null });
  });
});
