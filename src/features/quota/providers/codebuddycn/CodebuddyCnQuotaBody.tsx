/**
 * CodeBuddy CN 额度渲染体：资源包用量水位条。
 */

import { useTranslation } from 'react-i18next';
import type { CodeBuddyCnQuotaState } from '@/types';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

export function CodebuddyCnQuotaBody({ quota, classes }: QuotaBodyProps<CodeBuddyCnQuotaState>) {
  const { t } = useTranslation();
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return <div className={classes.quotaMessage}>{t('codebuddy_cn_quota.empty_data')}</div>;
  }

  return (
    <>
      {rows.map((row, index) => {
        const remaining =
          row.limit > 0
            ? Math.max(0, Math.min(100, Math.round(((row.limit - row.used) / row.limit) * 100)))
            : row.used > 0
              ? 0
              : null;
        const percentLabel = remaining === null ? '--' : `${remaining}%`;
        const usageLabel =
          row.limit > 0 ? `${row.used} / ${row.limit}${row.unit ? ` ${row.unit}` : ''}` : '';

        return (
          <div key={row.id} className={classes.quotaRow} title={usageLabel}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{row.label}</span>
              <div className={classes.quotaMeta}>
                {usageLabel && <span className={classes.quotaReset}>{usageLabel}</span>}
                <span className={classes.quotaPercent}>{percentLabel}</span>
              </div>
            </div>
            <QuotaMeter percent={remaining} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
