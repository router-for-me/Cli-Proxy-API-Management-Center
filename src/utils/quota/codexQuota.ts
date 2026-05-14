import type {
  CodexAdditionalRateLimit,
  CodexRateLimitInfo,
  CodexUsagePayload,
  CodexUsageWindow,
} from '@/types';
import { formatCodexResetLabel } from './formatters';
import { normalizeNumberValue, normalizeStringValue } from './parsers';

const FIVE_HOUR_SECONDS = 18_000;
const WEEK_SECONDS = 604_800;

type CodexQuotaWindowMeta = {
  id: string;
  labelKey: string;
};

const CODEX_WINDOW_META = {
  codeFiveHour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
  codeWeekly: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
  codeReviewFiveHour: {
    id: 'code-review-five-hour',
    labelKey: 'codex_quota.code_review_primary_window',
  },
  codeReviewWeekly: {
    id: 'code-review-weekly',
    labelKey: 'codex_quota.code_review_secondary_window',
  },
} as const satisfies Record<string, CodexQuotaWindowMeta>;

export type CodexQuotaWindowInfo = {
  id: string;
  labelKey: string;
  labelParams?: Record<string, string | number>;
  usedPercent: number | null;
  resetLabel: string;
  limitWindowSeconds: number | null;
};

const getWindowSeconds = (window?: CodexUsageWindow | null): number | null => {
  if (!window) return null;
  return normalizeNumberValue(window.limit_window_seconds ?? window.limitWindowSeconds);
};

export const getCodexQuotaWindowUsedPercent = (window?: CodexUsageWindow | null): number | null =>
  normalizeNumberValue(window?.used_percent ?? window?.usedPercent);

const normalizeWindowId = (raw: string) =>
  raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const pickClassifiedWindows = (
  limitInfo?: CodexRateLimitInfo | null,
  options?: { allowOrderFallback?: boolean }
): { fiveHourWindow: CodexUsageWindow | null; weeklyWindow: CodexUsageWindow | null } => {
  const allowOrderFallback = options?.allowOrderFallback ?? true;
  const primaryWindow = limitInfo?.primary_window ?? limitInfo?.primaryWindow ?? null;
  const secondaryWindow = limitInfo?.secondary_window ?? limitInfo?.secondaryWindow ?? null;
  const rawWindows = [primaryWindow, secondaryWindow];

  let fiveHourWindow: CodexUsageWindow | null = null;
  let weeklyWindow: CodexUsageWindow | null = null;

  for (const window of rawWindows) {
    if (!window) continue;
    const seconds = getWindowSeconds(window);
    if (seconds === FIVE_HOUR_SECONDS && !fiveHourWindow) {
      fiveHourWindow = window;
    } else if (seconds === WEEK_SECONDS && !weeklyWindow) {
      weeklyWindow = window;
    }
  }

  if (allowOrderFallback) {
    if (!fiveHourWindow) {
      fiveHourWindow = primaryWindow && primaryWindow !== weeklyWindow ? primaryWindow : null;
    }
    if (!weeklyWindow) {
      weeklyWindow = secondaryWindow && secondaryWindow !== fiveHourWindow ? secondaryWindow : null;
    }
  }

  return { fiveHourWindow, weeklyWindow };
};

export const classifyCodexRateLimitWindows = pickClassifiedWindows;

export const getCodexRateLimitWindows = (rateLimit?: CodexRateLimitInfo | null) => [
  rateLimit?.primary_window ?? rateLimit?.primaryWindow ?? null,
  rateLimit?.secondary_window ?? rateLimit?.secondaryWindow ?? null,
];

export const deriveCodexRateLimitUsedPercent = (
  rateLimit?: CodexRateLimitInfo | null
): number | null => {
  const values = getCodexRateLimitWindows(rateLimit)
    .map((window) => getCodexQuotaWindowUsedPercent(window))
    .filter((value): value is number => value !== null);
  if (!values.length) return null;
  return Math.max(...values);
};

