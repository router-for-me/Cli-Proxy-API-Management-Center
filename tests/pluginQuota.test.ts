import { describe, expect, spyOn, test } from 'bun:test';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { apiClient } from '@/services/api/client';
import { buildAntigravityQuotaGroups } from '@/utils/quota';
import {
  fetchPluginQuota,
  isPluginQuotaFile,
  normalizePluginQuotaSummary,
} from '@/features/quota/providers/plugin/data';

describe('generic plugin quota', () => {
  test('accepts capability-only declarative quota probes', () => {
    expect(
      isPluginQuotaFile({ name: 'kiro-a.json', supportsQuota: true, quotaProvider: 'kiro' })
    ).toBe(true);
    expect(isPluginQuotaFile({ name: 'kiro-a.json', supportsQuota: true })).toBe(true);
    expect(getQuotaCacheKey({ name: 'kiro-a.json', supportsQuota: true, authIndex: '7' })).toBe(
      'kiro-a.json' + String.fromCharCode(0) + '7'
    );
  });

  test('keeps only typed, finite summary metrics', () => {
    expect(
      normalizePluginQuotaSummary([
        { key: 'credits_used', label: 'Credits used', value: 1740.28, unit: 'credits' },
        { key: 'charged', label: 'Charged', value: 29.61, format: 'currency', currency: 'USD' },
        { key: 'bad', label: 'Bad', value: Number.NaN },
        { key: '', label: 'Missing key', value: 1 },
      ])
    ).toEqual([
      {
        key: 'credits_used',
        label: 'Credits used',
        value: 1740.28,
        unit: 'credits',
        format: undefined,
        currency: undefined,
      },
      {
        key: 'charged',
        label: 'Charged',
        value: 29.61,
        unit: undefined,
        format: 'currency',
        currency: 'USD',
      },
    ]);
  });

  test('keeps buckets with the same window distinct when plugins omit bucket IDs', () => {
    const groups = buildAntigravityQuotaGroups({
      groups: [
        {
          displayName: 'Kiro credits',
          buckets: [
            { window: 'monthly', remainingFraction: 0.8 },
            { window: 'monthly', remainingFraction: 0.2 },
          ],
        },
      ],
    });

    expect(groups[0]?.buckets.map((bucket) => bucket.id)).toEqual([
      'kiro-credits-monthly-1',
      'kiro-credits-monthly-2',
    ]);
  });

  test('omits provider for probe-only quota requests', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({});
    try {
      await fetchPluginQuota(
        { name: 'kiro-a.json', supportsQuota: true, authIndex: '7' },
        ((key: string) => key) as never
      );
      expect(post.mock.calls[0]?.[0]).toBe('/quota/fetch');
      expect(post.mock.calls[0]?.[1]).toEqual({ auth_index: '7' });
    } finally {
      post.mockRestore();
    }
  });
});
