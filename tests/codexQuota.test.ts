import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { CODEX_CONFIG, buildCodexQuotaWindows } from '@/features/quota/providers/codex/data';
import { apiCallApi, authFilesApi } from '@/services/api';
import type { CodexQuotaState, CodexUsagePayload } from '@/types';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_USAGE_URL,
  normalizeCodexResetCreditsPayload,
  parseCodexUsagePayload,
} from '@/utils/quota';

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

/** Stubs the two APIs a reset touches and records every call in order. */
const stubCodexResetApis = (resetQuota: (authIndex: string) => Promise<unknown>) => {
  const originalRequest = apiCallApi.request;
  const originalResetQuota = authFilesApi.resetQuota;
  const calls: string[] = [];
  apiCallApi.request = async ({ url }) => {
    calls.push(url);
    const body = url === CODEX_USAGE_URL ? CURRENT_CODEX_USAGE_PAYLOAD : null;
    return { statusCode: 200, header: {}, bodyText: '', body };
  };
  authFilesApi.resetQuota = async (authIndex) => {
    calls.push(`reset-quota:${authIndex}`);
    return resetQuota(authIndex);
  };
  return {
    calls,
    restore: () => {
      apiCallApi.request = originalRequest;
      authFilesApi.resetQuota = originalResetQuota;
    },
  };
};

describe('Codex quota reset', () => {
  test('clears the gateway cooldown after the credit is redeemed and before usage is re-read', async () => {
    const { calls, restore } = stubCodexResetApis(async () => ({}));

    try {
      await CODEX_CONFIG.resetQuota?.({ name: 'codex.json', authIndex: 7 }, t);
    } finally {
      restore();
    }

    expect(calls).toEqual([
      CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
      'reset-quota:7',
      CODEX_USAGE_URL,
      CODEX_RATE_LIMIT_RESET_CREDITS_URL,
    ]);
  });

  test('a retry after a failed gateway clear resumes the clear without redeeming again', async () => {
    let gatewayDown = true;
    const { calls, restore } = stubCodexResetApis(async () => {
      if (gatewayDown) throw new Error('502 gateway unavailable');
      return {};
    });
    const file = { name: 'codex-retry.json', authIndex: 8 };

    try {
      await expect(CODEX_CONFIG.resetQuota?.(file, t)).rejects.toThrow('502');
      gatewayDown = false;
      await CODEX_CONFIG.resetQuota?.(file, t);
    } finally {
      restore();
    }

    expect(calls).toEqual([
      CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
      'reset-quota:8',
      'reset-quota:8',
      CODEX_USAGE_URL,
      CODEX_RATE_LIMIT_RESET_CREDITS_URL,
    ]);
  });
});