export const isCodexRateLimitReached = (rateLimit?: CodexRateLimitInfo | null): boolean => {
  if (!rateLimit) return false;
  if (rateLimit.allowed === false) return true;
  if (rateLimit.limit_reached === true || rateLimit.limitReached === true) return true;
  return getCodexRateLimitWindows(rateLimit).some((window) => {
    const value = getCodexQuotaWindowUsedPercent(window);
    return value !== null && value >= 100;
  });
};

const addCodexWindowInfo = (
  windows: CodexQuotaWindowInfo[],
  id: string,
  labelKey: string,
  labelParams: Record<string, string | number> | undefined,
  window?: CodexUsageWindow | null,
  limitReached?: boolean,
  allowed?: boolean
) => {
  if (!window) return;

  const resetLabel = formatCodexResetLabel(window);
  const usedPercentRaw = getCodexQuotaWindowUsedPercent(window);
  const isLimitReached = Boolean(limitReached) || allowed === false;
  const usedPercent = usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);

  windows.push({
    id,
    labelKey,
    labelParams,
    usedPercent,
    resetLabel,
    limitWindowSeconds: getWindowSeconds(window),
  });
};

const addCodexRateLimitWindows = (
  windows: CodexQuotaWindowInfo[],
  limitInfo: CodexRateLimitInfo | null | undefined,
  fiveHourMeta: CodexQuotaWindowMeta,
  weeklyMeta: CodexQuotaWindowMeta
) => {
  const limitReached = limitInfo?.limit_reached ?? limitInfo?.limitReached;
  const allowed = limitInfo?.allowed;
  const classified = pickClassifiedWindows(limitInfo);

  addCodexWindowInfo(
    windows,
    fiveHourMeta.id,
    fiveHourMeta.labelKey,
    undefined,
    classified.fiveHourWindow,
    limitReached,
    allowed
  );
  addCodexWindowInfo(
    windows,
    weeklyMeta.id,
    weeklyMeta.labelKey,
    undefined,
    classified.weeklyWindow,
    limitReached,
    allowed
  );
};

const addAdditionalRateLimitWindows = (
  windows: CodexQuotaWindowInfo[],
  additionalRateLimits: CodexAdditionalRateLimit[] | null | undefined
) => {
  if (!Array.isArray(additionalRateLimits)) return;

  additionalRateLimits.forEach((limitItem, index) => {
    const rateInfo = limitItem?.rate_limit ?? limitItem?.rateLimit ?? null;
    if (!rateInfo) return;

    const limitName =
      normalizeStringValue(limitItem?.limit_name ?? limitItem?.limitName) ??
      normalizeStringValue(limitItem?.metered_feature ?? limitItem?.meteredFeature) ??
      `additional-${index + 1}`;
    const idPrefix = normalizeWindowId(limitName) || `additional-${index + 1}`;
    const limitReached = rateInfo.limit_reached ?? rateInfo.limitReached;
    const allowed = rateInfo.allowed;

    addCodexWindowInfo(
      windows,
      `${idPrefix}-five-hour-${index}`,
      'codex_quota.additional_primary_window',
      { name: limitName },
      rateInfo.primary_window ?? rateInfo.primaryWindow ?? null,
      limitReached,
      allowed
    );
    addCodexWindowInfo(
      windows,
      `${idPrefix}-weekly-${index}`,
      'codex_quota.additional_secondary_window',
      { name: limitName },
      rateInfo.secondary_window ?? rateInfo.secondaryWindow ?? null,
      limitReached,
      allowed
    );
  });
};

export const buildCodexQuotaWindowInfos = (payload: CodexUsagePayload): CodexQuotaWindowInfo[] => {
  const windows: CodexQuotaWindowInfo[] = [];
  const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
  const codeReviewLimit =
    payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
  const additionalRateLimits = payload.additional_rate_limits ?? payload.additionalRateLimits;

  addCodexRateLimitWindows(
    windows,
    rateLimit,
    CODEX_WINDOW_META.codeFiveHour,
    CODEX_WINDOW_META.codeWeekly
  );
  addCodexRateLimitWindows(
    windows,
    codeReviewLimit,
    CODEX_WINDOW_META.codeReviewFiveHour,
    CODEX_WINDOW_META.codeReviewWeekly
  );
  addAdditionalRateLimitWindows(windows, additionalRateLimits);

  return windows;
};
