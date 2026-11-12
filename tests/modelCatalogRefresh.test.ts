import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import axios, { AxiosError, type AxiosAdapter } from 'axios';
import { apiClient } from '../src/services/api/client';
import { modelsApi } from '../src/services/api/models';
import { authFilesApi } from '../src/services/api/authFiles';

const originalAdapter = axios.defaults.adapter;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let events: string[];

const response = () => ({
  ok: true,
  status: 'ok',
  catalog: 'https://catalog.invalid/models.json',
  codex_catalog: '/catalogs/codex_client_models.json',
  devin_catalog: 'https://catalog.invalid/devin_models.json',
  sources: {
    catalog: 'https://catalog.invalid/models.json',
    'codex-catalog': '/catalogs/codex_client_models.json',
    'devin-catalog': 'https://catalog.invalid/devin_models.json',
  },
  catalogs: {
    catalog: { source: 'https://catalog.invalid/models.json', refreshed: true },
    'codex-catalog': { source: '/catalogs/codex_client_models.json', refreshed: true },
    'devin-catalog': { source: 'https://catalog.invalid/devin_models.json', refreshed: true },
  },
  changed_providers: ['claude', 'gemini'],
});

const installResponse = (data: unknown, status = 200) => {
  const adapter: AxiosAdapter = async (config) => {
    const result = { data, status, statusText: String(status), headers: {}, config };
    if (status >= 400) {
      throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, result);
    }
    return result;
  };
  axios.defaults.adapter = adapter;
};

beforeEach(() => {
  events = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event.type);
        return true;
      },
    },
  });
  apiClient.setConfig({ apiBase: 'https://proxy.invalid/gateway', managementKey: 'fixture-only' });
});

