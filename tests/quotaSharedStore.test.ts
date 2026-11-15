import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { readFileSync } from 'node:fs';
import type { TFunction } from 'i18next';
import { legacyAccountId, sourceAccountId } from '../server/quota/identity';
import { createAuthFilesSourceScope } from '../src/features/authFiles/sourceScope';
import { createQuotaAdapters, getQuotaMap, getQuotaSetter } from '../src/features/quota/providers';
import { createSourceResetGrants } from '../src/features/quota/providers/claude/resetGrantScope';
import { isQuotaFresh } from '../src/features/quota/quotaFreshness';
import { createPoolResource } from '../src/features/quotaPool/poolResource';
import { poolSourceAccountId } from '../src/features/quotaPool/resetAccounts';
import { apiClient } from '../src/services/api/client';
import { createSourceLease } from '../src/services/api/sourceLease';
import { SourceSessions } from '../src/services/api/sourceSession';
import { sourceQuotaStore } from '../src/stores/sourceQuotaStores';
import { getQuotaCacheKey } from '../src/utils/quota/identity';
import type { PoolDashboard } from '../src/domain/quotaPool/types';
import { CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL } from '../src/utils/quota';
import type { ApiClient } from '../src/services/api/transport';

const organization = '11111111-2222-3333-4444-555555555555';
const grant = { id: 'test-grant', resets_total: 1, resets_left: 1, usable_now: true };
const t = ((key: string) => key) as TFunction;

const restores: Array<{ mockRestore(): void }> = [];
afterEach(() => restores.splice(0).forEach((spy) => spy.mockRestore()));

/** Hub sources whose transport answers from `respond`, the way the fake hubs do. */
function hubs(
  instanceIds: string[],
  respond: (config: InternalAxiosRequestConfig, payload?: { url?: string }) => unknown = () => ({})
) {
  const sessions = new SourceSessions();
  const original = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => {
    const payload =
      typeof config.data === 'string' ? (JSON.parse(config.data) as { url?: string }) : undefined;
    return {
      data: await respond(config, payload),
      status: 200,
      statusText: 'OK',
      headers: {},
      config,
    };
  };
  try {
    sessions.configure(
      instanceIds.map((instanceId) => ({
        instanceId,
        configurationRevision: 'fixture',
        apiBase: `https://${instanceId}.invalid`,
        managementKey: 'synthetic-test-key',
      }))
    );
  } finally {
    axios.defaults.adapter = original;
  }
  return sessions;
}

