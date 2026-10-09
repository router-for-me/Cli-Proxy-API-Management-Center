import { afterEach, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { normalizeClaudeUsageSnapshot } from '@/services/api/claudeUsage';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { apiCallApi, getApiCallErrorMessage, type ApiCallResult } from '@/services/api/apiCall';
import { apiClient } from '@/services/api/client';
import {
  CLAUDE_CONFIG,
  hasClaudeUsageData,
  resolveClaudeQuota,
} from '@/features/quota/providers/claude/data';
import { ClaudeQuotaBody } from '@/features/quota/providers/claude/ClaudeQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';
import { CLAUDE_PROFILE_URL, CLAUDE_USAGE_URL, formatQuotaResetTime } from '@/utils/quota';
import type { AuthFilesResponse, ClaudeQuotaState } from '@/types';
import fixture from './fixtures/claude-oauth-usage.json';

const observedAt = '2026-10-10T00:00:00Z';
const groupedSnapshot = {
  observed_at: observedAt,
  five_hour: fixture.five_hour,
  seven_day: fixture.seven_day,
  extra_usage: fixture.extra_usage,
  dollar_windows: {
    iguana_necktie: fixture.iguana_necktie,
    additional_credit_balance: fixture.additional_credit_balance,
  },
};
const file = { name: 'claude-fixture.json', type: 'claude', authIndex: 'synthetic-index' };
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'claude-usage-test'
);
const result = (
  statusCode: number,
  body: unknown,
  extra: Partial<ApiCallResult> = {}
): ApiCallResult => ({
  statusCode,
  header: {},
  body,
  bodyText: JSON.stringify(body),
  ...extra,
});
const snapshot = normalizeClaudeUsageSnapshot(groupedSnapshot)!;
const quota: ClaudeQuotaState = {
  status: 'success',
  windows: [],
  extraUsage: snapshot.extraUsage,
  dollarWindows: snapshot.dollarWindows,
  observedAt,
};
const render = (state: ClaudeQuotaState) =>
  renderToStaticMarkup(createElement(ClaudeQuotaBody, { quota: state, classes }));

beforeAll(async () => {
  await i18n.changeLanguage('en');
});