afterEach(() => {
  axios.defaults.adapter = originalAdapter;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('model catalog refresh', () => {
  test('pins the v8 management destination and key before asynchronous dispatch', async () => {
    axios.defaults.adapter = async (config) => {
      expect(config.baseURL).toBe('https://proxy.invalid/gateway/v8/management');
      expect(config.url).toBe('/models/refresh');
      expect(config.method).toBe('post');
      expect(config.data).toBeUndefined();
      expect(config.headers.Authorization).toBe('Bearer fixture-only');
      return {
        data: response(),
        status: 200,
        statusText: 'OK',
        headers: { 'x-cpa-version': 'stale', 'x-cpa-support-plugin': 'true' },
        config,
      };
    };
    const pending = modelsApi.refreshCatalog();
    apiClient.setConfig({ apiBase: 'https://replacement.invalid', managementKey: 'new-fixture' });
    const result = await pending;
    expect(result).toMatchObject({ outcome: 'success', changedProviders: ['claude', 'gemini'] });
    expect(result.catalogs.map(({ kind, source, state }) => ({ kind, source, state }))).toEqual([
      { kind: 'general', source: 'https://catalog.invalid/models.json', state: 'refreshed' },
      { kind: 'codex', source: '/catalogs/codex_client_models.json', state: 'refreshed' },
      { kind: 'devin', source: 'https://catalog.invalid/devin_models.json', state: 'refreshed' },
    ]);
    expect(events).toEqual([]);
  });

  test('preserves normal response-header integration', async () => {
    axios.defaults.adapter = async (config) => ({
      data: response(),
      status: 200,
      statusText: 'OK',
      config,
      headers: { 'x-cpa-version': 'v8.0.67', 'x-cpa-support-plugin': 'true' },
    });
    await modelsApi.refreshCatalog();
    expect(events).toEqual(['server-version-update', 'server-plugin-support-update']);
  });

  test('normalizes nullable provider changes without treating refreshed catalogs as unchanged', async () => {
    installResponse({ ...response(), changed_providers: null });
    const result = await modelsApi.refreshCatalog();
    expect(result.changedProviders).toEqual([]);
    expect(result.outcome).toBe('success');
  });

  test('does not treat an empty changed_providers list as a skipped Codex refresh', async () => {
    installResponse({
      ...response(),
      changed_providers: [],
      catalogs: {
        catalog: { source: 'disabled', refreshed: false, skipped: true },
        'codex-catalog': { source: '/catalogs/codex_client_models.json', refreshed: true },
        'devin-catalog': { source: 'disabled', refreshed: false, skipped: true },
      },
    });
    const result = await modelsApi.refreshCatalog();
    expect(result.outcome).toBe('success');
    expect(result.changedProviders).toEqual([]);
    expect(result.catalogs.map(({ state }) => state)).toEqual(['skipped', 'refreshed', 'skipped']);
  });

  test('reports embedded and Home policy skips without claiming a refresh', async () => {
    installResponse({
      ...response(),
      changed_providers: [],
      catalogs: {
        catalog: { source: 'disabled', refreshed: false, skipped: true },
        'codex-catalog': { source: 'embed', refreshed: false, skipped: true },
        'devin-catalog': { source: 'disabled', refreshed: false, skipped: true },
      },
    });
    const result = await modelsApi.refreshCatalog();
    expect(result.outcome).toBe('skipped');
    expect(result.catalogs.map(({ skipReason }) => skipReason)).toEqual([
      'disabled',
      'embedded',
      'disabled',
    ]);
  });

  test('retains successful publications and individual errors from a partial 502 response', async () => {
    installResponse(
      {
        ...response(),
        ok: false,
        error: 'no valid model catalog source',
        changed_providers: ['claude'],
        catalogs: {
          catalog: { source: 'https://catalog.invalid/models.json', refreshed: true },
          'codex-catalog': {
            source: '/catalogs/codex_client_models.json',
            refreshed: false,
            error: 'no valid model catalog source',
          },
          'devin-catalog': { source: 'embed', refreshed: false, skipped: true },
        },
      },
      502
    );
    const result = await modelsApi.refreshCatalog();
    expect(result.outcome).toBe('partial');
    expect(result.changedProviders).toEqual(['claude']);
    expect(result.catalogs[1]).toMatchObject({
      state: 'failed',
      error: 'no valid model catalog source',
    });
    expect(result.catalogs.map(({ state }) => state)).toEqual(['refreshed', 'failed', 'skipped']);
  });

  test('reports an entirely failed refresh separately from policy skips', async () => {
    installResponse(
      {
        ...response(),
        ok: false,
        changed_providers: [],
        error: 'refresh failed',
        catalogs: Object.fromEntries(
          Object.entries(response().catalogs).map(([key, status]) => [
            key,
            { ...status, refreshed: false, error: 'no valid model catalog source' },
          ])
        ),
      },
      502
    );
    expect((await modelsApi.refreshCatalog()).outcome).toBe('error');
  });

  test.each([400, 404, 405, 502])(
    'keeps ordinary HTTP %s errors and makes no fallback request',
    async (status) => {
      let calls = 0;
      axios.defaults.adapter = async (config) => {
        calls += 1;
        throw new AxiosError('Request failed', 'ERR_BAD_RESPONSE', config, undefined, {
          data: { error: 'fixture failure' },
          status,
          statusText: String(status),
          headers: {},
          config,
        });
      };
      await expect(modelsApi.refreshCatalog()).rejects.toMatchObject({
        status,
        message: 'fixture failure',
      });
      expect(calls).toBe(1);
    }
  );

  test('rejects the array-shaped payload suggested by the issue', async () => {
    installResponse({ ok: true, catalog: [], codex_catalog: [], devin_catalog: [], catalogs: [] });
    await expect(modelsApi.refreshCatalog()).rejects.toThrow(
      'Invalid model catalog refresh response'
    );
  });

  test.each([true, false])(
    'handles a 401 only while its owning session is current (%s)',
    async (current) => {
      installResponse({ error: 'unauthorized' }, 401);
      await expect(modelsApi.refreshCatalog({ isCurrent: () => current })).rejects.toMatchObject({
        status: 401,
      });
      expect(events).toEqual(current ? ['unauthorized'] : []);
    }
  );

  test('honors cancellation without dispatching a request', async () => {
    let calls = 0;
    axios.defaults.adapter = async (config) => {
      calls += 1;
      return { data: response(), status: 200, statusText: 'OK', headers: {}, config };
    };
    const controller = new AbortController();
    controller.abort();
    await expect(modelsApi.refreshCatalog({ signal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  for (const [method, argument, endpoint] of [
    ['getModelsForAuthFile', 'fixture.json', '/credentials/models?name=fixture.json'],
    ['getModelDefinitions', 'claude', '/routing/model-definitions/claude'],
  ] as const) {
    test(`${method} keeps model reloads on their owning connection and suppresses stale events`, async () => {
      axios.defaults.adapter = async (config) => {
        expect(config.baseURL).toBe('https://proxy.invalid/gateway/v8/management');
        expect(config.headers.Authorization).toBe('Bearer fixture-only');
        expect(config.url).toBe(endpoint);
        return {
          data: { models: [{ id: 'fixture-model' }] },
          status: 200,
          statusText: 'OK',
          config,
          headers: { 'x-cpa-version': 'stale', 'x-cpa-support-plugin': 'true' },
        };
      };
      const pending = authFilesApi[method](argument, () => true);
      apiClient.setConfig({ apiBase: 'https://replacement.invalid', managementKey: 'new-fixture' });
      expect(await pending).toEqual([{ id: 'fixture-model' }]);
      expect(events).toEqual([]);
    });
  }
});
