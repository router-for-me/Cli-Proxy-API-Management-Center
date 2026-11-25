import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from 'bun:test';
import axios from 'axios';
import type { Config } from '@/types';
import { apiClient } from '@/services/api/client';
import { LegacyBackendError } from '@/services/api/legacyBackendProbe';
import { useAuthStore } from '@/stores/useAuthStore';
import { useConfigStore } from '@/stores/useConfigStore';

const spies: Array<{ mockRestore(): void }> = [];
const originalFetchConfig = useConfigStore.getState().fetchConfig;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
const memory = new Map<string, string>();
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => memory.set(key, value),
      removeItem: (key: string) => memory.delete(key),
    },
  });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { host: 'proxy.invalid' } },
  });
});
afterAll(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});
afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  // Zustand replaces its state object; mockRestore alone can leave the mocked action in new states.
  useConfigStore.setState({ fetchConfig: originalFetchConfig });
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  useAuthStore.setState({ isAuthenticated: false, connectionStatus: 'disconnected' });
});

const credentials = {
  apiBase: 'https://proxy.invalid/gateway',
  managementKey: 'fixture-only',
  rememberPassword: false,
};

describe('legacy backend login diagnostic', () => {
  test('confirms v0 config after v8 404 without logging in', async () => {
    const v8Error = Object.assign(new Error('not found'), { status: 404 });
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockRejectedValue(v8Error));
    const probe = spyOn(axios, 'get').mockResolvedValue({ data: { 'api-keys': [] } });
    spies.push(probe);

    await expect(useAuthStore.getState().login(credentials)).rejects.toBeInstanceOf(
      LegacyBackendError
    );
    expect(probe).toHaveBeenCalledTimes(1);
    expect(probe).toHaveBeenCalledWith(
      'https://proxy.invalid/gateway/v0/management/config',
      expect.objectContaining({ headers: { Authorization: 'Bearer fixture-only' }, timeout: 3000 })
    );
    expect(useAuthStore.getState().isAuthenticated).toBe(false);
  });

  test('does not diagnose auth failures as old backend', async () => {
    const error = Object.assign(new Error('unauthorized'), { status: 401 });
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockRejectedValue(error));
    const probe = spyOn(axios, 'get');
    spies.push(probe);
    await expect(useAuthStore.getState().login(credentials)).rejects.toBe(error);
    expect(probe).not.toHaveBeenCalled();
  });

  test('keeps the original 404 when the v0 request fails or returns non-config content', async () => {
    const error = Object.assign(new Error('not found'), { status: 404 });
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockRejectedValue(error));
    const probe = spyOn(axios, 'get').mockResolvedValueOnce({ data: '<html>not a config</html>' });
    spies.push(probe);
    await expect(useAuthStore.getState().login(credentials)).rejects.toBe(error);
    probe.mockRejectedValueOnce(new Error('network unavailable'));
    await expect(useAuthStore.getState().login(credentials)).rejects.toBe(error);
  });

  test('does not publish an obsolete diagnostic after a connection switch', async () => {
    const error = Object.assign(new Error('not found'), { status: 404 });
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockRejectedValue(error));
    const probe = spyOn(axios, 'get').mockImplementation(async () => {
      apiClient.setConfig({ apiBase: 'https://new.invalid', managementKey: 'other' });
      return { data: {} };
    });
    spies.push(probe);
    await expect(useAuthStore.getState().login(credentials)).rejects.toBe(error);
  });
});

describe('login attempt ownership', () => {
  test('logout while config is pending cannot restore the login or its remember flag', async () => {
    const pending = Promise.withResolvers<Config>();
    spies.push(spyOn(useConfigStore.getState(), 'fetchConfig').mockReturnValue(pending.promise));
    const login = useAuthStore.getState().login({ ...credentials, rememberPassword: true });
    useAuthStore.getState().logout();
    pending.resolve({});
    await expect(login).rejects.toThrow();
    expect(useAuthStore.getState()).toMatchObject({
      isAuthenticated: false,
      connectionStatus: 'disconnected',
      managementKey: '',
    });
    expect(memory.has('isLoggedIn')).toBe(false);
  });

  test.each(['before', 'during'] as const)(
    'same-credential retry %s a legacy probe owns the result',
    async (timing) => {
      const missing = Object.assign(new Error('not found'), { status: 404 });
      const config = Promise.withResolvers<Config>();
      const started = Promise.withResolvers<void>();
      const diagnosis = Promise.withResolvers<{ data: object }>();
      spies.push(
        spyOn(useConfigStore.getState(), 'fetchConfig')
          .mockReturnValueOnce(config.promise)
          .mockResolvedValue({})
      );
      const probe = spyOn(axios, 'get').mockImplementation(() => {
        started.resolve();
        return diagnosis.promise;
      });
      spies.push(probe);
      const old = useAuthStore.getState().login(credentials);
      if (timing === 'during') {
        config.reject(missing);
        await started.promise;
      }
      await useAuthStore.getState().login(credentials);
      config.reject(missing);
      diagnosis.resolve({ data: {} });
      await expect(old).rejects.toBe(missing);
      expect(probe).toHaveBeenCalledTimes(timing === 'before' ? 0 : 1);
      expect(useAuthStore.getState().connectionStatus).toBe('connected');
    }
  );

  test.each([false, true])(
    '401 keeps its error without logging out a newer login (retry=%s)',
    async (retry) => {
      const release = Promise.withResolvers<void>();
      const events: string[] = [];
      Object.assign(window, {
        dispatchEvent(event: Event) {
          events.push(event.type);
          if (event.type === 'unauthorized') useAuthStore.getState().logout();
          return true;
        },
      });
      spies.push(
        spyOn(useConfigStore.getState(), 'fetchConfig')
          .mockImplementationOnce(() =>
            apiClient.get('/config', {
              adapter: async (config) => {
                await release.promise;
                throw {
                  isAxiosError: true,
                  message: 'Key rejected',
                  config,
                  response: { status: 401 },
                };
              },
            })
          )
          .mockResolvedValue({})
      );
      const old = useAuthStore.getState().login(credentials);
      if (retry) await useAuthStore.getState().login(credentials);
      release.resolve();
      await expect(old).rejects.toMatchObject({ status: 401, message: 'Key rejected' });
      expect(events).toEqual(retry ? [] : ['unauthorized']);
      expect(useAuthStore.getState().connectionStatus).toBe(retry ? 'connected' : 'disconnected');
    }
  );
});