describe('Claude OAuth usage API normalization', () => {
  test('preserves every extra-usage field and discovers independent dollar balances', () => {
    const normalized = normalizeClaudeUsageSnapshot(fixture)!;
    expect(normalized.fiveHour).toEqual({
      utilization: 42.5,
      resetsAt: fixture.five_hour.resets_at,
    });
    expect(normalized.sevenDay?.utilization).toBe(16);
    expect(normalized.extraUsage).toEqual({
      isEnabled: true,
      monthlyLimit: 5000,
      usedCredits: 1250,
      utilization: 25,
      currency: 'USD',
      disabledReason: null,
      userDisabled: false,
      spendLimitReached: false,
    });
    expect(normalized.dollarWindows.map((balance) => balance.key)).toEqual([
      'iguana_necktie',
      'additional_credit_balance',
    ]);
    expect(normalized.dollarWindows[0]).toMatchObject({
      limitDollars: 100,
      usedDollars: 5.043595,
      remainingDollars: 94.956405,
      resetsAt: '2026-11-01T00:00:00Z',
    });
    expect(normalized.dollarWindows[1]).toMatchObject({
      usedDollars: 0,
      remainingDollars: 20,
      utilization: 0,
      resetsAt: null,
    });
    expect(normalized.observedAt).toBeNull();
  });

  test('normalizes the grouped backend snapshot to the same data', () => {
    expect(snapshot).toEqual({
      ...normalizeClaudeUsageSnapshot(fixture),
      observedAt,
    });
  });

  test('retains null, false, and zero without fabricating values', () => {
    const normalized = normalizeClaudeUsageSnapshot({
      five_hour: { utilization: null, resets_at: null },
      seven_day: null,
      extra_usage: {
        is_enabled: false,
        monthly_limit: 0,
        used_credits: 0,
        utilization: null,
        currency: 'EUR',
        disabled_reason: 'user_disabled',
        user_disabled: true,
        spend_limit_reached: false,
      },
      future_upstream_key: {
        limit_dollars: null,
        used_dollars: 0,
        remaining_dollars: null,
        utilization: null,
        resets_at: null,
      },
    })!;
    expect(normalized.fiveHour).toEqual({ utilization: null, resetsAt: null });
    expect(normalized.sevenDay).toBeNull();
    expect(normalized.extraUsage).toMatchObject({
      isEnabled: false,
      monthlyLimit: 0,
      usedCredits: 0,
      currency: 'EUR',
      disabledReason: 'user_disabled',
      userDisabled: true,
      spendLimitReached: false,
    });
    expect(normalized.dollarWindows[0]).toEqual({
      key: 'future_upstream_key',
      limitDollars: null,
      usedDollars: 0,
      remainingDollars: null,
      utilization: null,
      resetsAt: null,
    });
  });

  test('ignores incomplete balances and unrelated payloads', () => {
    expect(normalizeClaudeUsageSnapshot({ error: 'failed' })).toBeNull();
    expect(normalizeClaudeUsageSnapshot(null)).toBeNull();
    expect(normalizeClaudeUsageSnapshot([])).toBeNull();
    expect(
      normalizeClaudeUsageSnapshot({ five_hour: null, partial: { used_dollars: 5 } })
    ).toMatchObject({ fiveHour: null, dollarWindows: [] });
  });

  test('surfaces cached usage on credential listings', () => {
    const files = normalizeAuthFilesResponse({
      files: [{ ...file, claude_usage: groupedSnapshot, claude_usage_stale: true }],
    } as AuthFilesResponse);
    expect(files.files[0].claudeUsage).toEqual(snapshot);
    expect(files.files[0].claudeUsageStale).toBe(true);
  });

  test('uses the authenticated API client and a safe error outside the retained body', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      status_code: 429,
      header: {},
      body: JSON.stringify(fixture),
      claude_usage: groupedSnapshot,
      stale: true,
      error: 'Claude usage upstream request failed',
    });
    try {
      const request = { authIndex: file.authIndex, method: 'GET', url: CLAUDE_USAGE_URL };
      const response = await apiCallApi.request(request);
      expect(post).toHaveBeenCalledWith('/requests/api-call', request, undefined);
      expect(response.claudeUsage).toEqual(snapshot);
      expect(response.body).toEqual(fixture);
      expect(response.stale).toBe(true);
      expect(getApiCallErrorMessage(response)).toBe('429 Claude usage upstream request failed');
    } finally {
      post.mockRestore();
    }
  });
});

