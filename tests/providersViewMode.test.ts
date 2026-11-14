import { afterEach, describe, expect, test } from 'bun:test';
import {
  readProvidersWorkbenchUiState,
  writeProvidersWorkbenchUiState,
} from '@/features/providers/uiState';

const originalWindow = globalThis.window;
afterEach(() => {
  globalThis.window = originalWindow;
});

const withStorage = (store: Map<string, string>) => {
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    },
  } as unknown as Window & typeof globalThis;
};

describe('gemini view mode persistence', () => {
  test('defaults to flat when storage is empty', () => {
    withStorage(new Map());
    expect(readProvidersWorkbenchUiState().geminiViewMode).toBe('flat');
  });

  test('round-trips group mode', () => {
    const store = new Map<string, string>();
    withStorage(store);
    writeProvidersWorkbenchUiState({
      activeBrand: 'gemini',
      filtersByBrand: {},
      geminiViewMode: 'group',
    });
    expect(readProvidersWorkbenchUiState().geminiViewMode).toBe('group');
  });

  test('invalid stored value falls back to flat', () => {
    const store = new Map<string, string>([
      ['providersPage.uiState', JSON.stringify({ geminiViewMode: 'nope' })],
    ]);
    withStorage(store);
    expect(readProvidersWorkbenchUiState().geminiViewMode).toBe('flat');
  });

  test('keeps active brand and filters while adding the view mode', () => {
    const store = new Map<string, string>([
      [
        'providersPage.uiState',
        JSON.stringify({
          activeBrand: 'codex',
          filtersByBrand: { codex: { filter: 'gpt', sortBy: 'priority', sortDir: 'desc', selectedModels: [] } },
          geminiViewMode: 'group',
        }),
      ],
    ]);
    withStorage(store);
    const state = readProvidersWorkbenchUiState();
    expect(state.activeBrand).toBe('codex');
    expect(state.filtersByBrand.codex?.filter).toBe('gpt');
    expect(state.geminiViewMode).toBe('group');
  });
});
