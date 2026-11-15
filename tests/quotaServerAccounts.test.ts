/**
 * Claude/Codex accounts served from prox-history: the routing rule, the accounts poller, how a
 * server reading reaches the source session's shared quota store, and what Refresh says.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import type { TFunction } from 'i18next';
import type {
  AccountRefreshResult,
  ServerAccount,
  ServerAccounts,
} from '../src/domain/quotaPool/accounts';
import type { AccountResets } from '../src/domain/quotaPool/types';
import {
  grantsFromResets,
  projectServerAccounts,
  refreshServedFile,
  refreshServedPage,
  serverGrantStatus,
  serverReadNotice,
} from '../src/features/quotaPool/serverQuota';
import { resetGrantChoices } from '../src/features/quota/providers/claude/selectResetGrant';
import { createQuotaBatchLoader } from '../src/features/quota/quotaBatch';
import { poolSourceAccountId } from '../src/features/quotaPool/resetAccounts';
import type { SourceOwner } from '../src/services/api/sourceSession';
import { createQuotaStore } from '../src/stores/useQuotaStore';
import {
  createServerAccountsStore,
  servedByServer,
  useServerAccountsStore,
  type ServerAccountsRuntime,
} from '../src/stores/useServerAccountsStore';
import type { ClaudeQuotaState, CodexQuotaState } from '../src/types';
import { getQuotaCacheKey } from '../src/utils/quota/identity';

const NOW = 1_800_000_000_000;
const t = ((key: string, params?: Record<string, unknown>) =>
  params ? `${key}:${JSON.stringify(params)}` : key) as unknown as TFunction;
const owner = (instanceId: string): SourceOwner => ({
  instanceId,
  sessionEpoch: 0,
  sourceGeneration: 1,
});

const account = (
  instanceId: string,
  provider: 'claude' | 'codex',
  authIndex: string,
  patch: Partial<ServerAccount> = {}
): ServerAccount => ({
  id: `id-${authIndex}`,
  sourceAccountId: poolSourceAccountId(instanceId, provider, authIndex),
  instanceId,
  provider,
  disabled: false,
  status: 'ok',
  observedAtMs: NOW - 120_000,
  label: `${provider} 1`,
  identifier: 'a•••',
  plan: { label: 'Plus', known: true, type: provider === 'codex' ? 'plus' : 'claude_pro' },
  windows: [
    {
      id: provider === 'claude' ? 'seven-day' : 'weekly',
      lane: 'weekly',
      labelKey: provider === 'claude' ? 'claude_quota.seven_day' : 'codex_quota.secondary_window',
      remainingPercent: 41,
      resetAtMs: NOW + 86_400_000,
      periodHours: 168,
    },
    {
      id: 'five-hour',
      lane: 'five-hour',
      labelKey: provider === 'claude' ? 'claude_quota.five_hour' : 'codex_quota.primary_window',
      remainingPercent: 88,
      resetAtMs: NOW + 3_600_000,
      periodHours: 5,
    },
  ],
  resets: null,
  billing: null,
  ...patch,
});

const body = (accounts: ServerAccount[], version = 'v1'): ServerAccounts => ({
  version,
  accounts,
  lastRefreshAtMs: NOW,
  nextRefreshAtMs: NOW + 300_000,
  refreshing: false,
});

/** A runtime whose API is a script: what prox-history answers, and every request it received. */
function fakeRuntime(script: {
  inventory?: () => Promise<{ instanceId: string; provider: string }[]>;
  read?: (
    known: string | null
  ) => Promise<{ status: 'unchanged' } | { status: 'changed'; accounts: ServerAccounts }>;
  refreshAccount?: (id: string) => Promise<AccountRefreshResult>;
  refreshAll?: () => Promise<{ refreshing: boolean; nextRefreshAtMs: number | null }>;
}) {
  const calls: string[] = [];
  const runtime: ServerAccountsRuntime = {
    api: () =>
      ({
        inventory: async () => {
          calls.push('inventory');
          return script.inventory!();
        },
        read: async (known: string | null) => {
          calls.push(`read:${known}`);
          return script.read!(known);
        },
        refreshAccount: async (id: string) => {
          calls.push(`refresh:${id}`);
          return script.refreshAccount!(id);
        },
        refreshAll: async () => {
          calls.push('refreshAll');
          return script.refreshAll!();
        },
      }) as unknown as ReturnType<ServerAccountsRuntime['api']>,
    now: () => NOW,
    connected: () => true,
    visible: () => true,
    onVisibilityChange: () => () => {},
    onFocus: () => () => {},
    every: () => () => {},
    sleep: async () => {},
  };
  return { runtime, calls };
}

