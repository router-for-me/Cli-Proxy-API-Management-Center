/**
 * Claude 额度数据层：用量窗口 + 套餐 + 额外用量。
 * React-free / SCSS-free —— 由 tests/claudeFableQuota.test.ts 直接消费。
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  ClaudeExtraUsage,
  ClaudeProfileResponse,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  ClaudeResetGrants,
  ClaudeResetGrantsPayload,
  ClaudeUsagePayload,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_RESET_GRANT_PROGRAM,
  CLAUDE_RESET_RATE_LIMITS_URL,
  CLAUDE_USAGE_URL,
  CLAUDE_REQUEST_HEADERS,
  CLAUDE_USAGE_WINDOW_KEYS,
  claudePeriodHours,
  normalizeNumberValue,
  normalizeStringValue,
  parseClaudeUsagePayload,
  formatQuotaResetTime,
  resolveResetMs,
  createStatusError,
  isClaudeFile,
  isDisabledAuthFile,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';

export type ClaudeQuotaData = {
  windows: ClaudeQuotaWindow[];
  extraUsage?: ClaudeExtraUsage | null;
  planType?: string | null;
  resetGrants?: ClaudeResetGrants | null;
};

const CLAUDE_RESET_GRANT_ID_PATTERN = /^[a-z0-9_-]{1,40}$/i;

/**
 * Summarises the `cedar_ember` block: `null` when the account is not eligible, otherwise the
 * spendable reset count and the grant a reset would consume (the server's pick, else the first
 * usable one). Paused grants and grants with no resets left are not spendable.
 */
export const parseClaudeResetGrants = (
  block: ClaudeResetGrantsPayload | null | undefined
): ClaudeResetGrants | null => {
  if (!block || block.eligible !== true || !Array.isArray(block.grants)) return null;

  const spendable = block.grants.filter((grant) => {
    const id = normalizeStringValue(grant?.id);
    const left = normalizeNumberValue(grant?.resets_left) ?? 0;
    return (
      Boolean(id && CLAUDE_RESET_GRANT_ID_PATTERN.test(id)) && grant.paused !== true && left > 0
    );
  });
  const next = spendable.find((grant) => grant.id === block.next_grant_id) ?? spendable[0] ?? null;

  return {
    availableCount: spendable.reduce(
      (sum, grant) => sum + (normalizeNumberValue(grant.resets_left) ?? 0),
      0
    ),
    nextGrantId: next ? (normalizeStringValue(next.id) ?? null) : null,
    expiresAt: next ? (normalizeStringValue(next.ends_at) ?? null) : null,
    cooldownUntil: normalizeStringValue(block.cooldown_until) ?? null,
  };
};

export const canResetClaudeQuota = (
  quota: Pick<ClaudeQuotaState, 'resetGrants'>,
  nowMs: number = Date.now()
): boolean => {
  const grants = quota.resetGrants;
  if (!grants || grants.availableCount <= 0 || !grants.nextGrantId) return false;
  const cooldownMs = grants.cooldownUntil ? Date.parse(grants.cooldownUntil) : NaN;
  return !(Number.isFinite(cooldownMs) && cooldownMs > nowMs);
};

const findFableUsageLimit = (payload: ClaudeUsagePayload) => {
  if (!Array.isArray(payload.limits)) return null;

  const candidates = payload.limits.filter((limit) => {
    const kind = (normalizeStringValue(limit?.kind) ?? '').trim().toLowerCase();
    const modelName = (normalizeStringValue(limit?.scope?.model?.display_name) ?? '')
      .trim()
      .toLowerCase();
    const isFable = modelName === 'fable' || modelName === 'fable 5';
    return kind === 'weekly_scoped' && isFable && normalizeNumberValue(limit?.percent) !== null;
  });

  return candidates.find((limit) => limit.is_active === true) ?? candidates[0] ?? null;
};

