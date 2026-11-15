import {
  billingFromCodexSubscription,
  type AccountBilling,
  type BillingExpiryFallback,
} from '@/domain/accountBilling';
import { buildCodexQuotaWindows } from '@/domain/quotaWindows/codex';
export { buildCodexQuotaWindows } from '@/domain/quotaWindows/codex';
export { normalizeCodexAccountCredits } from '@/utils/quota/parsers';
/**
 * Codex 额度数据层：用量窗口 + 套餐 + 重置积分（含消费流程）。
 * React-free / SCSS-free —— 由 tests/codexQuota.test.ts 直接消费。
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  CodexRateLimitResetCredit,
  CodexQuotaState,
  CodexQuotaWindow,
} from '@/types';
import { getApiCallErrorMessage } from '@/services/api/apiCall';
import { isRecord } from '@/utils/helpers';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
  CODEX_SUBSCRIPTION_URL,
  CODEX_USAGE_URL,
  CODEX_REQUEST_HEADERS,
  normalizeCodexAccountCredits,
  normalizeNumberValue,
  normalizePlanType,
  normalizeStringValue,
  normalizeCodexResetCreditsPayload,
  parseCodexUsagePayload,
  resolveCodexChatgptAccountId,
  resolveCodexPlanType,
  resolveCodexSubscriptionActiveUntil,
  createStatusError,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/authIndex';
import type { QuotaProviderData } from '../types';
import { isCodexQuotaFile } from '../filters';
import type { QuotaDependencies } from '../dependencies';

const CODEX_OPTIONAL_REQUEST_TIMEOUT_MS = 8000;

type CodexResetCreditsData = {
  availableCount: number | null;
  applicableAvailableCount: number | null;
  credits: CodexRateLimitResetCredit[];
  error: string;
};

export type CodexQuotaData = {
  billing?: AccountBilling | null;
  subscriptionActiveUntilSource?: BillingExpiryFallback['source'];
  planType: string | null;
  subscriptionActiveUntil: string | number | null;
  creditBalance: string | null;
  creditsUnlimited: boolean;
  rateLimitResetCreditsAvailableCount: number | null;
  rateLimitResetCreditsApplicableAvailableCount: number | null;
  rateLimitResetCredits: CodexRateLimitResetCredit[];
  rateLimitResetCreditsError: string;
  windows: CodexQuotaWindow[];
};

const buildCodexRequestHeader = (file: AuthFileItem): Record<string, string> => {
  const accountId = resolveCodexChatgptAccountId(file);
  const requestHeader: Record<string, string> = {
    ...CODEX_REQUEST_HEADERS,
  };
  if (accountId) {
    requestHeader['Chatgpt-Account-Id'] = accountId;
  }
  return requestHeader;
};

const parseCodexSubscriptionActiveUntil = (payload: unknown): string | number | null => {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return parseCodexSubscriptionActiveUntil(JSON.parse(trimmed));
    } catch {
      return null;
    }
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const subscription = payload as Record<string, unknown>;
  const value = subscription.active_until ?? subscription.activeUntil;
  const numberValue = normalizeNumberValue(value);
  if (numberValue !== null && numberValue !== 0) return numberValue;
  const stringValue = normalizeStringValue(value);
  return stringValue && stringValue !== '0' ? stringValue : null;
};

export function createCodexQuotaConfig(deps: QuotaDependencies) {
  const { apiCallApi, authFilesApi, guardConfigConnection } = deps;

  const fetchCodexSubscriptionActiveUntil = async (
    authIndex: string,
    accountId: string | null,
    requestHeader: Record<string, string>
  ): Promise<{ activeUntil: string | number | null; billing: AccountBilling | null } | null> => {
    if (!accountId) return null;

    try {
      const result = await apiCallApi.request(
        {
          authIndex,
          method: 'GET',
          url: `${CODEX_SUBSCRIPTION_URL}?account_id=${encodeURIComponent(accountId)}`,
          header: requestHeader,
        },
        { timeout: CODEX_OPTIONAL_REQUEST_TIMEOUT_MS }
      );
      if (result.statusCode < 200 || result.statusCode >= 300) return null;
      return {
        activeUntil: parseCodexSubscriptionActiveUntil(result.body ?? result.bodyText),
        billing: billingFromCodexSubscription(result.body ?? result.bodyText),
      };
    } catch {
      return null;
    }
  };

  const fetchCodexResetCredits = async (
    authIndex: string,
    requestHeader: Record<string, string>,
    t: TFunction
  ): Promise<CodexResetCreditsData> => {
    try {
      const result = await apiCallApi.request(
        {
          authIndex,
          method: 'GET',
          url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
          header: {
            ...requestHeader,
            Accept: 'application/json',
            'OpenAI-Beta': 'codex-1',
            Originator: 'Codex Desktop',
          },
        },
        { timeout: CODEX_OPTIONAL_REQUEST_TIMEOUT_MS }
      );

      if (result.statusCode < 200 || result.statusCode >= 300) {
        return {
          availableCount: null,
          applicableAvailableCount: null,
          credits: [],
          error: getApiCallErrorMessage(result),
        };
      }

      const summary = normalizeCodexResetCreditsPayload(result.body ?? result.bodyText);
      if (summary.invalidPayload) {
        return {
          availableCount: null,
          applicableAvailableCount: null,
          credits: [],
          error: t('codex_quota.reset_credits_invalid_payload'),
        };
      }

      return {
        availableCount: summary.availableCount,
        applicableAvailableCount: summary.applicableAvailableCount,
        credits: summary.credits,
        error: '',
      };
    } catch (err: unknown) {
      return {
        availableCount: null,
        applicableAvailableCount: null,
        credits: [],
        error: err instanceof Error ? err.message : t('common.unknown_error'),
      };
    }
  };

  const fetchCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
    const rawAuthIndex = file['auth_index'] ?? file.authIndex;
    const authIndex = normalizeAuthIndex(rawAuthIndex);
    if (!authIndex) {
      throw new Error(t('codex_quota.missing_auth_index'));
    }

    const planTypeFromFile = resolveCodexPlanType(file);
    const subscriptionActiveUntilFromFile = resolveCodexSubscriptionActiveUntil(file);
    const accountId = resolveCodexChatgptAccountId(file);
    const requestHeader = buildCodexRequestHeader(file);

    const [result, liveSubscriptionActiveUntil] = await Promise.all([
      apiCallApi.request({
        authIndex,
        method: 'GET',
        url: CODEX_USAGE_URL,
        header: requestHeader,
      }),
      fetchCodexSubscriptionActiveUntil(authIndex, accountId, requestHeader),
    ]);

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
    }

    const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
    if (!payload) {
      throw new Error(t('codex_quota.empty_windows'));
    }

    const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
    const accountCredits = normalizeCodexAccountCredits(payload.credits);
    const resetCredits = payload.rate_limit_reset_credits ?? payload.rateLimitResetCredits ?? null;
    const usageResetCreditsData = normalizeCodexResetCreditsPayload(resetCredits);
    const resetCreditsData = await fetchCodexResetCredits(authIndex, requestHeader, t);
    const resetCreditsCountFromDetails =
      resetCreditsData.credits.length > 0 ? resetCreditsData.credits.length : null;
    const rateLimitResetCreditsAvailableCount =
      resetCreditsData.availableCount ??
      resetCreditsCountFromDetails ??
      usageResetCreditsData.availableCount;
    const rateLimitResetCreditsApplicableAvailableCount =
      usageResetCreditsData.applicableAvailableCount ??
      resetCreditsData.applicableAvailableCount ??
      rateLimitResetCreditsAvailableCount;
    const planType = planTypeFromUsage ?? planTypeFromFile;
    const subscriptionActiveUntil =
      liveSubscriptionActiveUntil?.activeUntil ?? subscriptionActiveUntilFromFile;
    const windows = buildCodexQuotaWindows(payload, t);
    return {
      planType,
      subscriptionActiveUntil,
      subscriptionActiveUntilSource:
        liveSubscriptionActiveUntil?.activeUntil != null
          ? 'subscriptions.active_until'
          : 'id_token',
      billing: liveSubscriptionActiveUntil?.billing ?? null,
      creditBalance: accountCredits.balance,
      creditsUnlimited: accountCredits.unlimited,
      rateLimitResetCreditsAvailableCount,
      rateLimitResetCreditsApplicableAvailableCount,
      rateLimitResetCredits: resetCreditsData.credits,
      rateLimitResetCreditsError: resetCreditsData.error,
      windows,
    };
  };

  const createCodexRedeemRequestId = (): string => {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }

    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
      const value = Math.floor(Math.random() * 16);
      const segment = char === 'x' ? value : (value & 0x3) | 0x8;
      return segment.toString(16);
    });
  };

  const consumeCodexRateLimitResetCredit = async (
    file: AuthFileItem,
    t: TFunction
  ): Promise<string> => {
    const rawAuthIndex = file['auth_index'] ?? file.authIndex;
    const authIndex = normalizeAuthIndex(rawAuthIndex);
    if (!authIndex) {
      throw new Error(t('codex_quota.missing_auth_index'));
    }

    const requestHeader = buildCodexRequestHeader(file);

    const result = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: CODEX_RATE_LIMIT_RESET_CREDITS_CONSUME_URL,
      header: requestHeader,
      data: JSON.stringify({
        redeem_request_id: createCodexRedeemRequestId(),
      }),
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
    }
    const code = isRecord(result.body) ? result.body.code : undefined;
    if (code !== 'reset' && code !== 'already_redeemed') {
      throw new Error(t('codex_quota.reset_not_confirmed'));
    }
    return authIndex;
  };

  const resetCodexQuota = async (file: AuthFileItem, t: TFunction): Promise<CodexQuotaData> => {
    const assertConnection = guardConfigConnection();
    const authIndex = await consumeCodexRateLimitResetCredit(file, t);
    try {
      // Never clear a different connection's cooldown after awaiting redemption.
      assertConnection();
      const result = await authFilesApi.resetCooldown(authIndex);
      assertConnection();
      if (result.status !== 'ok' || result.auth_index !== authIndex) {
        throw new Error('Invalid cooldown reset response');
      }
    } catch {
      // Redemption already succeeded: direct the operator to the existing clear action.
      throw new Error(t('codex_quota.reset_cooldown_failed'));
    }
    return fetchCodexQuota(file, t);
  };

  const config: QuotaProviderData<CodexQuotaState, CodexQuotaData> = {
    type: 'codex',
    i18nPrefix: 'codex_quota',
    filterFn: isCodexQuotaFile,
    fetchQuota: fetchCodexQuota,
    resetQuota: resetCodexQuota,
    canResetQuota: (quota) => (quota.rateLimitResetCreditsAvailableCount ?? 0) > 0,
    storeSelector: (state) => state.codexQuota,
    storeSetter: 'setCodexQuota',
    buildLoadingState: () => ({
      status: 'loading',
      windows: [],
      rateLimitResetCredits: [],
      rateLimitResetCreditsError: '',
    }),
    buildSuccessState: (data) => ({
      status: 'success',
      windows: data.windows,
      planType: data.planType,
      subscriptionActiveUntil: data.subscriptionActiveUntil,
      subscriptionActiveUntilSource: data.subscriptionActiveUntilSource,
      billing: data.billing,
      creditBalance: data.creditBalance,
      creditsUnlimited: data.creditsUnlimited,
      rateLimitResetCreditsAvailableCount: data.rateLimitResetCreditsAvailableCount,
      rateLimitResetCreditsApplicableAvailableCount:
        data.rateLimitResetCreditsApplicableAvailableCount,
      rateLimitResetCredits: data.rateLimitResetCredits,
      rateLimitResetCreditsError: data.rateLimitResetCreditsError,
    }),
    buildErrorState: (message, status) => ({
      status: 'error',
      windows: [],
      rateLimitResetCredits: [],
      rateLimitResetCreditsError: '',
      error: message,
      errorStatus: status,
    }),
  };

  return config;
}
