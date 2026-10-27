import { beforeAll, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { normalizeAuthFileCooldowns } from '@/services/api/authFileCooldowns';
import { normalizeObservedRateLimits } from '@/services/api/rateLimitSignals';
import {
  classifyUpstreamProblem,
  deriveAccountStatus,
  describeAccountStatus,
  formatClockTime,
  formatRawStatusMessage,
  type AccountStatus,
} from '@/features/quota/accountStatus';
import { AccountStatusNotice } from '@/features/quota/components/AccountStatusNotice';
import { QuotaPool } from '@/features/quota/components/QuotaPool';
import { visibleQuotaTabs } from '@/features/quota/logic';
import {
  readPoolWindows,
  summarizeProviderPools,
  type PoolAccountInput,
} from '@/features/quota/pool';
import { claudeQuotaFromObservation } from '@/features/quota/providers/claude/observed';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { usedFromRemaining } from '@/features/quota/quotaTimelineModel';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { resolveVisibleFilter } from '@/features/authFiles/logic';
import type { AuthFileItem, AuthFilesResponse, ClaudeQuotaState } from '@/types';

const t = i18n.getFixedT('en');

beforeAll(async () => {
  await i18n.changeLanguage('en');
});
const NOW = new Date(2026, 9, 26, 14, 20).getTime();
const FIVE_HOUR_RESET = new Date(2026, 9, 26, 17, 20).getTime();
const SEVEN_DAY_RESET = new Date(2026, 10, 1, 5, 0).getTime();
const RATE_LIMIT_BODY =
  '{"type":"error","error":{"type":"rate_limit_error","message":"This request would exceed your account\'s rate limit. Please try again later."}}';

/** Shape of the live v8 `quota` field for a Claude credential. */
const quotaSignals = (
  fiveHour: string,
  status = 'allowed',
  observedAt = '2026-10-26T19:04:03Z'
) => ({
  observed_at: observedAt,
  signals: {
    'Anthropic-Ratelimit-Unified-5h-Reset': String(FIVE_HOUR_RESET / 1000),
    'Anthropic-Ratelimit-Unified-5h-Status': status,
    'Anthropic-Ratelimit-Unified-5h-Utilization': fiveHour,
    'Anthropic-Ratelimit-Unified-7d-Reset': String(SEVEN_DAY_RESET / 1000),
    'Anthropic-Ratelimit-Unified-7d-Status': 'allowed',
    'Anthropic-Ratelimit-Unified-7d-Utilization': '0.25',
    'Anthropic-Ratelimit-Unified-Representative-Claim': 'five_hour',
    'Anthropic-Ratelimit-Unified-Overage-Status': 'rejected',
  },
});

const cooldowns = (records: Record<string, unknown>[], receivedAtMs = NOW) =>
  normalizeAuthFileCooldowns(records, undefined, receivedAtMs);

const limitedFile = (): AuthFileItem => ({
  name: 'claude-work.json',
  provider: 'claude',
  email: 'work@example.com',
  status: 'error',
  unavailable: true,
  statusMessage: RATE_LIMIT_BODY,
  rateLimits: normalizeObservedRateLimits(quotaSignals('0.99', 'allowed_warning')),
  cooldownSnapshot: cooldowns([
    {
      scope: 'credential',
      reason: 'credential_quota',
      retry_at: '2026-10-26T22:20:08Z',
      remaining_seconds: 3 * 3600,
    },
    {
      scope: 'model',
      model_key: 'claude-opus-5',
      reason: 'quota',
      retry_at: '2026-10-26T22:20:08Z',
      remaining_seconds: 3 * 3600,
      http_status: 429,
    },
  ]),
});

describe('observed rate-limit normalization', () => {
  test('reads Anthropic unified headers as used percent, reset instant and binding window', () => {
    const observed = normalizeObservedRateLimits(quotaSignals('0.99', 'allowed_warning'));
    expect(observed?.observedAt).toBe('2026-10-26T19:04:03.000Z');
    expect(observed?.binding).toBe('five-hour');
    expect(observed?.windows).toEqual([
      { id: 'five-hour', usedPercent: 99, resetAtMs: FIVE_HOUR_RESET, rejected: false },
      { id: 'seven-day', usedPercent: 25, resetAtMs: SEVEN_DAY_RESET, rejected: false },
    ]);
  });

  test('marks a rejected window and matches header names case-insensitively', () => {
    const observed = normalizeObservedRateLimits({
      observed_at: '2026-10-26T19:04:00Z',
      signals: {
        'anthropic-ratelimit-unified-5h-utilization': '1.0',
        'ANTHROPIC-RATELIMIT-UNIFIED-5H-STATUS': 'rejected',
      },
    });
    expect(observed?.windows).toEqual([
      { id: 'five-hour', usedPercent: 100, resetAtMs: null, rejected: true },
    ]);
    expect(observed?.binding).toBeNull();
  });

  test('per-model snapshots of the same window merge to the highest reading', () => {
    const observed = normalizeObservedRateLimits(quotaSignals('0.99', 'allowed_warning'), {
      'claude-opus-5': quotaSignals('1.0', 'rejected', '2026-10-26T19:04:00Z'),
      'claude-haiku-5-5': quotaSignals('0.68', 'allowed', '2026-10-26T18:31:55Z'),
    });
    expect(observed?.observedAt).toBe('2026-10-26T19:04:03.000Z');
    expect(observed?.windows[0]).toEqual({
      id: 'five-hour',
      usedPercent: 100,
      resetAtMs: FIVE_HOUR_RESET,
      rejected: true,
    });
  });

  test('a later window instance supersedes an older snapshot', () => {
    const older = quotaSignals('0.95', 'allowed', '2026-10-26T10:00:00Z');
    older.signals['Anthropic-Ratelimit-Unified-5h-Reset'] = String(
      FIVE_HOUR_RESET / 1000 - 5 * 3600
    );
    const observed = normalizeObservedRateLimits(quotaSignals('0.1'), { model: older });
    expect(observed?.windows[0].usedPercent).toBeCloseTo(10);
  });

  test('ignores empty, undated or non-Anthropic observations', () => {
    expect(normalizeObservedRateLimits(undefined)).toBeUndefined();
    expect(normalizeObservedRateLimits({ signals: {} })).toBeUndefined();
    expect(normalizeObservedRateLimits({ signals: quotaSignals('0.5').signals })).toBeUndefined();
    expect(
      normalizeObservedRateLimits({
        observed_at: '2026-10-26T19:04:00Z',
        signals: { 'X-Codex-Primary-Used-Percent': '40' },
      })
    ).toBeUndefined();
  });

  test('the credentials list attaches the observation to each file', () => {
    const response = normalizeAuthFilesResponse({
      observed_at: '2026-10-26T19:21:08Z',
      files: [{ name: 'claude-a.json', provider: 'claude', quota: quotaSignals('0.19') }],
    } as unknown as AuthFilesResponse);
    expect(response.files[0].rateLimits?.windows[0].usedPercent).toBe(19);
  });
});

describe('account status', () => {
  test('a credential quota cooldown reads as the binding window limit with a return time', () => {
    const status = deriveAccountStatus(limitedFile(), NOW);
    expect(status).toEqual({
      kind: 'limited',
      window: 'five-hour',
      backAtMs: NOW + 3 * 3600 * 1000,
    });
    const description = describeAccountStatus(
      { kind: 'limited', window: 'five-hour', backAtMs: FIVE_HOUR_RESET },
      t,
      NOW,
      'en'
    );
    expect(description).toEqual({
      tone: 'danger',
      headline: '5-hour limit reached',
      when: 'back at 17:20 (in 3 hours)',
    });
  });

  test('a rejected window limits the account even without a cooldown record', () => {
    const file: AuthFileItem = {
      name: 'a.json',
      provider: 'claude',
      rateLimits: normalizeObservedRateLimits(quotaSignals('1.0', 'rejected')),
    };
    expect(deriveAccountStatus(file, NOW)).toEqual({
      kind: 'limited',
      window: 'five-hour',
      backAtMs: FIVE_HOUR_RESET,
    });
    expect(deriveAccountStatus(file, FIVE_HOUR_RESET + 1)).toEqual({ kind: 'available' });
  });

  test('model-only and non-quota cooldowns stay distinct from a full limit', () => {
    const modelOnly: AuthFileItem = {
      name: 'a.json',
      cooldownSnapshot: cooldowns([
        {
          scope: 'model',
          model_key: 'm1',
          reason: 'quota',
          retry_at: '2026-10-26T20:00:00Z',
          remaining_seconds: 600,
        },
        {
          scope: 'model',
          model_key: 'm2',
          reason: 'quota',
          retry_at: '2026-10-26T20:00:00Z',
          remaining_seconds: 1200,
        },
      ]),
    };
    expect(deriveAccountStatus(modelOnly, NOW)).toEqual({
      kind: 'models-limited',
      modelCount: 2,
      backAtMs: NOW + 600_000,
    });

    const transient: AuthFileItem = {
      name: 'a.json',
      cooldownSnapshot: cooldowns([
        {
          scope: 'credential',
          reason: 'transient_error',
          retry_at: '2026-10-26T20:00:00Z',
          remaining_seconds: 300,
        },
      ]),
    };
    const status = deriveAccountStatus(transient, NOW);
    expect(status).toEqual({ kind: 'paused', reason: 'transient_error', backAtMs: NOW + 300_000 });
    expect(describeAccountStatus(status, t, NOW, 'en').headline).toBe(
      'Paused: Transient upstream error'
    );
  });

  test('elapsed cooldowns fall through to the last upstream error, classified', () => {
    const file = limitedFile();
    const afterCooldown = NOW + 3 * 3600 * 1000 + 1;
    expect(deriveAccountStatus(file, afterCooldown)).toEqual({
      kind: 'failing',
      problem: 'rate-limited',
    });
    expect(
      describeAccountStatus({ kind: 'failing', problem: 'rate-limited' }, t, NOW).headline
    ).toBe('Rate-limited on the last request');
  });

  test('disabled and healthy accounts', () => {
    expect(deriveAccountStatus({ ...limitedFile(), disabled: true }, NOW)).toEqual({
      kind: 'disabled',
    });
    expect(
      deriveAccountStatus({ name: 'ok.json', status: 'active', statusMessage: 'ok' }, NOW)
    ).toEqual({
      kind: 'available',
    });
  });

  test('classifies upstream problems from raw messages', () => {
    expect(classifyUpstreamProblem(RATE_LIMIT_BODY)).toBe('rate-limited');
    expect(classifyUpstreamProblem('token expired')).toBe('auth');
    expect(classifyUpstreamProblem('{"error":{"type":"overloaded_error"}}')).toBe('overloaded');
    expect(classifyUpstreamProblem('socket hang up')).toBe('unknown');
  });

  test('clock times name the weekday only when the instant is on another day', () => {
    expect(formatClockTime(FIVE_HOUR_RESET, NOW, 'en')).toBe('17:20');
    expect(formatClockTime(SEVEN_DAY_RESET, NOW, 'en')).toBe('Sun 05:00');
  });

  test('raw JSON bodies are pretty-printed for the details disclosure', () => {
    expect(formatRawStatusMessage(RATE_LIMIT_BODY)).toContain('\n  "type": "error"');
    expect(formatRawStatusMessage('plain text')).toBe('plain text');
  });

  test('the notice leads with plain status and keeps the raw body behind details', () => {
    const markup = renderToStaticMarkup(
      createElement(AccountStatusNotice, {
        file: limitedFile(),
        status: { kind: 'limited', window: 'five-hour', backAtMs: FIVE_HOUR_RESET },
        now: NOW,
      })
    );
    expect(markup).toContain('5-hour limit reached');
    const [beforeDetails, insideDetails] = markup.split('<details');
    expect(beforeDetails).not.toContain('rate_limit_error');
    expect(insideDetails).toContain('rate_limit_error');
  });
});

describe('used percent everywhere', () => {
  test('timeline headroom converts to rounded, clamped percent used', () => {
    expect(usedFromRemaining(0)).toBe(100);
    expect(usedFromRemaining(18.4)).toBe(82);
    expect(usedFromRemaining(120)).toBe(0);
  });

  test('a Claude card row labels the figure as used', () => {
    const classes = bindQuotaClasses(
      Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
      'test-host'
    );
    const quota: ClaudeQuotaState = {
      status: 'success',
      windows: [
        {
          id: 'five-hour',
          label: '5-hour limit',
          usedPercent: 100,
          resetLabel: '-',
          resetAtMs: null,
          periodHours: 5,
        },
      ],
    };
    const markup = renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota, classes }));
    expect(markup).toContain('100% used');
    expect(markup).toContain('width:100%');
  });

  test('an observation renders through the same Claude state shape', () => {
    const observed = claudeQuotaFromObservation({
      observation: normalizeObservedRateLimits(quotaSignals('0.19'))!,
      status: { kind: 'available' },
      t,
    });
    expect(observed.status).toBe('success');
    expect(observed.observedAt).toBe('2026-10-26T19:04:03.000Z');
    expect(
      observed.windows.map(({ id, usedPercent, periodHours, resetAtMs }) => ({
        id,
        usedPercent,
        periodHours,
        resetAtMs,
      }))
    ).toEqual([
      { id: 'five-hour', usedPercent: 19, periodHours: 5, resetAtMs: FIVE_HOUR_RESET },
      { id: 'seven-day', usedPercent: 25, periodHours: 168, resetAtMs: SEVEN_DAY_RESET },
    ]);
  });

  test('a window the account is limited on reads as fully used', () => {
    const observed = claudeQuotaFromObservation({
      observation: normalizeObservedRateLimits(quotaSignals('0.9'))!,
      status: { kind: 'limited', window: 'five-hour', backAtMs: FIVE_HOUR_RESET },
      t,
    });
    expect(observed.windows.map((window) => window.usedPercent)).toEqual([100, 25]);
  });
});