const sources = [
  { instanceId: 'claude-primary', provider: 'claude' },
  { instanceId: 'codex-primary', provider: 'codex' },
];

describe('the routing rule', () => {
  const ready = {
    status: 'ready' as const,
    sources: new Set(['claude-primary\0claude', 'codex-primary\0codex']),
  };

  test('an account is served only when its source is inventoried and its provider is claude or codex', () => {
    expect(servedByServer(ready, 'claude-primary', 'claude')).toBe(true);
    expect(servedByServer(ready, 'codex-primary', 'codex')).toBe(true);
    // A hub prox-history does not list (a non-manifest hub), or another provider on a listed one.
    expect(servedByServer(ready, 'other-hub', 'claude')).toBe(false);
    expect(servedByServer(ready, 'claude-primary', 'codex')).toBe(false);
    // The other six providers stay hub-direct even where the instance is inventoried.
    for (const provider of ['antigravity', 'devin', 'kimi', 'meta', 'plugin', 'xai'])
      expect(servedByServer(ready, 'claude-primary', provider)).toBe(false);
    expect(servedByServer(ready, undefined, 'claude')).toBe(false);
  });

  test('before the inventory answered, or when it did not, nothing is served', () => {
    expect(servedByServer({ status: 'unknown' }, 'claude-primary', 'claude')).toBe(false);
    expect(servedByServer({ status: 'unavailable' }, 'claude-primary', 'claude')).toBe(false);
  });
});