describe('Claude quota usage reads', () => {
  const originalRequest = apiCallApi.request;
  afterEach(() => {
    apiCallApi.request = originalRequest;
  });

  test('uses existing quota reads and separates dollar balances from plan windows', async () => {
    const requests: Parameters<typeof apiCallApi.request>[0][] = [];
    apiCallApi.request = async (request) => {
      requests.push(request);
      return request.url === CLAUDE_USAGE_URL
        ? result(200, fixture, { claudeUsage: snapshot })
        : result(200, { account: { has_claude_max: true } });
    };
    const data = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
    expect(requests.map((request) => request.url)).toEqual([CLAUDE_USAGE_URL, CLAUDE_PROFILE_URL]);
    expect(requests[0]).toMatchObject({
      method: 'GET',
      authIndex: file.authIndex,
      header: {
        Authorization: 'Bearer $TOKEN$',
        Accept: 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
      },
    });
    expect(data.windows.map((window) => window.id)).toEqual([
      'five-hour',
      'seven-day',
      'seven-day-sonnet',
    ]);
    expect(data.dollarWindows).toEqual(snapshot.dollarWindows);
    expect(data.extraUsage?.usedCredits).toBe(1250);
    expect(data.planType).toBe('plan_max');
    expect(data.observedAt).toBe(observedAt);
  });

  test('retains the upstream last-good snapshot on a failed read', async () => {
    apiCallApi.request = async (request) =>
      request.url === CLAUDE_USAGE_URL
        ? result(429, fixture, {
            claudeUsage: snapshot,
            stale: true,
            error: 'Claude usage upstream request failed',
          })
        : result(503, { error: 'profile unavailable' });
    const data = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
    const state = CLAUDE_CONFIG.buildSuccessState(data);
    expect(state.status).toBe('error');
    expect(state.stale).toBe(true);
    expect(state.observedAt).toBe(observedAt);
    expect(state.extraUsage).toEqual(snapshot.extraUsage);
    expect(state.dollarWindows).toEqual(snapshot.dollarWindows);
    expect(state.error).toBe('429 Claude usage upstream request failed');
  });

  test('does not fabricate a snapshot when a read fails without cached data', async () => {
    apiCallApi.request = async () => result(401, { error: 'usage unavailable' });
    await expect(CLAUDE_CONFIG.fetchQuota(file, i18n.t)).rejects.toThrow('401 usage unavailable');
  });

  test('preserves legacy Fable-only payloads and partial credit pools', async () => {
    for (const window of [
      { utilization: 41, resets_at: fixture.seven_day.resets_at },
      { utilization: 5, remaining_dollars: 95, resets_at: fixture.seven_day.resets_at },
    ]) {
      apiCallApi.request = async (request) =>
        request.url === CLAUDE_USAGE_URL
          ? result(200, { iguana_necktie: window })
          : result(503, null);
      const data = await CLAUDE_CONFIG.fetchQuota(file, i18n.t);
      expect(data.windows).toHaveLength(1);
      expect(data.windows[0].id).toBe(
        'remaining_dollars' in window ? 'cloud-session-credits' : 'seven-day-fable'
      );
      expect(data.dollarWindows).toEqual([]);
    }
  });

  test('seeds the display from a listing without issuing another upstream read', () => {
    const listedFile = { ...file, claudeUsage: snapshot, claudeUsageStale: true };
    const state = resolveClaudeQuota(listedFile, undefined, i18n.t)!;
    expect(state.windows.map((window) => window.id)).toEqual(['five-hour', 'seven-day']);
    expect(state.extraUsage).toEqual(snapshot.extraUsage);
    expect(state.dollarWindows).toEqual(snapshot.dollarWindows);
    expect(state.stale).toBe(true);
    expect(hasClaudeUsageData(state)).toBe(true);
    expect(resolveClaudeQuota(listedFile, quota, i18n.t)).toBe(quota);
    expect(resolveClaudeQuota(file, undefined, i18n.t)).toBeUndefined();
  });
});

