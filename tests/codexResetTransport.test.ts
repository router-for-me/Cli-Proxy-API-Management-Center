import { afterEach, describe, expect, test } from 'bun:test';
import { AxiosError, type AxiosResponse } from 'axios';
import { ApiClient, apiClient, RequestNotSentError } from '@/services/api/client';
import { apiCallApi } from '@/services/api/apiCall';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

const recordEvents = (): string[] => {
  const events: string[] = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  return events;
};

describe('Codex reset connection transport', () => {
  test.each([false, true])('rejects queued requests before dispatch (ABA=%s)', async (aba) => {
    const client = new ApiClient();
    client.setConfig({ apiBase: 'http://old.test', managementKey: 'fixture-old' });
    const revision = client.getConnectionRevision();
    let dispatches = 0;
    const pending = client.post(
      '/requests/api-call',
      {},
      {
        expectedConnectionRevision: revision,
        adapter: async (config) => {
          dispatches += 1;
          return { config, data: {}, status: 200, statusText: 'OK', headers: {} };
        },
      }
    );
    client.setConfig({ apiBase: 'http://new.test', managementKey: 'fixture-new' });
    if (aba) client.setConfig({ apiBase: 'http://old.test', managementKey: 'fixture-old' });
    await expect(pending).rejects.toBeInstanceOf(RequestNotSentError);
    expect(dispatches).toBe(0);
  });

  for (const guarded of [true, false]) {
    for (const status of [200, 401]) {
      test(`old response keeps expected event behavior (guarded=${guarded}, status=${status})`, async () => {
        const events = recordEvents();
        const client = new ApiClient();
        client.setConfig({ apiBase: 'http://old.test', managementKey: 'fixture-old' });
        let onDispatched!: () => void;
        const dispatched = new Promise<void>((resolve) => {
          onDispatched = resolve;
        });
        let deliver!: () => void;
        const pending = client.get('/credentials', {
          ...(guarded ? { expectedConnectionRevision: client.getConnectionRevision() } : {}),
          adapter: (config) =>
            new Promise<AxiosResponse>((resolve, reject) => {
              expect(config.baseURL).toBe('http://old.test/v8/management');
              expect(config.headers.Authorization).toBe('Bearer fixture-old');
              deliver = () => {
                const response: AxiosResponse = {
                  config,
                  data: {},
                  status,
                  statusText: String(status),
                  headers: { 'X-CPA-Version': 'old-server', 'X-CPA-Support-Plugin': 'true' },
                };
                if (status === 401) {
                  reject(
                    new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, response)
                  );
                } else resolve(response);
              };
              onDispatched();
            }),
        });
        await dispatched;
        client.setConfig({ apiBase: 'http://new.test', managementKey: 'fixture-new' });
        deliver();
        if (status === 401) await expect(pending).rejects.toHaveProperty('status', 401);
        else await expect(pending).resolves.toEqual({});
        expect(events).toEqual(
          guarded
            ? []
            : status === 401
              ? ['unauthorized']
              : ['server-version-update', 'server-plugin-support-update']
        );
      });
    }
  }

  test('current guarded requests continue to publish server metadata', async () => {
    const events = recordEvents();
    const client = new ApiClient();
    client.setConfig({ apiBase: 'http://current.test', managementKey: 'fixture-current' });
    await client.get('/credentials', {
      expectedConnectionRevision: client.getConnectionRevision(),
      adapter: async (config) => ({
        config,
        data: {},
        status: 200,
        statusText: 'OK',
        headers: { 'X-CPA-Version': 'current-server', 'X-CPA-Support-Plugin': 'false' },
      }),
    });
    expect(events).toEqual(['server-version-update', 'server-plugin-support-update']);
  });

  test('the API-call wrapper preserves the dedicated local rejection', async () => {
    let dispatches = 0;
    await expect(
      apiCallApi.request(
        { method: 'POST', url: 'https://upstream.test' },
        {
          expectedConnectionRevision: apiClient.getConnectionRevision() - 1,
          adapter: async (config) => {
            dispatches += 1;
            return { config, data: {}, status: 200, statusText: 'OK', headers: {} };
          },
        }
      )
    ).rejects.toBeInstanceOf(RequestNotSentError);
    expect(dispatches).toBe(0);
  });

  test('connection scope survives reload and normalization without revealing its key', () => {
    const beforeReload = new ApiClient();
    const afterReload = new ApiClient();
    beforeReload.setConfig({ apiBase: 'http://same.test/', managementKey: 'fixture-secret' });
    afterReload.setConfig({
      apiBase: 'http://same.test/v8/management',
      managementKey: 'fixture-secret',
    });
    const scope = beforeReload.getConnectionScope();
    expect(scope).toMatch(/^[a-f0-9]{64}$/);
    expect(afterReload.getConnectionScope()).toBe(scope);
    afterReload.setConfig({ apiBase: 'http://same.test', managementKey: 'different-key' });
    expect(afterReload.getConnectionScope()).not.toBe(scope);
    afterReload.setConfig({ apiBase: 'http://different.test', managementKey: 'fixture-secret' });
    expect(afterReload.getConnectionScope()).not.toBe(scope);
  });
});
