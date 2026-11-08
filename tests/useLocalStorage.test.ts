import { afterAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { useLocalStorage } from '@/hooks/useLocalStorage';

/** Test files share one process, so restore the real `window` afterwards. */
const originalWindow = (globalThis as { window?: unknown }).window;

function installLocalStorage(entries: Record<string, string>) {
  const store = new Map(Object.entries(entries));
  (globalThis as unknown as { window: unknown }).window = {
    localStorage: { getItem: (key: string) => store.get(key) ?? null },
  };
}

function renderValue(initialValue: boolean | (() => boolean)) {
  function Probe() {
    const [value] = useLocalStorage('probe', initialValue);
    return createElement('output', null, String(value));
  }
  return renderToStaticMarkup(createElement(Probe));
}

afterAll(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('useLocalStorage', () => {
  test('calls a function initial value when nothing is stored', () => {
    installLocalStorage({});
    expect(renderValue(() => true)).toBe('<output>true</output>');
  });

  test('keeps a stored value over a function initial value', () => {
    installLocalStorage({ probe: 'false' });
    let called = false;
    const markup = renderValue(() => {
      called = true;
      return true;
    });
    expect(markup).toBe('<output>false</output>');
    expect(called).toBe(false);
  });
});
