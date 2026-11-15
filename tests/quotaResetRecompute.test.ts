/**
 * A Fable reset gives back Fable usage and the weekly usage Fable had spent. Prox does not model
 * that: after a claim it re-reads the provider, and everything shown is recomputed from the new
 * reading. This drives one claim through the real pieces with a pair of Claude usage responses
 * (before and after, shaped like the live 38% -> 86% weekly jump): the client claim, the targeted
 * refresh it triggers, the history server's collector and /v1/pools (points, recorded line,
 * forecast, reset counts), and the one client store that Auth Files and /quota/accounts share.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TFunction } from 'i18next';
import { createHandler } from '../server/app';
import { QuotaCollector } from '../server/quota/collector';
import { QuotaStore } from '../server/quota/store';
import type { PoolDashboard } from '../src/domain/quotaPool/types';
import { createAuthFilesSourceScope } from '../src/features/authFiles/sourceScope';
import { createQuotaAdapters, getQuotaMap, getQuotaSetter } from '../src/features/quota/providers';
import { createSourceResetGrants } from '../src/features/quota/providers/claude/resetGrantScope';
import { FOLLOW_UP_DELAY_MS } from '../src/features/quotaPool/accountSync';
import { poolSourceAccountId } from '../src/features/quotaPool/resetAccounts';
import { apiClient } from '../src/services/api/client';
import type { ApiClient } from '../src/services/api/transport';
import { sourceQuotaStore } from '../src/stores/sourceQuotaStores';
import type { ClaudeQuotaState } from '../src/types';
import { CLAUDE_USAGE_URL } from '../src/utils/quota/constants';
import { getQuotaCacheKey } from '../src/utils/quota/identity';
import { hubs } from './helpers/sourceHubs';

const NOW = 1_800_000_000_000;
const WEEK_RESET = NOW + 3 * 86_400_000;
const iso = (ms: number) => new Date(ms).toISOString();
const t = ((key: string) => key) as TFunction;
const KEY = 'synthetic-key';

type Stage = 'before' | 'after';
/** Claude's usage for one account: weekly 38% left and Fable 60% left before; 86% and 100% after. */
const usage = (stage: Stage) => ({
  five_hour: { utilization: 10, resets_at: iso(NOW + 5 * 3_600_000) },
  seven_day: { utilization: stage === 'before' ? 62 : 14, resets_at: iso(WEEK_RESET) },
  limits: [
    {
      kind: 'weekly_scoped',
      group: 'weekly',
      percent: stage === 'before' ? 40 : 0,
      resets_at: iso(WEEK_RESET),
      is_active: true,
      scope: { model: { id: null, display_name: 'Fable' } },
    },
  ],
  cedar_ember: {
    eligible: true,
    at_limit: true,
    grants: [
      {
        id: 'fable-grant',
        resets_total: 1,
        resets_left: stage === 'before' ? 1 : 0,
        usable_now: stage === 'before',
        gives_back_weekly: true,
        ends_at: iso(NOW + 4 * 86_400_000),
      },
    ],
  },
});

/** The forecast before the weekly reset, where it holds the balance flat (no burn in the fixture). */
const untilReset = (pool: PoolDashboard['pools'][number]) => {
  const flat = pool.projected.filter((point) => point.atMs < WEEK_RESET);
  return {
    points: [...new Set(flat.map((point) => point.remainingPoints))],
    count: flat.length,
  };
};

const cleanups: Array<() => void> = [];
const restores: Array<{ mockRestore(): void }> = [];
let followUps: Array<() => void> = [];
const realSetTimeout = globalThis.setTimeout;
beforeEach(() => {
  followUps = [];
  // The follow-up read waits 20.5 s: capture it, then run it by hand.
  restores.push(
    spyOn(globalThis, 'setTimeout').mockImplementation(((
      fn: () => void,
      ms?: number,
      ...args: unknown[]
    ) => {
      if (ms === FOLLOW_UP_DELAY_MS) {
        followUps.push(fn);
        return 0;
      }
      return realSetTimeout(fn, ms, ...args);
    }) as unknown as typeof setTimeout)
  );
});
afterEach(() => {
  restores.splice(0).forEach((spy) => spy.mockRestore());
  cleanups
    .splice(0)
    .reverse()
    .forEach((cleanup) => cleanup());
});
const until = async (done: () => boolean | Promise<boolean>) => {
  for (let i = 0; i < 200 && !(await done()); i++) await new Promise((r) => realSetTimeout(r, 5));
};