describe('the accounts poller store', () => {
  test('inventory, then accounts; the next read asks with the version and a 304 keeps the readings', async () => {
    const ann = account('claude-primary', 'claude', 'ann');
    const { runtime, calls } = fakeRuntime({
      inventory: async () => sources,
      read: async (known) =>
        known === 'v1' ? { status: 'unchanged' } : { status: 'changed', accounts: body([ann]) },
    });
    const store = createServerAccountsStore(runtime);
    await store.getState().poll();
    expect(store.getState().routing.status).toBe('ready');
    expect(store.getState().accounts[ann.sourceAccountId!]).toBe(ann);
    await store.getState().poll();
    expect(calls).toEqual(['inventory', 'read:null', 'read:v1']);
    expect(store.getState().accounts[ann.sourceAccountId!]).toBe(ann);
    expect(store.getState().version).toBe('v1');
  });

  test('prox-history absent or rejecting the key leaves everything hub-direct', async () => {
    for (const failure of [
      new Error('Network Error'),
      Object.assign(new Error('401'), { status: 401 }),
    ]) {
      const { runtime } = fakeRuntime({
        inventory: async () => {
          throw failure;
        },
      });
      const store = createServerAccountsStore(runtime);
      await store.getState().poll();
      expect(store.getState().routing.status).toBe('unavailable');
      expect(servedByServer(store.getState().routing, 'claude-primary', 'claude')).toBe(false);
      expect(store.getState().accounts).toEqual({});
    }
  });

  test('an inventory failure is asked again on the next poll', async () => {
    let up = false;
    const { runtime } = fakeRuntime({
      inventory: async () => {
        if (!up) throw new Error('down');
        return sources;
      },
      read: async () => ({ status: 'changed', accounts: body([]) }),
    });
    const store = createServerAccountsStore(runtime);
    await store.getState().poll();
    expect(store.getState().routing.status).toBe('unavailable');
    up = true;
    await store.getState().poll();
    expect(store.getState().routing.status).toBe('ready');
  });

  test('a server whose accounts cannot be read at all is not routed to', async () => {
    const { runtime, calls } = fakeRuntime({
      inventory: async () => sources,
      read: async () => {
        throw new Error('404');
      },
    });
    const store = createServerAccountsStore(runtime);
    await store.getState().poll();
    expect(store.getState().routing.status).toBe('unavailable');
    await store.getState().poll();
    // It does not flap: the inventory is not asked again for this connection.
    expect(calls).toEqual(['inventory', 'read:null']);
  });

  test('a later failure keeps the last readings', async () => {
    const ann = account('claude-primary', 'claude', 'ann');
    let fail = false;
    const { runtime } = fakeRuntime({
      inventory: async () => sources,
      read: async () => {
        if (fail) throw new Error('503');
        return { status: 'changed', accounts: body([ann]) };
      },
    });
    const store = createServerAccountsStore(runtime);
    await store.getState().poll();
    fail = true;
    await store.getState().poll();
    expect(store.getState().routing.status).toBe('ready');
    expect(store.getState().accounts[ann.sourceAccountId!]).toBe(ann);
  });

  test('a changed connection forgets the readings and routing', async () => {
    const ann = account('claude-primary', 'claude', 'ann');
    const { runtime } = fakeRuntime({
      inventory: async () => sources,
      read: async () => ({ status: 'changed', accounts: body([ann]) }),
    });
    const store = createServerAccountsStore(runtime);
    await store.getState().poll();
    store.getState().reset();
    expect(store.getState().routing.status).toBe('unknown');
    expect(store.getState().accounts).toEqual({});
    expect(store.getState().version).toBeNull();
  });

  test('a poll started before the connection changed cannot commit into the new one', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { runtime } = fakeRuntime({
      inventory: async () => {
        await gate;
        return sources;
      },
      read: async () => ({
        status: 'changed',
        accounts: body([account('claude-primary', 'claude', 'ann')]),
      }),
    });
    const store = createServerAccountsStore(runtime);
    const old = store.getState().poll();
    store.getState().reset();
    release();
    await old;
    expect(store.getState().routing.status).toBe('unknown');
    expect(store.getState().accounts).toEqual({});
  });
});

