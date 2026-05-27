/**
 * Provider-aware quota fetch + mapping for the request monitoring "account
 * quota" panel. Delegates HTTP/parsing to shared helpers under
 * @/utils/quota so QuotaPage and MonitoringCenter share the exact same
 * fetch and parse logic; this layer only adapts each provider's native
 * result shape into the panel's uniform AccountQuotaEntry/Window.
 */

import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaGroup,
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeQuotaWindow,
  GeminiCliQuotaBucketState,
  KimiQuotaRow,
  XaiBillingSummary,
} from '@/types';
import { requestCodexUsagePayload } from '@/services/api';
import {
  buildCodexQuotaWindowInfos,
  fetchAntigravityQuota,
  fetchClaudeQuota,
  fetchGeminiCliQuota,
  fetchKimiQuota,
  fetchXaiQuota,
  formatKimiResetHint,
  formatQuotaResetTime,
  getStatusFromError,
  normalizePlanType,
} from '@/utils/quota';
import type { QuotaType } from '@/components/quota';
import type { MonitoringAccountQuotaTarget } from './accountOverviewQuotaTargets';

export type AccountQuotaWindow = {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetLabel: string;
  usageLabel: string | null;
};

export type AccountQuotaEntry = {
  key: string;
  provider: QuotaType;
  authLabel: string;
  fileName: string;
  subtitle: string | null;
  windows: AccountQuotaWindow[];
  error?: string;
  errorStatus?: number;
};

const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'pro-lite', 'pro_lite']);

const GEMINI_CLI_TIER_LABEL_KEYS: Record<string, string> = {
  'free-tier': 'tier_free',
  'legacy-tier': 'tier_legacy',
  'standard-tier': 'tier_standard',
  'g1-pro-tier': 'tier_pro',
  'g1-ultra-tier': 'tier_ultra',
};

const joinSubtitle = (...segments: Array<string | null | undefined>): string | null => {
  const filtered = segments
    .map((segment) => (segment ?? '').trim())
    .filter((segment) => segment.length > 0);
  return filtered.length > 0 ? filtered.join(' · ') : null;
};

export const getCodexPlanLabel = (
  planType: string | null | undefined,
  t: TFunction
): string | null => {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
    return t('codex_quota.plan_prolite');
  }
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
};

const buildCodexAccountQuotaWindows = (
  payload: Parameters<typeof buildCodexQuotaWindowInfos>[0],
  t: TFunction
): AccountQuotaWindow[] =>
  buildCodexQuotaWindowInfos(payload).map((window) => {
    const clampedUsed =
      window.usedPercent === null ? null : Math.max(0, Math.min(100, window.usedPercent));
    const remainingPercent = clampedUsed === null ? null : Math.max(0, 100 - clampedUsed);
    let usageLabel: string | null = null;

    if (
      window.limitWindowSeconds !== null &&
      window.limitWindowSeconds > 0 &&
      clampedUsed !== null
    ) {
      const totalHours = window.limitWindowSeconds / 3600;
      const usedHours = (totalHours * clampedUsed) / 100;
      const formatHours = (value: number) =>
        Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
      usageLabel = t('codex_quota.window_usage', {
        used: formatHours(usedHours),
        total: formatHours(totalHours),
      });
    }

    return {
      id: window.id,
      label: t(window.labelKey, window.labelParams),
      remainingPercent,
      resetLabel: window.resetLabel,
      usageLabel,
    };
  });

const claudeWindowToAccountWindow = (window: ClaudeQuotaWindow): AccountQuotaWindow => {
  const clampedUsed =
    window.usedPercent === null ? null : Math.max(0, Math.min(100, window.usedPercent));
  const remainingPercent = clampedUsed === null ? null : Math.max(0, 100 - clampedUsed);
  return {
    id: window.id,
    label: window.label,
    remainingPercent,
    resetLabel: window.resetLabel,
    usageLabel: null,
  };
};

const antigravityGroupToAccountWindow = (group: AntigravityQuotaGroup): AccountQuotaWindow => {
  const clamped = Math.max(0, Math.min(1, group.remainingFraction));
  return {
    id: group.id,
    label: group.label,
    remainingPercent: clamped * 100,
    resetLabel: formatQuotaResetTime(group.resetTime),
    usageLabel: null,
  };
};

