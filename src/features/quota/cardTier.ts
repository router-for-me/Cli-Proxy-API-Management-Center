/**
 * 额度卡片档位：跨 provider 的统一阶梯。卡面（QuotaCard）与套餐文字
 * （*QuotaBody 的 plan value class）共用这里的判定，两者不会各说各话。
 *
 * 规则：各家最高个人档 = 套房；其下的付费个人档 = 行政间；入门付费档、
 * 团队/商业套餐与免费档 = 标准间。
 *
 * - flagship 套房：Codex Pro 500、Kimi Allegro、Claude Max 20x、Antigravity Ultra、SuperGrok Heavy
 * - premium  行政间：Codex Pro 200 / Pro 100、Claude Max 5x / Max（未区分）、
 *            Kimi Allegretto、Antigravity Ultra Lite、SuperGrok、xAI 付费 API
 * - standard 标准间：Plus、Team、Business（含 Business Premium）、Pro（Claude /
 *            Antigravity）、Kimi Moderato / Andante、Free，以及档位未知
 *
 * React-free，便于单测。
 */

import type {
  AuthFileItem,
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  XaiBillingSummary,
  XaiQuotaState,
} from '@/types';
import { resolveCodexPlanType, resolvePlanTier } from '@/utils/quota';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import type { QuotaClassMap } from './types';

export type QuotaCardTier = 'standard' | 'premium' | 'flagship';

/** 订阅接口无标签时，按月度额度（分）识别 SuperGrok / Heavy。 */
export const XAI_SUPERGROK_LIMIT_CENTS = 15_000;
export const XAI_SUPERGROK_HEAVY_LIMIT_CENTS = 150_000;

export function resolveCodexCardTier(planType: string | null | undefined): QuotaCardTier {
  const tier = resolvePlanTier(planType);
  if (tier === 'elite') return 'flagship';
  if (tier === 'premium') return 'premium';
  return 'standard';
}

/** Kimi: Allegro = Pro 500, Allegretto = Pro 200, Moderato = Plus. */
export function resolveKimiCardTier(planName: string | null | undefined): QuotaCardTier {
  const normalized = planName?.trim().toLowerCase();
  if (normalized === 'allegro') return 'flagship';
  if (normalized === 'allegretto') return 'premium';
  return 'standard';
}

export function resolveAntigravityCardTier(plan: string | null | undefined): QuotaCardTier {
  const normalized = plan?.trim().toLowerCase() ?? '';
  if (normalized === 'ultra') return 'flagship';
  if (normalized === 'ultra-lite') return 'premium';
  return 'standard';
}

export function resolveClaudeCardTier(planType: string | null | undefined): QuotaCardTier {
  if (planType === 'plan_max20') return 'flagship';
  // 未区分 5x/20x 的 Max 按低一档保守处理。
  if (planType === 'plan_max5' || planType === 'plan_max') return 'premium';
  return 'standard';
}

export function resolveXaiCardTier(billing: XaiBillingSummary): QuotaCardTier {
  if (billing.planLabel) {
    if (billing.planTier === 'elite') return 'flagship';
    if (billing.planTier === 'premium') return 'premium';
    return 'standard';
  }
  // 付费 API 只做健康检查，拿不到套餐名，但它本身就是付费档。
  if (billing.mode === 'paid-health') return 'premium';
  // 按月度额度识别时与订阅接口的判定保持一致（resolveXaiSubscriptionPlan）。
  if (billing.monthlyLimitCents === XAI_SUPERGROK_HEAVY_LIMIT_CENTS) return 'flagship';
  if (billing.monthlyLimitCents === XAI_SUPERGROK_LIMIT_CENTS) return 'premium';
  return 'standard';
}

/** 数据到达后的档位；非 success 返回 null（调用方应沿用上一次的档位）。 */
export function resolveQuotaCardTier(
  type: QuotaProviderType,
  quota: QuotaCardState | undefined
): QuotaCardTier | null {
  if (!quota || quota.status !== 'success') return null;
  switch (type) {
    case 'codex':
      return resolveCodexCardTier((quota as CodexQuotaState).planType);
    case 'kimi':
      return resolveKimiCardTier((quota as KimiQuotaState).planName);
    case 'antigravity':
      return resolveAntigravityCardTier((quota as AntigravityQuotaState).subscription?.plan);
    case 'claude':
      return resolveClaudeCardTier((quota as ClaudeQuotaState).planType);
    case 'xai': {
      const billing = (quota as XaiQuotaState).billing;
      return billing ? resolveXaiCardTier(billing) : 'standard';
    }
    default:
      return 'standard';
  }
}

/**
 * 数据到达前的档位猜测：只有 Codex 的认证文件自带套餐（id_token），
 * 让 Pro 200 卡片从空闲态起就是套房，避免数据到达时整卡由浅翻深。
 */
export function resolveInitialQuotaCardTier(
  type: QuotaProviderType,
  file: AuthFileItem
): QuotaCardTier {
  return type === 'codex' ? resolveCodexCardTier(resolveCodexPlanType(file)) : 'standard';
}

/** 套餐文字的样式：与卡面同档。 */
export function planValueClassForTier(tier: QuotaCardTier, classes: QuotaClassMap): string {
  if (tier === 'flagship') return classes.elitePlanValue;
  if (tier === 'premium') return classes.premiumPlanValue;
  return classes.codexPlanValue;
}
