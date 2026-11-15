import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHandler } from '../server/app';
import { QuotaCollector } from '../server/quota/collector';
import { buildDashboard, type DashboardOptions } from '../server/quota/domain';
import { legacyAccountId, LEGACY_SOURCE_MAPPING } from '../server/quota/identity';
import { QuotaStore } from '../server/quota/store';
import {
  DAY_MS,
  HOUR_MS,
  MANUAL_REFRESH_INTERVAL_MS,
  type StoredAccount,
} from '../server/quota/types';
import { until } from './helpers/inventoryHarness';
import { validateSourceManifest } from '../src/domain/providerSources/manifest';
import type { PoolDashboard, PoolProviderId } from '../src/domain/quotaPool/types';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_URL,
  CODEX_USAGE_URL,
  CODEX_SUBSCRIPTION_URL,
} from '../src/utils/quota/constants';

const NOW = 1_800_000_000_000;
const SENTINEL = 'SYNTHETIC_PRIVATE_INVENTORY_VALUE';
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function temporary() {
  const root = mkdtempSync(join(tmpdir(), 'prox-quota-sources-'));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function open(path = ':memory:') {
  const store = new QuotaStore(path);
  cleanups.push(() => store.close());
  return store;
}
function credential(provider: string, index = 'same-index') {
  return {
    provider,
    type: provider,
    auth_index: index,
    name: 'same-file.json',
    email: 'same@example.test',
    disabled: false,
    account: SENTINEL,
    metadata: { access_token: SENTINEL },
  };
}
function usage(provider: PoolProviderId, used = 20) {
  return provider === 'claude'
    ? {
        seven_day: { utilization: used, resets_at: new Date(NOW + DAY_MS).toISOString() },
        five_hour: { utilization: used, resets_at: new Date(NOW + HOUR_MS).toISOString() },
      }
    : {
        rate_limit: {
          primary_window: {
            used_percent: used,
            limit_window_seconds: 604800,
            reset_at: (NOW + DAY_MS) / 1000,
          },
          secondary_window: {
            used_percent: used,
            limit_window_seconds: 18000,
            reset_at: (NOW + HOUR_MS) / 1000,
          },
        },
      };
}
const options: DashboardOptions = {
  nowMs: NOW,
  window: 'weekly',
  lookbackHours: 3,
  multiplier: 1,
  offsetDays: 0,
  reveal: false,
};
const state = {
  historyStartedAtMs: NOW,
  lastRefreshAtMs: NOW,
  nextRefreshAtMs: NOW,
  refreshing: false,
  issues: [],
};
type Call = { instanceId: string; url: URL; init: RequestInit; body?: Record<string, unknown> };

function fixture(ids = ['source-a', 'source-b', 'source-c']) {
  const root = temporary();
  const sources = ids.map((instanceId, index) => {
    const managementKeyFile = join(root, `${instanceId}.key`);
    writeFileSync(managementKeyFile, `synthetic-key-${instanceId}`);
    return {
      instanceId,
      label: `Label ${instanceId}`,
      publicBasePath: `/${instanceId}`,
      aliases: index === 0 ? ['', '/codex-alias'] : [],
      authScope: instanceId,
      upstreamOrigin: `http://${instanceId}.invalid`,
      managementKeyFile,
    };
  });
  const manifest = validateSourceManifest({
    schemaVersion: 1,
    defaultInstanceId: ids[0],
    history: {
      upstreamOrigin: 'http://history.invalid',
      managementKeyFile: sources[0].managementKeyFile,
    },
    sources,
  });
  const inventories = new Map<string, unknown>(
    ids.map((id, i) => [
      id,
      {
        files: [credential('claude'), ...(i === 2 ? [credential('codex'), credential('xai')] : [])],
      },
    ])
  );
  const failures = new Map<string, number>();
  const quotaFailures = new Set<string>();
  const responses = new Map<string, unknown>();
  const calls: Call[] = [];
  let clock = NOW;
  let beforeResponse: ((call: Call) => Promise<void>) | undefined;
  const fetcher = Object.assign(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      const instanceId = url.hostname.replace('.invalid', '');
      const call = {
        instanceId,
        url,
        init,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      };
      calls.push(call);
      await beforeResponse?.(call);
      if (!call.body) {
        if (failures.has(instanceId))
          return new Response(SENTINEL, { status: failures.get(instanceId)! });
        return Response.json(inventories.get(instanceId));
      }
      if (responses.has(String(call.body.url)))
        return Response.json(responses.get(String(call.body.url)));
      if (quotaFailures.has(instanceId))
        return Response.json({
          status_code: 429,
          header: { 'Retry-After': ['30'], 'Set-Cookie': [SENTINEL] },
          body: SENTINEL,
        });
      return Response.json({
        status_code: 200,
        body: usage(
          call.body.url === `${CLAUDE_USAGE_URL}?cedar_ember=1&skip_spend=1` ? 'claude' : 'codex'
        ),
      });
    },
    { preconnect: () => {} }
  ) satisfies typeof fetch;
  const store = open();
  const collector = new QuotaCollector(store, {
    sources: manifest.sources,
    revision: 'synthetic-revision',
    fetcher,
    now: () => clock,
  });
  cleanups.push(() => collector.stop());
  const dashboard = () =>
    buildDashboard(
      store.listAccounts(),
      store.listSamples(0, clock),
      { ...options, nowMs: clock },
      {
        ...state,
        issues: collector.issues,
        sources: collector.sources,
        billing: collector.billing,
      }
    );
  return {
    sources,
    manifest,
    store,
    collector,
    calls,
    inventories,
    failures,
    quotaFailures,
    responses,
    dashboard,
    fetcher,
    advance: (ms = MANUAL_REFRESH_INTERVAL_MS) => {
      clock += ms;
    },
    delay: (callback: (call: Call) => Promise<void>) => {
      beforeResponse = callback;
    },
  };
}

