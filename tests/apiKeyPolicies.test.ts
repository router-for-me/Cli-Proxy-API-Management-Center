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
import { normalizeApiKeyPolicyUsage } from '@/services/api/apiKeyPolicyUsage';

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
          },
        },
        { nope: true },
      ],
    });
    expect(usage).toHaveLength(1);
    expect(usage[0].usage.day).toEqual({
      tokens: 12,
      cost: 0.5,
      requests: 2,
      resetAt: '2026-11-16T00:00:00+03:00',
    });
    expect(usage[0].usage.month.tokens).toBe(0);
  });
});
