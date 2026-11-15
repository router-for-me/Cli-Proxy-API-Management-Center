import { authFileDisplayMetadata } from '../src/features/authFiles/metadata';
import { describe, expect, test } from 'bun:test';
import axios, { type InternalAxiosRequestConfig } from 'axios';
import { readFileSync } from 'node:fs';
import { SourceSessions, sourceOwnerKey } from '../src/services/api/sourceSession';
import { createAuthFilesSourceScope } from '../src/features/authFiles/sourceScope';
import { invalidateAuthFileDerivedCaches } from '../src/features/authFiles/cacheInvalidation';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
} from '../src/stores/useQuotaStore';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(respond: (config: InternalAxiosRequestConfig) => unknown | Promise<unknown>) {
  const calls: InternalAxiosRequestConfig[] = [];
  const sessions = new SourceSessions();
  const adapter = axios.defaults.adapter;
  axios.defaults.adapter = async (config) => {
    calls.push(config);
    return { data: await respond(config), status: 200, statusText: 'OK', headers: {}, config };
  };
  try {
    sessions.configure(
      ['alpha', 'beta'].map((instanceId) => ({
        instanceId,
        configurationRevision: 'fixture',
        apiBase: `https://${instanceId}.invalid`,
        managementKey: 'synthetic-key',
      }))
    );
  } finally {
    axios.defaults.adapter = adapter;
  }
  const alphaSession = sessions.captureSource('alpha');
  const betaSession = sessions.captureSource('beta');
  return {
    calls,
    sessions,
    alphaSession,
    betaSession,
    alpha: createAuthFilesSourceScope(alphaSession),
    beta: createAuthFilesSourceScope(betaSession),
  };
}

const inventory = { files: [{ name: 'same.json', type: 'codex', auth_index: 'same-index' }] };