describe('enumerated quota sources', () => {
  test('targeted refresh polls only its account, updates samples/windows/resets and throttles for 20 seconds', async () => {
    const f = fixture();
    await f.collector.refresh();
    const account = f.store.listAccounts().find((a) => a.provider === 'codex')!;
    f.advance();
    f.calls.length = 0;
    let targetedClock = NOW + 1000;
    // Supply a changed usage and reset reading through the same source transport.
    const collector = new QuotaCollector(f.store, {
      sources: f.manifest.sources,
      revision: 'test',
      now: () => targetedClock,
      fetcher: Object.assign(
        async (input: string | URL | Request, init?: RequestInit) => {
          if (init?.body) {
            expect(new URL(String(input)).hostname).toBe('source-c.invalid');
            expect(JSON.parse(String(init.body)).authIndex).toBe('same-index');
            return Response.json({
              status_code: 200,
              body: {
                ...usage('codex', 5),
                rate_limit_reset_credits: {
                  available_count: 1,
                  applicable_available_count: 1,
                  credits: [],
                },
              },
            });
          }
          return f.fetcher(input, init);
        },
        { preconnect: () => {} }
      ),
    });
    cleanups.push(() => collector.stop());
    expect(await collector.refreshAccount(account.id)).toBe(true);
    expect(collector.windows.get(account.id)?.[0].remainingPercent).toBe(95);
    expect(collector.resets.get(account.id)?.available).toBe(1);
    expect(collector.resets.get(account.id)?.observedAtMs).toBe(NOW + 1000);
    expect(f.store.listSamples(NOW + 1000, NOW + 1000).map((s) => s.accountId)).toEqual([
      account.id,
      account.id,
    ]);
    expect(f.calls.map((c) => c.instanceId)).toEqual(['source-c']);
    expect(await collector.refreshAccount(account.id)).toBe(false);
    targetedClock += 19_999;
    expect(await collector.refreshAccount(account.id)).toBe(false);
    targetedClock += 1;
    expect(await collector.refreshAccount(account.id)).toBe(true);
    expect(await collector.refreshAccount('unknown')).toBe(false);
    const disabled = f.store.listAccounts().find((a) => a.provider === 'claude')!;
    f.store.recordInventory('claude', [{ ...disabled, disabled: true }], NOW, disabled.instanceId);
    expect(await collector.refreshAccount(disabled.id)).toBe(false);
  });

  test('targeted refresh is single-flight, waits for full collection, and never records partial inventory', async () => {
    const f = fixture();
    await f.collector.refresh();
    const account = f.store
      .listAccounts()
      .find((a) => a.instanceId === 'source-c' && a.provider === 'claude')!;
    const before = f.store.listAccounts();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.calls.length = 0;
    f.delay(async () => {
      await gate;
    });
    f.advance();
    const full = f.collector.refresh();
    const first = f.collector.refreshAccount(account.id);
    expect(f.collector.refreshAccount(account.id)).toBe(first);
    await Promise.resolve();
    expect(f.calls.filter((c) => c.body)).toHaveLength(0);
    release();
    await full;
    expect(await first).toBe(true);
    expect(f.calls.filter((c) => c.body && c.body.url !== CLAUDE_PROFILE_URL)).toHaveLength(5);
    const afterFull = f.store.listAccounts();
    f.advance();
    f.inventories.set(account.instanceId!, { files: [credential(account.provider)] });
    expect(await f.collector.refreshAccount(account.id)).toBe(true);
    expect(f.store.listAccounts()).toEqual(afterFull);
    expect(before).toHaveLength(afterFull.length);
  });

  test('a full refresh waits for targeted work and upstream-disabled accounts are skipped without inventory writes', async () => {
    const f = fixture();
    await f.collector.refresh();
    const account = f.store.listAccounts()[0];
    f.advance();
    f.calls.length = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let targetedSettled = false;
    const early: string[] = [];
    f.delay(async (call) => {
      // Only the full refresh reads the other sources; it must not start before the targeted read ends.
      if (!targetedSettled && call.instanceId !== account.instanceId) early.push(call.instanceId);
      await gate;
    });
    const targeted = f.collector.refreshAccount(account.id).finally(() => {
      targetedSettled = true;
    });
    const full = f.collector.refresh();
    await until(() => f.calls.length > 0); // The targeted read is parked at the gate.
    release();
    expect(await targeted).toBe(true);
    await full;
    expect(early).toEqual([]);
    f.advance();
    f.calls.length = 0;
    const before = f.store.listAccounts();
    f.inventories.set(account.instanceId!, {
      files: [{ ...credential(account.provider), disabled: true }],
    });
    expect(await f.collector.refreshAccount(account.id)).toBe(false);
    expect(f.calls).toHaveLength(1);
    expect(f.store.listAccounts()).toEqual(before);
  });

  test('stop aborts targeted reads and prevents writes even when the transport ignores cancellation', async () => {
    const f = fixture();
    await f.collector.refresh();
    const account = f.store.listAccounts()[0];
    const before = f.store.listSamples(0, NOW + MANUAL_REFRESH_INTERVAL_MS);
    f.advance();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.delay(async () => {
      await gate;
    });
    const started = f.calls.length;
    const targeted = f.collector.refreshAccount(account.id);
    await until(() => f.calls.length > started); // The read is in flight, parked at the gate.
    f.collector.stop();
    release();
    expect(await targeted).toBe(false);
    expect(f.store.listSamples(0, NOW + MANUAL_REFRESH_INTERVAL_MS)).toEqual(before);
  });

  test('enumerates aliases once, collects both supported kinds in mixed inventory, and retains every collision', async () => {
    const f = fixture();
    await f.collector.refresh();
    expect(
      f.calls
        .filter((call) => !call.body)
        .map((call) => call.instanceId)
        .sort()
    ).toEqual(['source-a', 'source-b', 'source-c']);
    expect(f.store.listAccounts()).toHaveLength(4);
    expect(new Set(f.store.listAccounts().map((account) => account.id)).size).toBe(4);
    expect(f.store.listSamples(NOW, NOW)).toHaveLength(8);
    for (const call of f.calls) {
      expect(new Headers(call.init.headers).get('authorization')).toBe(
        `Bearer synthetic-key-${call.instanceId}`
      );
      expect(call.init.redirect).toBe('error');
      if (call.body) {
        expect(call.url.pathname).toBe('/v8/management/requests/api-call');
        expect(call.body.method).toBe('GET');
        expect([
          `${CLAUDE_USAGE_URL}?cedar_ember=1&skip_spend=1`,
          CLAUDE_PROFILE_URL,
          CODEX_USAGE_URL,
          CODEX_SUBSCRIPTION_URL,
        ]).toContain(call.body.url);
        expect(call.body.authIndex).toBe('same-index');
        expect(Object.keys(call.body).sort()).toEqual(['authIndex', 'header', 'method', 'url']);
      } else expect(call.url.pathname).toBe('/v8/management/credentials');
    }
    expect(f.calls.filter((call) => call.body)).toHaveLength(7);
    expect(
      JSON.stringify([f.store.listAccounts(), f.dashboard(), f.collector.issues])
    ).not.toContain(SENTINEL);
    expect(JSON.stringify(f.dashboard())).not.toContain('synthetic-key');
    expect(
      f
        .dashboard()
        .pools.filter((pool) => pool.accountCount)
        .map((pool) => [pool.instanceId, pool.provider, pool.capacityPoints, pool.remainingPoints])
    ).toEqual([
      ['source-a', 'claude', 100, 80],
      ['source-b', 'claude', 100, 80],
      ['source-c', 'claude', 100, 80],
      ['source-c', 'codex', 100, 80],
    ]);
    expect(f.dashboard().combinations).toEqual([
      {
        provider: 'claude',
        reason: 'cross-source-combination-unverified',
        occurrenceCount: 3,
        capacityPoints: null,
        remainingPoints: null,
        burnPointsPerHour: null,
        drainPointsPerHour: null,
        firstEmptyAtMs: null,
        poolEmptyAtMs: null,
        recorded: [],
        projected: [],
      },
    ]);
  });

  test('complete empty retires only that source/provider; 401, failures and malformed inventories retire nothing', async () => {
    const f = fixture();
    await f.collector.refresh();
    const b = f.store.listAccounts().filter((account) => account.instanceId === 'source-b');
    f.inventories.set('source-a', { files: [] });
    for (const status of [401, 503]) {
      f.failures.set('source-b', status);
      f.advance();
      await f.collector.refresh();
      expect(f.store.listAccounts().filter((account) => account.instanceId === 'source-b')).toEqual(
        b
      );
      expect(
        f.store
          .listAccounts()
          .filter((account) => account.instanceId === 'source-a')
          .every((account) => account.retired)
      ).toBe(true);
      expect(
        f.store
          .listAccounts()
          .filter((account) => account.instanceId === 'source-c')
          .every((account) => !account.retired)
      ).toBe(true);
      expect(
        f.collector.issues.map((issue) => [issue.instanceId, issue.provider, issue.code])
      ).toEqual([
        ['source-b', 'claude', 'inventory-unavailable'],
        ['source-b', 'codex', 'inventory-unavailable'],
      ]);
    }
    f.failures.clear();
    for (const invalid of [
      {},
      { files: [], has_more: true },
      { files: [], total: 1 },
      { files: [credential('claude'), { ...credential('codex'), disabled: 'false' }] },
    ]) {
      f.inventories.set('source-b', invalid);
      f.advance();
      await f.collector.refresh();
      expect(f.store.listAccounts().filter((account) => account.instanceId === 'source-b')).toEqual(
        b
      );
      expect(
        f
          .dashboard()
          .pools.find((pool) => pool.instanceId === 'source-b' && pool.provider === 'claude')
          ?.remainingPoints
      ).toBeNull();
      expect(
        f
          .dashboard()
          .pools.find((pool) => pool.instanceId === 'source-c' && pool.provider === 'claude')
          ?.remainingPoints
      ).toBe(80);
    }
    f.inventories.set('source-c', { files: [credential('codex')] });
    f.advance();
    await f.collector.refresh();
    expect(
      f.store
        .listAccounts()
        .filter((account) => account.instanceId === 'source-c')
        .map((account) => [account.provider, account.retired])
    ).toEqual([
      ['claude', true],
      ['codex', false],
    ]);
  });

  test('key rotation/loss and quota failures are local to the owning source', async () => {
    const f = fixture();
    await f.collector.refresh();
    const before = f.store.listAccounts().find((account) => account.instanceId === 'source-b');
    rmSync(f.sources[1].managementKeyFile);
    writeFileSync(f.sources[0].managementKeyFile, 'synthetic-rotated');
    f.quotaFailures.add('source-a');
    f.calls.length = 0;
    f.advance();
    await f.collector.refresh();
    expect(f.calls.some((call) => call.instanceId === 'source-b')).toBe(false);
    expect(f.store.listAccounts().find((account) => account.instanceId === 'source-b')).toEqual(
      before
    );
    expect(
      f.calls
        .filter((call) => call.instanceId === 'source-a')
        .every(
          (call) =>
            new Headers(call.init.headers).get('authorization') === 'Bearer synthetic-rotated'
        )
    ).toBe(true);
    expect(f.collector.issues.filter((issue) => issue.instanceId === 'source-a')).toEqual([
      {
        instanceId: 'source-a',
        sourceLabel: 'Label source-a',
        provider: 'claude',
        code: 'quota-unavailable',
      },
    ]);
    expect(f.collector.issues.some((issue) => issue.instanceId === 'source-c')).toBe(false);
    expect(f.store.listSamples(NOW, NOW + MANUAL_REFRESH_INTERVAL_MS)).toHaveLength(12);
  });

  test('failed quota polls log status, retry-after and header names, never upstream values', async () => {
    const f = fixture();
    await f.collector.refresh();
    f.quotaFailures.add('source-a');
    f.advance();
    const logged = spyOn(console, 'error').mockImplementation(() => {});
    await f.collector.refresh();
    const lines = logged.mock.calls.map((call) => call.join(' '));
    logged.mockRestore();
    expect(lines).toContainEqual(
      expect.stringMatching(
        /^Quota request failed: claude 429 account=\S{8} retry-after=30 headers=retry-after,set-cookie$/
      )
    );
    expect(lines.join('\n')).not.toContain(SENTINEL);
  });

  test('HTTP exposes source pools and first-inventory failures without leaking configuration', async () => {
    const f = fixture();
    f.failures.set('source-b', 401);
    await f.collector.refresh();
    const handler = createHandler({
      store: f.store,
      collector: f.collector,
      keyFile: f.sources[0].managementKeyFile,
      now: () => NOW,
    });
    const response = handler(
      new Request('http://history.invalid/v1/pools', {
        headers: { authorization: 'Bearer synthetic-key-source-a' },
      })
    );
    const data = (await response.json()) as PoolDashboard;
    expect(response.status).toBe(200);
    expect(
      data.pools
        .filter((pool) => pool.instanceId === 'source-b')
        .every((pool) => pool.forecastState === 'partial' && pool.remainingPoints === null)
    ).toBe(true);
    expect(
      data.pools.find((pool) => pool.instanceId === 'source-a' && pool.provider === 'claude')
        ?.remainingPoints
    ).toBe(80);
    expect(JSON.stringify(data)).not.toContain('.key');
    expect(JSON.stringify(data)).not.toContain('.invalid');
  });

  test('removed sources retain history but cannot present a complete current pool', async () => {
    const f = fixture();
    await f.collector.refresh();
    const result = buildDashboard(f.store.listAccounts(), f.store.listSamples(0, NOW), options, {
      ...state,
      sources: f.collector.sources!.filter((source) => source.instanceId !== 'source-b'),
    });
    const removed = result.pools.find(
      (pool) => pool.instanceId === 'source-b' && pool.provider === 'claude'
    )!;
    expect(removed.accountCount).toBe(1);
    expect(removed.forecastState).toBe('partial');
    expect(removed.remainingPoints).toBeNull();
    expect(removed.recorded[0].remainingPoints).toBe(80);
    expect(removed.projected).toEqual([]);
    expect(f.store.listAccounts().every((account) => !account.retired)).toBe(true);
  });

  test('collector pins a copied source revision and cannot be redirected by caller mutation', async () => {
    const f = fixture();
    const sources = f.sources.map((source) => ({ ...source }));
    const collector = new QuotaCollector(f.store, {
      sources,
      revision: 'pinned',
      fetcher: f.fetcher,
      now: () => NOW,
    });
    cleanups.push(() => collector.stop());
    sources[0].upstreamOrigin = 'http://wrong.invalid';
    sources[0].managementKeyFile = '/missing-synthetic-key';
    sources[0].instanceId = 'wrong';
    sources.length = 1;
    await collector.refresh();
    expect(collector.revision).toBe('pinned');
    expect(collector.sources?.map((source) => source.instanceId)).toEqual([
      'source-a',
      'source-b',
      'source-c',
    ]);
    expect(f.store.listAccounts()).toHaveLength(4);
    expect(f.calls.every((call) => call.instanceId !== 'wrong')).toBe(true);
  });

  test('an aborted inventory cannot retire or publish when a delayed fetch ignores abort', async () => {
    const f = fixture();
    await f.collector.refresh();
    const before = f.store.listAccounts();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.delay(async (call) => {
      if (!call.body) {
        entered();
        await gate;
      }
    });
    for (const id of f.inventories.keys()) f.inventories.set(id, { files: [] });
    f.advance();
    const pending = f.collector.refresh();
    await ready;
    f.collector.stop();
    release();
    await pending;
    expect(f.store.listAccounts()).toEqual(before);
    expect(f.store.listSamples(0, NOW + MANUAL_REFRESH_INTERVAL_MS)).toHaveLength(8);
  });
});

