import type { QuotaProviderType } from './providers/types';

/** tab 顺序 = 旧页五分区的纵向顺序，'全部' tab 下卡片也按此分组排列。 */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/**
 * 页级分页固定 12/页：可被 1/2/3/4 列整除（网格永远满行收尾），
 * 同时把「刷新全部」的上游并发压到 ≤12（旧分区制上限是 25）。
 */
export const QUOTA_PAGE_SIZE = 12;

/** 与 useRevealGroup 的 GROUP_MAX_TOTAL 一致：卡片级联总预算 360ms。 */
export const CARD_ENTRANCE_BUDGET_MS = 360;
