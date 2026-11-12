import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import type { ModelCatalogRefreshResult } from '../src/services/api/modelCatalogs';
import { getErrorMessage, isRecord } from '../src/utils/helpers';

const read = (path: string) => readFileSync(path, 'utf8');
const hook = read('src/hooks/useModelCatalogSync.ts');
const refreshed = (providers: string[] = []): ModelCatalogRefreshResult => ({
  outcome: 'success',
  catalogs: [
    { kind: 'general', source: 'https://catalog.invalid', state: 'refreshed' },
    { kind: 'codex', source: 'https://catalog.invalid', state: 'refreshed' },
    { kind: 'devin', source: 'embed', state: 'skipped', skipReason: 'embedded' },
  ],
  changedProviders: providers,
});

// Execute the hook's actual async callback, following the existing source-harness test pattern.
function harness() {
  let revision = 1;
  let connected = true;
  let resolve!: (value: ModelCatalogRefreshResult) => void;
  let reject!: (error: Error & { status?: number }) => void;
  let calls = 0;
  let invalidations = 0;
  let refetches = 0;
  let loading = false;
  const operationRef = { current: null as AbortController | null };
  const notifications: unknown[][] = [];
  const env = {
    useCallback: (fn: unknown) => fn,
    operationRef,
    apiClient: { getConnectionRevision: () => revision },
    useAuthStore: {
      getState: () => ({ connectionStatus: connected ? 'connected' : 'disconnected' }),
    },
    modelsApi: {
      refreshCatalog: () => {
        calls++;
        return new Promise<ModelCatalogRefreshResult>((res, rej) => {
          resolve = res;
          reject = rej;
        });
      },
    },
    useModelsStore: { getState: () => ({ invalidateCache: () => invalidations++ }) },
    onSyncedRef: {
      current: async () => {
        refetches++;
      },
    },
    setSyncingModelCatalog: (value: boolean) => {
      loading = value;
    },
    showNotification: (...args: unknown[]) => notifications.push(args),
    t: (key: string, params?: { providers: string }) => `${key}${params?.providers ?? ''}`,
    getErrorMessage,
    isRecord,
  };
  const block = hook.slice(hook.indexOf('  const syncModelCatalog ='), hook.indexOf('  return {'));
  const js = ts.transpileModule(`${block}\nreturn syncModelCatalog;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return {
    sync: new Function(...Object.keys(env), js)(...Object.values(env)) as () => Promise<void>,
    resolve: (value: ModelCatalogRefreshResult = refreshed()) => resolve(value),
    reject: (status?: number) => reject(Object.assign(new Error('fixture failure'), { status })),
    switchConnection: () => revision++,
    disconnect: () => {
      connected = false;
    },
    unmount: () => {
      operationRef.current?.abort();
      operationRef.current = null;
    },
    notifications,
    get calls() {
      return calls;
    },
    get invalidations() {
      return invalidations;
    },
    get refetches() {
      return refetches;
    },
    get loading() {
      return loading;
    },
  };
}

describe('shared model catalog sync', () => {
  for (const providers of [[], ['claude', 'codex']]) {
    test(`refreshes derived model data without interpreting empty providers as unchanged: ${providers}`, async () => {
      const h = harness();
      const pending = h.sync();
      await h.sync();
      expect(h.calls).toBe(1);
      expect(h.loading).toBe(true);
      h.resolve(refreshed(providers));
      await pending;
      expect(h.loading).toBe(false);
      expect(h.invalidations).toBe(1);
      expect(h.refetches).toBe(1);
      expect(h.notifications[0][1]).toBe('success');
      expect(String(h.notifications[0][0])).toContain('model_catalog.success');
      expect(String(h.notifications[0][0])).not.toContain('unchanged');
      if (providers.length) {
        expect(String(h.notifications[0][0])).toContain(providers.join(', '));
      }
    });
  }

  test('keeps local model caches when the backend skips every catalog by policy', async () => {
    const h = harness();
    const pending = h.sync();
    h.resolve({
      ...refreshed(),
      outcome: 'skipped',
      catalogs: [
        { kind: 'general', source: 'disabled', state: 'skipped', skipReason: 'disabled' },
        { kind: 'codex', source: 'embed', state: 'skipped', skipReason: 'embedded' },
        { kind: 'devin', source: 'disabled', state: 'skipped', skipReason: 'disabled' },
      ],
    });
    await pending;
    expect(h.invalidations).toBe(0);
    expect(h.refetches).toBe(0);
    expect(h.notifications[0]).toEqual(['model_catalog.skipped', 'info']);
  });

  test('reloads successful publications from a partial failure and reports a warning', async () => {
    const h = harness();
    const pending = h.sync();
    h.resolve({
      ...refreshed(['claude']),
      outcome: 'partial',
      catalogs: [
        { kind: 'general', source: 'https://catalog.invalid', state: 'refreshed' },
        {
          kind: 'codex',
          source: 'https://catalog.invalid',
          state: 'failed',
          error: 'fixture failure',
        },
      ],
    });
    await pending;
    expect(h.invalidations).toBe(1);
    expect(h.refetches).toBe(1);
    expect(String(h.notifications[0][0])).toContain('fixture failure');
    expect(h.notifications[0][1]).toBe('warning');
  });

  test('does not invalidate model caches after an entirely failed refresh', async () => {
    const h = harness();
    const pending = h.sync();
    h.resolve({
      ...refreshed(),
      outcome: 'error',
      catalogs: [
        {
          kind: 'general',
          source: 'https://catalog.invalid',
          state: 'failed',
          error: 'fixture failure',
        },
      ],
    });
    await pending;
    expect(h.invalidations).toBe(0);
    expect(h.refetches).toBe(0);
    expect(h.notifications[0]).toEqual(['model_catalog.error fixture failure', 'error']);
  });

  test('reports errors without clearing valid caches and allows retry', async () => {
    const h = harness();
    const pending = h.sync();
    h.reject();
    await pending;
    expect(h.notifications[0]).toEqual(['model_catalog.error: fixture failure', 'error']);
    expect(h.invalidations).toBe(0);
    expect(h.loading).toBe(false);
    const retry = h.sync();
    h.resolve();
    await retry;
    expect(h.calls).toBe(2);
  });

  test.each([404, 405])('explains an unsupported backend (%s)', async (status) => {
    const h = harness();
    const pending = h.sync();
    h.reject(status);
    await pending;
    expect(h.invalidations).toBe(0);
    expect(h.notifications[0]).toEqual(['model_catalog.unsupported', 'error']);
  });

  for (const stale of ['switchConnection', 'unmount', 'disconnect'] as const) {
    for (const fail of [false, true]) {
      test(`ignores stale ${fail ? 'error' : 'success'} after ${stale}`, async () => {
        const h = harness();
        const pending = h.sync();
        h[stale]();
        if (fail) h.reject();
        else h.resolve(refreshed(['claude']));
        await pending;
        expect(h.notifications).toEqual([]);
        expect(h.invalidations).toBe(0);
        expect(h.refetches).toBe(0);
      });
    }
  }

  test('uses the same controller and copy in both entry points, preserving credential model invalidation', () => {
    const header = read('src/features/authFiles/components/VaultHeader.tsx');
    const actions = header.slice(header.indexOf('<div className={styles.actions}'));
    expect(actions.indexOf('onClick={onSyncModelCatalog}')).toBeLessThan(
      actions.indexOf('onClick={onRefreshCredentials}')
    );
    expect(actions.slice(0, actions.indexOf('{onRefreshCredentials'))).toContain(
      'styles.ghostAction'
    );
    expect(header).toContain("t('model_catalog.button')");
    const page = read('src/features/authFiles/AuthFilesPage.tsx');
    expect(page).toContain("from '@/hooks/useModelCatalogSync'");
    expect(page).toContain('invalidateModels()');
    expect(page).toContain('setModelCatalogVersion');
    expect(page).toContain('await showModels(');
    expect(page).not.toContain('ModelCatalogSyncResult');
    expect(read('src/pages/SystemModelsCard.tsx')).not.toContain('ModelCatalogSyncResult');
    expect(read('src/pages/SystemModelsCard.tsx')).toContain(
      'useModelCatalogSync(onCatalogsRefreshed)'
    );
    expect(read('src/features/authFiles/hooks/useAuthFilesOauth.tsx')).toContain(
      '[providerList, viewMode, modelCatalogVersion]'
    );
    expect(read('src/services/api/models.ts')).not.toContain('refreshCatalogs:');
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const messages = JSON.parse(read(`src/i18n/locales/${locale}.json`));
      expect(messages.model_catalog.button).toBeTruthy();
      expect(messages.model_catalog.changed_providers).toContain('{{providers}}');
      expect(messages.auth_files).not.toHaveProperty('sync_catalog_unchanged');
    }
  });
});
