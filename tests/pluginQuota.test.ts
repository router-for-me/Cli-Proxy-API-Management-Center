/**
 * 通用插件额度适配器。
 *
 * 内置六个 provider 各有专属适配器；未内置的 provider（宿主注册了 quota
 * provider，或凭证自带 quota_probe）由这一条通用路径承担。这里覆盖四件事：
 *  1. 判定哪些凭证属于通用路径（既不能漏，也不能抢走内置 provider 的凭证）；
 *  2. 宿主归一化载荷的收敛（未知字段丢弃，缺字段不崩）；
 *  3. 载荷 → 卡片行的折算，含重置时间解析；
 *  4. 与额度页归类、重置时间轴的接线。
 *
 * React-free 部分直接调用；渲染部分用 renderToStaticMarkup 断言真实标记。
 */

import { beforeAll, describe, expect, spyOn, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { AuthFileItem, PluginQuotaState } from '@/types';
import { apiClient } from '@/services/api/client';
import { normalizePluginQuotaPayload, pluginQuotaApi } from '@/services/api/quota';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { buildTabCounts, classifyQuotaFiles } from '@/features/quota/logic';
import { collectQuotaRowInstants, pickSoonestRowId } from '@/features/quota/resetSchedule';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { PluginQuotaBody } from '@/features/quota/providers/plugin/PluginQuotaBody';
import {
  buildPluginQuotaRows,
  hasPluginQuotaContent,
  isPluginQuotaAuthFile,
  parseQuotaResetMs,
} from '@/utils/quota/pluginQuota';
import {
  getQuotaCacheFileName,
  getQuotaCacheKey,
  getQuotaDisplayName,
} from '@/utils/quota/identity';

const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test-host'
);

const LABELS = { total: 'Total quota', group: 'Package' };

