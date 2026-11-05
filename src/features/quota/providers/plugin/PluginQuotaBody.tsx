import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { PluginQuotaMetric, PluginQuotaState } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, formatQuotaResetTime } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

const formatMetric = (metric: PluginQuotaMetric): string => {
  const value =
    metric.format === 'currency' && metric.currency
      ? new Intl.NumberFormat(undefined, { style: 'currency', currency: metric.currency }).format(metric.value)
      : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(metric.value);
  return metric.unit ? `${value} ${metric.unit}` : value;
};

export function PluginQuotaBody({ quota, classes }: QuotaBodyProps<PluginQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('plugin', quota), now),
    [quota, now]
  );
  const plan = quota.subscription?.tierName || quota.subscription?.plan || quota.subscription?.tierId;

  return (
    <>
      {(plan || quota.summary.length > 0) && (
        <div className={classes.codexPlan}>
          {plan && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('plugin_quota.plan_label')}</span>
              <span className={classes.codexPlanValue}>{plan}</span>
            </span>
          )}
          {quota.summary.map((metric) => (
            <span key={metric.key} className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{metric.label}</span>
              <span className={classes.codexPlanValue}>{formatMetric(metric)}</span>
            </span>
          ))}
        </div>
      )}
      {!plan && quota.summary.length === 0 && quota.groups.length === 0 ? (
        <div className={classes.quotaMessage}>{t('plugin_quota.empty_data')}</div>
      ) : (
        quota.groups.map((group) => (
          <div key={group.id} className={classes.antigravityQuotaGroup}>
            <div className={classes.antigravityQuotaGroupHeader}>
              <span className={classes.antigravityQuotaGroupTitle}>{group.label}</span>
              {group.description && (
                <span className={classes.antigravityQuotaGroupDescription}>{group.description}</span>
              )}
            </div>
            {group.buckets.map((bucket, index) => {
              const percent = Math.round(Math.max(0, Math.min(1, bucket.remainingFraction)) * 100);
              const resetDisplay = buildResetDisplay(
                formatQuotaResetTime(bucket.resetTime),
                bucket.resetAtMs,
                now,
                i18n.resolvedLanguage
              );
              const soon = bucket.id === soonestRowId;
              return (
                <div
                  key={bucket.id}
                  className={classes.quotaRow}
                  title={soon ? t('quota_management.soonest_row_hint') : undefined}
                >
                  <div className={classes.quotaRowHeader}>
                    <span className={classes.quotaModel} title={bucket.description}>
                      {bucket.label}
                    </span>
                    <div className={classes.quotaMeta}>
                      <span className={classes.quotaPercent}>
                        {t('plugin_quota.remaining_percent', { percent })}
                      </span>
                      {resetDisplay ? (
                        <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                      ) : (
                        <span className={classes.quotaReset}>-</span>
                      )}
                    </div>
                  </div>
                  <QuotaMeter percent={percent} classes={classes} index={index} />
                </div>
              );
            })}
          </div>
        ))
      )}
    </>
  );
}
