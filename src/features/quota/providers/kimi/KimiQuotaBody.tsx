/**
 * Kimi 额度渲染体：用量行水位条。
 */

import { useTranslation } from 'react-i18next';
import type { KimiQuotaState } from '@/types';
import { formatKimiResetHint } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

export function KimiQuotaBody({ quota, classes }: QuotaBodyProps<KimiQuotaState>) {
  const { t } = useTranslation();
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return <div className={classes.quotaMessage}>{t('kimi_quota.empty_data')}</div>;
  }

  return (
    <>
      {rows.map((row, index) => {
        const limit = row.limit;
        const used = row.used;
        const remaining =
          limit > 0
            ? Math.max(0, Math.min(100, Math.round(((limit - used) / limit) * 100)))
            : used > 0
              ? 0
              : null;
        const percentLabel = remaining === null ? '--' : `${remaining}%`;
        const rowLabel = row.labelKey
          ? t(row.labelKey, (row.labelParams ?? {}) as Record<string, string | number>)
          : (row.label ?? '');
        const resetLabel = formatKimiResetHint(t, row.resetHint);

        return (
          <div key={row.id} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{rowLabel}</span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>{percentLabel}</span>
                {resetLabel && <span className={classes.quotaReset}>{resetLabel}</span>}
              </div>
            </div>
            <QuotaMeter percent={remaining} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
