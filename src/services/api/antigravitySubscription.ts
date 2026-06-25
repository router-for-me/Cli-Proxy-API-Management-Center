import { apiCallApi, getApiCallErrorMessage } from './apiCall';
import {
  ANTIGRAVITY_CODE_ASSIST_URL,
  ANTIGRAVITY_REQUEST_HEADERS,
  createStatusError,
  normalizeStringValue,
  parseAntigravityPayload,
} from '@/utils/quota';

export type AntigravitySubscriptionPlan = 'free' | 'pro' | 'ultra' | 'ultra-lite' | 'unknown';

export type AntigravitySubscriptionTier = {
  id: string | null;
  name: string | null;
};

export type AntigravitySubscriptionCredit = {
  creditType: string | null;
  creditAmount: number | string | null;
  minimumCreditAmountForUsage: number | string | null;
};

export type AntigravitySubscriptionSummary = {
  plan: AntigravitySubscriptionPlan;
  tierId: string | null;
  tierName: string | null;
  source: 'paid' | 'current';
  currentTier: AntigravitySubscriptionTier | null;
  paidTier: AntigravitySubscriptionTier | null;
  availableCredits: AntigravitySubscriptionCredit[];
};

type RawTierPayload = {
  id?: unknown;
  name?: unknown;
  availableCredits?: unknown;
  available_credits?: unknown;
};

const CODE_ASSIST_REQUEST_BODY = JSON.stringify({ metadata: { ideType: 'ANTIGRAVITY' } });

const PLAN_BY_TIER_ID = new Map<string, AntigravitySubscriptionPlan>([
  ['free-tier', 'free'],
  ['g1-pro-tier', 'pro'],
  ['g1-ultra-tier', 'ultra'],
  ['g1-ultra-lite-tier', 'ultra-lite'],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeTier = (value: unknown): AntigravitySubscriptionTier | null => {
  if (!isRecord(value)) return null;
  const rawTier = value as RawTierPayload;
  return {
    id: normalizeStringValue(rawTier.id),
    name: normalizeStringValue(rawTier.name),
  };
};

const normalizeCreditValue = (value: unknown): number | string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return normalizeStringValue(value);
};

const normalizeCredits = (value: unknown): AntigravitySubscriptionCredit[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map((credit) => ({
      creditType: normalizeStringValue(credit.creditType ?? credit.credit_type),
      creditAmount: normalizeCreditValue(credit.creditAmount ?? credit.credit_amount),
      minimumCreditAmountForUsage: normalizeCreditValue(
        credit.minimumCreditAmountForUsage ?? credit.minimum_credit_amount_for_usage
      ),
    }))
    .filter((credit) => credit.creditType || credit.creditAmount !== null);
};

const resolvePlan = (tierId: string | null): AntigravitySubscriptionPlan => {
  if (!tierId) return 'unknown';
  return PLAN_BY_TIER_ID.get(tierId) ?? 'unknown';
};

export const parseAntigravitySubscriptionSummary = (
  payload: unknown
): AntigravitySubscriptionSummary | null => {
  const parsed = parseAntigravityPayload(payload);
  if (!parsed) return null;

  const currentTierPayload = parsed.currentTier ?? parsed.current_tier;
  const paidTierPayload = parsed.paidTier ?? parsed.paid_tier;
  const currentTier = normalizeTier(currentTierPayload);
  const paidTier = normalizeTier(paidTierPayload);
  const effectiveTier = paidTier?.id ? paidTier : currentTier;
  if (!effectiveTier?.id && !effectiveTier?.name) return null;

  const rawCredits = isRecord(paidTierPayload)
    ? (paidTierPayload.availableCredits ?? paidTierPayload.available_credits)
    : undefined;

  return {
    plan: resolvePlan(effectiveTier.id),
    tierId: effectiveTier.id,
    tierName: effectiveTier.name,
    source: paidTier?.id ? 'paid' : 'current',
    currentTier,
    paidTier,
    availableCredits: normalizeCredits(rawCredits),
  };
};

export const antigravitySubscriptionApi = {
  async get(authIndex: string): Promise<AntigravitySubscriptionSummary | null> {
    const result = await apiCallApi.request({
      authIndex,
      method: 'POST',
      url: ANTIGRAVITY_CODE_ASSIST_URL,
      header: { ...ANTIGRAVITY_REQUEST_HEADERS },
      data: CODE_ASSIST_REQUEST_BODY,
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
    }

    return parseAntigravitySubscriptionSummary(result.body ?? result.bodyText);
  },
};
