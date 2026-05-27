/**
 * Gemini CLI provider quota fetch + parse helpers.
 *
 * Returns plain data; supplementary refresh scheduling (e.g. async store
 * updates) lives in the QuotaPage layer so this helper stays reusable.
 */

import type { TFunction } from 'i18next';
import type {
  AuthFileItem,
  GeminiCliCodeAssistPayload,
  GeminiCliCredits,
  GeminiCliParsedBucket,
  GeminiCliQuotaBucketState,
  GeminiCliUserTier,
} from '@/types';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import {
  GEMINI_CLI_CODE_ASSIST_URL,
  GEMINI_CLI_QUOTA_URL,
  GEMINI_CLI_REQUEST_HEADERS,
} from '../constants';
import { createStatusError } from '../formatters';
import {
  normalizeAuthIndex,
  normalizeGeminiCliModelId,
  normalizeNumberValue,
  normalizeQuotaFraction,
  normalizeStringValue,
  parseGeminiCliCodeAssistPayload,
  parseGeminiCliQuotaPayload,
} from '../parsers';
import { buildGeminiCliQuotaBuckets } from '../builders';
import { resolveGeminiCliProjectId } from '../resolvers';

const GEMINI_CLI_G1_CREDIT_TYPE = 'GOOGLE_ONE_AI';

const GEMINI_CLI_TIER_LABELS: Record<string, string> = {
  'free-tier': 'tier_free',
  'legacy-tier': 'tier_legacy',
  'standard-tier': 'tier_standard',
  'g1-pro-tier': 'tier_pro',
  'g1-ultra-tier': 'tier_ultra',
};

export type GeminiCliQuotaBucketsResult = {
  fileName: string;
  projectId: string;
  authIndex: string;
  buckets: GeminiCliQuotaBucketState[];
};

export type GeminiCliCodeAssistSnapshot = {
  tierLabel: string | null;
  tierId: string | null;
  creditBalance: number | null;
};

export const resolveGeminiCliTierLabel = (
  payload: GeminiCliCodeAssistPayload | null,
  t: TFunction
): string | null => {
  if (!payload) return null;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const rawId = normalizeStringValue(paidTier?.id) ?? normalizeStringValue(currentTier?.id);
  if (!rawId) return null;
  const tierId = rawId.toLowerCase();
  const labelKey = GEMINI_CLI_TIER_LABELS[tierId];
  return labelKey ? t(`gemini_cli_quota.${labelKey}`) : rawId;
};

export const resolveGeminiCliTierId = (payload: GeminiCliCodeAssistPayload | null): string | null => {
  if (!payload) return null;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const rawId = normalizeStringValue(paidTier?.id) ?? normalizeStringValue(currentTier?.id);
  return rawId ? rawId.toLowerCase() : null;
};

export const resolveGeminiCliCreditBalance = (
  payload: GeminiCliCodeAssistPayload | null
): number | null => {
  if (!payload) return null;
  const paidTier: GeminiCliUserTier | null | undefined = payload.paidTier ?? payload.paid_tier;
  const currentTier: GeminiCliUserTier | null | undefined =
    payload.currentTier ?? payload.current_tier;
  const tier = paidTier ?? currentTier;
  if (!tier) return null;
  const credits: GeminiCliCredits[] = tier.availableCredits ?? tier.available_credits ?? [];
  let total = 0;
  let found = false;
  for (const credit of credits) {
    const creditType = normalizeStringValue(credit.creditType ?? credit.credit_type);
    if (creditType !== GEMINI_CLI_G1_CREDIT_TYPE) continue;
    const amount = normalizeNumberValue(credit.creditAmount ?? credit.credit_amount);
    if (amount !== null) {
      total += amount;
      found = true;
    }
  }
  return found ? total : null;
};

