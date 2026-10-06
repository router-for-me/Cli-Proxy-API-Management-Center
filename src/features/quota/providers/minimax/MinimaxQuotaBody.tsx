import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { MinimaxQuotaState } from '@/types';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay } from '@/utils/quota';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

export function MinimaxQuotaBody({ quota, classes }: QuotaBodyProps<MinimaxQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('minimax', quota), now),
    [quota, now]
  );
  const data = quota.data;
  if (!data) return <div className={classes.quotaMessage}>{t('minimax_quota.empty_data')}</div>;

  return (
    <>
      {data.windows.length === 0 && (
        <div className={classes.quotaMessage}>{t('minimax_quota.empty_data')}</div>
      )}
      {data.windows.map((window, index) => {
        const resetDisplay = buildResetDisplay(
          null,
          window.resetAt === undefined ? null : window.resetAt,
          now,
          i18n.resolvedLanguage
        );
        const soon = window.id === soonestRowId;
        const label =
          window.modelName && window.id === 'interval'
            ? `${t('minimax_quota.interval')} · ${window.modelName}`
            : t(`minimax_quota.${window.id}`);
        return (
          <div key={window.id} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{label}</span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>
                  {t('minimax_quota.remaining', {
                    percent: Number(window.remainingPercent.toFixed(1)),
                  })}
                </span>
                {resetDisplay && (
                  <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
                )}
              </div>
            </div>
            <div
              role="meter"
              aria-label={label}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={window.remainingPercent}
            >
              <QuotaMeter percent={window.remainingPercent} classes={classes} index={index} />
            </div>
          </div>
        );
      })}
    </>
  );
}