function legacyDatabase(path: string) {
  const db = new Database(path);
  // Actual pre-attribution schema: no ownership columns/tables.
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE quota_accounts (
      id TEXT PRIMARY KEY, provider TEXT NOT NULL, name TEXT NOT NULL, email TEXT,
      disabled INTEGER NOT NULL, retired INTEGER NOT NULL, lastSeenAtMs INTEGER NOT NULL, lastErrorAtMs INTEGER
    );
    CREATE TABLE quota_samples (
      accountId TEXT NOT NULL REFERENCES quota_accounts(id), window TEXT NOT NULL,
      observedAtMs INTEGER NOT NULL, remainingPercent REAL, resetAtMs INTEGER, periodHours REAL,
      PRIMARY KEY (accountId, window, observedAtMs)
    );
  `);
  for (const provider of ['claude', 'codex'] as const) {
    const id = legacyAccountId(provider, 'same-index');
    db.query('INSERT INTO quota_accounts VALUES (?, ?, ?, ?, 0, 0, ?, NULL)').run(
      id,
      provider,
      'same-file.json',
      'same@example.test',
      NOW
    );
    for (const [at, remaining] of [
      [NOW - 40 * DAY_MS, 99],
      [NOW - 10 * 60_000, 90],
      [NOW - 5 * 60_000, 85],
      [NOW, 80],
    ]) {
      for (const window of ['weekly', 'five-hour']) {
        db.query('INSERT INTO quota_samples VALUES (?, ?, ?, ?, ?, ?)').run(
          id,
          window,
          at,
          remaining,
          NOW + DAY_MS,
          window === 'weekly' ? 168 : 5
        );
      }
    }
  }
  db.close();
}
function rawSnapshot(path: string) {
  const db = new Database(path, { readonly: true });
  try {
    return {
      accounts: db.query('SELECT * FROM quota_accounts ORDER BY id').all(),
      samples: db
        .query('SELECT * FROM quota_samples ORDER BY accountId, window, observedAtMs')
        .all(),
      foreignKeys: db.query('PRAGMA foreign_key_check').all(),
    };
  } finally {
    db.close();
  }
}

describe('additive legacy quota attribution', () => {
  test('preserves every row/tuple and single-source results through migration, reopen and repeat', () => {
    const path = join(temporary(), 'quota.sqlite');
    legacyDatabase(path);
    // Opening adds the nullable retiredAtMs column; the baseline is taken after that upgrade so
    // this test keeps proving that attribution itself changes no row.
    let store = open(path);
    const before = rawSnapshot(path);
    const oldResult = buildDashboard(
      store.listAccounts(),
      store.listSamples(0, NOW),
      options,
      state
    );
    const ids = LEGACY_SOURCE_MAPPING.map((mapping) => mapping.instanceId);
    store.migrateLegacySources(LEGACY_SOURCE_MAPPING, ids);
    expect(rawSnapshot(path)).toEqual(before);
    expect(store.firstSampleAtMs()).toBe(NOW - 40 * DAY_MS);
    const result = buildDashboard(store.listAccounts(), store.listSamples(0, NOW), options, state);
    for (const oldPool of oldResult.pools) {
      const { instanceId, sourceLabel, ...pool } = result.pools.find(
        (pool) => pool.provider === oldPool.provider && pool.accountCount
      )!;
      expect(instanceId).toBe(`${oldPool.provider}-primary`);
      expect(sourceLabel).toBe(instanceId);
      // Attribution gives each migrated account its current identity; its stored id is unchanged.
      pool.accounts.forEach((account, index) => {
        expect(account.id).toBe(oldPool.accounts[index].id);
        expect(oldPool.accounts[index].sourceAccountId).toBeNull();
        expect(account.sourceAccountId).toBe(`${instanceId}:${account.id}`);
      });
      expect({
        ...pool,
        accounts: pool.accounts.map((account) => ({ ...account, sourceAccountId: null })),
      }).toEqual(oldPool);
      expect(pool.forecastState).toBe('ready');
    }
    store.close();
    store = open(path);
    store.migrateLegacySources(LEGACY_SOURCE_MAPPING, ids);
    expect(rawSnapshot(path)).toEqual(before);
    expect(
      store.listAccounts().every((account) => account.instanceId === `${account.provider}-primary`)
    ).toBe(true);
    expect(store.accountIdFor('claude-primary', 'claude', 'same-index')).toBe(
      legacyAccountId('claude', 'same-index')
    );
    expect(store.accountIdFor('another-source', 'claude', 'same-index')).not.toBe(
      legacyAccountId('claude', 'same-index')
    );
  });

  test('rollback includes all ownership and ledger writes when a later mapping fails', () => {
    const path = join(temporary(), 'quota.sqlite');
    legacyDatabase(path);
    const store = open(path);
    const before = rawSnapshot(path);
    const db = new Database(path);
    db.exec(`CREATE TRIGGER synthetic_failure BEFORE INSERT ON quota_account_sources
      WHEN NEW.instanceId = 'codex-primary' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
    expect(() =>
      store.migrateLegacySources(LEGACY_SOURCE_MAPPING, ['claude-primary', 'codex-primary'])
    ).toThrow();
    expect(db.query('SELECT * FROM quota_account_sources').all()).toEqual([]);
    expect(db.query('SELECT * FROM quota_legacy_sources').all()).toEqual([]);
    expect(rawSnapshot(path)).toEqual(before);
    db.exec('DROP TRIGGER synthetic_failure');
    db.close();
    store.migrateLegacySources(LEGACY_SOURCE_MAPPING, ['claude-primary', 'codex-primary']);
    expect(rawSnapshot(path)).toEqual(before);
  });

  test('rejects ambiguous/unknown mappings and subsequent reassignment; unmapped history remains unresolved', () => {
    const path = join(temporary(), 'quota.sqlite');
    legacyDatabase(path);
    const store = open(path);
    const before = rawSnapshot(path);
    expect(() =>
      store.migrateLegacySources(
        [
          { provider: 'claude', instanceId: 'a' },
          { provider: 'claude', instanceId: 'b' },
        ],
        ['a', 'b']
      )
    ).toThrow('Ambiguous');
    expect(() =>
      store.migrateLegacySources([{ provider: 'claude', instanceId: 'unknown' }], ['a'])
    ).toThrow('unknown');
    store.migrateLegacySources([{ provider: 'claude', instanceId: 'a' }], ['a']);
    expect(() =>
      store.migrateLegacySources([{ provider: 'claude', instanceId: 'b' }], ['b'])
    ).toThrow('Conflicting');
    expect(rawSnapshot(path)).toEqual(before);
    const dashboard = buildDashboard(store.listAccounts(), store.listSamples(0, NOW), options, {
      ...state,
      sources: [{ instanceId: 'a', sourceLabel: 'A' }],
    });
    expect(dashboard.unresolvedHistoryAccountCount).toBe(1);
    expect(dashboard.pools.filter((pool) => pool.provider === 'codex')).toEqual([]);
    expect(
      store.listAccounts().find((account) => account.provider === 'codex')?.instanceId
    ).toBeUndefined();
  });

  test('attributed legacy IDs continue collecting on their owner and cannot be stolen or cross-retired', async () => {
    const path = join(temporary(), 'quota.sqlite');
    legacyDatabase(path);
    const store = open(path);
    const f = fixture(['claude-primary', 'other-claude']);
    store.migrateLegacySources(
      [{ provider: 'claude', instanceId: 'claude-primary' }],
      f.sources.map((source) => source.instanceId)
    );
    const legacy = store.listAccounts().find((account) => account.provider === 'claude')!;
    const collector = new QuotaCollector(store, {
      sources: f.manifest.sources,
      revision: 'fixture',
      fetcher: f.fetcher,
      now: () => NOW + MANUAL_REFRESH_INTERVAL_MS,
    });
    cleanups.push(() => collector.stop());
    await collector.refresh();
    const owned = store.listAccounts().filter((account) => account.provider === 'claude');
    expect(owned.map((account) => account.id)).toContain(legacy.id);
    expect(owned).toHaveLength(2);
    expect(
      store
        .listSamples(NOW + MANUAL_REFRESH_INTERVAL_MS, NOW + MANUAL_REFRESH_INTERVAL_MS)
        .map((sample) => sample.accountId)
    ).toContain(legacy.id);
    const before = store.listAccounts();
    expect(() =>
      store.recordInventory(
        'claude',
        [{ ...legacy, instanceId: 'other-claude' }],
        NOW,
        'other-claude'
      )
    ).toThrow('Invalid quota identity');
    expect(store.listAccounts()).toEqual(before);
    store.recordInventory('claude', [], NOW, 'claude-primary');
    expect(store.listAccounts().find((account) => account.id === legacy.id)?.retired).toBe(true);
    expect(
      store.listAccounts().find((account) => account.instanceId === 'other-claude')?.retired
    ).toBe(false);
    const sampleCount = store.listSamples(0, NOW + MANUAL_REFRESH_INTERVAL_MS).length;
    store.recordInventory('claude', [], NOW); // Legacy fixture seam cannot retire owned rows.
    expect(
      store.listAccounts().find((account) => account.instanceId === 'other-claude')?.retired
    ).toBe(false);
    expect(store.listSamples(0, NOW + MANUAL_REFRESH_INTERVAL_MS)).toHaveLength(sampleCount);
  });

  test('a targeted refresh accepts the source-qualified id of a legacy-attributed account', async () => {
    // The browser names an account by source and auth index only; it cannot know that the
    // server stores a migrated account under its pre-attribution id.
    const path = join(temporary(), 'quota.sqlite');
    legacyDatabase(path);
    const store = open(path);
    const f = fixture(['claude-primary', 'other-claude']);
    store.migrateLegacySources(
      [{ provider: 'claude', instanceId: 'claude-primary' }],
      f.sources.map((source) => source.instanceId)
    );
    const legacy = store.listAccounts().find((account) => account.provider === 'claude')!;
    let clock = NOW;
    const collector = new QuotaCollector(store, {
      sources: f.manifest.sources,
      revision: 'fixture',
      fetcher: f.fetcher,
      now: () => clock,
    });
    cleanups.push(() => collector.stop());
    await collector.refresh();
    clock += MANUAL_REFRESH_INTERVAL_MS;
    const qualified = `claude-primary:${legacy.id}`;
    expect(store.listAccounts().find((account) => account.id === legacy.id)?.sourceAccountId).toBe(
      qualified
    );
    const first = collector.refreshAccount(qualified);
    // Both spellings are one account, so they share its single flight and its 20 s limit.
    expect(collector.refreshAccount(legacy.id)).toBe(first);
    expect(await first).toBe(true);
    expect(await collector.refreshAccount(qualified)).toBe(false);
    expect(await collector.refreshAccount(`other-source:${legacy.id}`)).toBe(false);
    clock += 20_000;
    expect(await collector.refreshAccount(qualified)).toBe(true);
    // POST /v1/refresh carries the same id from the browser.
    clock += 20_000;
    const handler = createHandler({
      store,
      collector,
      keyFile: f.sources[0].managementKeyFile,
      now: () => clock,
    });
    const response = await handler(
      new Request('http://localhost/v1/refresh', {
        method: 'POST',
        headers: { Authorization: `Bearer synthetic-key-${f.sources[0].instanceId}` },
        body: JSON.stringify({ accountId: qualified }),
      })
    );
    expect(await response.json()).toEqual({ refreshed: true, retryAtMs: null });
  });

  test('a source-qualified alias collision aborts mapping rather than merging two histories', () => {
    const path = join(temporary(), 'quota.sqlite');
    legacyDatabase(path);
    const store = open(path);
    const legacy = store.listAccounts().find((account) => account.provider === 'claude')!;
    const account: StoredAccount = {
      ...legacy,
      id: store.accountIdFor('a', 'claude', 'same-index'),
      instanceId: 'a',
    };
    store.recordInventory('claude', [account], NOW, 'a');
    const before = rawSnapshot(path);
    expect(() =>
      store.migrateLegacySources([{ provider: 'claude', instanceId: 'a' }], ['a'])
    ).toThrow();
    expect(rawSnapshot(path)).toEqual(before);
    expect(
      store.listAccounts().find((account) => account.id === legacy.id)?.instanceId
    ).toBeUndefined();
  });

  test('production wiring has no provider-keyed default origins and ships the authoritative manifest', () => {
    const main = readFileSync(new URL('../server/main.ts', import.meta.url), 'utf8');
    const collector = readFileSync(
      new URL('../server/quota/collector.ts', import.meta.url),
      'utf8'
    );
    const dockerfile = readFileSync(
      new URL('../deploy/Dockerfile.history', import.meta.url),
      'utf8'
    );
    expect(main).toContain('loadSourceManifest');
    expect(main).toContain('sources: manifest.sources');
    expect(main).toContain('manifest.history.managementKeyFile');
    expect(collector).not.toContain('DEFAULT_ORIGINS');
    expect(collector).not.toMatch(/127\.0\.0\.1:831[79]/);
    expect(dockerfile).toContain('COPY deploy/provider-sources.json');
  });
});

