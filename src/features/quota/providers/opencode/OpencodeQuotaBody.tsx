/**
 * OpenCode Go quota body: one meter per rolling / weekly / monthly window.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpencodeQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function OpencodeQuotaBody({ quota, classes }: QuotaBodyProps<OpencodeQuotaState>) {
  const { t, i18n } = useTranslation();
  // Ahead of the early return below — hooks cannot be conditional.
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('opencode', quota), now),
    [quota, now]
  );
  const rows = quota.rows ?? [];

  if (rows.length === 0) {
    return <div className={classes.quotaMessage}>{t('opencode_quota.empty_data')}</div>;
  }

  return (
    <>
      {rows.map((row, index) => {
        const percentLabel = row.rateLimited
          ? t('opencode_quota.rate_limited')
          : `${row.remainingPercent}%`;
        const resetDisplay = buildResetDisplay(
          null,
          row.resetAtMs,
          now,
          i18n.resolvedLanguage
        );
        const soon = row.id === soonestRowId;

        return (
          <div
            key={row.id}
            className={classes.quotaRow}
            title={soon ? t('quota_management.soonest_row_hint') : undefined}
          >
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{t(row.labelKey)}</span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>{percentLabel}</span>
                {resetDisplay && (
                  <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                )}
              </div>
            </div>
            <QuotaMeter percent={row.remainingPercent} classes={classes} index={index} />
          </div>
        );
      })}
    </>
  );
}
