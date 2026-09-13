import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CODEX_CONFIG, buildCodexQuotaWindows } from '@/features/quota/providers/codex/data';
import type { CodexQuotaState, CodexUsagePayload } from '@/types';
import { normalizeCodexResetCreditsPayload, parseCodexUsagePayload } from '@/utils/quota';
import { collectQuotaRowInstants } from '@/features/quota/resetSchedule';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';

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

/**
 * Business/enterprise accounts meter by a credit budget: `rate_limit` is null
 * and the real allowance arrives under `spend_control.individual_limit`.
 * Payload captured verbatim from chatgpt.com/backend-api/wham/usage.
 */
const BUSINESS_CODEX_USAGE_PAYLOAD: CodexUsagePayload = {
  plan_type: 'business',
  rate_limit: null,
  code_review_rate_limit: null,
  additional_rate_limits: [
    {
      limit_name: 'GPT-5.3-Codex-Spark-Preview',
      metered_feature: 'codex_bengalfox',
      rate_limit: {
        allowed: true,
        limit_reached: false,
        primary_window: {
          used_percent: 0,
          limit_window_seconds: 18000,
          reset_after_seconds: 18000,
          reset_at: 1788587485,
        },
        secondary_window: {
          used_percent: 0,
          limit_window_seconds: 604800,
          reset_after_seconds: 604800,
          reset_at: 1789174285,
        },
      },
    },
  ],
  spend_control: {
    reached: false,
    individual_limit: {
      source: 'group_based_spend_controls',
      limit: '37500',
      used: '3138.653407096863',
      remaining: '34361.34659290314',
      used_percent: 8,
      remaining_percent: 92,
      reset_after_seconds: 2243315,
      reset_at: 1790812800,
    },
  },
  rate_limit_reset_credits: {
    available_count: 0,
    applicable_available_count: 0,
  },
};

describe('Codex spend-control budget', () => {
  test('reads the credit budget from the observed business payload', () => {
    const windows = buildCodexQuotaWindows(BUSINESS_CODEX_USAGE_PAYLOAD, t);
    const budget = windows.find(({ id }) => id === 'spend-control');

    expect(budget).toBeDefined();
    expect(budget?.labelKey).toBe('codex_quota.spend_control_window');
    expect(budget?.usedPercent).toBe(8);
    expect(budget?.totalAmount).toBe(37500);
    expect(budget?.usedAmount).toBeCloseTo(3138.653407096863, 6);
    expect(budget?.resetAtMs).toBe(1790812800 * 1000);
  });

  test('keeps the budget last so the model windows stay on top', () => {
    const windows = buildCodexQuotaWindows(BUSINESS_CODEX_USAGE_PAYLOAD, t);

    expect(windows.map(({ id }) => id)).toEqual([
      'gpt-5-3-codex-spark-preview-five-hour-0',
      'gpt-5-3-codex-spark-preview-weekly-0',
      'spend-control',
    ]);
  });

  test('derives the used amount and percentage when only limit and remaining arrive', () => {
    const windows = buildCodexQuotaWindows(
      { spend_control: { individual_limit: { limit: '200', remaining: '150' } } },
      t
    );

    expect(windows[0]?.usedAmount).toBe(50);
    expect(windows[0]?.usedPercent).toBe(25);
  });

  test('ignores a spend control carrying no usable numbers', () => {
    expect(buildCodexQuotaWindows({ spend_control: { reached: false } }, t)).toHaveLength(0);
    expect(
      buildCodexQuotaWindows({ spend_control: { individual_limit: {} } }, t)
    ).toHaveLength(0);
  });

  // A budget refilling is a billing cycle, not capacity coming back — the same
  // rule the xAI monthly figure follows.
  test('excludes the budget from recovery ranking and the timeline lane', () => {
    const windows = buildCodexQuotaWindows(
      {
        spend_control: {
          individual_limit: { limit: '100', used: '60', reset_at: 1790812800 },
        },
      },
      t
    );
    const quota: CodexQuotaState = { status: 'success', windows };

    expect(collectQuotaRowInstants('codex', quota)).toEqual([]);
    expect(buildTimelineLane({ name: 'a', displayName: 'a', provider: 'codex', quota }).anchorMs).toBeNull();
  });
});
