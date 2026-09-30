import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { readApiKeyNames, saveApiKeyName } from '../src/features/config/apiKeyNames';
import { obfuscatedStorage } from '../src/services/storage/secureStorage';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('local API key names', () => {
  test('persists optional names by server and key, not list position', () => {
    expect(saveApiKeyName('https://one.test', 'fixture-key-a', ' Alice ')).toBe(true);
    saveApiKeyName('https://one.test', 'fixture-key-b', 'Bob');
    saveApiKeyName('https://two.test', 'fixture-key-a', 'Other');
    expect(readApiKeyNames('https://one.test')).toEqual({
      'fixture-key-a': 'Alice',
      'fixture-key-b': 'Bob',
    });
    expect(readApiKeyNames('https://two.test')['fixture-key-a']).toBe('Other');
    expect([...values.values()].join('')).not.toContain('fixture-key-a');
  });

  test('clears names without removing other entries', () => {
    saveApiKeyName('server', 'one', 'First');
    saveApiKeyName('server', 'two', 'Second');
    saveApiKeyName('server', 'one', '  ');
    expect(readApiKeyNames('server')).toEqual({ two: 'Second' });
    saveApiKeyName('server', 'two', '');
    expect(values.size).toBe(0);
  });

  test('handles special property names', () => {
    saveApiKeyName('server', '__proto__', 'Special');
    expect(Object.hasOwn(readApiKeyNames('server'), '__proto__')).toBe(true);
    expect(readApiKeyNames('server')['__proto__']).toBe('Special');
  });

  test('ignores malformed data and invalid entries', () => {
    values.set('api-key-names:v1:server', '{invalid');
    expect(readApiKeyNames('server')).toEqual({});
    obfuscatedStorage.setItem('api-key-names:v1:server', { valid: 'Name', bad: 4, empty: '' });
    expect(readApiKeyNames('server')).toEqual({ valid: 'Name' });
    obfuscatedStorage.setItem('api-key-names:v1:server', ['Name']);
    expect(readApiKeyNames('server')).toEqual({});
  });

  test('reports unavailable storage instead of throwing', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('Storage blocked');
      },
    });
    expect(readApiKeyNames('server')).toEqual({});
    expect(saveApiKeyName('server', 'key', 'Name')).toBe(false);
  });
});
