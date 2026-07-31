import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CODEX_CONFIG, buildCodexQuotaWindows } from '@/features/quota/providers/codex/data';
import type { CodexQuotaState, CodexUsagePayload } from '@/types';
import { normalizeCodexResetCreditsPayload, parseCodexUsagePayload } from '@/utils/quota';

const t = ((key: string) => key) as TFunction;

const CURRENT_CODEX_USAGE_PAYLOAD: CodexUsagePayload = {
  plan_type: 'pro',
  rate_limit: {
    allowed: true,
    limit_reached: false,
    primary_window: {
      used_percent: 1,
      limit_window_seconds: 604800,
      reset_after_seconds: 601888,
      reset_at: 1785902974,
    },
    secondary_window: null,
  },
  code_review_rate_limit: null,
  additional_rate_limits: [
    {
      limit_name: 'GPT-5.3-Codex-Spark',
      metered_feature: 'codex_bengalfox',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 604800,
          reset_after_seconds: 602111,
          reset_at: 1785903197,
        },
        secondary_window: null,
      },
    },
  ],
  rate_limit_reset_credits: {
    available_count: 1,
    applicable_available_count: 0,
  },
};

describe('Codex current usage payload', () => {
  test('parses the proxied JSON body and classifies both primary weekly windows', () => {
    const payload = parseCodexUsagePayload(JSON.stringify(CURRENT_CODEX_USAGE_PAYLOAD));
    expect(payload).not.toBeNull();

    const windows = buildCodexQuotaWindows(payload!, t);

    expect(windows.map(({ id }) => id)).toEqual(['weekly', 'gpt-5-3-codex-spark-weekly-0']);
    expect(windows.map(({ labelKey }) => labelKey)).toEqual([
      'codex_quota.secondary_window',
      'codex_quota.additional_secondary_window',
    ]);
    expect(windows.map(({ usedPercent }) => usedPercent)).toEqual([1, 0]);
    expect(windows[1]?.labelParams).toEqual({ name: 'GPT-5.3-Codex-Spark' });
  });

  test('shows reset support when total credits remain but none currently apply', () => {
    const summary = normalizeCodexResetCreditsPayload(
      CURRENT_CODEX_USAGE_PAYLOAD.rate_limit_reset_credits
    );

    expect(summary.invalidPayload).toBeFalse();
    expect(summary.availableCount).toBe(1);
    expect(summary.applicableAvailableCount).toBe(0);

    const quota: CodexQuotaState = {
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: summary.availableCount,
      rateLimitResetCreditsApplicableAvailableCount: summary.applicableAvailableCount,
    };
    expect(CODEX_CONFIG.canResetQuota?.(quota)).toBeTrue();
  });

  test('keeps reset support for legacy payloads without applicable count', () => {
    const quota: CodexQuotaState = {
      status: 'success',
      windows: [],
      rateLimitResetCreditsAvailableCount: 1,
    };

    expect(CODEX_CONFIG.canResetQuota?.(quota)).toBeTrue();
  });
});
