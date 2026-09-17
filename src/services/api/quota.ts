/**
 * 通用插件额度 API：`POST /v0/management/quota/fetch`。
 *
 * 这是宿主按 provider 解析 quota provider 的通用入口（内置与插件共用）。面板
 * 需要它来查询没有专属适配器的 provider：请求只带 auth_index，由宿主决定路由到
 * 哪个额度实现。
 */

import { apiClient } from './client';
import { isRecord } from '@/utils/helpers';
import type {
  PluginQuotaBucket,
  PluginQuotaData,
  PluginQuotaGroup,
  PluginQuotaMetric,
} from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';

const asString = (value: unknown): string | undefined => {
  if (value === undefined || value === null) return undefined;
  const text = String(value).trim();
  return text ? text : undefined;
};

const asNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const normalizeMetric = (value: unknown): PluginQuotaMetric | null => {
  if (!isRecord(value)) return null;
  const key = asString(value.key);
  const label = asString(value.label);
  const metricValue = asNumber(value.value);
  if (!key || !label || metricValue === undefined) return null;
  return {
    key,
    label,
    value: metricValue,
    unit: asString(value.unit),
    format: asString(value.format),
    currency: asString(value.currency),
  };
};

const normalizeBucket = (value: unknown): PluginQuotaBucket | null => {
  if (!isRecord(value)) return null;
  const bucket: PluginQuotaBucket = {
    window: asString(value.window),
    resetTime: asString(value.resetTime),
    description: asString(value.description),
  };
  // remainingFraction 与 resetTime 都没给的行没有可渲染内容，直接丢弃。
  const fraction = asNumber(value.remainingFraction);
  if (fraction !== undefined) bucket.remainingFraction = fraction;
  if (!bucket.remainingFraction && !bucket.resetTime && !bucket.description) return null;
  return bucket;
};

const normalizeGroup = (value: unknown): PluginQuotaGroup | null => {
  if (!isRecord(value)) return null;
  const buckets = Array.isArray(value.buckets)
    ? value.buckets
        .map((bucket) => normalizeBucket(bucket))
        .filter((bucket): bucket is PluginQuotaBucket => bucket !== null)
    : [];
  const displayName = asString(value.displayName);
  if (buckets.length === 0 && !displayName) return null;
  return { displayName, buckets };
};

/**
 * 把宿主响应收敛成面板可渲染的形状；未知字段一律丢弃。
 *
 * 非对象入参也返回同一形状（空数组而非缺字段），调用方因此不必区分「没数据」
 * 与「数据不合法」两种空结果。
 */
export const normalizePluginQuotaPayload = (value: unknown): PluginQuotaData => {
  if (!isRecord(value)) return { summary: [], groups: [] };
  const summary = Array.isArray(value.summary)
    ? value.summary
        .map((metric) => normalizeMetric(metric))
        .filter((metric): metric is PluginQuotaMetric => metric !== null)
    : [];
  const groups = Array.isArray(value.groups)
    ? value.groups
        .map((group) => normalizeGroup(group))
        .filter((group): group is PluginQuotaGroup => group !== null)
    : [];

  const subscription = isRecord(value.subscription)
    ? {
        plan: asString(value.subscription.plan),
        tierName: asString(value.subscription.tierName),
        tierId: asString(value.subscription.tierId),
      }
    : undefined;

  const serverTimeOffsetMs = asNumber(value.serverTimeOffsetMs);

  return { subscription, summary, groups, serverTimeOffsetMs };
};

export const pluginQuotaApi = {
  /**
   * 查询一个凭证的插件额度。
   *
   * auth_index 必填：宿主用它定位凭证。凭据缺索引是数据问题而非网络问题，因此
   * 直接抛错，让调用方给出比「未知错误」更有用的提示。
   */
  async fetch(authIndex: string): Promise<PluginQuotaData> {
    const normalizedIndex = normalizeAuthIndex(authIndex);
    if (!normalizedIndex) {
      throw new Error('missing auth_index');
    }
    const raw = await apiClient.post<unknown>('/quota/fetch', {
      auth_index: normalizedIndex,
    });
    return normalizePluginQuotaPayload(raw);
  },
};
