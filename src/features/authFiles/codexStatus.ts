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

/** Status filters aligned with xAI: working / cooldown / denied / other. */
export const CODEX_STATUS_FILTERS = [
  'all',
  'working',
  'cooldown',
  'denied',
  'other',
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

export type CodexAccountStatusKind = Exclude<CodexStatusFilter, 'all'>;

export type CodexAccountStatus = {
  kind: CodexAccountStatusKind;
  needsReauth: boolean;
  quotaLimited: boolean;
  fiveHourLimited: boolean;
  weeklyLimited: boolean;
  monthlyLimited: boolean;
};

const PREMIUM_PLAN_TYPES = new Set(['prolite', 'pro-lite', 'pro_lite']);

const DENIED_STATUS_CODES = new Set([401, 402, 403]);

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

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && Number.isFinite(Number(value))
      ? Number(value)
      : null;

const collectStatusText = (file: AuthFileItem, refreshed?: CodexRefreshState): string =>
  [
    refreshed?.error,
    file.disabled_reason,
    file.status_message,
    file.statusMessage,
    typeof file.error === 'string' ? file.error : '',
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

const isDeniedAuthMessage = (text: string): boolean => {
  if (!text) return false;
  return (
    text.includes('invalid_token') ||
    text.includes('invalid token') ||
    text.includes('invalidated') ||
    text.includes('unauthorized') ||
    text.includes('unauthenticated') ||
    text.includes('authentication') ||
    text.includes('permission-denied') ||
    text.includes('access denied') ||
    text.includes('deactivated') ||
    text.includes('workspace') ||
    text.includes('account_deactivated') ||
    text.includes('token_expired') ||
    text.includes('refresh_token') ||
    text.includes('needs reauth') ||
    text.includes('reauth')
  );
};

const resolveHttpStatus = (file: AuthFileItem, refreshed?: CodexRefreshState): number | null => {
  const fromRefresh = readNumber(refreshed?.errorStatus);
  if (fromRefresh !== null) return fromRefresh;
  const fromFile =
    readNumber((file as { last_error_status?: unknown }).last_error_status) ??
    readNumber((file as { error_status?: unknown }).error_status) ??
    readNumber((file as { status_code?: unknown }).status_code);
  return fromFile;
};

/**
 * Classify Codex auth similar to xAI:
 * - denied: 401/402/403 or known auth-death messages (invalid token, deactivated workspace, …)
 * - cooldown: any quota window at 100% (rate/usage limit)
 * - working: enabled, no hard auth failure, no full quota
 * - other: disabled/unavailable or other errors
 */
export const getCodexAccountStatus = (
  file: AuthFileItem,
  refreshed?: CodexRefreshState
): CodexAccountStatus => {
  const windows = refreshed?.windows ?? [];
  const fiveHourLimited = windows.some((window) => isWindowFull(window, 'five-hour'));
  const weeklyLimited = windows.some((window) => isWindowFull(window, 'weekly'));
  const monthlyLimited = windows.some((window) => isWindowFull(window, 'monthly'));
  const quotaLimited = fiveHourLimited || weeklyLimited || monthlyLimited;

  const statusCode = resolveHttpStatus(file, refreshed);
  const statusText = collectStatusText(file, refreshed);
  const deniedByStatus = statusCode !== null && DENIED_STATUS_CODES.has(statusCode);
  const deniedByMessage = isDeniedAuthMessage(statusText);
  // usage_limit_reached is cooldown, not permanent denial
  const usageLimitOnly =
    statusText.includes('usage_limit_reached') || statusText.includes('usage limit');
  const needsReauth = deniedByStatus || (deniedByMessage && !usageLimitOnly);

  if (needsReauth) {
    return {
      kind: 'denied',
      needsReauth: true,
      quotaLimited,
      fiveHourLimited,
      weeklyLimited,
      monthlyLimited,
    };
  }

  if (quotaLimited || usageLimitOnly) {
    return {
      kind: 'cooldown',
      needsReauth: false,
      quotaLimited: true,
      fiveHourLimited,
      weeklyLimited,
      monthlyLimited,
    };
  }

  if (
    file.disabled !== true &&
    file.unavailable !== true &&
    refreshed?.status !== 'error' &&
    (statusCode === null || statusCode < 400)
  ) {
    return {
      kind: 'working',
      needsReauth: false,
      quotaLimited: false,
      fiveHourLimited: false,
      weeklyLimited: false,
      monthlyLimited: false,
    };
  }

  return {
    kind: 'other',
    needsReauth: false,
    quotaLimited,
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
  file: AuthFileItem,
  refreshed?: CodexRefreshState
): boolean => filter === 'all' || getCodexAccountStatus(file, refreshed).kind === filter;