describe('auth files source view lifetime', () => {
  test('same filenames remain separate occurrences; enumeration never downloads credentials or fetches quota', async () => {
    const f = fixture(() => inventory);
    const inventories = await Promise.all([f.alpha.api.list(), f.beta.api.list()]);
    expect(inventories.map((result) => result.files[0].name)).toEqual(['same.json', 'same.json']);
    expect(sourceOwnerKey(f.alpha.session.owner)).not.toBe(sourceOwnerKey(f.beta.session.owner));
    expect(f.calls.map((call) => [call.baseURL, call.url])).toEqual([
      ['https://alpha.invalid/v8/management', '/credentials'],
      ['https://beta.invalid/v8/management', '/credentials'],
    ]);
    expect(f.alpha.quotaStore).not.toBe(f.beta.quotaStore);
    expect(Object.isFrozen(f.alpha.session)).toBe(true);
  });

  test('delayed confirmation, editor save, download, upload and refresh reject before dispatch after unmount', async () => {
    const f = fixture(() => ({ status: 'ok' }));
    const captured = f.alpha.api;
    f.alpha.dispose();
    f.alphaSession.assertCurrent(); // Registry session can still serve other views.
    const outcomes = await Promise.allSettled([
      captured.deleteFile('same.json'),
      captured.patchFields('same.json', { prefix: 'alpha' }),
      captured.download('same.json'),
      captured.uploadFiles([new File(['{}'], 'same.json')]),
      captured.requestManualRefresh('same.json', 'same-index'),
      captured.saveOauthModelAlias('codex', [{ name: 'model', alias: 'alias' }]),
    ]);
    expect(outcomes.every((result) => result.status === 'rejected')).toBe(true);
    expect(f.calls).toHaveLength(0);
    await f.beta.api.deleteFile('same.json');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].baseURL).toContain('beta.invalid');
  });

  test('unmount aborts a request queued in the transport before its adapter dispatches', async () => {
    const f = fixture(() => inventory);
    const pending = f.alpha.api.list();
    f.alpha.dispose();
    await expect(pending).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  test('in-flight inventory and downloaded text cannot publish after view removal', async () => {
    const response = deferred<unknown>();
    const f = fixture(() => response.promise);
    const inventoryRead = f.alpha.api.list();
    const download = f.alpha.api.downloadText('same.json');
    // Let the real transport dispatch into the synthetic adapter.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.calls).toHaveLength(2);
    const outcomes = Promise.allSettled([inventoryRead, download]);
    f.alpha.dispose();
    response.resolve(new Blob(['credential-sentinel']));
    expect((await outcomes).every((result) => result.status === 'rejected')).toBe(true);
  });

  test('queued OAuth map writes stop at dequeue after unmount, never following the other source', async () => {
    const read = deferred<unknown>();
    const f = fixture(() => read.promise);
    const first = f.alpha.api.saveOauthExcludedModels('codex', ['first']);
    const queued = f.alpha.api.saveOauthExcludedModels('claude', ['second']);
    const outcomes = Promise.allSettled([first, queued]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.calls).toHaveLength(1);
    f.alpha.dispose();
    read.resolve({});
    expect((await outcomes).every((result) => result.status === 'rejected')).toBe(true);
    expect(f.calls.map((call) => call.method)).toEqual(['get']);
  });

  test('two mounted leases of one owner serialize OAuth writes through the shared API queue', async () => {
    const firstRead = deferred<unknown>();
    let values: unknown = {};
    let reads = 0;
    const f = fixture((config) => {
      if (config.method === 'put') {
        values = JSON.parse(config.data as string);
        return {};
      }
      reads += 1;
      return reads === 1 ? firstRead.promise : values;
    });
    const otherView = createAuthFilesSourceScope(f.alphaSession);
    const first = f.alpha.api.saveOauthExcludedModels('codex', ['one']);
    const second = otherView.api.saveOauthExcludedModels('claude', ['two']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(f.calls).toHaveLength(1);
    firstRead.resolve({});
    await Promise.all([first, second]);
    expect(f.calls.map((call) => call.method)).toEqual(['get', 'put', 'get', 'put']);
    expect(values).toEqual({ codex: ['one'], claude: ['two'] });
    f.alpha.dispose();
    expect(otherView.isCurrent()).toBe(true);
  });

  test('source-local mutations invalidate only that view and preserve retained Claude usage rules', () => {
    const f = fixture(() => inventory);
    const quota = { status: 'success' as const, windows: [], observedAt: 10, planType: 'fixture' };
    f.alpha.quotaStore.getState().setClaudeQuota({ 'same.json': quota });
    f.beta.quotaStore.getState().setClaudeQuota({ 'same.json': quota });
    f.alpha.quotaStore
      .getState()
      .setClaudeQuota({ 'same.json': { status: 'loading', windows: [] } });
    expect(f.alpha.quotaStore.getState().claudeQuota['same.json'].observedAt).toBe(10);
    const a = captureQuotaCacheGeneration('same.json', f.alpha.quotaStore);
    const b = captureQuotaCacheGeneration('same.json', f.beta.quotaStore);
    let invalidated: string[] | undefined;
    invalidateAuthFileDerivedCaches(
      (names) => {
        invalidated = names;
      },
      ['same.json'],
      f.alpha.quotaStore
    );
    expect(invalidated).toEqual(['same.json']);
    expect(f.alpha.quotaStore.getState().claudeQuota['same.json']).toBeUndefined();
    expect(f.beta.quotaStore.getState().claudeQuota['same.json']).toBe(quota);
    expect(commitIfQuotaCacheCurrent(a, () => {})).toBe(false);
    expect(commitIfQuotaCacheCurrent(b, () => {})).toBe(true);
    // The store belongs to the source session, shared with the other pages; closing this view
    // keeps it (the session's replacement is what drops it: tests/quotaSharedStore.test.ts).
    f.beta.dispose();
    expect(commitIfQuotaCacheCurrent(b, () => {})).toBe(true);
  });

  test('logout and A -> B -> A replacement never revive an old view owner', async () => {
    const f = fixture(() => inventory);
    f.sessions.reset();
    f.sessions.configure([
      {
        instanceId: 'alpha',
        configurationRevision: 'fixture',
        apiBase: 'https://alpha.invalid',
        managementKey: 'synthetic-key',
      },
    ]);
    const replacement = f.sessions.captureSource('alpha');
    expect(sourceOwnerKey(replacement.owner)).not.toBe(sourceOwnerKey(f.alpha.session.owner));
    expect(f.alpha.isCurrent()).toBe(false);
    await expect(f.alpha.api.list()).rejects.toThrow();
    expect(f.calls).toHaveLength(0);
  });

  test('layout-effect replay rejects pre-cleanup results while allowing the current view to load', async () => {
    const pending = deferred<unknown>();
    let first = true;
    const f = fixture(() => {
      if (first) {
        first = false;
        return pending.promise;
      }
      return inventory;
    });
    const previous = f.alpha.api.list();
    await new Promise((resolve) => setTimeout(resolve, 0));
    f.alpha.dispose();
    f.alpha.activate();
    pending.resolve(inventory);
    await expect(previous).rejects.toThrow();
    expect((await f.alpha.api.list()).files[0].name).toBe('same.json');
  });
});

describe('auth files source wiring', () => {
  test('renders concurrent registry panels with source-qualified navigation and inline selections', () => {
    const page =
      readFileSync('src/features/authFiles/AuthFilesPage.tsx', 'utf8') +
      readFileSync('src/features/authFiles/AuthFilesSourceContent.tsx', 'utf8');
    expect(page).toContain('sources.map((view) =>');
    expect(page).toContain('<AuthFilesSourceProvider');
    expect(page).toContain('data-source-id={view.source.instanceId}');
    expect(page).toContain('sourceOwner: sourceScope.session.owner');
    expect(page).toContain('modelsScreenPath(instanceId, provider)');
    expect(page).toContain('sourceLabel={sourceScope.source.label}');
    expect(page).not.toContain('selectedInstanceId');
    expect(page).not.toContain('useAuthStore');
  });

  test('every feature request hook uses injected API; quota cache and factory keep the same owner', () => {
    for (const path of [
      'hooks/useAuthFilesData.ts',
      'hooks/useAuthFilesModels.ts',
      'hooks/useAuthFilesOauth.tsx',
      'hooks/useAuthFilesPrefixProxyEditor.ts',
      'components/AuthFileExcludedModelsField.tsx',
    ]) {
      const source = readFileSync(`src/features/authFiles/${path}`, 'utf8');
      expect(source).toContain('useAuthFilesSource()');
      expect(source).not.toMatch(/import\s*\{[^}]*\b(?:apiClient|authFilesApi)\b[^}]*\}\s*from/);
    }
    const context = readFileSync('src/features/authFiles/AuthFilesSourceContext.tsx', 'utf8');
    expect(context).toContain('createQuotaAdapters(scope.session, scope.quotaStore)');
    const quota = readFileSync(
      'src/features/authFiles/components/AuthFileQuotaSection.tsx',
      'utf8'
    );
    expect(quota).toContain('captureQuotaCacheGeneration(file.name, sourceScope.quotaStore)');
    expect(quota).not.toContain('QUOTA_ADAPTERS');
    expect(quota).not.toContain('useEffect'); // Inventory cannot trigger adapter actions.
  });
});

test('inspector projects known scalar metadata without account keys or unknown nested credentials', () => {
  const file = {
    name: 'fixture.json',
    email: 'fixture@example.invalid',
    authIndex: 7,
    disabled: false,
    account: 'SECRET',
    account_type: 'SECRET',
    future: { token: 'SECRET' },
    status: 'ready',
  };
  Object.assign(file, { status: { token: 'SECRET' } });
  const safe = authFileDisplayMetadata(file);
  expect(safe).toEqual({
    name: 'fixture.json',
    email: 'fixture@example.invalid',
    authIndex: 7,
    disabled: false,
  });
  expect(JSON.stringify(safe)).not.toContain('SECRET');
  const editor = readFileSync(
    'src/features/authFiles/hooks/useAuthFilesPrefixProxyEditor.ts',
    'utf8'
  );
  expect(editor).toContain('JSON.stringify(authFileDisplayMetadata(file), null, 2)');
  expect(editor).not.toContain('JSON.stringify(file, null, 2)');
});
