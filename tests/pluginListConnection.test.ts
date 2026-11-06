import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import axios, { AxiosError, type AxiosAdapter, type AxiosInstance, type AxiosResponse } from 'axios';
import { apiClient } from '@/services/api/client';
import { pluginsApi } from '@/services/api/plugins';

const connectionA = { apiBase: 'https://original.invalid', managementKey: 'original-fixture' };
const connectionB = { apiBase: 'https://replacement.invalid', managementKey: 'replacement-fixture' };
const metadataHeaders = {
  'x-cpa-version': 'original-version',
  'x-cpa-build-date': 'original-build',
  'x-cpa-support-plugin': 'true',
};
const pluginData = {
  plugins_enabled: true,
  plugins_dir: ' custom-plugins ',
  plugins: [
    null,
    { id: '' },
    {
      id: ' quota-plugin ',
      supports_quota: true,
      quota_provider: ' CUSTOM ',
      metadata: { logo: ' /plugin-logo.svg ' },
    },
  ],
};

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let restoreTransport: (() => void) | undefined;
let events: Event[];
// Model the global event consumers separately from the hook's local stale-result guards.
let session: {
  isAuthenticated: boolean;
  serverVersion: string | null;
  serverBuildDate: string | null;
  supportsPlugin: boolean;
};

beforeEach(() => {
  events = [];
  session = {
    isAuthenticated: true,
    serverVersion: 'replacement-version',
    serverBuildDate: 'replacement-build',
    supportsPlugin: false,
  };
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      dispatchEvent: (event: Event) => {
        events.push(event);
        if (event.type === 'unauthorized') session.isAuthenticated = false;
        if (event.type === 'server-version-update') {
          const detail = (event as CustomEvent).detail;
          session.serverVersion = detail.version;
          session.serverBuildDate = detail.buildDate;
        }
        if (event.type === 'server-plugin-support-update') {
          session.supportsPlugin = (event as CustomEvent).detail.supportsPlugin;
        }
        return true;
      },
    },
  });
  apiClient.setConfig(connectionA);
});

afterEach(() => {
  restoreTransport?.();
  restoreTransport = undefined;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

function deferPluginResponse(status: number) {
  let started!: (config: AxiosResponse['config']) => void;
  const dispatched = new Promise<AxiosResponse['config']>((resolve) => {
    started = resolve;
  });
  let deliver!: () => void;
  const adapter: AxiosAdapter = (config) =>
    new Promise<AxiosResponse>((resolve, reject) => {
      deliver = () => {
        const response: AxiosResponse = {
          config,
          data: status === 401 ? { error: 'unauthorized', message: 'Fixture key rejected' } : pluginData,
          status,
          statusText: status === 401 ? 'Unauthorized' : 'OK',
          headers: metadataHeaders,
        };
        if (status === 401) {
          reject(new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response));
        } else {
          resolve(response);
        }
      };
      started(config);
    });

  // Replace only the transport, not get/list/captureConnection or either interceptor chain.
  // Cover the existing singleton and any real captured client created by the API layer.
  const instance = (apiClient as unknown as { instance: AxiosInstance }).instance;
  const originalAdapter = instance.defaults.adapter;
  const create = axios.create.bind(axios);
  const createSpy = spyOn(axios, 'create').mockImplementation((config) =>
    create({ ...config, adapter })
  );
  instance.defaults.adapter = adapter;
  restoreTransport = () => {
    instance.defaults.adapter = originalAdapter;
    createSpy.mockRestore();
  };

  return { dispatched, deliver: () => deliver() };
}

function expectOriginalRequest(config: AxiosResponse['config']) {
  expect(config.baseURL).toBe('https://original.invalid/v8/management');
  expect(config.headers.Authorization).toBe('Bearer original-fixture');
  expect(config.url).toBe('/plugins');
  expect(config.method).toBe('get');
}

function expectNormalizedPlugins(result: Awaited<ReturnType<typeof pluginsApi.list>>) {
  expect(result).toMatchObject({
    pluginsEnabled: true,
    pluginsDir: 'custom-plugins',
    plugins: [
      {
        id: 'quota-plugin',
        supportsQuota: true,
        quotaProvider: 'custom',
        logo: '/plugin-logo.svg',
        metadata: { logo: '/plugin-logo.svg' },
      },
    ],
  });
  expect(result.plugins).toHaveLength(1);
}

const switches = [
  {
    name: 'A to B',
    change: () => apiClient.setConfig(connectionB),
  },
  {
    name: 'A to B to A (ABA)',
    change: () => {
      apiClient.setConfig(connectionB);
      apiClient.setConfig(connectionA);
    },
  },
  {
    name: 'key-only replacement',
    change: () => apiClient.setConfig({ ...connectionA, managementKey: 'replacement-fixture' }),
  },
];

describe('plugin list connection isolation through real Axios interceptors', () => {
  for (const { name, change } of switches) {
    test(`late 401 after ${name} does not emit unauthorized or clear current authentication`, async () => {
      const transport = deferPluginResponse(401);
      const request = pluginsApi.list();
      expectOriginalRequest(await transport.dispatched);
      change();
      const currentSession = { ...session };
      transport.deliver();

      await expect(request).rejects.toMatchObject({
        name: 'ApiError',
        status: 401,
        code: 'ERR_BAD_REQUEST',
        apiCode: 'unauthorized',
        message: 'Fixture key rejected',
      });
      expect(events).toEqual([]);
      expect(session).toEqual(currentSession);
      expect(session.isAuthenticated).toBe(true);
    });

    test(`late success after ${name} does not overwrite current server metadata`, async () => {
      const transport = deferPluginResponse(200);
      const request = pluginsApi.list();
      expectOriginalRequest(await transport.dispatched);
      change();
      const currentSession = { ...session };
      transport.deliver();

      expectNormalizedPlugins(await request);
      expect(events).toEqual([]);
      expect(session).toEqual(currentSession);
    });
  }

  test('pins credentials before the asynchronous request interceptor runs', async () => {
    const transport = deferPluginResponse(200);
    const request = pluginsApi.list();
    apiClient.setConfig(connectionB);
    expectOriginalRequest(await transport.dispatched);
    transport.deliver();

    expectNormalizedPlugins(await request);
    expect(events).toEqual([]);
  });

  test('same-connection success retains normalization and all metadata events', async () => {
    const transport = deferPluginResponse(200);
    const request = pluginsApi.list();
    expectOriginalRequest(await transport.dispatched);
    const revision = apiClient.getConnectionRevision();
    apiClient.setConfig(connectionA);
    expect(apiClient.getConnectionRevision()).toBe(revision);
    transport.deliver();

    expectNormalizedPlugins(await request);
    expect(events.map((event) => event.type)).toEqual([
      'server-version-update',
      'server-plugin-support-update',
    ]);
    expect(session).toEqual({
      isAuthenticated: true,
      serverVersion: 'original-version',
      serverBuildDate: 'original-build',
      supportsPlugin: true,
    });
  });

  test('same-connection 401 retains normalized error and emits unauthorized exactly once', async () => {
    const transport = deferPluginResponse(401);
    const request = pluginsApi.list();
    expectOriginalRequest(await transport.dispatched);
    transport.deliver();

    await expect(request).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
      code: 'ERR_BAD_REQUEST',
      apiCode: 'unauthorized',
      message: 'Fixture key rejected',
      details: { error: 'unauthorized', message: 'Fixture key rejected' },
      data: { error: 'unauthorized', message: 'Fixture key rejected' },
    });
    expect(events.map((event) => event.type)).toEqual(['unauthorized']);
    expect(session.isAuthenticated).toBe(false);
  });
});