describe('server numbers in the shared quota store', () => {
  const ready = {
    status: 'ready' as const,
    sources: new Set(['claude-primary\0claude', 'codex-primary\0codex']),
  };
  const claudeFile = { name: 'ann.json', type: 'claude', auth_index: 'ann' };
  const codexFile = { name: 'cy.json', type: 'codex', auth_index: 'cy' };

  test('a served Claude account shows the server windows, read when the server observed them', () => {
    const store = createQuotaStore();
    const ann = account('claude-primary', 'claude', 'ann', {
      extraUsage: {
        isEnabled: true,
        monthlyLimit: 5000,
        usedCredits: 100,
        utilization: 2,
        currency: 'USD',
        disabledReason: null,
        userDisabled: false,
        spendLimitReached: false,
      },
    });
    projectServerAccounts({
      owner: owner('claude-primary'),
      files: [claudeFile],
      routing: ready,
      accounts: { [ann.sourceAccountId!]: ann },
      store,
      t,
    });
    const key = getQuotaCacheKey(claudeFile);
    const shown = store.getState().claudeQuota[key] as ClaudeQuotaState;
    expect(shown.status).toBe('success');
    expect(shown.windows.map((w) => [w.id, w.usedPercent])).toEqual([
      ['seven-day', 59],
      ['five-hour', 12],
    ]);
    expect(shown.windows[0]).toMatchObject({ resetAtMs: NOW + 86_400_000, periodHours: 168 });
    expect(shown.extraUsage?.monthlyLimit).toBe(5000);
    expect(store.getState().fetchedAt[key]).toBe(NOW - 120_000);
  });

  test('a served Codex account shows its windows and held credits', () => {
    const store = createQuotaStore();
    const resets: AccountResets = {
      available: 2,
      usable: 1,
      blocker: null,
      nextExpiryAtMs: NOW + 1000,
      expiries: [NOW + 1000, NOW + 2000],
      observedAtMs: NOW,
    };
    const cy = account('codex-primary', 'codex', 'cy', { resets });
    projectServerAccounts({
      owner: owner('codex-primary'),
      files: [codexFile],
      routing: ready,
      accounts: { [cy.sourceAccountId!]: cy },
      store,
      t,
    });
    const shown = store.getState().codexQuota[getQuotaCacheKey(codexFile)] as CodexQuotaState;
    expect(shown.planType).toBe('plus');
    expect(shown.rateLimitResetCreditsAvailableCount).toBe(2);
    expect(shown.rateLimitResetCreditsApplicableAvailableCount).toBe(1);
    expect(shown.rateLimitResetCredits).toHaveLength(2);
    expect(shown.windows.find((w) => w.id === 'weekly')?.usedPercent).toBe(59);
  });

  test('nothing is written for a non-manifest hub, another provider, or without a routing answer', () => {
    const ann = account('claude-primary', 'claude', 'ann');
    const accounts = { [ann.sourceAccountId!]: ann };
    const project = (
      instanceId: string,
      files: Record<string, unknown>[],
      routing: Parameters<typeof projectServerAccounts>[0]['routing']
    ) => {
      const store = createQuotaStore();
      projectServerAccounts({
        owner: owner(instanceId),
        files: files as never,
        routing,
        accounts,
        store,
        t,
      });
      return store.getState();
    };
    // The same file on a hub the server does not list stays hub-direct.
    expect(project('other-hub', [claudeFile], ready).claudeQuota).toEqual({});
    // An antigravity credential on a listed instance is not served.
    expect(
      project('claude-primary', [{ name: 'g.json', type: 'antigravity', auth_index: 'ann' }], ready)
        .antigravityQuota
    ).toEqual({});
    expect(project('claude-primary', [claudeFile], { status: 'unknown' }).claudeQuota).toEqual({});
    expect(project('claude-primary', [claudeFile], { status: 'unavailable' }).claudeQuota).toEqual(
      {}
    );
  });

  test('a served account the server has not read yet is left for the next poll, not read on the hub', () => {
    const store = createQuotaStore();
    projectServerAccounts({
      owner: owner('claude-primary'),
      files: [claudeFile],
      routing: ready,
      accounts: {},
      store,
      t,
    });
    expect(store.getState().claudeQuota).toEqual({});
  });

  test('a disabled account shows its stored sample, aged; a newer hub reading is not overwritten', () => {
    const store = createQuotaStore();
    const off = account('claude-primary', 'claude', 'ann', {
      disabled: true,
      status: 'disabled',
      observedAtMs: NOW - 3 * 3_600_000,
    });
    const args = {
      owner: owner('claude-primary'),
      files: [{ ...claudeFile, disabled: true }],
      routing: ready,
      accounts: { [off.sourceAccountId!]: off },
      store,
      t,
    };
    const key = getQuotaCacheKey(claudeFile);
    projectServerAccounts(args);
    expect(store.getState().fetchedAt[key]).toBe(NOW - 3 * 3_600_000);
    expect((store.getState().claudeQuota[key] as ClaudeQuotaState).stale).toBe(false);
    // The explicit Refresh on a disabled account reads the hub: its newer reading stays.
    store.getState().setClaudeQuota((prev) => ({
      ...prev,
      [key]: { status: 'success', windows: [], observedAt: 'hub' },
    }));
    store.setState({ fetchedAt: { [key]: NOW } });
    projectServerAccounts({ ...args, accounts: { [off.sourceAccountId!]: { ...off } } });
    expect((store.getState().claudeQuota[key] as ClaudeQuotaState).observedAt).toBe('hub');
  });

  test('an unchanged poll writes nothing; a changed reading replaces the card', () => {
    const store = createQuotaStore();
    const ann = account('claude-primary', 'claude', 'ann');
    const args = {
      owner: owner('claude-primary'),
      files: [claudeFile],
      routing: ready,
      accounts: { [ann.sourceAccountId!]: ann },
      store,
      t,
    };
    projectServerAccounts(args);
    const key = getQuotaCacheKey(claudeFile);
    const first = store.getState().claudeQuota[key];
    projectServerAccounts(args);
    expect(store.getState().claudeQuota[key]).toBe(first);
    const newer = { ...ann, observedAtMs: NOW };
    projectServerAccounts({ ...args, accounts: { [ann.sourceAccountId!]: newer } });
    expect(store.getState().claudeQuota[key]).not.toBe(first);
    expect(store.getState().fetchedAt[key]).toBe(NOW);
  });
});

