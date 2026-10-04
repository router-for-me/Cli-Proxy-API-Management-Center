import { expect, test, spyOn } from 'bun:test';
import { AxiosError, type InternalAxiosRequestConfig } from 'axios';
import { apiClient } from '../src/services/api/client';
test('an in-flight old connection 401 cannot log out a newer connection; current 401 is safely diagnosed once', async () => {
  const originalWindow = globalThis.window;
  const target = new EventTarget();
  globalThis.window = target as unknown as Window & typeof globalThis;
  let unauthorized = 0;
  target.addEventListener('unauthorized', () => unauthorized++);
  const warning = spyOn(console, 'warn').mockImplementation(() => {});
  // Use the real request/response interceptors with a local adapter: no network traffic.
  let rejectOld: (() => void) | undefined;
  let started: (() => void) | undefined;
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  try {
    apiClient.setConfig({ apiBase: 'http://fixture-a', managementKey: 'secret-fixture' });
    const old = apiClient
      .get('/credentials', {
        adapter: (config) =>
          new Promise((_, reject) => {
            rejectOld = () =>
              reject(
                new AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined, {
                  status: 401,
                  data: { error: 'invalid management key' },
                  headers: {},
                  config,
                  statusText: 'Unauthorized',
                })
              );
            started!();
          }),
      })
      .catch(() => {});
    await requestStarted;
    apiClient.setConfig({ apiBase: 'http://fixture-b', managementKey: 'other-secret' });
    apiClient.setConfig({ apiBase: 'http://fixture-a', managementKey: 'secret-fixture' });
    expect(rejectOld).toBeDefined();
    rejectOld!();
    await old;
    expect(unauthorized).toBe(0);
    await apiClient.post(
      '/api-call',
      {},
      {
        adapter: async (config) => ({
          status: 200,
          data: { status_code: 401, body: 'provider rejected' },
          headers: {},
          config,
          statusText: 'OK',
        }),
      }
    );
    await apiClient
      .post(
        '/credentials/refresh',
        {},
        {
          adapter: async (config) => {
            throw new AxiosError('provider expired', 'ERR_BAD_RESPONSE', config, undefined, {
              status: 500,
              data: { error: 'provider_reauthentication_required' },
              headers: {},
              config,
              statusText: 'Error',
            });
          },
        }
      )
      .catch(() => {});
    expect(unauthorized).toBe(0);
    const adapter = async (config: InternalAxiosRequestConfig) => {
      throw new AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined, {
        status: 401,
        data: { secret: 'body-secret' },
        headers: {},
        config,
        statusText: 'Unauthorized',
      });
    };
    for (let i = 0; i < 2; i++)
      await apiClient
        .get('/credentials/download?name=private@example.com&token=query-secret', { adapter })
        .catch(() => {});
    expect(unauthorized).toBe(2);
    expect(warning).toHaveBeenCalledTimes(1);
    const diagnostic = JSON.stringify(warning.mock.calls);
    for (const value of ['private@', 'secret', 'Bearer', 'http://fixture'])
      expect(diagnostic).not.toContain(value);
    expect(diagnostic).toContain('401');
  } finally {
    warning.mockRestore();
    globalThis.window = originalWindow;
    apiClient.setConfig({ apiBase: '', managementKey: '' });
  }
});
