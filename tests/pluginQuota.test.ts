import { describe, expect, test } from 'bun:test';
import { buildAntigravityQuotaGroups } from '@/utils/quota';
import {
  isPluginQuotaFile,
  normalizePluginQuotaSummary,
} from '@/features/quota/providers/plugin/data';

describe('generic plugin quota', () => {
  test('requires both the server capability and its provider identifier', () => {
    expect(isPluginQuotaFile({ name: 'kiro-a.json', supportsQuota: true, quotaProvider: 'kiro' })).toBe(
      true
    );
    expect(isPluginQuotaFile({ name: 'kiro-a.json', supportsQuota: true })).toBe(false);
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
      { key: 'credits_used', label: 'Credits used', value: 1740.28, unit: 'credits', format: undefined, currency: undefined },
      { key: 'charged', label: 'Charged', value: 29.61, unit: undefined, format: 'currency', currency: 'USD' },
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
});