export const fetchGeminiCliCodeAssistSnapshot = async (
  authIndex: string,
  projectId: string,
  t: TFunction
): Promise<GeminiCliCodeAssistSnapshot> => {
  try {
    const result = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: GEMINI_CLI_CODE_ASSIST_URL,
      header: { ...GEMINI_CLI_REQUEST_HEADERS },
      data: JSON.stringify({
        cloudaicompanionProject: projectId,
        metadata: {
          ideType: 'IDE_UNSPECIFIED',
          platform: 'PLATFORM_UNSPECIFIED',
          pluginType: 'GEMINI',
          duetProject: projectId,
        },
      }),
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      return { tierLabel: null, tierId: null, creditBalance: null };
    }

    const payload = parseGeminiCliCodeAssistPayload(result.body ?? result.bodyText);
    return {
      tierLabel: resolveGeminiCliTierLabel(payload, t),
      tierId: resolveGeminiCliTierId(payload),
      creditBalance: resolveGeminiCliCreditBalance(payload),
    };
  } catch {
    return { tierLabel: null, tierId: null, creditBalance: null };
  }
};

export const fetchGeminiCliQuotaBuckets = async (
  file: AuthFileItem,
  t: TFunction
): Promise<GeminiCliQuotaBucketsResult> => {
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndex = normalizeAuthIndex(rawAuthIndex);
  if (!authIndex) {
    throw new Error(t('gemini_cli_quota.missing_auth_index'));
  }

  const projectId = resolveGeminiCliProjectId(file);
  if (!projectId) {
    throw new Error(t('gemini_cli_quota.missing_project_id'));
  }

  const quotaResponse = await apiCallApi.request({
    authIndex,
    method: 'POST',
    url: GEMINI_CLI_QUOTA_URL,
    header: { ...GEMINI_CLI_REQUEST_HEADERS },
    data: JSON.stringify({ project: projectId }),
  });
  if (quotaResponse.statusCode < 200 || quotaResponse.statusCode >= 300) {
    throw createStatusError(getApiCallErrorMessage(quotaResponse), quotaResponse.statusCode);
  }

  const payload = parseGeminiCliQuotaPayload(quotaResponse.body ?? quotaResponse.bodyText);
  const buckets = Array.isArray(payload?.buckets) ? payload?.buckets : [];

  const parsedBuckets = buckets
    .map((bucket) => {
      const modelId = normalizeGeminiCliModelId(bucket.modelId ?? bucket.model_id);
      if (!modelId) return null;
      const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
      const remainingFractionRaw = normalizeQuotaFraction(
        bucket.remainingFraction ?? bucket.remaining_fraction
      );
      const remainingAmount = normalizeNumberValue(
        bucket.remainingAmount ?? bucket.remaining_amount
      );
      const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
      let fallbackFraction: number | null = null;
      if (remainingAmount !== null) {
        fallbackFraction = remainingAmount <= 0 ? 0 : null;
      } else if (resetTime) {
        fallbackFraction = 0;
      }
      const remainingFraction = remainingFractionRaw ?? fallbackFraction;
      return {
        modelId,
        tokenType,
        remainingFraction,
        remainingAmount,
        resetTime,
      };
    })
    .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

  return {
    fileName: file.name,
    projectId,
    authIndex,
    buckets: buildGeminiCliQuotaBuckets(parsedBuckets),
  };
};

export type GeminiCliQuotaResult = GeminiCliQuotaBucketsResult & GeminiCliCodeAssistSnapshot;

/**
 * Convenience helper that fetches buckets first, then awaits the supplementary
 * code-assist snapshot. Consumers that need to schedule the snapshot
 * asynchronously (QuotaPage) should call the two helpers separately.
 */
export const fetchGeminiCliQuota = async (
  file: AuthFileItem,
  t: TFunction
): Promise<GeminiCliQuotaResult> => {
  const bucketsResult = await fetchGeminiCliQuotaBuckets(file, t);
  const snapshot = await fetchGeminiCliCodeAssistSnapshot(
    bucketsResult.authIndex,
    bucketsResult.projectId,
    t
  );
  return { ...bucketsResult, ...snapshot };
};
