import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  clearAllAuthStorage,
  createScopedAuthStorage,
  getAuthLoginStateStorageKey,
  getAuthSelectionStorageKey,
  getScopedAuthStorageKey,
  obfuscatedStorage,
  resolveLegacyAuthApiBase,
} from '../src/services/storage/secureStorage';
import { STORAGE_KEY_AUTH } from '../src/utils/constants';

const values = new Map<string, string>();
const memoryStorage: Storage = {
  get length() {
    return values.size;
  },
  clear: () => values.clear(),
  getItem: (key) => values.get(key) ?? null,
  key: (index) => [...values.keys()][index] ?? null,
  removeItem: (key) => void values.delete(key),
  setItem: (key, value) => void values.set(key, value),
};

const envelope = (apiBase: string, managementKey: string) =>
  JSON.stringify({ state: { apiBase, managementKey, rememberPassword: true }, version: 0 });

beforeEach(() => {
  values.clear();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: memoryStorage });
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { host: 'example.test' } },
  });
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent: 'auth-storage-test' },
  });
});

afterEach(() => {
  values.clear();
});

describe('auth storage isolation', () => {
  test('uses different remembered profiles for same-origin panel subpaths', () => {
    const tenantA = createScopedAuthStorage(() => 'https://example.test/tenant-a');
    const tenantB = createScopedAuthStorage(() => 'https://example.test/tenant-b');

    tenantA.setItem(STORAGE_KEY_AUTH, envelope('https://example.test/tenant-a', 'key-a'));
    tenantB.setItem(STORAGE_KEY_AUTH, envelope('https://example.test/tenant-b', 'key-b'));

    expect(tenantA.getItem(STORAGE_KEY_AUTH)).toContain('key-a');
    expect(tenantA.getItem(STORAGE_KEY_AUTH)).not.toContain('key-b');
    expect(tenantB.getItem(STORAGE_KEY_AUTH)).toContain('key-b');
    expect(
      getScopedAuthStorageKey(
        'https://example.test/tenant-a',
        'https://example.test/backend'
      )
    ).not.toBe(
      getScopedAuthStorageKey(
        'https://example.test/tenant-b',
        'https://example.test/backend'
      )
    );
    expect(getAuthLoginStateStorageKey('https://example.test/tenant-a')).not.toBe(
      getAuthLoginStateStorageKey('https://example.test/tenant-b')
    );
  });

  test('does not migrate or expose a legacy root credential to a same-origin subpath', () => {
    obfuscatedStorage.setItem(
      STORAGE_KEY_AUTH,
      JSON.parse(envelope('https://example.test', 'legacy-key'))
    );
    localStorage.setItem('isLoggedIn', 'true');
    const storage = createScopedAuthStorage(() => 'https://example.test/proxy');

    const restored = storage.getItem(STORAGE_KEY_AUTH);

    expect(restored).toBeNull();
    expect(obfuscatedStorage.getItem(STORAGE_KEY_AUTH)).not.toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBe('true');
    expect(localStorage.getItem(getAuthLoginStateStorageKey('https://example.test/proxy'))).toBeNull();
    expect(obfuscatedStorage.getItem(getAuthSelectionStorageKey('https://example.test/proxy'))).toBeNull();
  });

  test('migrates legacy credentials only when the normalized panel identity is exact', () => {
    obfuscatedStorage.setItem(
      STORAGE_KEY_AUTH,
      JSON.parse(envelope('https://example.test/proxy/v8/management/', 'legacy-key'))
    );
    localStorage.setItem('isLoggedIn', 'true');
    const storage = createScopedAuthStorage(() => 'https://example.test/proxy');

    const restored = storage.getItem(STORAGE_KEY_AUTH);

    expect(restored).toContain('https://example.test/proxy');
    expect(restored).toContain('legacy-key');
    expect(localStorage.getItem(STORAGE_KEY_AUTH)).toBeNull();
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    expect(localStorage.getItem(getAuthLoginStateStorageKey('https://example.test/proxy'))).toBe(
      'true'
    );
  });

  test('does not auto-use an unrelated legacy tenant or origin', () => {
    expect(resolveLegacyAuthApiBase('https://example.test', 'https://example.test/proxy')).toBeNull();
    expect(
      resolveLegacyAuthApiBase(
        'https://example.test/tenant-a',
        'https://example.test/tenant-b'
      )
    ).toBeNull();
    expect(
      resolveLegacyAuthApiBase('https://other.test', 'https://example.test/tenant-b')
    ).toBeNull();
  });

  test('requires a panel-scoped selection even when another panel saved that backend', () => {
    const tenantA = createScopedAuthStorage(() => 'https://example.test/tenant-a');
    const tenantB = createScopedAuthStorage(() => 'https://example.test/tenant-b');
    tenantA.setItem(STORAGE_KEY_AUTH, envelope('https://example.test/tenant-b', 'tenant-a-key'));

    expect(tenantB.getItem(STORAGE_KEY_AUTH)).toBeNull();
  });

  test('two panels sharing one backend keep distinct credential envelopes', () => {
    const tenantA = createScopedAuthStorage(() => 'https://example.test/tenant-a');
    const tenantB = createScopedAuthStorage(() => 'https://example.test/tenant-b');
    const backend = 'https://api.example.test/shared';

    tenantA.setItem(STORAGE_KEY_AUTH, envelope(backend, 'key-from-a'));
    tenantB.setItem(STORAGE_KEY_AUTH, envelope(backend, 'key-from-b'));

    expect(tenantA.getItem(STORAGE_KEY_AUTH)).toContain('key-from-a');
    expect(tenantA.getItem(STORAGE_KEY_AUTH)).not.toContain('key-from-b');
    expect(tenantB.getItem(STORAGE_KEY_AUTH)).toContain('key-from-b');
    expect(tenantB.getItem(STORAGE_KEY_AUTH)).not.toContain('key-from-a');
  });

  test.each(['enc::v1::obsolete', '{"state":{"managementKey":"old-key"}}'])(
    'retires obsolete scoped credentials without exposing another panel: %s',
    (raw) => {
      const panel = 'https://example.test/tenant-a';
      const backend = 'https://api.example.test/shared';
      const tenantA = createScopedAuthStorage(() => panel);
      const tenantB = createScopedAuthStorage(() => 'https://example.test/tenant-b');
      tenantA.setItem(STORAGE_KEY_AUTH, envelope(backend, 'key-a'));
      tenantB.setItem(STORAGE_KEY_AUTH, envelope(backend, 'key-b'));
      localStorage.setItem(getScopedAuthStorageKey(panel, backend), raw);
      localStorage.setItem(getAuthLoginStateStorageKey(panel), 'true');

      expect(tenantA.getItem(STORAGE_KEY_AUTH)).toBeNull();
      expect(localStorage.getItem(getScopedAuthStorageKey(panel, backend))).toBeNull();
      expect(localStorage.getItem(getAuthLoginStateStorageKey(panel))).toBeNull();
      expect(tenantB.getItem(STORAGE_KEY_AUTH)).toContain('key-b');
    }
  );

  test('clears every scoped and legacy auth record while preserving unrelated storage', () => {
    const tenantA = createScopedAuthStorage(() => 'https://example.test/tenant-a');
    const tenantB = createScopedAuthStorage(() => 'https://example.test/tenant-b');
    tenantA.setItem(STORAGE_KEY_AUTH, envelope('https://api.example.test/shared', 'key-a'));
    tenantB.setItem(STORAGE_KEY_AUTH, envelope('https://api.example.test/shared', 'key-b'));
    localStorage.setItem(getAuthLoginStateStorageKey('https://example.test/tenant-a'), 'true');
    localStorage.setItem(getAuthLoginStateStorageKey('https://example.test/tenant-b'), 'true');
    localStorage.setItem(STORAGE_KEY_AUTH, 'legacy-envelope');
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('apiBase', 'legacy-base');
    localStorage.setItem('apiUrl', 'legacy-url');
    localStorage.setItem('managementKey', 'legacy-key');
    localStorage.setItem('unrelated-setting', 'keep-me');

    clearAllAuthStorage();

    expect([...values.keys()].filter((key) => key.startsWith('cli-proxy-auth'))).toEqual([]);
    expect(localStorage.getItem('isLoggedIn')).toBeNull();
    expect(localStorage.getItem('apiBase')).toBeNull();
    expect(localStorage.getItem('apiUrl')).toBeNull();
    expect(localStorage.getItem('managementKey')).toBeNull();
    expect(localStorage.getItem('unrelated-setting')).toBe('keep-me');
  });
});