test('a Fable claim recomputes pool points, forecast, resets and every page from the new reading', async () => {
  let stage: Stage = 'before';
  let clock = NOW;

  // The history server: the real store, collector and HTTP handler over one fake Claude hub.
  const root = mkdtempSync(join(tmpdir(), 'prox-reset-recompute-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const keyFile = join(root, 'key');
  writeFileSync(keyFile, `${KEY}\n`, { mode: 0o600 });
  const fetcher = Object.assign(
    async (_input: string | URL | Request, init: RequestInit = {}) => {
      if (!init.body)
        return Response.json({
          files: [
            {
              name: 'carol.json',
              type: 'claude',
              provider: 'claude',
              auth_index: 'carol-index',
              email: 'carol@example.test',
              disabled: false,
            },
          ],
        });
      const call = JSON.parse(String(init.body)) as { url: string };
      return Response.json({
        status_code: 200,
        body: call.url.startsWith(CLAUDE_USAGE_URL) ? usage(stage) : {},
      });
    },
    { preconnect: () => {} }
  );
  const store = new QuotaStore(':memory:', () => clock);
  cleanups.push(() => store.close());
  const collector = new QuotaCollector(store, {
    sources: [
      {
        instanceId: 'claude-primary',
        label: 'Claude',
        publicBasePath: '/claude',
        aliases: [],
        authScope: 'synthetic',
        providers: ['claude'],
        upstreamOrigin: 'http://claude-primary.invalid',
        managementKeyFile: keyFile,
      },
    ],
    revision: 'synthetic',
    fetcher,
    now: () => clock,
  });
  cleanups.push(() => collector.stop());
  const handler = createHandler({ store, collector, keyFile, now: () => clock });
  const request = (path: string, body?: unknown) =>
    handler(
      new Request(`http://localhost${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: `Bearer ${KEY}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
    );
  const pool = async () => {
    const dashboard = (await (
      await request('/v1/pools?window=weekly&lookback=3&multiplier=1&offsetDays=0')
    ).json()) as PoolDashboard;
    return dashboard.pools[0]!;
  };
  // What the browser's POST /prox/refresh reaches: the same handler, and every call is kept.
  const refreshes: { accountId: string; refreshed: boolean }[] = [];
  restores.push(
    spyOn(apiClient, 'captureConnection').mockReturnValue({
      post: async (_url: string, body: { accountId: string }) => {
        const answer = (await (await request('/v1/refresh', body)).json()) as {
          refreshed: boolean;
        };
        refreshes.push({ accountId: body.accountId, refreshed: answer.refreshed });
        return answer;
      },
    } as unknown as ApiClient)
  );

  // The hub the pages talk to: the same usage, and the claim flips it to the "after" reading.
  const sessions = hubs(['claude-primary'], (config, payload) => {
    if (config.url !== '/requests/api-call') return {};
    if (payload?.url?.endsWith('/reset_rate_limits')) {
      stage = 'after';
      return { status_code: 200, body: { result: 'reset' } };
    }
    if (payload?.url?.endsWith('/profile'))
      return {
        status_code: 200,
        body: { organization: { uuid: '11111111-2222-3333-4444-555555555555' } },
      };
    return {
      status_code: 200,
      body: payload?.url?.startsWith(CLAUDE_USAGE_URL) ? usage(stage) : {},
    };
  });
  const source = sessions.captureSource('claude-primary');
  const authFiles = createAuthFilesSourceScope(source);
  const quotaPage = sourceQuotaStore(source.owner);
  const adapter = createQuotaAdapters(source, quotaPage).claude;
  const file = { name: 'carol.json', type: 'claude', auth_index: 'carol-index' };
  const key = getQuotaCacheKey(file);
  /** What a page does after a read: build the state from the reading and store it. */
  const readIntoStore = async () => {
    const setQuota = getQuotaSetter(adapter, quotaPage);
    setQuota((prev) => ({ ...prev, [key]: adapter.buildLoadingState() }));
    const data = await adapter.fetchQuota(file, t);
    setQuota((prev) => ({ ...prev, [key]: adapter.buildSuccessState(data) }));
  };
  const remaining = (store: typeof quotaPage, id: string) => {
    const state = getQuotaMap(adapter, store)[key] as ClaudeQuotaState | undefined;
    const window = state?.windows.find((entry) => entry.id === id);
    return window?.usedPercent == null ? null : 100 - window.usedPercent;
  };

  // Before the claim: the server and the pages agree on weekly 38%, Fable 60%, one reset held.
  await collector.refresh();
  clock += 11 * 60_000;
  const account = store.listAccounts()[0]!;
  const accountId = poolSourceAccountId('claude-primary', 'claude', 'carol-index');
  expect(account.sourceAccountId ?? account.id).toBe(accountId);
  expect(await collector.refreshAccount(accountId)).toBe(true);
  await readIntoStore();
  const before = await pool();
  expect(before.remainingPoints).toBe(38);
  expect(before.nextResetGainPoints).toBe(62);
  expect(before.recorded.at(-1)?.remainingPoints).toBe(38);
  expect(untilReset(before)).toEqual({ points: [38], count: expect.any(Number) });
  expect(before.accounts[0]!.resets?.available).toBe(1);
  for (const store of [authFiles.quotaStore, quotaPage]) {
    expect(remaining(store, 'seven-day')).toBe(38);
    expect(remaining(store, 'seven-day-fable')).toBe(60);
  }

  // Claim from a page. Prox asks the provider again, right away, and does not model the refund.
  clock += 60_000;
  const answer = await createSourceResetGrants(authFiles.session).operations.run(
    'carol.json',
    'carol-index',
    'fable-grant'
  );
  expect(answer).toMatchObject({ code: 'reset' });
  await until(async () => (await pool()).remainingPoints === 86);
  expect(refreshes).toEqual([{ accountId, refreshed: true }]);
  await readIntoStore(); // the claim's own forced read, as the page issues it

  // Pool totals, the recorded line, the forecast and the reset count follow the new reading.
  const after = await pool();
  expect(after.remainingPoints).toBe(86);
  expect(after.nextResetGainPoints).toBe(14);
  // The recorded line keeps its history and ends on the new reading.
  expect(after.recorded[0]?.remainingPoints).toBe(38);
  expect(after.recorded.at(-1)?.remainingPoints).toBe(86);
  expect(untilReset(after).count).toBeGreaterThan(1);
  expect(untilReset(after)).toEqual({ points: [86], count: expect.any(Number) });
  expect(after.accounts[0]!.resets?.available).toBe(0);
  const weekly = after.accounts[0]!.windows.find((entry) => entry.id === 'seven-day');
  expect(weekly?.remainingPercent).toBe(86);
  // Auth Files and /quota/accounts read one store, and neither is left on the pre-claim value.
  for (const store of [authFiles.quotaStore, quotaPage]) {
    expect(remaining(store, 'seven-day')).toBe(86);
    expect(remaining(store, 'seven-day-fable')).toBe(100);
  }

  // One follow-up read, no sooner than the 20 s floor, in case the provider lags.
  expect(followUps).toHaveLength(1);
  clock += 21_000;
  followUps[0]!();
  await until(() => refreshes.length === 2);
  expect(refreshes[1]).toEqual({ accountId, refreshed: true });
  expect((await pool()).remainingPoints).toBe(86);
  expect(followUps).toHaveLength(1);
});
