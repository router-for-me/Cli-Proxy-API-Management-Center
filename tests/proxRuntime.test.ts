import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveConnectionSources } from '../src/domain/providerSources/resolution';
import { loadSourceManifest } from '../server/providerSources/config';
import { useAuthStore } from '../src/stores/useAuthStore';
import { useConfigStore } from '../src/stores/useConfigStore';
import { apiClient } from '../src/services/api/client';

describe('Prox management runtime routes', () => {
  const { discovery } = loadSourceManifest(
    new URL('../deploy/provider-sources.json', import.meta.url).pathname
  );
  test('root aliases resolve to the same enumerated owner', () => {
    const origin = 'https://prox.example.test';
    for (const path of ['', '/codex', '/claude', '/claude/v8/management', '/gemini']) {
      const result = resolveConnectionSources(origin + path, origin, discovery);
      expect(result.selectedInstanceId).toBe(
        path.startsWith('/claude')
          ? 'claude-primary'
          : path.startsWith('/gemini')
            ? 'gemini-primary'
            : 'codex-primary'
      );
      expect(result.sources).toHaveLength(3);
    }
  });
  test('does not invent sibling routes for arbitrary backend connections', () => {
    expect(
      resolveConnectionSources('http://localhost:8317', 'http://localhost:18318', discovery).mode
    ).toBe('external');
    expect(
      resolveConnectionSources(
        'https://prox.example.test/other',
        'https://prox.example.test',
        discovery
      ).mode
    ).toBe('external');
    expect(() => resolveConnectionSources('', 'https://prox.example.test', discovery)).toThrow();
  });
});

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const originalFetch = useConfigStore.getState().fetchConfig;
const originalState = useAuthStore.getState();
const originalStorage = useAuthStore.persist.getOptions().storage;
const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
afterEach(() => {
  useConfigStore.setState({ fetchConfig: originalFetch });
  useAuthStore.setState(originalState);
  apiClient.setConfig({
    apiBase: originalState.apiBase,
    managementKey: originalState.managementKey,
  });
  useAuthStore.persist.setOptions({ storage: originalStorage });
  if (localStorageDescriptor)
    Object.defineProperty(globalThis, 'localStorage', localStorageDescriptor);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
function prepare() {
  useAuthStore.persist.setOptions({
    storage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { setItem() {}, removeItem() {} },
  });
}
beforeEach(prepare);
test('a pending runtime switch cannot log a user back in after logout', async () => {
  prepare();
  const pending = deferred();
  useConfigStore.setState({
    fetchConfig: async () => {
      await pending.promise;
      return {};
    },
  });
  const login = useAuthStore
    .getState()
    .login({ apiBase: 'https://prox.example.test/claude', managementKey: 'fixture' });
  useAuthStore.getState().logout();
  pending.resolve();
  await expect(login).rejects.toThrow('Connection changed');
  expect(useAuthStore.getState().isAuthenticated).toBe(false);
  expect(useAuthStore.getState().connectionStatus).toBe('disconnected');
});
test('a superseded runtime login cannot overwrite the latest provider selection', async () => {
  prepare();
  const old = deferred();
  let calls = 0;
  useConfigStore.setState({
    fetchConfig: async () => {
      if (++calls === 1) await old.promise;
      return {};
    },
  });
  const first = useAuthStore
    .getState()
    .login({ apiBase: 'https://prox.example.test/codex', managementKey: 'fixture' });
  await useAuthStore
    .getState()
    .login({ apiBase: 'https://prox.example.test/claude', managementKey: 'fixture' });
  old.resolve();
  await expect(first).rejects.toThrow('Connection changed');
  expect(useAuthStore.getState().apiBase).toBe('https://prox.example.test/claude');
  expect(useAuthStore.getState().connectionStatus).toBe('connected');
});
