import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem, KimiUsagePayload } from '@/types';

const apiCallMock = vi.hoisted(() => vi.fn());
const downloadTextMock = vi.hoisted(() => vi.fn());
const requestCodexUsageRawMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/api', () => ({
  apiCallApi: { request: apiCallMock },
  authFilesApi: { downloadText: downloadTextMock },
  getApiCallErrorMessage: (result: { statusCode: number }) => `HTTP ${result.statusCode}`,
  requestCodexUsageRaw: requestCodexUsageRawMock,
}));

import {
  fetchAntigravityQuota,
  fetchClaudeQuota,
  fetchCodexQuota,
  fetchGeminiCliQuotaBuckets,
  fetchKimiQuota,
  fetchXaiQuota,
} from './index';

const t = ((key: string, params?: Record<string, unknown>) => {
  if (params && Object.keys(params).length > 0) {
    return `${key}:${JSON.stringify(params)}`;
  }
  return key;
}) as unknown as Parameters<typeof fetchClaudeQuota>[1];

const baseFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: overrides.name ?? 'demo.json',
  type: overrides.type ?? 'codex',
  authIndex: overrides.authIndex ?? '7',
  ...overrides,
});

describe('quota providers', () => {
  beforeEach(() => {
    apiCallMock.mockReset();
    downloadTextMock.mockReset();
    requestCodexUsageRawMock.mockReset();
  });

  describe('fetchCodexQuota', () => {
    it('throws when the auth index is missing', async () => {
      const file = baseFile({ authIndex: '' });
      await expect(fetchCodexQuota(file, t)).rejects.toThrow('codex_quota.missing_auth_index');
    });

    it('builds windows from the payload and prefers payload plan type', async () => {
      requestCodexUsageRawMock.mockResolvedValue({
        result: { statusCode: 200 },
        payload: {
          plan_type: 'pro',
          rate_limit: {
            primary_window: {
              used_percent: 40,
              limit_window_seconds: 18_000,
            },
            secondary_window: {
              used_percent: 10,
              limit_window_seconds: 604_800,
            },
          },
        },
      });

      const result = await fetchCodexQuota(baseFile(), t);

      expect(result.planType).toBe('pro');
      expect(result.windows.map((window) => window.id)).toEqual(['five-hour', 'weekly']);
      expect(requestCodexUsageRawMock).toHaveBeenCalledWith({ authIndex: '7', accountId: null });
    });

    it('throws a status error when the upstream returns non-2xx', async () => {
      requestCodexUsageRawMock.mockResolvedValue({
        result: { statusCode: 403 },
        payload: null,
      });

      await expect(fetchCodexQuota(baseFile(), t)).rejects.toMatchObject({
        message: 'HTTP 403',
        status: 403,
      });
    });

    it('throws when the response is empty', async () => {
      requestCodexUsageRawMock.mockResolvedValue({
        result: { statusCode: 200 },
        payload: null,
      });

      await expect(fetchCodexQuota(baseFile(), t)).rejects.toThrow('codex_quota.empty_windows');
    });
  });

  describe('fetchClaudeQuota', () => {
    it('throws when the auth index is missing', async () => {
      await expect(fetchClaudeQuota(baseFile({ authIndex: '' }), t)).rejects.toThrow(
        'claude_quota.missing_auth_index'
      );
    });

    it('parses usage windows and resolves plan from profile', async () => {
      apiCallMock.mockImplementation(async (request: { url: string }) => {
        if (request.url.includes('/usage')) {
          return {
            statusCode: 200,
            body: {
              five_hour: { utilization: 25, resets_at: '2026-01-01T00:00:00Z' },
              seven_day: { utilization: 10, resets_at: '2026-01-07T00:00:00Z' },
            },
          };
        }
        return {
          statusCode: 200,
          body: { account: { has_claude_max: true } },
        };
      });

      const result = await fetchClaudeQuota(baseFile({ type: 'claude' }), t);

      expect(result.windows.map((window) => window.id)).toEqual(['five-hour', 'seven-day']);
      expect(result.planType).toBe('plan_max');
    });

    it('throws when the usage call fails', async () => {
      apiCallMock.mockImplementation(async (request: { url: string }) => {
        if (request.url.includes('/usage')) {
          return { statusCode: 401 };
        }
        return { statusCode: 200, body: {} };
      });

      await expect(fetchClaudeQuota(baseFile({ type: 'claude' }), t)).rejects.toMatchObject({
        message: 'HTTP 401',
        status: 401,
      });
    });
  });

  describe('fetchAntigravityQuota', () => {
    it('falls back to the default project id when the auth file is missing one', async () => {
      downloadTextMock.mockResolvedValue('{}');
      apiCallMock.mockResolvedValue({
        statusCode: 200,
        body: {
          models: {
            'claude-sonnet-4-6': {
              quotaInfo: { remainingFraction: 0.5, resetTime: '2026-01-01T00:00:00Z' },
            },
          },
        },
      });

      const result = await fetchAntigravityQuota(baseFile({ type: 'antigravity' }), t);

      expect(result.length).toBeGreaterThan(0);
      expect(apiCallMock).toHaveBeenCalled();
      const lastCallArgs = apiCallMock.mock.calls[apiCallMock.mock.calls.length - 1]?.[0] as {
        data: string;
      };
      expect(JSON.parse(lastCallArgs.data)).toEqual({ project: 'bamboo-precept-lgxtn' });
    });

    it('returns the first endpoint that yields models', async () => {
      downloadTextMock.mockResolvedValue('{"project_id":"my-project"}');
      apiCallMock
        .mockResolvedValueOnce({ statusCode: 404 })
        .mockResolvedValueOnce({
          statusCode: 200,
          body: {
            models: {
              'claude-sonnet-4-6': {
                quotaInfo: { remainingFraction: 0.7, resetTime: '2026-01-02T00:00:00Z' },
              },
            },
          },
        });

      const result = await fetchAntigravityQuota(baseFile({ type: 'antigravity' }), t);
      expect(result.length).toBeGreaterThan(0);
      expect(apiCallMock).toHaveBeenCalledTimes(2);
    });

    it('throws with the first prioritized status when every endpoint fails', async () => {
      downloadTextMock.mockResolvedValue('');
      apiCallMock.mockResolvedValue({ statusCode: 403 });

      await expect(fetchAntigravityQuota(baseFile({ type: 'antigravity' }), t)).rejects.toMatchObject(
        { status: 403 }
      );
    });
  });

  describe('fetchGeminiCliQuotaBuckets', () => {
    it('throws when project id cannot be resolved', async () => {
      await expect(
        fetchGeminiCliQuotaBuckets(baseFile({ type: 'gemini-cli' }), t)
      ).rejects.toThrow('gemini_cli_quota.missing_project_id');
    });

    it('parses buckets when the request succeeds', async () => {
      apiCallMock.mockResolvedValue({
        statusCode: 200,
        body: {
          buckets: [
            {
              modelId: 'gemini-2.5-flash-lite',
              remainingFraction: 0.42,
              remainingAmount: 100,
              resetTime: '2026-01-03T00:00:00Z',
            },
          ],
        },
      });

      const file = baseFile({
        type: 'gemini-cli',
        account: 'demo (demo-project)',
      });
      const result = await fetchGeminiCliQuotaBuckets(file, t);

      expect(result.projectId).toBe('demo-project');
      expect(result.buckets.length).toBeGreaterThan(0);
    });
  });

  describe('fetchKimiQuota', () => {
    it('throws when the auth index is missing', async () => {
      await expect(fetchKimiQuota(baseFile({ authIndex: '' }), t)).rejects.toThrow(
        'kimi_quota.missing_auth_index'
      );
    });

    it('throws a status error on non-2xx response', async () => {
      apiCallMock.mockResolvedValue({ statusCode: 502 });
      await expect(fetchKimiQuota(baseFile({ type: 'kimi' }), t)).rejects.toMatchObject({
        status: 502,
      });
    });

    it('throws when the payload cannot be parsed', async () => {
      apiCallMock.mockResolvedValue({ statusCode: 200, body: 'not-json' });
      await expect(fetchKimiQuota(baseFile({ type: 'kimi' }), t)).rejects.toThrow(
        'kimi_quota.empty_data'
      );
    });

    it('parses Kimi rows for a valid payload', async () => {
      const payload: KimiUsagePayload = {
        limits: [
          {
            name: 'weekly',
            detail: { used: 5, limit: 100 },
            window: { duration: 7, timeUnit: 'day' },
          },
        ],
      };
      apiCallMock.mockResolvedValue({ statusCode: 200, body: payload });
      const result = await fetchKimiQuota(baseFile({ type: 'kimi' }), t);
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('fetchXaiQuota', () => {
    it('throws when the auth index is missing', async () => {
      await expect(fetchXaiQuota(baseFile({ type: 'xai', authIndex: '' }), t)).rejects.toThrow(
        'xai_quota.missing_auth_index'
      );
    });

    it('throws a status error on non-2xx response', async () => {
      apiCallMock.mockResolvedValue({ statusCode: 403, body: null });
      await expect(fetchXaiQuota(baseFile({ type: 'xai' }), t)).rejects.toMatchObject({
        status: 403,
      });
    });

    it('throws when the payload has no usable config block', async () => {
      apiCallMock.mockResolvedValue({ statusCode: 200, body: {} });
      await expect(fetchXaiQuota(baseFile({ type: 'xai' }), t)).rejects.toThrow(
        'xai_quota.empty_data'
      );
    });

    it('parses billing summary from camelCase response fields', async () => {
      apiCallMock.mockResolvedValue({
        statusCode: 200,
        body: {
          config: {
            monthlyLimit: { val: 15000 },
            used: { val: 3000 },
            onDemandCap: { val: 5000 },
            billingPeriodStart: '2026-05-01T00:00:00Z',
            billingPeriodEnd: '2026-06-01T00:00:00Z',
          },
        },
      });

      const result = await fetchXaiQuota(baseFile({ type: 'xai' }), t);

      expect(result.monthlyLimitCents).toBe(15000);
      expect(result.usedCents).toBe(3000);
      expect(result.onDemandCapCents).toBe(5000);
      expect(result.billingPeriodEnd).toBe('2026-06-01T00:00:00Z');
      expect(result.usedPercent).toBeCloseTo(20, 5);
    });

    it('accepts snake_case fallbacks and plain-number cents', async () => {
      apiCallMock.mockResolvedValue({
        statusCode: 200,
        body: {
          config: {
            monthly_limit: 10000,
            used: 2500,
            on_demand_cap: 0,
            billing_period_end: '2026-06-01T00:00:00Z',
          },
        },
      });

      const result = await fetchXaiQuota(baseFile({ type: 'x-ai' }), t);

      expect(result.monthlyLimitCents).toBe(10000);
      expect(result.usedCents).toBe(2500);
      expect(result.onDemandCapCents).toBe(0);
      expect(result.usedPercent).toBeCloseTo(25, 5);
    });

    it('parses payload returned as a JSON string body', async () => {
      apiCallMock.mockResolvedValue({
        statusCode: 200,
        body: JSON.stringify({
          config: {
            monthlyLimit: { val: 20000 },
            used: { val: 5000 },
            billingPeriodEnd: '2026-06-01T00:00:00Z',
          },
        }),
      });

      const result = await fetchXaiQuota(baseFile({ type: 'grok' }), t);

      expect(result.monthlyLimitCents).toBe(20000);
      expect(result.usedCents).toBe(5000);
      expect(result.usedPercent).toBeCloseTo(25, 5);
    });

    it('reports null usedPercent when limit is unknown', async () => {
      apiCallMock.mockResolvedValue({
        statusCode: 200,
        body: {
          config: {
            used: { val: 3000 },
            billingPeriodEnd: '2026-06-01T00:00:00Z',
          },
        },
      });

      const result = await fetchXaiQuota(baseFile({ type: 'xai' }), t);

      expect(result.monthlyLimitCents).toBeNull();
      expect(result.usedCents).toBe(3000);
      expect(result.usedPercent).toBeNull();
    });
  });
});