const geminiBucketToAccountWindow = (
  bucket: GeminiCliQuotaBucketState,
  t: TFunction
): AccountQuotaWindow => {
  const clamped =
    bucket.remainingFraction === null
      ? null
      : Math.max(0, Math.min(1, bucket.remainingFraction));
  const remainingPercent = clamped === null ? null : clamped * 100;
  const usageLabel =
    bucket.remainingAmount === null || bucket.remainingAmount === undefined
      ? null
      : t('gemini_cli_quota.remaining_amount', { count: bucket.remainingAmount });
  return {
    id: bucket.id,
    label: bucket.label,
    remainingPercent,
    resetLabel: formatQuotaResetTime(bucket.resetTime),
    usageLabel,
  };
};

const kimiRowToAccountWindow = (row: KimiQuotaRow, t: TFunction): AccountQuotaWindow => {
  const { limit, used } = row;
  const remainingPercent =
    limit > 0
      ? Math.max(0, Math.min(100, ((limit - used) / limit) * 100))
      : used > 0
        ? 0
        : null;
  const label = row.labelKey
    ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
    : (row.label ?? '');
  const usageLabel = limit > 0 ? `${used} / ${limit}` : null;
  const resetLabel = formatKimiResetHint(t, row.resetHint) || '-';
  return {
    id: row.id,
    label,
    remainingPercent,
    resetLabel,
    usageLabel,
  };
};

const formatUsdFromCents = (cents: number | null): string => {
  if (cents === null) return '--';
  return new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
};

const xaiBillingToAccountWindow = (
  billing: XaiBillingSummary,
  t: TFunction
): AccountQuotaWindow => {
  const clampedUsed =
    billing.usedPercent === null ? null : Math.max(0, Math.min(100, billing.usedPercent));
  const remainingPercent = clampedUsed === null ? null : Math.max(0, 100 - clampedUsed);
  const usedLabel = formatUsdFromCents(billing.usedCents);
  const limitLabel = formatUsdFromCents(billing.monthlyLimitCents);
  const usageLabel =
    billing.monthlyLimitCents === null ? usedLabel : `${usedLabel} / ${limitLabel}`;
  return {
    id: 'monthly-credits',
    label: t('xai_quota.monthly_credits'),
    remainingPercent,
    resetLabel: formatQuotaResetTime(billing.billingPeriodEnd),
    usageLabel,
  };
};

const formatXaiPayAsYouGoSubtitle = (
  billing: XaiBillingSummary,
  t: TFunction
): string | null => {
  const onDemandCap = billing.onDemandCapCents ?? 0;
  const label = t('xai_quota.pay_as_you_go_label');
  const value =
    onDemandCap > 0
      ? t('xai_quota.pay_as_you_go_enabled', { cap: formatUsdFromCents(onDemandCap) })
      : t('xai_quota.pay_as_you_go_disabled');
  return `${label}: ${value}`;
};

const formatClaudeExtraUsage = (
  extra: ClaudeExtraUsage | null | undefined,
  t: TFunction
): string | null => {
  if (!extra || !extra.is_enabled) return null;
  const used = (extra.used_credits ?? 0) / 100;
  const limit = (extra.monthly_limit ?? 0) / 100;
  return `${t('claude_quota.extra_usage_label')}: $${used.toFixed(2)} / $${limit.toFixed(2)}`;
};

const resolveGeminiTierDisplay = (tierLabel: string | null, t: TFunction): string | null => {
  if (!tierLabel) return null;
  const key = GEMINI_CLI_TIER_LABEL_KEYS[tierLabel.toLowerCase()];
  return key ? t(`gemini_cli_quota.${key}`) : tierLabel;
};

type CommonEntryFields = Pick<AccountQuotaEntry, 'key' | 'provider' | 'authLabel' | 'fileName'>;

const commonFields = (target: MonitoringAccountQuotaTarget): CommonEntryFields => ({
  key: target.key,
  provider: target.provider,
  authLabel: target.authLabel,
  fileName: target.fileName,
});

const errorEntry = (
  target: MonitoringAccountQuotaTarget,
  err: unknown,
  t: TFunction
): AccountQuotaEntry => ({
  ...commonFields(target),
  subtitle: null,
  windows: [],
  error: err instanceof Error ? err.message : String(err || t('common.unknown_error')),
  errorStatus: getStatusFromError(err),
});