/** 宿主 `/auth-files` 对「已注册 quota provider」的插件凭证下发的字段。 */
const pluginFile = (extra: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({
    name: 'workbuddy-a.json',
    provider: 'workbuddy',
    supports_quota: true,
    ...extra,
  }) as AuthFileItem;

/** quota_probe 路径：宿主只下发 supports_quota（plugin_quota.go 的回落分支）。 */
const probeOnlyFile = (extra: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({
    name: 'probe-only.json',
    provider: 'workbuddy',
    supports_quota: true,
    ...extra,
  }) as AuthFileItem;

/** 宿主归一化载荷（对应 pluginapi.QuotaFetchResponse）。 */
const HOST_PAYLOAD = {
  subscription: { plan: 'Pro plan', tierName: 'tier-1', tierId: '42' },
  summary: [
    { key: 'remain', label: 'Remaining', value: 2654 },
    { key: 'total', label: 'Total', value: 2800 },
  ],
  groups: [
    {
      displayName: 'Bundle A',
      buckets: [
        {
          window: 'monthly',
          remainingFraction: 0.5,
          resetTime: '2026-10-01 00:00:00',
          description: '1327 / 2654',
        },
        { remainingFraction: 0.25, description: 'no reset time' },
      ],
    },
    { buckets: [{ remainingFraction: 1, description: 'unnamed group' }] },
  ],
};

beforeAll(async () => {
  // 语料的回落语言是 zh-CN；断言用英文，先钉住语言。
  await i18n.changeLanguage('en');
});

describe('isPluginQuotaAuthFile', () => {
  test('accepts a host-declared quota provider outside the built-in set', () => {
    expect(isPluginQuotaAuthFile(pluginFile())).toBe(true);
    expect(isPluginQuotaAuthFile(pluginFile({ supports_quota: 'true' }))).toBe(true);
    expect(isPluginQuotaAuthFile(probeOnlyFile())).toBe(true);
  });

  test('reads the provider from type when provider is absent', () => {
    const file = { name: 'workbuddy-a.json', type: 'workbuddy', supports_quota: true };
    expect(isPluginQuotaAuthFile(file as AuthFileItem)).toBe(true);
  });

  test('yields to the built-in adapters', () => {
    // 内置 provider 即使自报 supports_quota 也必须由专属适配器渲染。
    for (const provider of ['claude', 'codex', 'kimi', 'devin', 'xai', 'antigravity']) {
      expect(isPluginQuotaAuthFile(pluginFile({ provider }))).toBe(false);
    }
  });

  test('rejects credentials the host has not vouched for', () => {
    expect(isPluginQuotaAuthFile(pluginFile({ supports_quota: undefined }))).toBe(false);
    expect(isPluginQuotaAuthFile(pluginFile({ supports_quota: false }))).toBe(false);
    expect(isPluginQuotaAuthFile(pluginFile({ supports_quota: 'maybe' }))).toBe(false);
    expect(isPluginQuotaAuthFile(pluginFile({ provider: '' }))).toBe(false);
    expect(isPluginQuotaAuthFile(pluginFile({ provider: 'unknown' }))).toBe(false);
    expect(isPluginQuotaAuthFile(pluginFile({ provider: 'empty' }))).toBe(false);
  });
});

describe('normalizePluginQuotaPayload', () => {
  test('keeps the fields a card can render', () => {
    const payload = normalizePluginQuotaPayload(HOST_PAYLOAD);
    expect(payload.subscription?.plan).toBe('Pro plan');
    expect(payload.summary?.map((metric) => metric.key)).toEqual(['remain', 'total']);
    expect(payload.groups?.[0]?.buckets?.[0]?.remainingFraction).toBe(0.5);
    expect(payload.groups?.[1]?.displayName).toBeUndefined();
  });

  test('coerces numeric strings and drops entries it cannot render', () => {
    const payload = normalizePluginQuotaPayload({
      summary: [
        { key: 'remain', label: 'Remaining', value: '12', unit: 'calls' },
        { key: 'broken' },
        'junk',
        null,
      ],
      groups: [{ displayName: 'g', buckets: [{ resetTime: 'x' }, {}, 'junk'] }],
      subscription: 'not-an-object',
      serverTimeOffsetMs: '1500',
    });

    expect(payload.summary).toHaveLength(1);
    expect(payload.summary?.[0]?.value).toBe(12);
    expect(payload.summary?.[0]?.unit).toBe('calls');
    // 没有任何可渲染字段的 bucket 被丢弃。
    expect(payload.groups?.[0]?.buckets).toHaveLength(1);
    expect(payload.subscription).toBeUndefined();
    expect(payload.serverTimeOffsetMs).toBe(1500);
  });

  test('survives payloads that are not objects at all', () => {
    expect(normalizePluginQuotaPayload(null).summary).toEqual([]);
    expect(normalizePluginQuotaPayload('nope').groups).toEqual([]);
  });
});

describe('pluginQuotaApi.fetch', () => {
  test('posts the normalized auth index and returns the normalized payload', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(HOST_PAYLOAD);
    try {
      const payload = await pluginQuotaApi.fetch('42');

      expect(post).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledWith('/quota/fetch', { auth_index: '42' });
      expect(payload.subscription?.plan).toBe('Pro plan');
    } finally {
      post.mockRestore();
    }
  });

  test('rejects a credential with no auth index before touching the network', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(HOST_PAYLOAD);
    try {
      await expect(pluginQuotaApi.fetch('')).rejects.toThrow('missing auth_index');
      expect(post).not.toHaveBeenCalled();
    } finally {
      post.mockRestore();
    }
  });
});

describe('parseQuotaResetMs', () => {
  test('reads the upstream local-time format', () => {
    expect(parseQuotaResetMs('2026-10-01 00:00:00')).toBe(new Date(2026, 9, 1, 0, 0, 0).getTime());
    expect(parseQuotaResetMs('2026-10-01T08:30')).toBe(new Date(2026, 9, 1, 8, 30, 0).getTime());
  });

  test('reads an ISO instant', () => {
    expect(parseQuotaResetMs('2026-10-01T00:00:00Z')).toBe(Date.parse('2026-10-01T00:00:00Z'));
  });

  test('returns null rather than guessing', () => {
    for (const value of [undefined, null, '', '   ', 'soon', 'not-a-date', 123]) {
      expect(parseQuotaResetMs(value)).toBeNull();
    }
  });
});

