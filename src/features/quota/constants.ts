import type { QuotaProviderType } from './providers/types';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'devin',
  'meta',
  'plugin',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** 页级分页默认 20/页；分页大小只影响展示，不再限制「刷新全部」的范围。 */
export const QUOTA_PAGE_SIZE = 20;

/** 配额页可选的每页条数。 */
export const QUOTA_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/** 「刷新全部」的上游请求并发上限，与分页大小解耦。 */
export const QUOTA_REFRESH_CONCURRENCY = 6;

/** 卡片排序：默认 = provider 分组序；soonest = 最快恢复优先。 */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
