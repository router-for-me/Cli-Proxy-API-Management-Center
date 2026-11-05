import { describe, expect, test } from 'bun:test';
import {
  ollamaConnectionEntries,
  OLLAMA_CONFIG,
} from '../src/features/quota/providers/ollama/data';
import { classifyQuotaFiles } from '../src/features/quota/logic';
import { getQuotaCacheKey } from '../src/utils/quota/identity';
import { useQuotaStore } from '../src/stores/useQuotaStore';
import { isPluginQuotaFile } from '../src/utils/quota/validators';
import { normalizeOllamaConnections, normalizeOllamaQuota } from '../src/services/api/ollamaQuota';
import { selectOllamaRange } from '../src/features/quota/providers/ollama/data';

describe('Ollama Cloud quota connections', () => {
  test('uses secret-free connection resources without creating OAuth credentials', () => {
    const entries = ollamaConnectionEntries([{ connection_id: 'cloud', display_name: 'Cloud' }]);
    expect(classifyQuotaFiles(entries).map((entry) => entry.type)).toEqual(['ollama']);
    expect(entries[0].ollamaConnectionId).toBe('cloud');
    expect(JSON.stringify(entries)).not.toContain('api_key');
    expect(isPluginQuotaFile(entries[0])).toBe(false);
    expect(OLLAMA_CONFIG.filterFn({ name: 'Local', provider: 'ollama' })).toBe(false);
  });

  test('isolates connection cache identities even when labels collide', () => {
    const entries = ollamaConnectionEntries([
      { connection_id: 'one', display_name: 'Same' },
      { connection_id: 'two', display_name: 'Same' },
    ]);
    expect(getQuotaCacheKey(entries[0])).not.toBe(getQuotaCacheKey(entries[1]));
    expect(getQuotaCacheKey(entries[0])).not.toBe('Same');
  });

  test('logout clears Ollama quota state', () => {
    useQuotaStore.getState().setOllamaQuota({ cloud: { status: 'loading' } });
    useQuotaStore.getState().clearQuotaCache();
    expect(useQuotaStore.getState().ollamaQuota).toEqual({});
  });

  test('rejects malformed discovery and mismatched quota identity', () => {
    for (const value of [{}, null, { connections: [{}] }, { connections: null }]) {
      expect(() => normalizeOllamaConnections(value)).toThrow();
    }
    expect(() => normalizeOllamaQuota({ connection_id: 'wrong' }, 'expected', '7d')).toThrow();
  });

  test('range and refresh share loading state and retain the selected range', () => {
    const file = ollamaConnectionEntries([{ connection_id: 'opaque', display_name: 'Cloud' }])[0];
    const key = getQuotaCacheKey(file);
    const store = useQuotaStore.getState();
    store.clearQuotaCache();
    store.setOllamaQuota({
      [key]: {
        status: 'success',
        data: { connection_id: 'opaque', range: '7d', fetched_at: '2026-11-05T00:00:00Z' },
      },
    });
    selectOllamaRange(file, '30d');
    expect(useQuotaStore.getState().ollamaQuota[key].selectedRange).toBe('30d');
    expect(useQuotaStore.getState().ollamaQuota[key].data?.range).toBe('7d');
    store.setOllamaQuota((previous) => ({ ...previous, [key]: { status: 'loading' } }));
    selectOllamaRange(file, '24h');
    expect(useQuotaStore.getState().ollamaQuota[key].selectedRange).toBe('30d');
    store.clearQuotaCache();
  });
});
