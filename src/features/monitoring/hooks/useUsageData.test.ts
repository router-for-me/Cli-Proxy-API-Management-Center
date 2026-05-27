import { act, createElement, useEffect } from 'react';
import { create, type ReactTestRenderer } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeUsagePayloads, useUsageData, type UsagePageQueries } from './useUsageData';

const { mocks } = vi.hoisted(() => {
  return {
    mocks: {
      getModelPrices: vi.fn(),
      saveModelPrices: vi.fn(),
      getApiKeyAliases: vi.fn(),
      getUsage: vi.fn(),
      getUsagePage: vi.fn(),
      loadStoredModelPrices: vi.fn(),
      clearModelPrices: vi.fn(),
      saveStoredModelPrices: vi.fn(),
    },
  };
});

vi.mock('@/stores', () => ({
  useAuthStore: (selector: (state: { apiBase: string; managementKey: string }) => unknown) =>
    selector({ apiBase: 'http://cpa.local', managementKey: 'management-key' }),
  useUsageServiceStore: (selector: (state: { enabled: boolean; serviceBase: string }) => unknown) =>
    selector({ enabled: true, serviceBase: 'http://usage.local' }),
}));

vi.mock('@/services/api/usageService', () => ({
  isUsageServiceId: (value: string) => value === 'usage-service',
  normalizeUsageServiceBase: (value: string) => value.replace(/\/+$/, ''),
  usageServiceApi: {
    getModelPrices: mocks.getModelPrices,
    saveModelPrices: mocks.saveModelPrices,
    getApiKeyAliases: mocks.getApiKeyAliases,
    getUsage: mocks.getUsage,
    getUsagePage: mocks.getUsagePage,
  },
}));

vi.mock('@/utils/connection', () => ({
  detectApiBaseFromLocation: () => '',
}));

vi.mock('@/utils/usage', () => ({
  clearModelPrices: mocks.clearModelPrices,
  loadModelPrices: mocks.loadStoredModelPrices,
  saveModelPrices: mocks.saveStoredModelPrices,
}));

type UseUsageDataHarness = {
  getCurrent: () => ReturnType<typeof useUsageData>;
  unmount: () => void;
};

const flushPromises = () => new Promise((resolve) => setTimeout(resolve, 0));

const mountUseUsageData = async (
  usagePageQueries?: UsagePageQueries
): Promise<UseUsageDataHarness> => {
  let hook: ReturnType<typeof useUsageData> | null = null;
  let renderer: ReactTestRenderer | null = null;

  function HookHarness() {
    const current = useUsageData(undefined, usagePageQueries);
    useEffect(() => {
      hook = current;
    });
    return null;
  }

  await act(async () => {
    renderer = create(createElement(HookHarness));
    await flushPromises();
  });

  return {
    getCurrent: () => {
      if (!hook) {
        throw new Error('Failed to mount useUsageData test harness');
      }
      return hook;
    },
    unmount: () => {
      if (!renderer) return;
      act(() => {
        renderer?.unmount();
      });
    },
  };
};

beforeEach(() => {
  mocks.getModelPrices.mockReset();
  mocks.saveModelPrices.mockReset();
  mocks.getApiKeyAliases.mockReset();
  mocks.getUsage.mockReset();
  mocks.getUsagePage.mockReset();
  mocks.loadStoredModelPrices.mockReset();
  mocks.clearModelPrices.mockReset();
  mocks.saveStoredModelPrices.mockReset();

  mocks.getApiKeyAliases.mockResolvedValue({ items: [] });
  mocks.getUsage.mockResolvedValue({});
  mocks.loadStoredModelPrices.mockReturnValue({});
});

describe('useUsageData', () => {
  it('reloads model prices when loadModelPrices is called again', async () => {
    mocks.getModelPrices
      .mockResolvedValueOnce({ prices: { 'gpt-initial': { prompt: 1, completion: 2, cache: 0 } } })
      .mockResolvedValueOnce({
        prices: { 'gpt-refreshed': { prompt: 3, completion: 4, cache: 0 } },
      });

    const harness = await mountUseUsageData();

    expect(harness.getCurrent().modelPrices).toEqual({
      'gpt-initial': { prompt: 1, completion: 2, cache: 0 },
    });

    await act(async () => {
      await harness.getCurrent().loadModelPrices();
    });

    expect(harness.getCurrent().modelPrices).toEqual({
      'gpt-refreshed': { prompt: 3, completion: 4, cache: 0 },
    });
    expect(mocks.getModelPrices).toHaveBeenCalledTimes(2);

    harness.unmount();
  });

  it('starts full model aggregation from page 1 even when caller state is on another page', async () => {
    mocks.getModelPrices.mockResolvedValue({ prices: {} });
    mocks.getUsagePage
      .mockResolvedValueOnce({
        page: 1,
        page_size: 1,
        total_items: 2,
        usage: { total_requests: 1, apis: {} },
      })
      .mockResolvedValueOnce({
        page: 2,
        page_size: 1,
        total_items: 2,
        usage: { total_requests: 1, apis: {} },
      });

    const harness = await mountUseUsageData({
      models: { page: 3, pageSize: 1 },
    });

    expect(mocks.getUsagePage).toHaveBeenNthCalledWith(
      1,
      'http://usage.local',
      'management-key',
      'models',
      undefined,
      { page: 1, pageSize: 1 }
    );
    expect(mocks.getUsagePage).toHaveBeenNthCalledWith(
      2,
      'http://usage.local',
      'management-key',
      'models',
      undefined,
      { page: 2, pageSize: 1 }
    );
    expect(harness.getCurrent().usagePages?.models?.usage.total_requests).toBe(2);

    harness.unmount();
  });
});

describe('mergeUsagePayloads', () => {
  it('merges totals, tokens, latency and appends details for repeated endpoint/model keys', () => {
    const merged = mergeUsagePayloads([
      {
        total_requests: 1,
        success_count: 1,
        total_tokens: 10,
        latency_sum_ms: 100,
        latency_count: 1,
        tokens: { input_tokens: 4, output_tokens: 6, total_tokens: 10 },
        apis: {
          'POST /v1/chat/completions': {
            models: {
              'gpt-5': { details: [{ id: 'first' }] },
            },
          },
        },
      },
      {
        total_requests: 2,
        failure_count: 1,
        total_tokens: 30,
        latency_sum_ms: 500,
        latency_count: 2,
        tokens: { input_tokens: 12, output_tokens: 18, total_tokens: 30 },
        apis: {
          'POST /v1/chat/completions': {
            models: {
              'gpt-5': { details: [{ id: 'second' }] },
            },
          },
        },
      },
    ]);

    expect(merged).toMatchObject({
      total_requests: 3,
      success_count: 1,
      failure_count: 1,
      total_tokens: 40,
      latency_sum_ms: 600,
      latency_count: 3,
      latency_ms: 200,
      tokens: {
        input_tokens: 16,
        output_tokens: 24,
        total_tokens: 40,
      },
    });
    const details = (
      merged.apis?.['POST /v1/chat/completions'] as {
        models?: Record<string, { details?: unknown[] }>;
      }
    )?.models?.['gpt-5']?.details;
    expect(details).toEqual([{ id: 'first' }, { id: 'second' }]);
  });
});
