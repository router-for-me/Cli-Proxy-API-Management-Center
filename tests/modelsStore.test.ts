import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { modelsApi } from '../src/services/api/models';
import { useModelsStore } from '../src/stores/useModelsStore';
import type { ModelInfo } from '../src/utils/models';

function deferred() {
  let resolve!: (models: ModelInfo[]) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<ModelInfo[]>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const originalFetch = modelsApi.fetchModels;
afterEach(() => {
  modelsApi.fetchModels = originalFetch;
  useModelsStore.getState().clearCache();
});

describe('models cache request isolation', () => {
  it('does not restore models or connection cache after clearing an in-flight request', async () => {
    const request = deferred();
    spyOn(modelsApi, 'fetchModels').mockReturnValue(request.promise);
    const pending = useModelsStore.getState().fetchModels('https://old.invalid');
    useModelsStore.getState().clearCache();
    expect(useModelsStore.getState().loading).toBe(false);
    request.resolve([{ name: 'old' }]);
    expect(await pending).toEqual([{ name: 'old' }]);
    expect(useModelsStore.getState()).toMatchObject({
      models: [],
      cache: null,
      loading: false,
      error: null,
    });
  });

  it('ignores stale failures without clearing a newer request loading state', async () => {
    const old = deferred();
    const current = deferred();
    spyOn(modelsApi, 'fetchModels')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const pending = useModelsStore.getState().fetchModels('https://old.invalid');
    useModelsStore.getState().clearCache();
    const next = useModelsStore.getState().fetchModels('https://new.invalid');
    old.reject(new Error('old failure'));
    await expect(pending).rejects.toThrow('old failure');
    expect(useModelsStore.getState()).toMatchObject({ loading: true, error: null });
    current.resolve([{ name: 'new' }]);
    await next;
    expect(useModelsStore.getState().cache?.apiBase).toBe('https://new.invalid');
  });

  it('allows only the latest request to publish, even without an explicit clear', async () => {
    const old = deferred();
    const current = deferred();
    spyOn(modelsApi, 'fetchModels')
      .mockReturnValueOnce(old.promise)
      .mockReturnValueOnce(current.promise);
    const pending = useModelsStore.getState().fetchModels('https://old.invalid');
    const next = useModelsStore.getState().fetchModels('https://new.invalid');
    current.resolve([{ name: 'new' }]);
    await next;
    old.resolve([{ name: 'old' }]);
    await pending;
    expect(useModelsStore.getState().models).toEqual([{ name: 'new' }]);
  });

  it('a cache hit supersedes an in-flight refresh and resets loading', async () => {
    const request = deferred();
    spyOn(modelsApi, 'fetchModels')
      .mockResolvedValueOnce([{ name: 'cached' }])
      .mockReturnValueOnce(request.promise);
    await useModelsStore.getState().fetchModels('https://cache.invalid', ' test-key ');
    const pending = useModelsStore
      .getState()
      .fetchModels('https://cache.invalid', 'test-key', true);
    await useModelsStore.getState().fetchModels('https://cache.invalid', 'test-key');
    expect(useModelsStore.getState().loading).toBe(false);
    request.resolve([{ name: 'stale refresh' }]);
    await pending;
    expect(useModelsStore.getState().models).toEqual([{ name: 'cached' }]);
  });

  it('reports active failures, then clears error and loading on invalidation', async () => {
    spyOn(modelsApi, 'fetchModels').mockRejectedValue(new Error('active failure'));
    await expect(useModelsStore.getState().fetchModels('https://test.invalid')).rejects.toThrow();
    expect(useModelsStore.getState().error).toBe('active failure');
    useModelsStore.getState().clearCache();
    expect(useModelsStore.getState()).toMatchObject({ error: null, loading: false });
  });

  it('retains the visible list during a refresh and after a same-scope failure', async () => {
    const request = deferred();
    spyOn(modelsApi, 'fetchModels')
      .mockResolvedValueOnce([{ name: 'last-success' }])
      .mockReturnValueOnce(request.promise);
    await useModelsStore.getState().fetchModels('https://proxy.invalid', 'fixture-key');
    const pending = useModelsStore
      .getState()
      .fetchModels('https://proxy.invalid', 'fixture-key', true);
    expect(useModelsStore.getState()).toMatchObject({
      loading: true,
      models: [{ name: 'last-success' }],
    });
    request.reject(new Error('fixture unavailable'));
    await expect(pending).rejects.toThrow('fixture unavailable');
    expect(useModelsStore.getState()).toMatchObject({
      loading: false,
      models: [{ name: 'last-success' }],
      error: 'fixture unavailable',
    });
  });

  for (const [apiBase, apiKey] of [
    ['https://replacement.invalid', 'original-fixture'],
    ['https://proxy.invalid', 'replacement-fixture'],
  ]) {
    it(`does not retain models when switching scope to ${apiBase} with ${apiKey}`, async () => {
      const request = deferred();
      spyOn(modelsApi, 'fetchModels')
        .mockResolvedValueOnce([{ name: 'private-original' }])
        .mockReturnValueOnce(request.promise);
      await useModelsStore.getState().fetchModels('https://proxy.invalid', 'original-fixture');
      const pending = useModelsStore.getState().fetchModels(apiBase, apiKey, true);
      expect(useModelsStore.getState().models).toEqual([]);
      request.reject(new Error('replacement unavailable'));
      await expect(pending).rejects.toThrow('replacement unavailable');
      expect(useModelsStore.getState().models).toEqual([]);
    });
  }

  it('invalidates freshness and fences pending reads without removing the visible model list', async () => {
    const request = deferred();
    spyOn(modelsApi, 'fetchModels')
      .mockResolvedValueOnce([{ name: 'last-success' }])
      .mockReturnValueOnce(request.promise);
    await useModelsStore.getState().fetchModels('https://proxy.invalid', 'fixture-key');
    const pending = useModelsStore
      .getState()
      .fetchModels('https://proxy.invalid', 'fixture-key', true);
    useModelsStore.getState().invalidateCache();
    expect(useModelsStore.getState()).toMatchObject({
      models: [{ name: 'last-success' }],
      cache: null,
      loading: false,
    });
    request.resolve([{ name: 'stale-publication' }]);
    await pending;
    expect(useModelsStore.getState()).toMatchObject({
      models: [{ name: 'last-success' }],
      cache: null,
    });
  });
});
