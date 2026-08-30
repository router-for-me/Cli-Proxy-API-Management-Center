/**
 * CodeBuddy CN 额度渲染体：套餐 chip + 用量行水位条。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CodeBuddyQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function CodeBuddyQuotaBody({ quota, classes }: QuotaBodyProps<CodeBuddyQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('codebuddy', quota), now),
    [quota, now]
  );
  const rows = quota.rows ?? [];
  const plan = quota.plan ?? null;

  if (rows.length === 0) {
    return <div className={classes.quotaMessage}>{t('codebuddy_quota.empty_data')}</div>;
  }

  return (
    <>
      {plan && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanItem}>
            <span className={classes.codexPlanLabel}>{t('codebuddy_quota.plan_label')}</span>
            <span className={classes.codexPlanValue}>{plan}</span>
          </span>
        </div>
      )}
      {rows.map((row, index) => {
        const total = row.total;
        const used = row.used;
        const remaining =
          total > 0 ? Math.max(0, Math.min(100, Math.round(((total - used) / total) * 100))) : null;
        const percentLabel = remaining === null ? '--' : `${remaining}%`;
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
                <span className={classes.quotaPercent}>{percentLabel}</span>
                {resetDisplay && (
                  <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                )}
              </div>
            </div>
            <QuotaMeter percent={remaining} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