describe('pooled quota', () => {
  const claudeAccount = (
    name: string,
    fiveHour: string,
    status: AccountStatus = { kind: 'available' }
  ): PoolAccountInput => ({
    name,
    displayName: name,
    provider: 'claude',
    status,
    quota: claudeQuotaFromObservation({
      observation: normalizeObservedRateLimits(quotaSignals(fiveHour))!,
      status,
      t,
    }),
  });

  test('keeps each account and its own windows, a limited account reading as full', () => {
    const limited: AccountStatus = {
      kind: 'limited',
      window: 'five-hour',
      backAtMs: FIVE_HOUR_RESET,
    };
    const [pool] = summarizeProviderPools(
      [claudeAccount('work', '0.99', limited), claudeAccount('personal', '0.19')],
      NOW
    );
    expect(pool.provider).toBe('claude');
    expect(pool.accounts).toEqual([
      {
        name: 'work',
        displayName: 'work',
        status: limited,
        windows: {
          'five-hour': { usedPercent: 100, resetAtMs: FIVE_HOUR_RESET },
          'seven-day': { usedPercent: 25, resetAtMs: SEVEN_DAY_RESET },
        },
      },
      {
        name: 'personal',
        displayName: 'personal',
        status: { kind: 'available' },
        windows: {
          'five-hour': { usedPercent: 19, resetAtMs: FIVE_HOUR_RESET },
          'seven-day': { usedPercent: 25, resetAtMs: SEVEN_DAY_RESET },
        },
      },
    ]);
  });

  test('a window whose reset has passed counts as empty', () => {
    expect(readPoolWindows(claudeAccount('a', '0.8'), FIVE_HOUR_RESET + 1)['five-hour']).toEqual({
      usedPercent: 0,
      resetAtMs: null,
    });
  });

  test('an account without a reading has no windows, not zero', () => {
    const [pool] = summarizeProviderPools(
      [
        {
          name: 'unseen',
          displayName: 'unseen',
          provider: 'claude',
          quota: undefined,
          status: { kind: 'available' },
        },
      ],
      NOW
    );
    expect(pool.accounts[0].windows).toEqual({ 'five-hour': null, 'seven-day': null });
  });

  test('Codex weekly maps to the 7-day column; providers without these windows are skipped', () => {
    const pools = summarizeProviderPools(
      [
        {
          name: 'codex-a',
          displayName: 'codex-a',
          provider: 'codex',
          status: { kind: 'available' },
          quota: {
            status: 'success',
            windows: [{ id: 'weekly', usedPercent: 30, resetAtMs: SEVEN_DAY_RESET }],
          } as never,
        },
        {
          name: 'kimi-a',
          displayName: 'kimi-a',
          provider: 'kimi',
          status: { kind: 'available' },
          quota: undefined,
        },
      ],
      NOW
    );
    expect(pools.map((pool) => pool.provider)).toEqual(['codex']);
    expect(pools[0].accounts[0].windows).toEqual({
      'five-hour': null,
      'seven-day': { usedPercent: 30, resetAtMs: SEVEN_DAY_RESET },
    });
  });

  test('renders one row per account with its own usage and reset', () => {
    const limited: AccountStatus = {
      kind: 'limited',
      window: 'five-hour',
      backAtMs: FIVE_HOUR_RESET,
    };
    const pools = summarizeProviderPools(
      [claudeAccount('work', '0.99', limited), claudeAccount('personal', '0.19')],
      NOW
    );
    const markup = renderToStaticMarkup(
      createElement(QuotaPool, { pools, now: NOW, resolvedTheme: 'light' })
    );
    expect(markup).toContain('2 accounts');
    expect(markup).toContain('1 of 2 available');
    expect(markup).toContain('5-hour limit reached');
    expect(markup).toContain('100% used');
    expect(markup).toContain('19% used');
    expect(markup).toContain('in 3 hours');
    expect(markup).not.toContain('of 200%');
  });
});

describe('empty provider filtering', () => {
  test('quota tabs keep only providers that have credentials', () => {
    expect(visibleQuotaTabs({ all: 2, claude: 2, codex: 0, kimi: 0 })).toEqual(['all', 'claude']);
    expect(visibleQuotaTabs({ all: 0 })).toEqual(['all']);
  });

  test('a remembered filter for a provider with no credentials falls back to all', () => {
    expect(resolveVisibleFilter('codex', ['all', 'claude'])).toBe('all');
    expect(resolveVisibleFilter('claude', ['all', 'claude'])).toBe('claude');
  });
});