describe('Refresh on a served account', () => {
  afterEach(() => useServerAccountsStore.getState().reset());
  const file = { name: 'ann.json', type: 'claude', auth_index: 'ann' };
  const key = getQuotaCacheKey(file);

  function serve(result: AccountRefreshResult | null) {
    const sent: string[] = [];
    const { runtime } = fakeRuntime({
      inventory: async () => sources,
      read: async () => ({ status: 'changed', accounts: body([]) }),
      refreshAccount: async (id) => {
        sent.push(id);
        if (!result) throw new Error('down');
        return result;
      },
    });
    // The module singleton is what the pages call; stand in for its runtime-bound store.
    const store = createServerAccountsStore(runtime);
    useServerAccountsStore.setState(store.getState(), true);
    useServerAccountsStore.setState({
      refreshAccount: store.getState().refreshAccount,
      refreshAll: store.getState().refreshAll,
    });
    return sent;
  }

  test('a refresh the 20 s floor skipped names when the next read may run', async () => {
    const quota = createQuotaStore();
    const sent = serve({ refreshed: false, retryAtMs: NOW + 15_000 });
    const outcome = await refreshServedFile({ owner: owner('claude-primary'), file, store: quota });
    expect(sent).toEqual([poolSourceAccountId('claude-primary', 'claude', 'ann')]);
    expect(outcome).toEqual({ kind: 'waiting', retryAtMs: NOW + 15_000 });
    expect(quota.getState().nextReadAt[key]).toBe(NOW + 15_000);
    const notice = serverReadNotice(outcome, {
      name: 'ann.json',
      t,
      language: 'en',
      readAtMs: NOW - 125_000,
      nowMs: NOW,
    });
    expect(notice.type).toBe('info');
    expect(notice.text).toContain('auth_files.quota_server_wait');
    expect(notice.text).toContain('2 minutes ago');
    expect(notice.text).toContain(
      new Date(NOW + 15_000).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })
    );
  });

  test('a refresh the server ran clears the hint; one it could not run is a failure', async () => {
    const quota = createQuotaStore();
    quota.getState().setNextReadAt(key, NOW);
    serve({ refreshed: true, retryAtMs: null });
    expect(await refreshServedFile({ owner: owner('claude-primary'), file, store: quota })).toEqual(
      {
        kind: 'read',
      }
    );
    expect(quota.getState().nextReadAt[key]).toBeUndefined();
    serve({ refreshed: false, retryAtMs: null });
    expect(
      (await refreshServedFile({ owner: owner('claude-primary'), file, store: quota })).kind
    ).toBe('failed');
    serve(null);
    expect(
      (await refreshServedFile({ owner: owner('claude-primary'), file, store: quota })).kind
    ).toBe('failed');
  });

  test('the page-wide refresh asks once and, when the 4 minute floor skipped it, names the next read', async () => {
    const calls: string[] = [];
    const { runtime } = fakeRuntime({
      inventory: async () => sources,
      read: async () => ({ status: 'changed', accounts: body([]) }),
      refreshAll: async () => {
        calls.push('all');
        return { refreshing: false, nextRefreshAtMs: NOW + 200_000 };
      },
    });
    const real = createServerAccountsStore(runtime);
    useServerAccountsStore.setState(real.getState(), true);
    const quota = createQuotaStore();
    const outcome = await refreshServedPage({
      files: [file, { ...file, name: 'b.json', auth_index: 'b' }],
      store: quota,
    });
    expect(calls).toEqual(['all']);
    expect(outcome).toEqual({ kind: 'waiting', retryAtMs: NOW + 200_000 });
    expect(quota.getState().nextReadAt[key]).toBe(NOW + 200_000);
  });
});