describe('memory-only account billing collection', () => {
  const subscription = {
    entitlement: { subscription_plan: 'pro', renews_at: '2026-11-13T00:00:00Z' },
    last_active_subscription: { will_renew: true },
  };
  const url = `${CODEX_SUBSCRIPTION_URL}?account_id=${encodeURIComponent(SENTINEL)}`;
  test.each([
    undefined,
    null,
    'bad',
    {},
    { chatgpt_account_id: 123 },
    { chatgpt_account_id: 'x'.repeat(257) },
  ])(
    'lenient missing or malformed id token %j preserves inventory and call count',
    async (id_token) => {
      const f = fixture();
      f.inventories.set('source-c', { files: [{ ...credential('codex'), id_token }] });
      await f.collector.refresh();
      expect(f.store.listAccounts().some((a) => a.provider === 'codex')).toBe(true);
      expect(
        f.calls.filter((c) => String(c.body?.url).startsWith(CODEX_SUBSCRIPTION_URL))
      ).toHaveLength(0);
    }
  );
  test('one subscription read across 72 polls and 3 targeted refreshes; failure keeps prior reading and never leaks identity', async () => {
    const f = fixture();
    f.inventories.set('source-c', {
      files: [{ ...credential('codex'), id_token: { chatgpt_account_id: SENTINEL } }],
    });
    f.responses.set(url, { status_code: 200, body: JSON.stringify(subscription) });
    await f.collector.refresh();
    const account = f.store.listAccounts().find((a) => a.provider === 'codex')!;
    const first = f.collector.billing.get(account.id);
    expect(first).toMatchObject({ provider: 'codex', willRenew: true });
    for (let i = 1; i < 72; i++) {
      f.advance(5 * 60_000);
      await f.collector.refresh();
      if ([10, 30, 50].includes(i)) await f.collector.refreshAccount(account.id);
    }
    const calls = f.calls.filter((c) => c.body?.url === url);
    expect(calls).toHaveLength(1);
    expect(calls[0].body?.header).toMatchObject({ 'Chatgpt-Account-Id': SENTINEL });
    f.advance(5 * 60_000);
    f.responses.set(url, { status_code: 500, body: SENTINEL });
    await f.collector.refreshAccount(account.id);
    expect(f.calls.filter((c) => c.body?.url === url)).toHaveLength(2);
    expect(f.collector.billing.get(account.id)).toEqual(first);
    f.advance();
    await f.collector.refresh();
    expect(f.calls.filter((c) => c.body?.url === url)).toHaveLength(2);
    expect(
      JSON.stringify([f.store.listAccounts(), f.dashboard(), f.collector.issues])
    ).not.toContain(SENTINEL);
    expect(
      f
        .dashboard()
        .pools.flatMap((p) => p.accounts)
        .find((a) => a.id === account.id)?.billing
    ).toEqual(first);
  });
  test('Claude reads once after restart with fresh stored plan, gates failures and records billing even without a plan', async () => {
    const f = fixture(['source-a']);
    await f.collector.refresh();
    const account = f.store.listAccounts()[0];
    f.store.recordPlan(account.id, 'claude_pro', NOW);
    f.responses.set(CLAUDE_PROFILE_URL, { status_code: 500, body: SENTINEL });
    let clock = NOW;
    const restarted = new QuotaCollector(f.store, {
      sources: f.manifest.sources,
      revision: 'restart',
      fetcher: f.fetcher,
      now: () => clock,
    });
    cleanups.push(() => restarted.stop());
    f.calls.length = 0;
    await restarted.refresh();
    expect(f.calls.filter((c) => c.body?.url === CLAUDE_PROFILE_URL)).toHaveLength(1);
    clock += 5 * 60_000;
    await restarted.refresh();
    expect(f.calls.filter((c) => c.body?.url === CLAUDE_PROFILE_URL)).toHaveLength(1);
    clock = NOW + 6 * HOUR_MS;
    f.responses.set(CLAUDE_PROFILE_URL, {
      status_code: 200,
      body: {
        organization: {
          subscription_status: 'active',
          subscription_created_at: '2026-01-31T00:00:00Z',
          billing_type: 'stripe_subscription',
        },
      },
    });
    await restarted.refresh();
    expect(f.calls.filter((c) => c.body?.url === CLAUDE_PROFILE_URL)).toHaveLength(2);
    expect(restarted.billing.get(account.id)).toMatchObject({
      provider: 'claude',
      status: 'active',
    });
    expect(f.store.listAccounts()[0].plan).toBe('claude_pro');
  });
});
