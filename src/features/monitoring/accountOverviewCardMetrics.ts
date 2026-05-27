import { ACCOUNT_OVERVIEW_CARD_METRIC_KEYS } from './accountOverviewState';

const ACCOUNT_OVERVIEW_CARD_METRIC_KEY_SET = new Set<string>(ACCOUNT_OVERVIEW_CARD_METRIC_KEYS);
const ACCOUNT_OVERVIEW_CARD_METRIC_ORDER_MAP = new Map<string, number>(
  ACCOUNT_OVERVIEW_CARD_METRIC_KEYS.map((key, index) => [key, index])
);

export const sortAccountOverviewCardMetrics = <T extends { key: string }>(metrics: T[]) =>
  metrics
    .filter((metric) => ACCOUNT_OVERVIEW_CARD_METRIC_KEY_SET.has(metric.key))
    .sort(
      (left, right) =>
        (ACCOUNT_OVERVIEW_CARD_METRIC_ORDER_MAP.get(left.key) ?? Number.MAX_SAFE_INTEGER) -
        (ACCOUNT_OVERVIEW_CARD_METRIC_ORDER_MAP.get(right.key) ?? Number.MAX_SAFE_INTEGER)
    );
