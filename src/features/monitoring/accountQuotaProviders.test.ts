import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthFileItem } from '@/types';
import type { MonitoringAccountQuotaTarget } from './accountOverviewQuotaTargets';

const apiCallMock = vi.hoisted(() => vi.fn());
const downloadTextMock = vi.hoisted(() => vi.fn());
const requestCodexUsageRawMock = vi.hoisted(() => vi.fn());

vi.mock('@/services/api', () => ({
  apiCallApi: { request: apiCallMock },
  authFilesApi: { downloadText: downloadTextMock },
  getApiCallErrorMessage: (result: { statusCode: number }) => `HTTP ${result.statusCode}`,
  requestCodexUsageRaw: requestCodexUsageRawMock,
  requestCodexUsagePayload: async (
    params: { authIndex: string; accountId?: string | null },
    options: { emptyMessage?: string } = {}
  ) => {
    const { result, payload } = await requestCodexUsageRawMock(params);
    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw Object.assign(new Error(`HTTP ${result.statusCode}`), { status: result.statusCode });
    }
    if (!payload) {
      throw new Error(options.emptyMessage || 'empty');
    }
    return payload;
  },
}));

import { fetchAccountQuotaEntry, getCodexPlanLabel } from './accountQuotaProviders';

const t = ((key: string, params?: Record<string, unknown>) => {
  if (!params || Object.keys(params).length === 0) return key;
  return `${key}:${JSON.stringify(params)}`;
}) as unknown as Parameters<typeof fetchAccountQuotaEntry>[2];

const baseTarget = (
  overrides: Partial<MonitoringAccountQuotaTarget> = {}
): MonitoringAccountQuotaTarget => ({
  key: overrides.key ?? 'target-key',
  provider: overrides.provider ?? 'codex',
  authIndex: overrides.authIndex ?? '1',
  authLabel: overrides.authLabel ?? 'Auth',
  fileName: overrides.fileName ?? 'demo.json',
  accountId: overrides.accountId ?? null,
  planType: overrides.planType ?? null,
});

const baseFile = (overrides: Partial<AuthFileItem> = {}): AuthFileItem => ({
  name: overrides.name ?? 'demo.json',
  type: overrides.type ?? 'codex',
  authIndex: overrides.authIndex ?? '1',
  ...overrides,
});

describe('getCodexPlanLabel', () => {
  it('translates known Codex plan ids to i18n labels', () => {
    expect(getCodexPlanLabel('pro', t)).toBe('codex_quota.plan_pro');
    expect(getCodexPlanLabel('prolite', t)).toBe('codex_quota.plan_prolite');
    expect(getCodexPlanLabel('plus', t)).toBe('codex_quota.plan_plus');
    expect(getCodexPlanLabel('team', t)).toBe('codex_quota.plan_team');
    expect(getCodexPlanLabel('free', t)).toBe('codex_quota.plan_free');
  });

  it('returns null for empty/unknown inputs', () => {
    expect(getCodexPlanLabel(null, t)).toBeNull();
    expect(getCodexPlanLabel('', t)).toBeNull();
  });

  it('falls back to the raw plan type when no specific label exists', () => {
    expect(getCodexPlanLabel('mystery', t)).toBe('mystery');
  });
});

