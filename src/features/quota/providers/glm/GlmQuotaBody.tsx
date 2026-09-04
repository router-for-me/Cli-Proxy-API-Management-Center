/**
 * GLM Coding Plan quota renderer.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { GlmQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function GlmQuotaBody({ quota, classes }: QuotaBodyProps<GlmQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('glm', quota), now),
    [quota, now]
  );
  const rows = quota.rows ?? [];

  return (
    <>
      {quota.planName && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('glm_quota.plan_label')}</span>
          <span className={classes.codexPlanValue}>{quota.planName}</span>
        </div>
      )}
      {rows.length === 0 ? (
        <div className={classes.quotaMessage}>{t('glm_quota.empty_data')}</div>
      ) : (
        rows.map((row, index) => {
          const remaining =
            row.limit > 0
              ? Math.max(0, Math.min(100, Math.round(((row.limit - row.used) / row.limit) * 100)))
              : null;
          const rowLabel = row.labelKey
            ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
            : (row.label ?? '');
          const resetDisplay = buildResetDisplay(null, row.resetAtMs, now, i18n.resolvedLanguage);
          const soon = row.id === soonestRowId;

          return (
            <div
              key={row.id}
              className={classes.quotaRow}
              title={soon ? t('quota_management.soonest_row_hint') : undefined}
            >
              <div className={classes.quotaRowHeader}>
                <span className={classes.quotaModel}>{rowLabel}</span>
                <div className={classes.quotaMeta}>
                  <span className={classes.quotaPercent}>
                    {remaining === null ? '--' : `${remaining}%`}
                  </span>
                  {resetDisplay && (
                    <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                  )}
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