export const buildClaudeQuotaWindows = (
  payload: ClaudeUsagePayload,
  t: TFunction
): ClaudeQuotaWindow[] => {
  const windows: ClaudeQuotaWindow[] = [];
  const fableLimit = findFableUsageLimit(payload);

  for (const { key, id, labelKey } of CLAUDE_USAGE_WINDOW_KEYS) {
    if (key === 'iguana_necktie' && fableLimit) continue;
    const window = payload[key as keyof ClaudeUsagePayload];
    if (!window || typeof window !== 'object' || !('utilization' in window)) continue;
    const typedWindow = window as { utilization: number; resets_at: string | null };
    const usedPercent = normalizeNumberValue(typedWindow.utilization);
    const resetLabel = formatQuotaResetTime(typedWindow.resets_at ?? undefined);
    windows.push({
      id,
      label: t(labelKey),
      labelKey,
      usedPercent,
      resetLabel,
      // Claude states the period nowhere in the payload, so it comes from the
      // key: `five_hour` is the rolling window, everything else is weekly.
      resetAtMs: resolveResetMs([typedWindow.resets_at]),
      periodHours: claudePeriodHours(key),
    });
  }

  if (fableLimit) {
    const usedPercent = normalizeNumberValue(fableLimit.percent);
    if (usedPercent !== null) {
      windows.push({
        id: 'seven-day-fable',
        label: t('claude_quota.seven_day_fable'),
        labelKey: 'claude_quota.seven_day_fable',
        usedPercent,
        resetLabel: formatQuotaResetTime(fableLimit.resets_at ?? undefined),
        // `weekly_scoped` is a 7-day window by definition, so the timeline can
        // place this row alongside the ones derived from the named keys.
        resetAtMs: resolveResetMs([fableLimit.resets_at]),
        periodHours: claudePeriodHours('seven_day'),
      });
    }
  }

  return windows;
};

const normalizeFlagValue = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const trimmed = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'on'].includes(trimmed)) return true;
    if (['false', '0', 'no', 'n', 'off'].includes(trimmed)) return false;
  }
  return undefined;
};

const parseClaudeProfilePayload = (payload: unknown): ClaudeProfileResponse | null => {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as ClaudeProfileResponse;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as ClaudeProfileResponse;
  }
  return null;
};

export const resolveClaudePlanType = (profile: ClaudeProfileResponse | null): string | null => {
  if (!profile) return null;

  const organizationType = normalizeStringValue(
    profile.organization?.organization_type
  )?.toLowerCase();
  const subscriptionStatus = normalizeStringValue(
    profile.organization?.subscription_status
  )?.toLowerCase();

  if (organizationType === 'claude_team' && subscriptionStatus === 'active') {
    return 'plan_team';
  }

  // Account flags include personal subscriptions even for a Team-scoped token.
  const hasClaudeMax = normalizeFlagValue(profile.account?.has_claude_max);
  if (hasClaudeMax) return 'plan_max';

  const hasClaudePro = normalizeFlagValue(profile.account?.has_claude_pro);
  if (hasClaudePro) return 'plan_pro';

  if (hasClaudeMax === false && hasClaudePro === false) return 'plan_free';

  return null;
};

const fetchClaudeQuota = async (file: AuthFileItem, t: TFunction): Promise<ClaudeQuotaData> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  const [usageResult, profileResult] = await Promise.allSettled([
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_USAGE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
    apiCallApi.request({
      authIndex,
      method: 'GET',
      url: CLAUDE_PROFILE_URL,
      header: { ...CLAUDE_REQUEST_HEADERS },
    }),
  ]);

  if (usageResult.status === 'rejected') {
    throw usageResult.reason;
  }

  const result = usageResult.value;

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  const payload = parseClaudeUsagePayload(result.body ?? result.bodyText);
  if (!payload) {
    throw new Error(t('claude_quota.empty_windows'));
  }

  const windows = buildClaudeQuotaWindows(payload, t);
  const planType =
    profileResult.status === 'fulfilled' &&
    profileResult.value.statusCode >= 200 &&
    profileResult.value.statusCode < 300
      ? resolveClaudePlanType(
          parseClaudeProfilePayload(profileResult.value.body ?? profileResult.value.bodyText)
        )
      : null;

  return {
    windows,
    extraUsage: payload.extra_usage,
    planType,
    resetGrants: parseClaudeResetGrants(payload.cedar_ember),
  };
};