describe('the page-wide refresh', () => {
  test('served credentials are never read on the hub; everything else still is', async () => {
    const hubReads: string[] = [];
    const served: string[] = [];
    const quota = createQuotaStore();
    const adapter = (type: string) =>
      ({
        type,
        storeSelector: (state: { claudeQuota: object; xaiQuota: object }) =>
          type === 'claude' ? state.claudeQuota : state.xaiQuota,
        storeSetter: type === 'claude' ? 'setClaudeQuota' : 'setXaiQuota',
        buildLoadingState: () => ({ status: 'loading', windows: [] }),
        buildSuccessState: () => ({ status: 'success', windows: [] }),
        buildErrorState: () => ({ status: 'error', windows: [] }),
        fetchQuota: async (file: { name: string }) => {
          hubReads.push(file.name);
          return {};
        },
      }) as never;
    const load = createQuotaBatchLoader({
      adapters: { claude: adapter('claude'), xai: adapter('xai') } as never,
      store: quota,
      t,
      isCurrent: () => true,
      served: (entry) => entry.type === 'claude',
      refreshServed: async (entries) => {
        served.push(...entries.map((entry) => entry.file.name));
        return true;
      },
    });
    const settled: boolean[] = [];
    await load(
      [
        { file: { name: 'ann.json', auth_index: 'ann' }, type: 'claude' },
        { file: { name: 'grok.json', auth_index: 'grok' }, type: 'xai' },
      ] as never,
      (ok) => settled.push(ok)
    );
    expect(served).toEqual(['ann.json']);
    expect(hubReads).toEqual(['grok.json']);
    expect(settled).toEqual([true, true]);
  });
});

describe('held resets of a served Claude account', () => {
  const resets: AccountResets = {
    available: 3,
    usable: 2,
    blocker: null,
    nextExpiryAtMs: NOW + 1000,
    expiries: [NOW + 1000, NOW + 1000, NOW + 5000],
    kinds: ['weekly', 'weekly', 'fable'],
    observedAtMs: NOW,
  };

  test('are listed from the server reading, in the shape the card and chooser already use', () => {
    const status = serverGrantStatus(resets, NOW)!;
    expect(grantsFromResets(resets, NOW).map((g) => [g.kind, g.usableNow])).toEqual([
      ['weekly', true],
      ['weekly', true],
      ['fable', false],
    ]);
    // Two usable resets of the one kind that end together are a single choice.
    expect(resetGrantChoices(status, NOW).map((c) => [c.grant.kind, c.count])).toEqual([
      ['weekly', 2],
    ]);
    expect(serverGrantStatus(null, NOW)).toBeNull();
  });
});

describe('no hub auto-poll for a served account', () => {
  const read = (path: string) => readFileSync(path, 'utf8');

  test('the grant read on mount is skipped in server mode, and made when the dialog opens', () => {
    const source = read('src/features/quota/providers/claude/ClaudeResetGrants.tsx');
    // The mount effect returns before scheduling the hub read in server mode...
    expect(source).toMatch(/if \(serverMode \|\| !enabled \|\| disabled/);
    // ...and the one live read is made by the confirm action, before the chooser opens.
    expect(source).toMatch(/if \(server && !pending\) \{[\s\S]*scope\s*\.read\(authIndex\)/);
  });

  test('Auth Files, the Quota page and the pool reset row hand the served account to the hook', () => {
    expect(read('src/features/authFiles/components/AuthFileQuotaSection.tsx')).toContain(
      "served && quotaType === 'claude' ? { resets: serverAccount?.resets ?? null }"
    );
    expect(read('src/features/quota/QuotaPage.tsx')).toContain('isServedFile(routing');
    expect(read('src/features/quotaPool/PoolAccountResets.tsx')).toContain(
      'served ? { resets: fact.account.resets } : undefined'
    );
  });
});
