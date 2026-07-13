import type { AuthFileItem, CodexQuotaWindow } from '@/types';
import { normalizePlanType, resolveCodexPlanType } from '@/utils/quota';

export const CODEX_PLAN_FILTERS = [
  'all',
  'free',
  'k12',
  'plus',
  'team',
  'prolite',
  'pro',
  'unknown',
] as const;
export const CODEX_STATUS_FILTERS = [
  'all',
  'reauth',
  'quota_limited',
  'five_hour_limited',
  'weekly_limited',
  'monthly_limited',
] as const;

export type CodexPlanFilter = (typeof CODEX_PLAN_FILTERS)[number];
export type CodexStatusFilter = (typeof CODEX_STATUS_FILTERS)[number];

export type CodexRefreshState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  planType: string | null;
  windows: CodexQuotaWindow[];
  error?: string;
  errorStatus?: number;
};

export type CodexAccountStatus = {
  needsReauth: boolean;
  quotaLimited: boolean;
  fiveHourLimited: boolean;
  weeklyLimited: boolean;
  monthlyLimited: boolean;
};

const PREMIUM_PLAN_TYPES = new Set(['prolite', 'pro-lite', 'pro_lite']);

const normalizedPlanFilterValue = (value: string | null): CodexPlanFilter | null => {
  const normalized = normalizePlanType(value);
  if (!normalized) return null;
  if (
    normalized === 'free' ||
    normalized === 'k12' ||
    normalized === 'plus' ||
    normalized === 'team' ||
    normalized === 'pro'
  ) {
    return normalized;
  }
  return PREMIUM_PLAN_TYPES.has(normalized) ? 'prolite' : null;
};

export const getCodexPlanFilterValue = (
  file: AuthFileItem,
  refreshed?: CodexRefreshState
): CodexPlanFilter | null =>
  normalizedPlanFilterValue(refreshed?.planType ?? resolveCodexPlanType(file));

export const getCodexPlanSortRank = (
  file: AuthFileItem,
  refreshed?: CodexRefreshState
): number | null => {
  switch (getCodexPlanFilterValue(file, refreshed)) {
    case 'pro':
      return 50;
    case 'prolite':
      return 40;
    case 'team':
      return 30;
    case 'plus':
      return 20;
    case 'free':
      return 10;
    case 'k12':
      return 10;
    default:
      return null;
  }
};

const isWindowFull = (window: CodexQuotaWindow, kind: string): boolean =>
  window.usedPercent !== null &&
  window.usedPercent >= 100 &&
  (window.id === kind || window.id.includes(kind));

export const getCodexAccountStatus = (refreshed?: CodexRefreshState): CodexAccountStatus => {
  const windows = refreshed?.windows ?? [];
  const fiveHourLimited = windows.some((window) => isWindowFull(window, 'five-hour'));
  const weeklyLimited = windows.some((window) => isWindowFull(window, 'weekly'));
  const monthlyLimited = windows.some((window) => isWindowFull(window, 'monthly'));
  return {
    needsReauth: refreshed?.errorStatus === 401,
    quotaLimited: fiveHourLimited || weeklyLimited || monthlyLimited,
    fiveHourLimited,
    weeklyLimited,
    monthlyLimited,
  };
};

export const matchesCodexPlanFilter = (
  file: AuthFileItem,
  filter: CodexPlanFilter,
  refreshed?: CodexRefreshState
): boolean => {
  if (filter === 'all') return true;
  const value = getCodexPlanFilterValue(file, refreshed);
  return filter === 'unknown' ? value === null : value === filter;
};

export const matchesCodexStatusFilter = (
  filter: CodexStatusFilter,
  refreshed?: CodexRefreshState
): boolean => {
  if (filter === 'all') return true;
  const status = getCodexAccountStatus(refreshed);
  if (filter === 'reauth') return status.needsReauth;
  if (filter === 'quota_limited') return status.quotaLimited;
  if (filter === 'five_hour_limited') return status.fiveHourLimited;
  if (filter === 'weekly_limited') return status.weeklyLimited;
  return status.monthlyLimited;
};
