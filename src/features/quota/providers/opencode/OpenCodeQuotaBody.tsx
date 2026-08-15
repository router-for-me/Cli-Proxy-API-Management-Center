/**
 * OpenCode Go quota body: fixed 5H / Week / Month meters.
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OpenCodeQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function OpenCodeQuotaBody({ quota, classes }: QuotaBodyProps<OpenCodeQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('opencode', quota), now),
    [quota, now]
  );
  const windows = quota.windows ?? [];

  if (windows.length === 0) {
    return <div className={classes.quotaMessage}>{t('opencode_quota.empty_data')}</div>;
  }

  return (
    <>
      {windows.map((window, index) => {
        const remaining = window.remainingPercent;
        const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
        const windowLabel = t(window.labelKey);
        const resetDisplay = buildResetDisplay(
          window.resetLabel || null,
          window.resetAtMs,
          now,
          i18n.resolvedLanguage
        );
        const soon = window.id === soonestRowId;

        return (
          <div
            key={window.id}
            className={classes.quotaRow}
            title={soon ? t('quota_management.soonest_row_hint') : undefined}
          >
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{windowLabel}</span>
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