/** The history server, as the browser reaches it: every POST /prox/refresh lands here. */
function historyServer() {
  const posts: { url: string; body: unknown }[] = [];
  const client = {
    post: async (url: string, body: unknown) => {
      posts.push({ url, body });
      return { refreshed: true };
    },
  } as unknown as ApiClient;
  restores.push(spyOn(apiClient, 'captureConnection').mockReturnValue(client));
  return posts;
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const claudeHub = (config: InternalAxiosRequestConfig, payload?: { url?: string }) => {
  if (config.url !== '/requests/api-call') return {};
  if (payload?.url?.endsWith('/reset_rate_limits'))
    return { status_code: 200, body: { result: 'reset' } };
  if (payload?.url?.endsWith('/profile'))
    return { status_code: 200, body: { organization: { uuid: organization } } };
  return {
    status_code: 200,
    body: { cedar_ember: { eligible: true, at_limit: true, grants: [grant] } },
  };
};

describe('one quota store per hub source session', () => {
  test('Auth Files, the Quota page and the pool reset panel read and write the same store', () => {
    const sessions = hubs(['claude-primary', 'codex-primary']);
    const source = sessions.captureSource('claude-primary');
    const authFiles = createAuthFilesSourceScope(source);
    // Each page leases the session on its own; the store belongs to the session, not the lease.
    const quotaPage = sourceQuotaStore(createSourceLease(source).session.owner);
    const poolPanel = sourceQuotaStore(createSourceLease(source).session.owner);
    expect(authFiles.quotaStore).toBe(quotaPage);
    expect(poolPanel).toBe(quotaPage);

    const adapters = createQuotaAdapters(source, poolPanel);
    const file = { name: 'work.json', type: 'claude', auth_index: 'auth-1' };
    const key = getQuotaCacheKey(file);
    const setClaude = getQuotaSetter(adapters.claude, poolPanel);
    setClaude((prev) => ({ ...prev, [key]: { status: 'loading', windows: [] } }));
    setClaude((prev) => ({
      ...prev,
      [key]: { status: 'success', windows: [], observedAt: 7, planType: 'max' },
    }));
    // The pool panel's claim reading is what Auth Files and the Quota page now show.
    for (const store of [authFiles.quotaStore, quotaPage]) {
      expect(getQuotaMap(adapters.claude, store)[key]).toMatchObject({
        status: 'success',
        observedAt: 7,
      });
      // The 60 s reuse sees the read too, so no page re-reads it a second time.
      expect(isQuotaFresh(store.getState().fetchedAt[key], Date.now())).toBe(true);
    }
    // Closing a page keeps the session's data.
    authFiles.dispose();
    expect(getQuotaMap(adapters.claude, quotaPage)[key]).toBeDefined();
  });

  test('a source session never shares with another source or with its replacement', () => {
    const sessions = hubs(['claude-primary', 'codex-primary']);
    const first = sessions.captureSource('claude-primary');
    const store = sourceQuotaStore(first.owner);
    expect(sourceQuotaStore(sessions.captureSource('codex-primary').owner)).not.toBe(store);
    const adapters = createQuotaAdapters(first, store);
    getQuotaSetter(adapters.claude, store)(() => ({
      'a.json': { status: 'success', windows: [] },
    }));
    sessions.reset();
    sessions.configure([
      {
        instanceId: 'claude-primary',
        configurationRevision: 'fixture',
        apiBase: 'https://claude-primary.invalid',
        managementKey: 'synthetic-test-key',
      },
    ]);
    const replacement = sourceQuotaStore(sessions.captureSource('claude-primary').owner);
    expect(replacement).not.toBe(store);
    expect(replacement.getState().claudeQuota).toEqual({});
  });

  test('no page builds a private quota store', () => {
    for (const path of [
      'src/features/authFiles/sourceScope.ts',
      'src/features/quota/QuotaPage.tsx',
      'src/features/quotaPool/PoolAccountResets.tsx',
    ]) {
      const source = readFileSync(path, 'utf8');
      expect(source).toContain('sourceQuotaStore(');
      expect(source).not.toContain('createQuotaStore');
    }
  });
});

describe('a confirmed reset attempt re-reads that account on the history server', () => {
  test('the identity the browser sends is the server one', () => {
    expect(poolSourceAccountId('claude-primary', 'claude', 'auth-1')).toBe(
      sourceAccountId('claude-primary', legacyAccountId('claude', 'auth-1'))
    );
  });

  test('a Claude claim, from any page, posts one targeted refresh for its account', async () => {
    const posts = historyServer();
    const sessions = hubs(['claude-primary'], claudeHub);
    // Two pages claim through the same session; only the claim that ran posts.
    const authFiles = createAuthFilesSourceScope(sessions.captureSource('claude-primary'));
    const answer = await createSourceResetGrants(authFiles.session).operations.run(
      'work.json',
      'auth-1',
      grant.id
    );
    await flush();
    expect(answer).toMatchObject({ code: 'reset' });
    expect(posts).toEqual([
      {
        url: '/prox/refresh',
        body: { accountId: poolSourceAccountId('claude-primary', 'claude', 'auth-1') },
      },
    ]);
  });

  test('a claim refused before it was sent changes nothing, so it posts nothing', async () => {
    const posts = historyServer();
    const sessions = hubs(['claude-primary'], (config, payload) =>
      payload?.url?.endsWith('/profile')
        ? { status_code: 500, body: {} }
        : claudeHub(config, payload)
    );
    const lease = createSourceLease(sessions.captureSource('claude-primary'));
    lease.activate();
    await createSourceResetGrants(lease.session)
      .operations.run('work.json', 'auth-1', grant.id)
      .catch(() => {});
    await flush();
    expect(posts).toEqual([]);
  });

  test('a Codex reset attempt posts one targeted refresh, even when it was not confirmed', async () => {
    const posts = historyServer();
    const sessions = hubs(['codex-primary'], (config, payload) =>
      config.url === '/requests/api-call' && payload?.url === CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL
        ? { status_code: 200, body: { code: 'no_credit' } }
        : { status_code: 200, body: {} }
    );
    const session = sessions.captureSource('codex-primary');
    const adapters = createQuotaAdapters(session, sourceQuotaStore(session.owner));
    const file = { name: 'work.json', type: 'codex', auth_index: 'codex-1' };
    await adapters.codex.resetQuota!(file, t).catch(() => {});
    await flush();
    expect(posts).toEqual([
      {
        url: '/prox/refresh',
        body: { accountId: poolSourceAccountId('codex-primary', 'codex', 'codex-1') },
      },
    ]);
  });

  test('Quota Management reloads its pool once the account was re-read', async () => {
    historyServer();
    const dashboard = { pools: [] } as unknown as PoolDashboard;
    let reads = 0;
    const resource = createPoolResource(
      {
        get: async () => {
          reads++;
          return dashboard;
        },
        refresh: async () => ({ refreshing: false, nextRefreshAtMs: 0, lastRefreshAtMs: null }),
        refreshAccount: async () => ({ refreshed: true }),
      },
      { window: 'weekly', lookback: 24, multiplier: 1, offsetDays: 0, reveal: false },
      () => true
    );
    const stop = resource.subscribe(() => {});
    await flush();
    expect(reads).toBe(1);
    const sessions = hubs(['claude-primary'], claudeHub);
    await createSourceResetGrants(sessions.captureSource('claude-primary')).operations.run(
      'work.json',
      'auth-1',
      grant.id
    );
    await flush();
    expect(reads).toBe(2);
    stop();
  });
});
