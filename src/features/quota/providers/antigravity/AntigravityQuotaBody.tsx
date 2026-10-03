/**
 * Antigravity 额度渲染体：套餐 chip 行（ultra/ultra-lite=金卡）+ 分组水位条。
 */

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type { AntigravityQuotaState, AntigravityQuotaSubscription } from '@/types';
import { QuotaMeter } from '../../components/QuotaMeter';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';
import {
  formatAntigravityDuration,
  getNextAntigravityCountdownUpdateDelay,
  resolveAntigravityCountdown,
  type AntigravityCountdown,
} from './countdown';

/**
 * 行尾"X 后刷新"文案。
 *
 * `unknown` 渲染成 '-'：字段缺失时宁可留空，也不要拼出"…后刷新"。
 */
const formatAntigravityResetLabel = (
  countdown: AntigravityCountdown,
  t: TFunction
): string => {
  if (countdown.kind === 'unknown') return '-';
  if (countdown.kind === 'elapsed') return t('antigravity_quota.refresh_available');
  return t('antigravity_quota.refreshes_in', {
    duration: formatAntigravityDuration(t, countdown.deltaMs),
  });
};

const ANTIGRAVITY_GROUP_LABEL_KEYS = new Map<string, string>([
  ['gemini models', 'group_gemini_models'],
  ['claude and gpt models', 'group_claude_gpt_models'],
]);

const ANTIGRAVITY_BUCKET_LABEL_KEYS = new Map<string, string>([
  ['weekly limit', 'weekly_limit'],
  ['daily limit', 'daily_limit'],
  ['5 hour limit', 'five_hour_limit'],
  ['5-hour limit', 'five_hour_limit'],
  ['five hour limit', 'five_hour_limit'],
  ['monthly limit', 'monthly_limit'],
]);

const normalizeAntigravityQuotaText = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, ' ');

const translateAntigravityQuotaLabel = (
  value: string,
  keys: Map<string, string>,
  t: TFunction
): string => {
  const key = keys.get(normalizeAntigravityQuotaText(value));
  return key ? t(`antigravity_quota.${key}`) : value;
};

const translateAntigravityQuotaDescription = (
  value: string | undefined,
  t: TFunction
): string | undefined => {
  if (!value) return undefined;
  const modelsMatch = value.match(/^models within this group:\s*(.+)$/i);
  if (modelsMatch) {
    return t('antigravity_quota.group_models_description', {
      models: modelsMatch[1].trim(),
    });
  }
  return value;
};

const getAntigravityPlanLabel = (
  subscription: AntigravityQuotaSubscription | null | undefined,
  t: TFunction
): string | null => {
  if (!subscription) return null;
  if (subscription.plan === 'free') return t('antigravity_subscription.plan_free');
  if (subscription.plan === 'pro') return t('antigravity_subscription.plan_pro');
  if (subscription.plan === 'ultra') return t('antigravity_subscription.plan_ultra');
  if (subscription.plan === 'ultra-lite') return t('antigravity_subscription.plan_ultra_lite');
  return (
    subscription.tierName ||
    subscription.tierId ||
    (subscription.plan === 'unknown' ? t('antigravity_subscription.plan_unknown') : null)
  );
};

