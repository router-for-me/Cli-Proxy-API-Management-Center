import { describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { normalizeAuthFilesResponse } from '@/services/api/authFiles';
import { resolveAuthFileQuotaType } from '@/features/authFiles/logic';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { PluginQuotaBody } from '@/features/quota/providers/plugin/PluginQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import type { PluginQuotaState } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { apiClient } from '@/services/api/client';
import {
  BUILT_IN_QUOTA_PROVIDERS,
  buildAntigravityQuotaGroups,
  isPluginQuotaFile,
} from '@/utils/quota';
import { QUOTA_TAB_ORDER } from '@/features/quota/constants';
import {
  fetchPluginQuota,
  normalizePluginQuotaSummary,
} from '@/features/quota/providers/plugin/data';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);
const renderQuota = (quota: PluginQuotaState) =>
  renderToStaticMarkup(createElement(PluginQuotaBody, { quota, classes }));

describe('generic plugin quota', () => {
  test('keeps built-in quota cards when a plugin also advertises quota', () => {
    const builtIns = QUOTA_TAB_ORDER.filter((type) => type !== 'plugin');
    expect([...BUILT_IN_QUOTA_PROVIDERS].sort()).toEqual([...builtIns].sort());
    for (const type of builtIns) {
      for (const capability of [
        { quota_probe: { url: 'https://quota.example.test/usage' } },
        { quota_provider: type },
        {},
      ]) {
        const raw = {
          name: `${type}.json`,
          type,
          supports_quota: true,
          auth_index: '7',
          ...capability,
        };
        const file = normalizeAuthFilesResponse({ files: [raw] }).files[0];
        for (const candidate of [raw, file]) {
          expect(isPluginQuotaFile(candidate)).toBe(false);
          expect(resolveQuotaProviderType(candidate)).toBe(type);
          expect(resolveAuthFileQuotaType(candidate, 'all')).toBe(type);
          expect(resolveAuthFileQuotaType(candidate, type)).toBe(type);
          expect(resolveAuthFileQuotaType(candidate, 'plugin')).toBeNull();
        }
        expect(getQuotaCacheKey(file)).toBe(
          type === 'devin' ? `${type}.json${String.fromCharCode(0)}7` : `${type}.json`
        );
        expect(classifyQuotaFiles([file]).map((entry) => entry.type)).toEqual([type]);
      }
    }
  });

  test('routes advertised quotas for providers without a built-in card', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({});
    try {
      for (const capability of [
        { quota_probe: { url: 'https://quota.example.test/usage' } },
        { quota_provider: 'kiro' },
      ]) {
        const raw = {
          name: 'kiro.json',
          type: 'kiro',
          supports_quota: true,
          auth_index: '7',
          ...capability,
        };
        const file = normalizeAuthFilesResponse({ files: [raw] }).files[0];
        for (const candidate of [raw, file]) {
          expect(resolveQuotaProviderType(candidate)).toBe('plugin');
          expect(resolveAuthFileQuotaType(candidate, 'all')).toBe('plugin');
          expect(resolveAuthFileQuotaType(candidate, 'kiro')).toBe('plugin');
          expect(resolveAuthFileQuotaType(candidate, 'plugin')).toBe('plugin');
          expect(resolveAuthFileQuotaType(candidate, 'unrelated')).toBeNull();
          expect(resolveAuthFileQuotaType(candidate, null)).toBeNull();
          expect(classifyQuotaFiles([{ ...candidate, disabled: true }])).toEqual([]);
        }
        const [entry] = classifyQuotaFiles([file]);
        await QUOTA_ADAPTERS[entry.type].fetchQuota(file, i18n.t);
        expect(post.mock.calls.at(-1)).toEqual([
          '/quota/fetch',
          { auth_index: '7', ...(capability.quota_provider ? { provider: 'kiro' } : {}) },
        ]);
      }
      for (const supportsQuota of [undefined, false]) {
        const file = { name: 'kiro.json', type: 'kiro', supportsQuota };
        expect(resolveQuotaProviderType(file)).toBeNull();
        expect(resolveAuthFileQuotaType(file, 'all')).toBeNull();
      }
    } finally {
      post.mockRestore();
    }
  });

  test('renders an empty state only without usable summary, subscription or buckets', async () => {
    const post = spyOn(apiClient, 'post');
    try {
      for (const payload of [
        {
          summary: [
            { key: 'balance', label: 'Balance', value: 42, format: 'currency', currency: 'USD' },
          ],
        },
        { summary: [{ key: 'balance', label: 'Balance', value: 0 }] },
        { subscription: { plan: 'Pro' } },
        { subscription: { tierName: 'Premium' } },
        { subscription: { tierId: 'team' } },
        {},
        { subscription: { plan: '  ' }, summary: [{ key: '', label: 'Invalid', value: 42 }] },
      ]) {
        post.mockResolvedValue(payload);
        const data = await fetchPluginQuota({ name: 'quota.json', authIndex: '7' }, i18n.t);
        const markup = renderQuota({ status: 'success', ...data });
        const hasData =
          data.summary.length > 0 || Object.values(data.subscription ?? {}).some(Boolean);
        expect(markup.includes(i18n.t('plugin_quota.empty_data'))).toBe(!hasData);
        for (const metric of data.summary) {
          expect(markup).toContain('>Balance</span>');
          expect(markup).toContain(metric.value === 42 ? '$42.00' : '>0</span>');
        }
      }
    } finally {
      post.mockRestore();
    }
  });

  test('uses readable bucket labels without changing their distinct cache IDs', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      groups: [
        {
          displayName: 'Kiro credits',
          buckets: [
            { window: 'monthly', description: ' Base credits ', remainingFraction: 0.8 },
            { window: 'monthly', description: 'Bonus credits', remainingFraction: 0.2 },
            { window: 'daily', description: ' ', remainingFraction: 0.5 },
            {
              window: 'weekly',
              displayName: 'Explicit label',
              description: 'Details',
              remainingFraction: 0,
            },
          ],
        },
      ],
    });
    try {
      const data = await fetchPluginQuota({ name: 'kiro.json', authIndex: '7' }, i18n.t);
      const buckets = data.groups[0].buckets;
      expect(buckets.find((bucket) => bucket.id === 'kiro-credits-monthly-1')?.label).toBe(
        'Base credits'
      );
      expect(buckets.find((bucket) => bucket.id === 'kiro-credits-monthly-2')?.label).toBe(
        'Bonus credits'
      );
      const markup = renderQuota({ status: 'success', ...data });
      for (const label of ['Base credits', 'Bonus credits', 'daily', 'Explicit label']) {
        expect(markup).toContain(`>${label}</span>`);
      }
      expect(markup).not.toContain('kiro-credits-monthly-');
      expect(markup).not.toContain(i18n.t('plugin_quota.empty_data'));
    } finally {
      post.mockRestore();
    }
  });

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
