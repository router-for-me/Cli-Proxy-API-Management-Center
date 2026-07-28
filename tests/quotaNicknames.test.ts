import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  QUOTA_NICKNAME_STORAGE_KEY,
  readNicknames,
  resolveDisplayName,
  writeNickname,
} from '../src/components/quota/quotaNicknames';

/**
 * Minimal localStorage stand-in — bun:test has no DOM.
 *
 * Preserves any pre-existing `window` and restores it afterwards: tests share
 * one process, and a bare stub left on globalThis breaks other suites whose
 * modules call window.addEventListener at import time.
 */
const originalWindow = (globalThis as { window?: unknown }).window;

const installStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  (globalThis as { window?: unknown }).window = {
    ...(typeof originalWindow === 'object' && originalWindow !== null ? originalWindow : {}),
    localStorage: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    },
  };
  return data;
};

const restoreWindow = () => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
};

afterAll(restoreWindow);

describe('quota nicknames', () => {
  beforeEach(() => installStorage());

  test('round-trips a nickname through storage', () => {
    const data = installStorage();
    const next = writeNickname({}, 'claude-alice.json', 'Alice · design');

    expect(next['claude-alice.json']).toBe('Alice · design');
    expect(JSON.parse(data.get(QUOTA_NICKNAME_STORAGE_KEY)!)).toEqual({
      'claude-alice.json': 'Alice · design',
    });
    expect(readNicknames()).toEqual({ 'claude-alice.json': 'Alice · design' });
  });

  test('clearing a nickname removes it rather than storing an empty string', () => {
    const start = writeNickname({}, 'a.json', 'Alice');
    const cleared = writeNickname(start, 'a.json', '   ');

    expect(cleared).toEqual({});
    expect(readNicknames()).toEqual({});
  });

  test('trims surrounding whitespace', () => {
    expect(writeNickname({}, 'a.json', '  Bob · research  ')).toEqual({
      'a.json': 'Bob · research',
    });
  });

  test('ignores malformed or non-string stored values', () => {
    installStorage({ [QUOTA_NICKNAME_STORAGE_KEY]: '{"a.json": 42, "b.json": "ok", "c":""}' });
    expect(readNicknames()).toEqual({ 'b.json': 'ok' });

    installStorage({ [QUOTA_NICKNAME_STORAGE_KEY]: 'not json' });
    expect(readNicknames()).toEqual({});

    installStorage({ [QUOTA_NICKNAME_STORAGE_KEY]: '["array"]' });
    expect(readNicknames()).toEqual({});
  });

  test('survives storage being unavailable', () => {
    (globalThis as { window?: unknown }).window = {
      ...(typeof originalWindow === 'object' && originalWindow !== null ? originalWindow : {}),
      localStorage: {
        getItem: () => {
          throw new Error('denied');
        },
        setItem: () => {
          throw new Error('denied');
        },
      },
    };

    expect(readNicknames()).toEqual({});
    // The in-memory map still updates, so the rename applies for this session.
    expect(writeNickname({}, 'a.json', 'Alice')).toEqual({ 'a.json': 'Alice' });
  });
});

describe('resolveDisplayName precedence', () => {
  test('nickname beats label and email', () => {
    expect(
      resolveDisplayName('a.json', 'alice@example.com', 'alice@example.com', {
        'a.json': 'Alice · design',
      })
    ).toBe('Alice · design');
  });

  test('falls back to label, then email, then the filename', () => {
    expect(resolveDisplayName('a.json', 'alice@example.com', undefined, {})).toBe(
      'alice@example.com'
    );
    expect(resolveDisplayName('a.json', '   ', 'bob@example.com', {})).toBe('bob@example.com');
    expect(resolveDisplayName('a.json', undefined, undefined, {})).toBe('a.json');
  });

  test('a nickname for another credential does not leak', () => {
    expect(resolveDisplayName('b.json', 'bob@example.com', undefined, { 'a.json': 'Alice' })).toBe(
      'bob@example.com'
    );
  });
});