describe('buildPluginQuotaRows', () => {
  test('leads with the plan and pairs the remaining amount with a percentage', () => {
    const rows = buildPluginQuotaRows(HOST_PAYLOAD, LABELS);

    expect(rows[0]).toMatchObject({
      id: 'plugin:total',
      label: 'Pro plan',
      amount: '2654 / 2800',
    });
    // 2654 / 2800 = 94.785…% —— 保留两位，不四舍五入成整数。
    expect(rows[0]?.percent).toBeCloseTo(94.79, 2);
  });

  test('falls back to the generic labels when the host names nothing', () => {
    const rows = buildPluginQuotaRows(
      { summary: HOST_PAYLOAD.summary, groups: [{ buckets: [{ remainingFraction: 1 }] }] },
      LABELS
    );

    expect(rows[0]?.label).toBe('Total quota');
    expect(rows[1]?.label).toBe('Package');
  });

  test('keeps a bucket that only has a description and parses its reset time', () => {
    const rows = buildPluginQuotaRows(HOST_PAYLOAD, LABELS);
    const window = rows.find((row) => row.id === 'plugin:0:0');

    expect(window).toMatchObject({
      label: 'Bundle A',
      percent: 50,
      amount: '1327 / 2654',
    });
    expect(window?.resetAtMs).toBe(new Date(2026, 9, 1).getTime());

    const withoutReset = rows.find((row) => row.id === 'plugin:0:1');
    expect(withoutReset?.resetAtMs).toBeNull();
  });

  test('reports no percentage when the upstream sends no ratio', () => {
    const rows = buildPluginQuotaRows(
      { groups: [{ buckets: [{ description: 'unknown' }] }] },
      LABELS
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.percent).toBeNull();
    expect(rows[0]?.amount).toBe('unknown');
  });

  test('omits the total row when the host sends no summary and no plan', () => {
    const rows = buildPluginQuotaRows({ groups: HOST_PAYLOAD.groups }, LABELS);
    expect(rows.every((row) => row.id !== 'plugin:total')).toBe(true);
    expect(rows).toHaveLength(3);
  });

  test('handles an absent payload', () => {
    expect(buildPluginQuotaRows(null, LABELS)).toEqual([]);
    expect(buildPluginQuotaRows(undefined, LABELS)).toEqual([]);
    expect(buildPluginQuotaRows({}, LABELS)).toEqual([]);
  });
});

describe('hasPluginQuotaContent', () => {
  test('is true for anything the card could show', () => {
    expect(hasPluginQuotaContent(HOST_PAYLOAD)).toBe(true);
    expect(hasPluginQuotaContent({ summary: HOST_PAYLOAD.summary })).toBe(true);
    expect(hasPluginQuotaContent({ groups: [{ buckets: [{ remainingFraction: 1 }] }] })).toBe(true);
    expect(hasPluginQuotaContent({ subscription: { plan: 'Pro' } })).toBe(true);
  });

  test('is false for empty shells', () => {
    expect(hasPluginQuotaContent(null)).toBe(false);
    expect(hasPluginQuotaContent(undefined)).toBe(false);
    expect(hasPluginQuotaContent({})).toBe(false);
    expect(hasPluginQuotaContent({ summary: [], groups: [{ buckets: [] }] })).toBe(false);
  });
});

describe('quota page wiring', () => {
  test('classifies a plugin credential into its own tab after the built-ins', () => {
    const entries = classifyQuotaFiles([
      pluginFile({ authIndex: '7' }),
      { name: 'claude-a.json', provider: 'claude' } as AuthFileItem,
      { name: 'gemini-a.json', provider: 'gemini' } as AuthFileItem,
    ]);

    expect(entries.map((entry) => entry.type)).toEqual(['claude', 'plugin']);

    const counts = buildTabCounts(entries);
    expect(counts.plugin).toBe(1);
    expect(counts.all).toBe(2);
  });

  test('contributes its reset times to the shared schedule', () => {
    const quota: PluginQuotaState = {
      status: 'success',
      rows: buildPluginQuotaRows(HOST_PAYLOAD, LABELS),
    };

    const instants = collectQuotaRowInstants('plugin', quota);
    // 只有带可用 resetAtMs 的行参与排期；总额度行与缺时间的行不参与。
    expect(instants.map((instant) => instant.rowId)).toEqual(['plugin:0:0']);

    const beforeReset = new Date(2026, 8, 30).getTime();
    expect(pickSoonestRowId(instants, beforeReset)).toBe('plugin:0:0');
    // 已经恢复的行不再占用「最快恢复」的高亮。
    expect(pickSoonestRowId(instants, new Date(2026, 9, 2).getTime())).toBeNull();
  });

  test('ignores a quota that has not loaded yet', () => {
    expect(collectQuotaRowInstants('plugin', { status: 'loading', rows: [] })).toEqual([]);
  });
});

