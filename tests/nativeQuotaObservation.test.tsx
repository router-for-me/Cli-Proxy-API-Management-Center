import { afterEach, beforeEach, expect, setSystemTime, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n';
import {
  observationAge,
  browserResetDisplay,
  withQuotaObservation,
} from '../src/features/quota/observationFormat';
import { AuthFileObservation } from '../src/features/quota/authFileObservation';
import { CodexQuotaBody } from '../src/features/quota/providers/codex/CodexQuotaBody';
import { CODEX_CONFIG } from '../src/features/quota/providers/codex/data';
import { apiCallApi, type ApiCallResult } from '../src/services/api';
import type { TFunction } from 'i18next';
import { CODEX_USAGE_URL, CODEX_RATE_LIMIT_RESET_CREDITS_URL } from '../src/utils/quota';
import { QUOTA_CLASS_KEYS, type QuotaClassMap } from '../src/features/quota/types';
import type { CodexQuotaState } from '../src/types';

const originalRequest = apiCallApi.request;
let originalLanguage: string;
beforeEach(async () => {
  originalLanguage = i18n.language;
  await i18n.changeLanguage('en');
});
afterEach(async () => {
  apiCallApi.request = originalRequest;
  setSystemTime();
  await i18n.changeLanguage(originalLanguage);
});

test('age uses the captured instant, preserves missing observations and clamps future clocks', () => {
  const captured = '2026-01-01T00:00:00.000Z';
  const now = Date.parse(captured) + 24_000;
  expect(observationAge(undefined, now)).toBeNull();
  expect(observationAge('invalid', now)).toBeNull();
  expect(observationAge(captured, now)?.compact).toBe(
    new Intl.NumberFormat(undefined, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
    }).format(24)
  );
  expect(observationAge(captured, now)?.relative).toBe(
    new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(-24, 'second')
  );
  expect(observationAge(captured, now)?.timestamp).toBe(
    new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'long' }).format(
      Date.parse(captured)
    )
  );
  expect(observationAge(captured, now + 901_000)?.stale).toBe(true);
  expect(observationAge(captured, now - 100_000)?.compact).toBe(
    new Intl.NumberFormat(undefined, {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
    }).format(0)
  );
  expect(withQuotaObservation({ capturedAt: captured }, '2026-01-02T00:00:00Z').capturedAt).toBe(
    captured
  );
});

test('reset dates follow browser regional time preferences instead of a cached formatted label', () => {
  const at = Date.parse('2026-11-02T18:35:00Z');
  const display = browserResetDisplay('old display', at, at - 86_400_000, 'zh-CN');
  expect(display?.absolute).toBe(
    new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(at)
  );
  expect(display?.relative).toBe(
    new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(1, 'day')
  );
  expect(browserResetDisplay('unknown instant', null, at)?.absolute).toBe('unknown instant');
});

test('quota usage capture precedes slower metadata reads and survives later cache access', async () => {
  const captured = '2026-01-01T00:00:00.000Z';
  setSystemTime(new Date(captured));
  apiCallApi.request = async (request) => {
    if (request.url === CODEX_USAGE_URL)
      return {
        statusCode: 200,
        body: {
          plan_type: 'pro',
          credits: { balance: '12.5' },
          rate_limit: {
            primary_window: {
              used_percent: 14,
              limit_window_seconds: 604800,
              reset_after_seconds: 3600,
            },
          },
        },
      } as ApiCallResult;
    if (request.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL) {
      setSystemTime(new Date('2026-01-01T00:00:10Z'));
      return { statusCode: 200, body: { available_count: 1, credits: [] } } as ApiCallResult;
    }
    throw new Error('Unexpected fixture request');
  };
  const data = await CODEX_CONFIG.fetchQuota(
    { name: 'fixture.json', auth_index: 'fixture:1', type: 'codex' },
    ((key: string) => key) as TFunction
  );
  const state = CODEX_CONFIG.buildSuccessState(data);
  expect(state.capturedAt).toBe(captured);
  expect(state.windows[0].resetAtMs).toBe(Date.parse(captured) + 3600_000);
  expect(withQuotaObservation(state, new Date().toISOString()).capturedAt).toBe(captured);
  expect(state.creditBalance).toBe('12.5');
  expect(CODEX_CONFIG.canResetQuota?.(state)).toBe(true);
});

test('inline age keeps native plan, credits, manual-reset expiry and provider windows', () => {
  const classes = Object.fromEntries(
    QUOTA_CLASS_KEYS.map((key) => [key, key])
  ) as unknown as QuotaClassMap;
  const quota: CodexQuotaState = {
    status: 'success',
    planType: 'pro',
    creditBalance: '12.5',
    subscriptionActiveUntil: '2026-11-01T12:00:00Z',
    capturedAt: new Date().toISOString(),
    source: 'provider_query',
    rateLimitResetCreditsAvailableCount: 1,
    rateLimitResetCredits: [
      {
        id: 'reset',
        status: 'available',
        grantedAt: '2026-01-01T00:00:00Z',
        expiresAt: '2026-10-29T12:00:00Z',
      },
    ],
    windows: [
      {
        id: 'weekly',
        label: 'Weekly limit',
        usedPercent: 14,
        resetAtMs: Date.parse('2026-10-09T12:00:00Z'),
        resetLabel: '',
        periodHours: 168,
      },
    ],
  };
  const native = renderToStaticMarkup(createElement(CodexQuotaBody, { quota, classes }));
  const inline = renderToStaticMarkup(
    createElement(
      AuthFileObservation.Provider,
      { value: quota },
      createElement(CodexQuotaBody, { quota, classes })
    )
  );
  for (const content of [
    i18n.t('codex_quota.plan_pro'),
    '12.5',
    'Manual resets',
    'Manual reset expiry',
    'Weekly limit',
    '86%',
  ])
    expect(inline).toContain(content);
  expect(inline).toContain('aria-label="Last updated:');
  expect(native).not.toContain('aria-label="Last updated:');
  expect(inline).not.toContain('secondary');
  expect(inline.match(/<svg/g)?.length).toBe(1);
});
