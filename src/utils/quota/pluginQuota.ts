/**
 * 通用插件额度工具。
 *
 * 内置的六个 provider 各有专属适配器与 UI 形状；插件提供的 provider（例如
 * workbuddy）没有专属适配器，宿主会用归一化形状回答 `/quota/fetch`：
 * `{ subscription, summary[], groups[{ displayName, buckets[] }] }`。
 *
 * 这里集中两件事，避免适配器与认证文件卡片各写一份：
 *  1. 判定一个凭证是否属于「插件额度」（宿主下发 `supports_quota`，且 provider
 *     不在内置集合里）；
 *  2. 把归一化载荷折算成卡片渲染所需的行，并在这一步解析重置时间。
 *
 * React-free / SCSS-free —— 可被纯逻辑测试直接消费。
 */

import type { AuthFileItem, PluginQuotaData, PluginQuotaRow } from '@/types';

/**
 * 面板已内置额度适配器的 provider。
 *
 * 这些 provider 由各自的适配器负责，通用分支必须让位 —— 否则一个自带
 * `supports_quota` 的 claude 凭证会同时命中两条路径。
 */
export const BUILT_IN_QUOTA_PROVIDERS: ReadonlySet<string> = new Set([
  'antigravity',
  'claude',
  'codex',
  'devin',
  'kimi',
  'xai',
]);

const readFlag = (value: unknown): boolean => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
};

const readText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

/** 凭证的 provider 键（后端两条分支分别写在 provider / type 上）。 */
export const resolveQuotaProviderKey = (file: AuthFileItem): string =>
  readText(file.provider ?? file.type).toLowerCase();

/**
 * 宿主是否声明该凭证有额度能力。
 *
 * `supports_quota` 来自 `/v0/management/auth-files`：凭证的 provider 注册了
 * quota provider（插件或内置）时由宿主写入。
 */
export const hasHostQuotaSupport = (file: AuthFileItem): boolean =>
  readFlag(file['supports_quota'] ?? file['supportsQuota']);

/** 该凭证是否应由通用插件适配器渲染额度。 */
export const isPluginQuotaAuthFile = (file: AuthFileItem): boolean => {
  if (!hasHostQuotaSupport(file)) return false;
  const provider = resolveQuotaProviderKey(file);
  if (!provider || provider === 'unknown' || provider === 'empty') return false;
  return !BUILT_IN_QUOTA_PROVIDERS.has(provider);
};

/**
 * 解析后端给的重置时间。
 *
 * 插件额度原样转发上游字段，常见形式是 `YYYY-MM-DD HH:mm:ss`（本地时间语义，
 * 上游不保证带时区），也可能是 ISO 字符串。无法解析时返回 null，让 UI 只显示
 * 绝对时间而不显示倒计时，而不是猜一个错误的时间点。
 */
export const parseQuotaResetMs = (value: unknown): number | null => {
  const text = readText(value);
  if (!text) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(text);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second ?? '0')
    ).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
};

const clampPercent = (value: number): number =>
  Math.max(0, Math.min(100, Math.round(value * 100) / 100));

const formatMetricValue = (value: number): string =>
  Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);

export interface PluginQuotaLabels {
  /** 整体额度行在没有套餐名时的标题。 */
  total: string;
  /** 套餐行缺少名称时的标题。 */
  group: string;
}

/**
 * 归一化载荷 → 卡片行。
 *
 * 第一行是整体额度（剩余/总量 + 剩余百分比），其后每个未命名桶一行，沿用上游
 * 套餐名。没有金额字段时留空，UI 不显示 `undefined`。
 */
export const buildPluginQuotaRows = (
  payload: PluginQuotaData | null | undefined,
  labels: PluginQuotaLabels
): PluginQuotaRow[] => {
  if (!payload) return [];

  const rows: PluginQuotaRow[] = [];
  const summary = Array.isArray(payload.summary) ? payload.summary : [];
  const remain = summary.find((metric) => metric?.key === 'remain');
  const total = summary.find((metric) => metric?.key === 'total');
  const plan =
    readText(payload.subscription?.plan) || readText(payload.subscription?.tierName);

  const percent =
    typeof remain?.value === 'number' &&
    typeof total?.value === 'number' &&
    total.value > 0
      ? clampPercent((remain.value / total.value) * 100)
      : null;

  if (percent !== null || remain || total) {
    rows.push({
      id: 'plugin:total',
      label: plan || labels.total,
      percent,
      amount:
        typeof remain?.value === 'number' && typeof total?.value === 'number'
          ? `${formatMetricValue(remain.value)} / ${formatMetricValue(total.value)}`
          : undefined,
      resetAtMs: null,
    });
  }

  const groups = Array.isArray(payload.groups) ? payload.groups : [];
  groups.forEach((group, groupIndex) => {
    const groupLabel = readText(group?.displayName) || labels.group;
    const buckets = Array.isArray(group?.buckets) ? group.buckets : [];
    buckets.forEach((bucket, bucketIndex) => {
      const fraction =
        typeof bucket?.remainingFraction === 'number' ? bucket.remainingFraction : null;
      rows.push({
        id: `plugin:${groupIndex}:${bucketIndex}`,
        label: groupLabel,
        percent: fraction === null ? null : clampPercent(fraction * 100),
        amount: readText(bucket?.description) || undefined,
        resetAtMs: parseQuotaResetMs(bucket?.resetTime ?? bucket?.window),
      });
    });
  });

  return rows;
};

/** 载荷是否有任何可展示的内容。 */
export const hasPluginQuotaContent = (
  payload: PluginQuotaData | null | undefined
): boolean => {
  if (!payload) return false;
  const hasSummary = Array.isArray(payload.summary) && payload.summary.length > 0;
  const hasGroups =
    Array.isArray(payload.groups) &&
    payload.groups.some((group) => (group?.buckets?.length ?? 0) > 0);
  const hasPlan =
    readText(payload.subscription?.plan).length > 0 ||
    readText(payload.subscription?.tierName).length > 0;
  return hasSummary || hasGroups || hasPlan;
};