describe('fetchAccountQuotaEntry', () => {
  beforeEach(() => {
    apiCallMock.mockReset();
    downloadTextMock.mockReset();
    requestCodexUsageRawMock.mockReset();
  });

  it('maps Codex payloads into AccountQuotaWindows with subtitle', async () => {
    requestCodexUsageRawMock.mockResolvedValue({
      result: { statusCode: 200 },
      payload: {
        plan_type: 'pro',
        rate_limit: {
          primary_window: { used_percent: 40, limit_window_seconds: 18_000 },
          secondary_window: { used_percent: 25, limit_window_seconds: 604_800 },
        },
      },
    });

    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'codex', accountId: 'acc-1' }),
      undefined,
      t
    );

    expect(entry.provider).toBe('codex');
    expect(entry.error).toBeUndefined();
    expect(entry.subtitle).toBe('codex_quota.plan_pro');
    expect(entry.windows.map((window) => window.id)).toEqual(['five-hour', 'weekly']);
    expect(entry.windows[0].remainingPercent).toBe(60);
    expect(entry.windows[0].usageLabel).toContain('codex_quota.window_usage');
  });

  it('returns an error entry when Codex fetch fails', async () => {
    requestCodexUsageRawMock.mockResolvedValue({ result: { statusCode: 500 }, payload: null });

    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'codex' }),
      undefined,
      t
    );

    expect(entry.error).toBe('HTTP 500');
    expect(entry.errorStatus).toBe(500);
    expect(entry.windows).toEqual([]);
    expect(entry.subtitle).toBeNull();
  });

  it('maps Claude payload including plan label and extra usage subtitle', async () => {
    apiCallMock.mockImplementation(async (request: { url: string }) => {
      if (request.url.includes('/usage')) {
        return {
          statusCode: 200,
          body: {
            five_hour: { utilization: 30, resets_at: '2026-01-01T00:00:00Z' },
            extra_usage: {
              is_enabled: true,
              monthly_limit: 5000,
              used_credits: 1234,
              utilization: 0.25,
            },
          },
        };
      }
      return {
        statusCode: 200,
        body: { account: { has_claude_max: true } },
      };
    });

    const file = baseFile({ type: 'claude' });
    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'claude' }),
      file,
      t
    );

    expect(entry.error).toBeUndefined();
    expect(entry.subtitle).toContain('claude_quota.plan_max');
    expect(entry.subtitle).toContain('claude_quota.extra_usage_label');
    expect(entry.subtitle).toContain('$12.34');
    expect(entry.subtitle).toContain('$50.00');
    expect(entry.windows[0].remainingPercent).toBe(70);
  });

  it('returns null subtitle for Antigravity entries with groups', async () => {
    downloadTextMock.mockResolvedValue('');
    apiCallMock.mockResolvedValue({
      statusCode: 200,
      body: {
        models: {
          'claude-sonnet-4-6': {
            quotaInfo: { remainingFraction: 0.3, resetTime: '2026-01-01T00:00:00Z' },
          },
        },
      },
    });

    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'antigravity' }),
      baseFile({ type: 'antigravity' }),
      t
    );

    expect(entry.subtitle).toBeNull();
    expect(entry.windows.length).toBeGreaterThan(0);
  });

  it('maps Gemini CLI buckets and skips supplementary tier when missing', async () => {
    apiCallMock.mockImplementation(async (request: { url: string }) => {
      if (request.url.includes('retrieveUserQuota')) {
        return {
          statusCode: 200,
          body: {
            buckets: [
              {
                modelId: 'gemini-2.5-flash-lite',
                remainingFraction: 0.6,
                remainingAmount: 50,
              },
            ],
          },
        };
      }
      return { statusCode: 500 };
    });

    const file = baseFile({ type: 'gemini-cli', account: 'demo (proj-x)' });
    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'gemini-cli' }),
      file,
      t
    );

    expect(entry.error).toBeUndefined();
    expect(entry.subtitle).toBeNull();
    expect(entry.windows.length).toBeGreaterThan(0);
    expect(entry.windows[0].remainingPercent).toBe(60);
    expect(entry.windows[0].usageLabel).toContain('gemini_cli_quota.remaining_amount');
  });

  it('returns Kimi rows with usage/limit labels and null subtitle', async () => {
    apiCallMock.mockResolvedValue({
      statusCode: 200,
      body: {
        limits: [
          {
            name: 'weekly',
            detail: { used: 5, limit: 100 },
            window: { duration: 7, timeUnit: 'day' },
          },
        ],
      },
    });

    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'kimi' }),
      baseFile({ type: 'kimi' }),
      t
    );

    expect(entry.subtitle).toBeNull();
    expect(entry.windows.length).toBeGreaterThan(0);
    expect(entry.windows[0].usageLabel).toBe('5 / 100');
    expect(entry.windows[0].remainingPercent).toBe(95);
  });

  it('maps xAI billing into a monthly-credits window and pay-as-you-go subtitle', async () => {
    apiCallMock.mockResolvedValue({
      statusCode: 200,
      body: {
        config: {
          monthlyLimit: { val: 15000 },
          used: { val: 4500 },
          onDemandCap: { val: 5000 },
          billingPeriodEnd: '2026-06-01T00:00:00Z',
        },
      },
    });

    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'xai' }),
      baseFile({ type: 'xai' }),
      t
    );

    expect(entry.error).toBeUndefined();
    expect(entry.windows).toHaveLength(1);
    expect(entry.windows[0].id).toBe('monthly-credits');
    expect(entry.windows[0].label).toBe('xai_quota.monthly_credits');
    expect(entry.windows[0].remainingPercent).toBeCloseTo(70, 5);
    expect(entry.windows[0].usageLabel).toContain('$');
    expect(entry.windows[0].usageLabel).toContain('/');
    expect(entry.subtitle).toContain('xai_quota.pay_as_you_go_label');
    expect(entry.subtitle).toContain('xai_quota.pay_as_you_go_enabled');
  });

  it('uses the disabled pay-as-you-go label when onDemandCap is zero or missing', async () => {
    apiCallMock.mockResolvedValue({
      statusCode: 200,
      body: {
        config: {
          monthly_limit: { val: 10000 },
          used: { val: 2500 },
          billing_period_end: '2026-06-01T00:00:00Z',
        },
      },
    });

    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'xai' }),
      baseFile({ type: 'x-ai' }),
      t
    );

    expect(entry.error).toBeUndefined();
    expect(entry.subtitle).toContain('xai_quota.pay_as_you_go_disabled');
    expect(entry.windows[0].remainingPercent).toBeCloseTo(75, 5);
  });

  it('returns error entry when xAI fetch returns non-2xx', async () => {
    apiCallMock.mockResolvedValue({ statusCode: 403, body: null });

    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'xai' }),
      baseFile({ type: 'xai' }),
      t
    );

    expect(entry.error).toBe('HTTP 403');
    expect(entry.errorStatus).toBe(403);
    expect(entry.windows).toEqual([]);
  });

  it('returns error entry when xAI auth file is missing', async () => {
    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'xai' }),
      undefined,
      t
    );

    expect(entry.error).toBe('xai_quota.missing_auth_index');
    expect(entry.windows).toEqual([]);
  });

  it('returns error entry when a non-Codex provider receives no file', async () => {
    const entry = await fetchAccountQuotaEntry(
      baseTarget({ provider: 'claude' }),
      undefined,
      t
    );

    expect(entry.error).toBe('claude_quota.missing_auth_index');
    expect(entry.windows).toEqual([]);
  });
});