const fetchCodexEntry = async (
  target: MonitoringAccountQuotaTarget,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const payload = await requestCodexUsagePayload(
    { authIndex: target.authIndex, accountId: target.accountId },
    { emptyMessage: t('codex_quota.empty_windows') }
  );
  const planType = normalizePlanType(payload.plan_type ?? payload.planType) ?? target.planType;
  return {
    ...commonFields(target),
    subtitle: getCodexPlanLabel(planType, t),
    windows: buildCodexAccountQuotaWindows(payload, t),
  };
};

const fetchClaudeEntry = async (
  target: MonitoringAccountQuotaTarget,
  file: AuthFileItem,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const result = await fetchClaudeQuota(file, t);
  const planLabel = result.planType ? t(`claude_quota.${result.planType}`) : null;
  const extraLabel = formatClaudeExtraUsage(result.extraUsage ?? null, t);
  return {
    ...commonFields(target),
    subtitle: joinSubtitle(planLabel, extraLabel),
    windows: result.windows.map(claudeWindowToAccountWindow),
  };
};

const fetchAntigravityEntry = async (
  target: MonitoringAccountQuotaTarget,
  file: AuthFileItem,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const groups = await fetchAntigravityQuota(file, t);
  return {
    ...commonFields(target),
    subtitle: null,
    windows: groups.map(antigravityGroupToAccountWindow),
  };
};

const fetchGeminiCliEntry = async (
  target: MonitoringAccountQuotaTarget,
  file: AuthFileItem,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const result = await fetchGeminiCliQuota(file, t);
  const tierDisplay = resolveGeminiTierDisplay(result.tierLabel, t);
  const creditDisplay =
    result.creditBalance !== null && result.creditBalance !== undefined
      ? t('gemini_cli_quota.credit_amount', { count: result.creditBalance })
      : null;
  return {
    ...commonFields(target),
    subtitle: joinSubtitle(tierDisplay, creditDisplay),
    windows: result.buckets.map((bucket) => geminiBucketToAccountWindow(bucket, t)),
  };
};

const fetchKimiEntry = async (
  target: MonitoringAccountQuotaTarget,
  file: AuthFileItem,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const rows = await fetchKimiQuota(file, t);
  return {
    ...commonFields(target),
    subtitle: null,
    windows: rows.map((row) => kimiRowToAccountWindow(row, t)),
  };
};

const fetchXaiEntry = async (
  target: MonitoringAccountQuotaTarget,
  file: AuthFileItem,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const billing = await fetchXaiQuota(file, t);
  return {
    ...commonFields(target),
    subtitle: formatXaiPayAsYouGoSubtitle(billing, t),
    windows: [xaiBillingToAccountWindow(billing, t)],
  };
};

/**
 * Single entry point: dispatch to the matching provider's fetch + mapper.
 * Catches and translates errors into a populated AccountQuotaEntry.
 */
export const fetchAccountQuotaEntry = async (
  target: MonitoringAccountQuotaTarget,
  file: AuthFileItem | undefined,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  try {
    switch (target.provider) {
      case 'codex':
        return await fetchCodexEntry(target, t);
      case 'claude':
        if (!file) throw new Error(t('claude_quota.missing_auth_index'));
        return await fetchClaudeEntry(target, file, t);
      case 'antigravity':
        if (!file) throw new Error(t('antigravity_quota.missing_auth_index'));
        return await fetchAntigravityEntry(target, file, t);
      case 'gemini-cli':
        if (!file) throw new Error(t('gemini_cli_quota.missing_auth_index'));
        return await fetchGeminiCliEntry(target, file, t);
      case 'kimi':
        if (!file) throw new Error(t('kimi_quota.missing_auth_index'));
        return await fetchKimiEntry(target, file, t);
      case 'xai':
        if (!file) throw new Error(t('xai_quota.missing_auth_index'));
        return await fetchXaiEntry(target, file, t);
      default:
        return errorEntry(target, new Error(`Unsupported provider: ${String(target.provider)}`), t);
    }
  } catch (err: unknown) {
    return errorEntry(target, err, t);
  }
};
