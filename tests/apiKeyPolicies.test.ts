import { describe, expect, test } from 'bun:test';
import {
  createApiKeyPolicy,
  daysUntilExpiry,
  expiresAtToDateInput,
  isApiKeyPolicyEmpty,
  parseApiKeyPolicies,
  parseModelPatterns,
  parseModelPrices,
  serializeApiKeyPolicies,
  serializeModelPrices,
} from '@/features/config/apiKeyPolicies';
import { aggregateModelUsage, normalizeApiKeyPolicyUsage } from '@/services/api/apiKeyPolicyUsage';

describe('api key policies', () => {
  test('round-trips every policy field through YAML names', () => {
    const raw = [
      {
        key: 'sk-a',
        name: ' Team A ',
        disabled: true,
        'allowed-auths': ['a1', ' b2 '],
        'allowed-models': ['gpt-5*'],
        'expires-at': '2027-01-01',
        limits: { 'tokens-per-day': 1000, 'cost-per-month': 50, 'cost-per-week': -1 },
      },
      { key: '', name: 'dropped' },
      'not-a-policy',
    ];
    const parsed = parseApiKeyPolicies(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Team A');
    expect(parsed[0].allowedAuths).toEqual(['a1', 'b2']);
    expect(parsed[0].limits.tokensPerDay).toBe(1000);
    expect(parsed[0].limits.costPerWeek).toBe(0);
    expect(serializeApiKeyPolicies(parsed, ['sk-a'])).toEqual([
      {
        key: 'sk-a',
        name: 'Team A',
        disabled: true,
        'allowed-auths': ['a1', 'b2'],
        'allowed-models': ['gpt-5*'],
        'expires-at': '2027-01-01',
        limits: { 'tokens-per-day': 1000, 'cost-per-month': 50 },
      },
    ]);
  });

  test('drops empty policies and policies for removed keys', () => {
    const empty = createApiKeyPolicy('sk-a');
    expect(isApiKeyPolicyEmpty(empty)).toBe(true);
    const limited = { ...createApiKeyPolicy('sk-b'), limits: { ...empty.limits, costPerDay: 1 } };
    expect(isApiKeyPolicyEmpty(limited)).toBe(false);
    expect(serializeApiKeyPolicies([empty, limited], ['sk-a', 'sk-b'])).toEqual([
      { key: 'sk-b', limits: { 'cost-per-day': 1 } },
    ]);
    expect(serializeApiKeyPolicies([limited], ['sk-a'])).toEqual([]);
  });

  test('model patterns accept lines and commas', () => {
    expect(parseModelPatterns('gpt-5*\n claude-*, gpt-5*\n\n')).toEqual(['gpt-5*', 'claude-*']);
  });

  test('model prices keep only named rows', () => {
    const prices = parseModelPrices([
      { model: 'gpt-5*', input: 1.25, output: 10, 'cached-input': 0.125 },
      { input: 3 },
    ]);
    expect(prices).toEqual([{ model: 'gpt-5*', input: 1.25, output: 10, cachedInput: 0.125 }]);
    expect(
      serializeModelPrices([...prices, { model: ' ', input: 1, output: 0, cachedInput: 0 }])
    ).toEqual([{ model: 'gpt-5*', input: 1.25, output: 10, 'cached-input': 0.125 }]);
  });

  test('expiry helpers match backend semantics', () => {
    const now = new Date(2026, 10, 15, 12, 0, 0);
    expect(daysUntilExpiry('', now)).toBeNull();
    expect(daysUntilExpiry('2026-11-15', now)).toBe(0);
    expect(daysUntilExpiry('2026-11-25', now)).toBe(10);
    expect(daysUntilExpiry('2026-11-14', now)).toBe(-1);
    expect(daysUntilExpiry('garbage', now)).toBe(-1);
    expect(expiresAtToDateInput('2026-11-20')).toBe('2026-11-20');
    expect(expiresAtToDateInput('')).toBe('');
  });

  test('normalizes the usage endpoint payload', () => {
    const usage = normalizeApiKeyPolicyUsage({
      keys: [
        {
          key: 'sk-a',
          expired: false,
          usage: {
            day: { tokens: 12, cost: 0.5, requests: 2, reset_at: '2026-11-16T00:00:00+03:00' },
            total: {
              tokens: 12,
              requests: 2,
              failed: 1,
              models: [
                {
                  model: 'gpt-5.1',
                  requests: 2,
                  failed: 1,
                  input_tokens: 9,
                  output_tokens: 3,
                  tokens: 12,
                },
                { requests: 1 },
              ],
            },
          },
        },
        { nope: true },
      ],
    });
    expect(usage).toHaveLength(1);
    expect(usage[0].name).toBe('');
    expect(usage[0].usage.day).toEqual({
      tokens: 12,
      cost: 0.5,
      requests: 2,
      failed: 0,
      resetAt: '2026-11-16T00:00:00+03:00',
      models: [],
      rejected: 0,
      rejectedReasons: {},
      lastRejectedAt: '',
    });
    expect(usage[0].usage.month.tokens).toBe(0);
    expect(usage[0].usage.total.resetAt).toBe('');
    expect(usage[0].usage.total.models).toEqual([
      {
        model: 'gpt-5.1',
        requests: 2,
        failed: 1,
        inputTokens: 9,
        outputTokens: 3,
        cachedTokens: 0,
        cacheWriteTokens: 0,
        reasoningTokens: 0,
        tokens: 12,
        cost: 0,
      },
    ]);
  });

  test('aggregates model usage across keys', () => {
    const usage = normalizeApiKeyPolicyUsage({
      keys: [
        {
          key: 'sk-a',
          name: ' Team A ',
          usage: { week: { models: [{ model: 'm1', requests: 1, tokens: 5, cost: 0.1 }] } },
        },
        {
          key: 'sk-b',
          usage: {
            week: {
              models: [
                { model: 'm2', requests: 1, tokens: 50 },
                { model: 'm1', requests: 2, tokens: 10, cost: 0.2 },
              ],
            },
          },
        },
      ],
    });
    expect(usage[0].name).toBe('Team A');
    const rows = aggregateModelUsage(usage, 'week');
    expect(rows.map((r) => [r.model, r.requests, r.tokens])).toEqual([
      ['m2', 1, 50],
      ['m1', 3, 15],
    ]);
    expect(rows[1].cost).toBeCloseTo(0.3);
    expect(aggregateModelUsage(usage, 'day')).toEqual([]);
  });
});
