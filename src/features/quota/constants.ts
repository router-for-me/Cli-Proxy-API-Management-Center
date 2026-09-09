import type { QuotaProviderType } from './providers/types';

/** Provider tab order also determines the card grouping in the All tab. */
export const QUOTA_TAB_ORDER: readonly QuotaProviderType[] = [
  'claude',
  'antigravity',
  'codex',
  'xai',
  'kimi',
  'github-copilot',
];

export type QuotaTabId = 'all' | QuotaProviderType;

/** Limit each page and refresh-all concurrency to 20 accounts. */
export const QUOTA_PAGE_SIZE = 20;

/** Default sorting groups providers; soonest sorts by the next quota reset. */
export const QUOTA_SORT_MODES = ['default', 'soonest'] as const;

export type QuotaSortMode = (typeof QUOTA_SORT_MODES)[number];

/** Match the 360ms card entrance budget used by useRevealGroup. */
export const CARD_ENTRANCE_BUDGET_MS = 360;