describe('plugin quota cache identity', () => {
  test('keys each credential of a shared file separately', () => {
    const first = pluginFile({ authIndex: '7' });
    const second = pluginFile({ authIndex: '8' });

    // 同一文件里的两个凭证必须落在不同缓存键上，否则它们会共用同一张卡片的额度。
    expect(getQuotaCacheKey(first)).not.toBe(getQuotaCacheKey(second));
    // 键里带了身份，但文件操作仍要能还原成真实文件名。
    expect(getQuotaCacheFileName(getQuotaCacheKey(first))).toBe('workbuddy-a.json');
  });

  test('leaves built-in providers on the filename-only key', () => {
    const claude = { name: 'claude-a.json', provider: 'claude' } as AuthFileItem;

    expect(getQuotaCacheKey(claude)).toBe('claude-a.json');
    expect(getQuotaDisplayName(claude)).toBe('claude-a.json');
  });

  test('disambiguates same-name plugin cards, preferring the readable identity', () => {
    expect(getQuotaDisplayName(pluginFile({ authIndex: '7' }))).toBe('workbuddy-a.json · 7');
    expect(getQuotaDisplayName(pluginFile({ authIndex: '7', email: 'a@example.com' }))).toBe(
      'workbuddy-a.json · a@example.com'
    );
  });
});

describe('plugin quota timeline lane', () => {
  const laneOf = (quota: PluginQuotaState) =>
    buildTimelineLane({
      name: 'workbuddy-a.json',
      displayName: 'workbuddy-a.json',
      provider: 'plugin',
      quota,
    });

  test('projects the normalized rows onto a lane', () => {
    const lane = laneOf({ status: 'success', rows: buildPluginQuotaRows(HOST_PAYLOAD, LABELS) });

    // 只有带重置时间的行能定锚，取最近的一次重置。
    expect(lane.anchorMs).toBe(new Date(2026, 9, 1).getTime());
    expect(lane.remaining).toBe(50);
    // 适配器已经把上游形状折成百分比，这里不再自行换算；没有重置时间的行留在卡片上，
    // 与内置 provider 的时间轴口径一致。
    expect(lane.limits).toEqual([{ label: 'Bundle A', remaining: 50 }]);
  });

  test('reports an empty lane when nothing carries a reset time', () => {
    const lane = laneOf({
      status: 'success',
      rows: [{ id: 'plugin:total', label: 'Total quota', percent: 95, resetAtMs: null }],
    });

    expect(lane.anchorMs).toBeNull();
    expect(lane.limits).toEqual([]);
  });

  test('does not invent a percentage the adapter could not compute', () => {
    const lane = laneOf({
      status: 'success',
      rows: [
        {
          id: 'plugin:0:0',
          label: 'Package',
          percent: null,
          resetAtMs: new Date(2026, 9, 1).getTime(),
        },
      ],
    });

    expect(lane.anchorMs).toBe(new Date(2026, 9, 1).getTime());
    expect(lane.remaining).toBeNull();
    expect(lane.limits).toEqual([]);
  });
});

describe('PluginQuotaBody', () => {
  const render = (quota: PluginQuotaState) =>
    renderToStaticMarkup(createElement(PluginQuotaBody, { quota, classes }));

  test('renders every row with its label, amount and percentage', () => {
    const markup = render({
      status: 'success',
      rows: buildPluginQuotaRows(HOST_PAYLOAD, LABELS),
    });

    expect(markup).toContain('Pro plan');
    expect(markup).toContain('2654 / 2800');
    expect(markup).toContain('95%');
    expect(markup).toContain('Bundle A');
    expect(markup).toContain('1327 / 2654');
    expect(markup).toContain('50%');
  });

  test('shows -- instead of inventing a percentage', () => {
    const markup = render({
      status: 'success',
      rows: [{ id: 'plugin:0:0', label: 'Package', percent: null, amount: 'unknown' }],
    });

    expect(markup).toContain('--');
    expect(markup).toContain('unknown');
  });

  test('explains an empty result', () => {
    expect(render({ status: 'success', rows: [] })).toContain('No quota data returned');
  });
});
