/**
 * Plan badge ("Max 20x", "Pro 200", "Ultra Lite") for a credential, with the
 * upstream card tier deciding how strongly it is styled. Tier rules and plan
 * labels come from upstream (features/quota/cardTier.ts and the provider quota
 * bodies), so both quota pages agree on what each plan is called.
 */

import type { TFunction } from 'i18next';
import {
  resolveAntigravityCardTier,
  resolveClaudeCardTier,
  resolveCodexCardTier,
  resolveKimiCardTier,
  type QuotaCardTier,
} from '@/features/quota/cardTier';
import type { QuotaFileEntry } from '@/features/quota/logic';
import { QUOTA_ADAPTERS, type QuotaCardState } from '@/features/quota/providers';
import type { AntigravityQuotaSubscription } from '@/types';
import {
  BUSINESS_PREMIUM_CODEX_PLAN_TYPE,
  PRO_CODEX_PLAN_TYPE,
  PRO_LITE_CODEX_PLAN_TYPES,
  PRO_MAX_CODEX_PLAN_TYPES,
  normalizePlanType,
  resolveCodexPlanType,
} from '@/utils/quota';

export interface PlanBadge {
  label: string;
  tier: QuotaCardTier;
}

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const loaded = (quota: QuotaCardState | undefined) =>
  quota?.status === 'success' ? (quota as unknown as Record<string, unknown>) : null;

/** Claude's profile tier label ("Max 20x") ranks like upstream's plan types. */
const claudeTierFromLabel = (label: string): QuotaCardTier => {
  if (/max\s*20x/i.test(label)) return 'flagship';
  if (/max/i.test(label)) return 'premium';
  return 'standard';
};

function codexLabel(planType: string, t: TFunction): string {
  const normalized = normalizePlanType(planType) ?? planType;
  if (normalized === BUSINESS_PREMIUM_CODEX_PLAN_TYPE)
    return t('codex_quota.plan_business_premium');
  if (PRO_MAX_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_promax');
  if (normalized === PRO_CODEX_PLAN_TYPE) return t('codex_quota.plan_pro');
  if (PRO_LITE_CODEX_PLAN_TYPES.has(normalized)) return t('codex_quota.plan_prolite');
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType;
}

function antigravityLabel(subscription: AntigravityQuotaSubscription, t: TFunction) {
  const plan = subscription.plan?.trim().toLowerCase();
  if (plan === 'free') return t('antigravity_subscription.plan_free');
  if (plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return text(subscription.tierName) ?? text(subscription.tierId);
}

/** The credential's plan badge, or null when its plan is not known. */
export function resolvePlanBadge(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  claudeTier: string | null | undefined,
  t: TFunction
): PlanBadge | null {
  const state = loaded(quota);
  switch (entry.type) {
    case 'claude': {
      if (claudeTier) return { label: claudeTier, tier: claudeTierFromLabel(claudeTier) };
      const planType = text(state?.planType);
      if (!planType) return null;
      return {
        label: t(`claude_quota.${planType}`, { defaultValue: planType }),
        tier: resolveClaudeCardTier(planType),
      };
    }
    case 'codex': {
      const planType = text(state?.planType) ?? resolveCodexPlanType(entry.file);
      if (!planType) return null;
      return { label: codexLabel(planType, t), tier: resolveCodexCardTier(planType) };
    }
    case 'antigravity': {
      const subscription = state?.subscription as AntigravityQuotaSubscription | null | undefined;
      const label = subscription ? antigravityLabel(subscription, t) : null;
      return label ? { label, tier: resolveAntigravityCardTier(subscription?.plan) } : null;
    }
    case 'kimi': {
      const plan = text(state?.planName);
      return plan ? { label: plan, tier: resolveKimiCardTier(plan) } : null;
    }
    default: {
      const data = state?.data as { planName?: unknown } | undefined;
      const plan = text(state?.planType) ?? text(state?.plan) ?? text(data?.planName);
      if (!plan) return null;
      const prefix = QUOTA_ADAPTERS[entry.type].i18nPrefix;
      return { label: t(`${prefix}.plan_${plan}`, { defaultValue: plan }), tier: 'standard' };
    }
  }
}
