import { describe, expect, it } from 'vitest';
import {
  classifyCodexRateLimitWindows,
  deriveCodexRateLimitUsedPercent,
  isCodexRateLimitReached,
  buildCodexQuotaWindowInfos,
} from './codexQuota';

describe('buildCodexQuotaWindowInfos', () => {
  it('classifies Codex primary and weekly windows by duration', () => {
    const windows = buildCodexQuotaWindowInfos({
      rate_limit: {
        primary_window: {
          used_percent: 10,
          limit_window_seconds: 604_800,
          reset_after_seconds: 60,
        },
        secondary_window: {
          used_percent: 30,
          limit_window_seconds: 18_000,
          reset_after_seconds: 120,
        },
      },
    });

    expect(windows.map((window) => [window.id, window.usedPercent])).toEqual([
      ['five-hour', 30],
      ['weekly', 10],
    ]);
  });

  it('marks reached windows as fully used when usage percent is absent', () => {
    const windows = buildCodexQuotaWindowInfos({
      rate_limit: {
        limit_reached: true,
        primary_window: {
          limit_window_seconds: 18_000,
          reset_after_seconds: 300,
        },
      },
    });

    expect(windows[0]).toMatchObject({
      id: 'five-hour',
      usedPercent: 100,
    });
  });

  it('normalizes additional rate limit labels into stable ids and params', () => {
    const windows = buildCodexQuotaWindowInfos({
      additional_rate_limits: [
        {
          limit_name: 'Code Review Premium',
          rate_limit: {
            primary_window: {
              used_percent: 45,
              limit_window_seconds: 18_000,
              reset_after_seconds: 600,
            },
            secondary_window: {
              used_percent: 55,
              limit_window_seconds: 604_800,
              reset_after_seconds: 1_200,
            },
          },
        },
      ],
    });

    expect(windows).toMatchObject([
      {
        id: 'code-review-premium-five-hour-0',
        labelKey: 'codex_quota.additional_primary_window',
        labelParams: { name: 'Code Review Premium' },
        usedPercent: 45,
      },
      {
        id: 'code-review-premium-weekly-0',
        labelKey: 'codex_quota.additional_secondary_window',
        labelParams: { name: 'Code Review Premium' },
        usedPercent: 55,
      },
    ]);
  });

  it('shares rate-limit helpers used by Codex inspection', () => {
    const rateLimit = {
      allowed: true,
      primary_window: {
        used_percent: 65,
        limit_window_seconds: 604_800,
      },
      secondary_window: {
        used_percent: 100,
        limit_window_seconds: 18_000,
      },
    };

    const classified = classifyCodexRateLimitWindows(rateLimit);

    expect(classified.fiveHourWindow?.used_percent).toBe(100);
    expect(classified.weeklyWindow?.used_percent).toBe(65);
    expect(deriveCodexRateLimitUsedPercent(rateLimit)).toBe(100);
    expect(isCodexRateLimitReached(rateLimit)).toBe(true);
  });
});
