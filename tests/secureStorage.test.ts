import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { obfuscatedStorage } from '../src/services/storage/secureStorage';
import { deobfuscateData, isObfuscated, obfuscateData } from '../src/utils/encryption';

const host = 'proxy.example:8317';
const oldUserAgent = 'Mozilla/5.0 Firefox/158.0';
const newUserAgent = 'Mozilla/5.0 Firefox/159.0';
// Long enough to exercise the user-agent portion of the old XOR key.
const session = {
  state: {
    apiBase: 'https://proxy.example:8317',
    managementKey: 'test-only-management-key-for-browser-upgrade-regression',
    rememberPassword: true,
  },
  version: 0,
};

// Independent fixture encoder matching the historical v1 format.
function legacyPayload(value: string, userAgent = oldUserAgent): string {
  const encoder = new TextEncoder();
  const key = encoder.encode(`cli-proxy-api-webui::secure-storage|${host}|${userAgent}`);
  const bytes = encoder.encode(value);
  const binary = Array.from(bytes, (byte, index) =>
    String.fromCharCode(byte ^ key[index % key.length])
  ).join('');
  return `enc::v1::${btoa(binary)}`;
}

const originalGlobals = new Map(
  ['window', 'navigator', 'localStorage'].map((name) => [
    name,
    Object.getOwnPropertyDescriptor(globalThis, name),
  ])
);
let stored: Map<string, string>;
let failWrites: boolean;

function setUserAgent(userAgent: string): void {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent } });
}

beforeEach(() => {
  stored = new Map();
  failWrites = false;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { host } },
  });
  setUserAgent(oldUserAgent);
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failWrites) throw new Error('Storage is read-only');
        stored.set(key, value);
      },
      removeItem: (key: string) => stored.delete(key),
    },
  });
});

afterEach(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else Reflect.deleteProperty(globalThis, name);
  }
});

describe('saved login obfuscation', () => {
  test('saved sessions survive a browser update and a fresh module load', async () => {
    // Isolate both loads from modules initialized by other suites without browser globals.
    const beforePath = '../src/utils/encryption.ts?before-browser-upgrade';
    const beforeReload = await import(beforePath);
    const saved = beforeReload.obfuscateData(JSON.stringify(session));
    expect(saved.startsWith('enc::v2::')).toBe(true);
    setUserAgent(newUserAgent);
    // A fresh module models a page reload, without reusing a cached pre-update key.
    const modulePath = '../src/utils/encryption.ts?browser-upgrade';
    const afterReload = await import(modulePath);
    expect(JSON.parse(afterReload.deobfuscateData(saved))).toEqual(session);
    expect(afterReload.obfuscateData(JSON.stringify(session))).toBe(saved);
  });

  test('reads v1 values and migrates them before the browser updates', () => {
    stored.set('auth', legacyPayload(JSON.stringify(session)));
    expect(obfuscatedStorage.getItem('auth')).toEqual(session);
    expect(stored.get('auth')!.startsWith('enc::v2::')).toBe(true);
    setUserAgent(newUserAgent);
    expect(obfuscatedStorage.getItem('auth')).toEqual(session);
  });

  test('migration write failures do not prevent reading an existing session', () => {
    const saved = legacyPayload(JSON.stringify(session));
    stored.set('auth', saved);
    failWrites = true;
    expect(obfuscatedStorage.getItem('auth')).toEqual(session);
    expect(stored.get('auth')).toBe(saved);
  });

  test('does not overwrite v1 data that no longer parses after an update', () => {
    const saved = legacyPayload(JSON.stringify(session));
    stored.set('auth', saved);
    setUserAgent(newUserAgent);
    expect(() => JSON.parse(deobfuscateData(saved))).toThrow();
    obfuscatedStorage.getItem('auth');
    expect(stored.get('auth')).toBe(saved);
  });

  test('keeps both version prefixes obfuscated during plaintext migration', () => {
    const saved = legacyPayload(JSON.stringify(session));
    expect(isObfuscated(saved)).toBe(true);
    expect(isObfuscated(obfuscateData('value'))).toBe(true);
    stored.set('auth', saved);
    obfuscatedStorage.migratePlaintextKeys(['auth']);
    expect(stored.get('auth')).toBe(saved);
  });

  test('preserves plaintext, empty, Unicode and legacy string values', () => {
    expect(deobfuscateData('plain')).toBe('plain');
    expect(obfuscateData('')).toBe('');
    expect(deobfuscateData('')).toBe('');
    expect(isObfuscated('plain')).toBe(false);
    expect(deobfuscateData(obfuscateData('测试 🔑'))).toBe('测试 🔑');
    expect(deobfuscateData(legacyPayload('测试 🔑'))).toBe('测试 🔑');
    stored.set('legacy-string', legacyPayload('old plain string'));
    expect(obfuscatedStorage.getItem('legacy-string')).toBe('old plain string');
    stored.set('plain', JSON.stringify(session));
    expect(obfuscatedStorage.getItem('plain', { obfuscate: false })).toEqual(session);
    expect(obfuscatedStorage.getItem('missing')).toBeNull();
  });
});