const createClaudeResetRequestId = (): string => {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const value = Math.floor(Math.random() * 16);
    const segment = char === 'x' ? value : (value & 0x3) | 0x8;
    return segment.toString(16);
  });
};

const parseJsonObject = (body: unknown, bodyText?: string): Record<string, unknown> | null => {
  const source = body ?? bodyText;
  if (typeof source === 'string') {
    try {
      const parsed: unknown = JSON.parse(source);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  }
  return source && typeof source === 'object' ? (source as Record<string, unknown>) : null;
};

const consumeClaudeResetGrant = async (file: AuthFileItem, t: TFunction): Promise<void> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('claude_quota.missing_auth_index'));
  }

  // Re-read the grant right before spending so a stale card never picks an old grant id.
  const usageResult = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CLAUDE_USAGE_URL,
    header: { ...CLAUDE_REQUEST_HEADERS },
  });
  if (usageResult.statusCode < 200 || usageResult.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(usageResult), usageResult.statusCode);
  }
  const grants = parseClaudeResetGrants(
    parseClaudeUsagePayload(usageResult.body ?? usageResult.bodyText)?.cedar_ember
  );
  if (!grants || !canResetClaudeQuota({ resetGrants: grants })) {
    throw new Error(t('claude_quota.reset_unavailable'));
  }

  const profileResult = await apiCallApi.request({
    authIndex,
    method: 'GET',
    url: CLAUDE_PROFILE_URL,
    header: { ...CLAUDE_REQUEST_HEADERS },
  });
  if (profileResult.statusCode < 200 || profileResult.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(profileResult), profileResult.statusCode);
  }
  const orgId = normalizeStringValue(
    parseClaudeProfilePayload(profileResult.body ?? profileResult.bodyText)?.organization?.uuid
  );
  if (!orgId) {
    throw new Error(t('claude_quota.reset_missing_org'));
  }

  const result = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: CLAUDE_RESET_RATE_LIMITS_URL.replace('{org_id}', encodeURIComponent(orgId)),
    header: { ...CLAUDE_REQUEST_HEADERS },
    data: JSON.stringify({
      program: CLAUDE_RESET_GRANT_PROGRAM,
      grant_id: grants.nextGrantId,
      request_id: createClaudeResetRequestId(),
    }),
  });
  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
  }

  // A 200 is not enough: the grant is only spent when Anthropic answers `result: "reset"`.
  const body = parseJsonObject(result.body, result.bodyText);
  if (normalizeStringValue(body?.result) !== 'reset') {
    const reason = normalizeStringValue(body?.reason) ?? normalizeStringValue(body?.result);
    throw new Error(reason ?? t('common.unknown_error'));
  }
};

const resetClaudeQuota = async (file: AuthFileItem, t: TFunction): Promise<ClaudeQuotaData> => {
  await consumeClaudeResetGrant(file, t);
  return fetchClaudeQuota(file, t);
};

export const CLAUDE_CONFIG: QuotaProviderData<ClaudeQuotaState, ClaudeQuotaData> = {
  type: 'claude',
  i18nPrefix: 'claude_quota',
  filterFn: (file) => isClaudeFile(file) && !isDisabledAuthFile(file),
  fetchQuota: fetchClaudeQuota,
  resetQuota: resetClaudeQuota,
  canResetQuota: (quota) => canResetClaudeQuota(quota),
  storeSelector: (state) => state.claudeQuota,
  storeSetter: 'setClaudeQuota',
  buildLoadingState: () => ({ status: 'loading', windows: [] }),
  buildSuccessState: (data) => ({
    status: 'success',
    windows: data.windows,
    extraUsage: data.extraUsage,
    planType: data.planType,
    resetGrants: data.resetGrants,
  }),
  buildErrorState: (message, status) => ({
    status: 'error',
    windows: [],
    error: message,
    errorStatus: status,
  }),
};