describe('Claude usage snapshot rendering and retention', () => {
  beforeEach(() => {
    useQuotaStore.getState().clearQuotaCache();
  });

  test('keeps a read-only quota refresh action for seeded auth-file snapshots', () => {
    // This host imports SCSS modules, so cover the action wiring here and
    // verify its interaction with the production build in the browser.
    const source = readFileSync(
      new URL('../src/features/authFiles/components/AuthFileQuotaSection.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain(
      "const showRefreshQuotaAction = quotaType === 'devin' || quotaType === 'claude';"
    );
    expect(source).toContain('resetQuotaAction || showRefreshQuotaAction');
    expect(source).toContain('{showRefreshQuotaAction && (');
    expect(source).toContain('onClick={() => void refreshQuotaForFile()}');
    expect(source).toContain("disabled={!canRefreshQuota || quotaStatus === 'loading'}");
  });

  test('renders enabled extra usage in minor units and each balance in dollars', () => {
    const markup = render(quota);
    expect(markup).toContain('Extra Usage');
    expect(markup).toContain('Enabled');
    expect(markup).toContain('Spent $12.50 / Limit $50.00');
    expect(markup).toContain('25% used');
    expect(markup).toContain('iguana_necktie');
    expect(markup).toContain('$94.96 remaining');
    expect(markup).toContain('Spent $5.04 / Limit $100.00');
    expect(markup).toContain(formatQuotaResetTime(fixture.iguana_necktie.resets_at));
    expect(markup).toContain('additional_credit_balance');
    expect(markup).toContain('$20.00 remaining');
    expect(markup).toContain('Spent $0.00 / Limit $20.00');
    expect(markup).toContain('Not provided');
    expect(markup).not.toContain('No quota data available');
  });

  test('renders disabled extra usage, reasons, and zero amounts', () => {
    const markup = render({
      ...quota,
      extraUsage: {
        ...snapshot.extraUsage!,
        isEnabled: false,
        usedCredits: 0,
        monthlyLimit: 0,
        utilization: 0,
        userDisabled: true,
        spendLimitReached: true,
        disabledReason: 'user_disabled',
      },
    });
    expect(markup).toContain('Disabled');
    expect(markup).toContain('Spent $0.00 / Limit $0.00');
    expect(markup).toContain('Disabled by user');
    expect(markup).toContain('Spending limit reached');
    expect(markup).toContain('Reason: user_disabled');
  });

  test('shows the last observation time when a retained snapshot is stale', () => {
    const markup = render({ ...quota, status: 'error', stale: true });
    expect(markup).toContain('role="status"');
    expect(markup).toContain('Showing last successful check:');
    expect(markup).toContain(new Date(observedAt).toLocaleString('en'));
    expect(markup).toContain('$94.96 remaining');
  });

  test('keeps the last good data during loading and errors, then recovers', () => {
    const store = useQuotaStore.getState();
    store.setClaudeQuota({ [file.name]: quota });
    store.setClaudeQuota({ [file.name]: CLAUDE_CONFIG.buildLoadingState() });
    let retained = useQuotaStore.getState().claudeQuota[file.name];
    expect(retained.status).toBe('loading');
    expect(retained.extraUsage).toEqual(quota.extraUsage);
    expect(retained.dollarWindows).toEqual(quota.dollarWindows);
    store.setClaudeQuota({ [file.name]: CLAUDE_CONFIG.buildErrorState('network failed', 502) });
    retained = useQuotaStore.getState().claudeQuota[file.name];
    expect(retained.status).toBe('error');
    expect(retained.stale).toBe(true);
    expect(retained.observedAt).toBe(observedAt);
    expect(retained.dollarWindows).toEqual(quota.dollarWindows);
    const recovered = { ...quota, observedAt: '2026-10-10T01:00:00Z', stale: false };
    store.setClaudeQuota({ [file.name]: recovered });
    expect(useQuotaStore.getState().claudeQuota[file.name]).toEqual(recovered);
  });

  test('does not retain balances across file replacement or session invalidation', () => {
    const store = useQuotaStore.getState();
    store.setClaudeQuota({ [file.name]: quota });
    const pending = captureQuotaCacheGeneration(file.name);
    store.clearQuotaCache([file.name]);
    expect(
      commitIfQuotaCacheCurrent(pending, () => store.setClaudeQuota({ [file.name]: quota }))
    ).toBe(false);
    store.setClaudeQuota({ [file.name]: CLAUDE_CONFIG.buildErrorState('new account read failed') });
    expect(hasClaudeUsageData(useQuotaStore.getState().claudeQuota[file.name])).toBe(false);
    store.setClaudeQuota({ [file.name]: quota });
    const previousSession = captureQuotaCacheGeneration(file.name);
    store.clearQuotaCache();
    expect(
      commitIfQuotaCacheCurrent(previousSession, () => store.setClaudeQuota({ [file.name]: quota }))
    ).toBe(false);
    expect(useQuotaStore.getState().claudeQuota).toEqual({});
  });
});