export function AntigravityQuotaBody({ quota, classes }: QuotaBodyProps<AntigravityQuotaState>) {
  const { t } = useTranslation();
  const groups = quota.groups ?? [];
  const planLabel = getAntigravityPlanLabel(quota.subscription, t);
  const normalizedPlan = quota.subscription?.plan?.toLowerCase() ?? '';
  const isPremiumPlan = normalizedPlan === 'ultra' || normalizedPlan === 'ultra-lite';
  const serverTimeOffsetMs = quota.serverTimeOffsetMs ?? 0;
  const resetTimestamps = useMemo(
    () =>
      (quota.groups ?? []).flatMap((group) =>
        group.buckets
          .flatMap((bucket) =>
            // 被压制行的倒计时走 disabledResetTime：不到点就没有重渲染，文案会卡在"还有 N 天"。
            [bucket.resetTime, bucket.disabledResetTime].map((value) =>
              value ? new Date(value).getTime() : Number.NaN
            )
          )
          .filter(Number.isFinite)
      ),
    [quota.groups]
  );
  // 首屏直接显示准确文案；后续 effect 会在最近的分钟边界更新并重新排程。
  const [nowMs, setNowMs] = useState(() => Date.now() + serverTimeOffsetMs);

  useEffect(() => {
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const updateCountdown = () => {
      const currentNowMs = Date.now() + serverTimeOffsetMs;
      setNowMs(currentNowMs);
      const delay = getNextAntigravityCountdownUpdateDelay(resetTimestamps, currentNowMs);
      if (delay !== null) {
        timeoutId = setTimeout(updateCountdown, delay);
      }
    };

    updateCountdown();
    return () => {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    };
  }, [resetTimestamps, serverTimeOffsetMs]);

  // Ranked against this provider's own server-corrected clock rather than the
  // shared one, so the final-hour warning and the countdown always agree.
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('antigravity', quota), nowMs),
    [quota, nowMs]
  );

  return (
    <>
      {planLabel && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanItem}>
            <span className={classes.codexPlanLabel}>{t('antigravity_quota.plan_label')}</span>
            <span className={isPremiumPlan ? classes.premiumPlanValue : classes.codexPlanValue}>
              {planLabel}
            </span>
          </span>
        </div>
      )}
      {groups.length === 0 ? (
        <div className={classes.quotaMessage}>{t('antigravity_quota.empty_models')}</div>
      ) : (
        groups.map((group) => {
          const groupLabel = translateAntigravityQuotaLabel(
            group.label,
            ANTIGRAVITY_GROUP_LABEL_KEYS,
            t
          );
          const groupDescription = translateAntigravityQuotaDescription(group.description, t);

          return (
            <div key={group.id} className={classes.antigravityQuotaGroup}>
              <div className={classes.antigravityQuotaGroupHeader}>
                <span className={classes.antigravityQuotaGroupTitle}>{groupLabel}</span>
                {groupDescription && (
                  <span className={classes.antigravityQuotaGroupDescription}>
                    {groupDescription}
                  </span>
                )}
              </div>
              {group.buckets.map((bucket, index) => {
                const clamped = Math.max(0, Math.min(1, bucket.remainingFraction));
                const percent = clamped * 100;
                // 周额度已耗尽时 5h 窗口不生效：不再报"额度可用"，改报压制原因与恢复时长。
                const recovery = bucket.disabled
                  ? resolveAntigravityCountdown(bucket.disabledResetTime, nowMs)
                  : null;
                const percentLabel =
                  recovery === null
                    ? bucket.remainingFraction === 1
                      ? t('antigravity_quota.quota_available')
                      : t('antigravity_quota.remaining_percent', {
                          percent: Math.round(percent),
                        })
                    : // 恢复时刻已过或缺失时退到无时长文案，绝不拼出"…后刷新"或"- 后刷新"。
                      recovery.kind === 'countdown'
                      ? t('antigravity_quota.disabled_weekly_exhausted_in', {
                          duration: formatAntigravityDuration(t, recovery.deltaMs),
                        })
                      : t('antigravity_quota.disabled_weekly_exhausted');
                // 左侧已写着恢复时长，行尾再挂 5h 自己的倒计时就是同一行两个倒计时。
                const resetLabel = recovery
                  ? null
                  : formatAntigravityResetLabel(
                      resolveAntigravityCountdown(bucket.resetTime, nowMs),
                      t
                    );
                const bucketLabel = translateAntigravityQuotaLabel(
                  bucket.label,
                  ANTIGRAVITY_BUCKET_LABEL_KEYS,
                  t
                );
                const bucketDescription = translateAntigravityQuotaDescription(
                  bucket.description,
                  t
                );

                const soon = bucket.id === soonestRowId;

                return (
                  <div key={bucket.id} className={classes.quotaRow}>
                    <div className={classes.quotaRowHeader}>
                      <span className={classes.quotaModel} title={bucketDescription}>
                        {bucketLabel}
                      </span>
                      <div className={classes.quotaMeta}>
                        <span className={classes.quotaPercent}>{percentLabel}</span>
                        {resetLabel !== null && (
                          <span
                            className={
                              soon
                                ? `${classes.quotaReset} ${classes.quotaResetRelativeSoon}`
                                : classes.quotaReset
                            }
                            title={soon ? t('quota_management.soonest_row_hint') : undefined}
                          >
                            {resetLabel}
                          </span>
                        )}
                      </div>
                    </div>
                    <QuotaMeter
                      percent={percent}
                      classes={classes}
                      index={index}
                      disabled={bucket.disabled}
                    />
                  </div>
                );
              })}
            </div>
          );
        })
      )}
    </>
  );
}
