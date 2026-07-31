/**
 * Codex 额度渲染体：套餐 chip 行（elite=Pro 20x 液态铂金 / premium=金卡）、
 * 重置积分明细、用量窗口水位条。
 */

import { useTranslation } from 'react-i18next';
import type { CodexQuotaState } from '@/types';
import {
  normalizePlanType,
  resolvePlanTier,
  PREMIUM_CODEX_PLAN_TYPES,
  formatShanghaiDateTime,
} from '@/utils/quota';
import { formatDateTimeValue } from '@/utils/format';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps, QuotaClassMap } from '../../types';

const getPlanValueClass = (planType: string | null, classes: QuotaClassMap): string => {
  // elite/premium 顺序契约由 resolvePlanTier 承载（tests/quotaPlanTier.test.ts 守护）。
  const tier = resolvePlanTier(planType);
  if (tier === 'elite') return classes.elitePlanValue;
  if (tier === 'premium') return classes.premiumPlanValue;
  return classes.codexPlanValue;
};

export function CodexQuotaBody({ quota, classes }: QuotaBodyProps<CodexQuotaState>) {
  const { t } = useTranslation();
  const windows = quota.windows ?? [];
  const planType = quota.planType ?? null;
  const subscriptionActiveUntil = quota.subscriptionActiveUntil ?? null;
  const rateLimitResetCreditsAvailableCount = quota.rateLimitResetCreditsAvailableCount ?? null;
  const rateLimitResetCredits = quota.rateLimitResetCredits ?? [];
  const rateLimitResetCreditsError = quota.rateLimitResetCreditsError ?? '';

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'pro') return t('codex_quota.plan_pro');
    if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
      return t('codex_quota.plan_prolite');
    }
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const expiryLabel = subscriptionActiveUntil ? formatDateTimeValue(subscriptionActiveUntil) : '';
  const planValueClass = getPlanValueClass(planType, classes);

  return (
    <>
      {(planLabel || expiryLabel || rateLimitResetCreditsAvailableCount !== null) && (
        <div className={classes.codexPlan}>
          {planLabel && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('codex_quota.plan_label')}</span>
              <span className={planValueClass}>{planLabel}</span>
            </span>
          )}
          {expiryLabel && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('codex_quota.expires_label')}</span>
              <span className={classes.codexPlanValue}>{expiryLabel}</span>
            </span>
          )}
          {rateLimitResetCreditsAvailableCount !== null && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('codex_quota.reset_credits_label')}</span>
              <span className={classes.codexPlanValue}>
                {rateLimitResetCreditsAvailableCount.toString()}
              </span>
            </span>
          )}
        </div>
      )}
      {rateLimitResetCredits.length > 0 ? (
        <div className={classes.codexResetCredits}>
          <div className={classes.codexResetCreditsTitle}>
            {t('codex_quota.reset_credits_expiry_label')}
          </div>
          {rateLimitResetCredits.map((credit, index) => (
            <div
              key={credit.id || `${credit.expiresAt}-${index}`}
              className={classes.codexResetCreditRow}
            >
              <span className={classes.codexResetCreditLabel}>
                {t('codex_quota.reset_credit_number', { index: index + 1 })}
              </span>
              <span className={classes.codexResetCreditTime}>
                {formatShanghaiDateTime(credit.expiresAt) || credit.expiresAt}
              </span>
            </div>
          ))}
        </div>
      ) : rateLimitResetCreditsError ? (
        <div className={classes.codexResetCreditsError}>
          {t('codex_quota.reset_credits_expiry_failed', {
            message: rateLimitResetCreditsError,
          })}
        </div>
      ) : null}
      {windows.length === 0 ? (
        <div className={classes.quotaMessage}>{t('codex_quota.empty_windows')}</div>
      ) : (
        windows.map((window, index) => {
          const used = window.usedPercent;
          const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
          const remaining =
            clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
          const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
          const windowLabel = window.labelKey
            ? t(window.labelKey, window.labelParams as Record<string, string | number>)
            : window.label;

          return (
            <div key={window.id} className={classes.quotaRow}>
              <div className={classes.quotaRowHeader}>
                <span className={classes.quotaModel}>{windowLabel}</span>
                <div className={classes.quotaMeta}>
                  <span className={classes.quotaPercent}>{percentLabel}</span>
                  <span className={classes.quotaReset}>{window.resetLabel}</span>
                </div>
              </div>
              <QuotaMeter percent={remaining} classes={classes} index={index} />
            </div>
          );
        })
      )}
    </>
  );
}
