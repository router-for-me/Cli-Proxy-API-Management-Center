/**
 * OpenCode Go subscription quota body: one metered row per usage window
 * (rolling / weekly / monthly), a usage-book state chip, and the poll time.
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

/** Translate a namespaced key, falling back to the raw name when upstream adds a
 *  window/status this build has no copy for (t returns the key itself). */
const translateOr = (t: (key: string) => string, key: string, fallback: string): string => {
  const translated = t(key);
  return translated === key ? fallback : translated;
};

export function OpenCodeQuotaBody({ quota, classes }: QuotaBodyProps<OpenCodeQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('opencode', quota), now),
    [quota, now]
  );
  const windows = quota.windows ?? [];

  return (
    <>
      <div className={classes.codexPlan}>
        <span className={classes.codexPlanItem} data-quota-plan="">
          <span className={classes.codexPlanLabel}>{t('opencode_quota.state_label')}</span>
          <span className={classes.codexPlanValue}>
            {translateOr(t, `opencode_quota.state_${quota.state}`, quota.state)}
          </span>
        </span>
        {quota.fetchedAtMs !== null && (
          <span className={classes.codexPlanItem} data-quota-plan="">
            <span className={classes.codexPlanLabel}>{t('opencode_quota.polled_label')}</span>
            <span className={classes.codexPlanValue}>
              {new Date(quota.fetchedAtMs).toLocaleTimeString(i18n.resolvedLanguage)}
            </span>
          </span>
        )}
      </div>
      {windows.length === 0 && (
        <div className={classes.quotaMessage}>
          {quota.state === 'pending'
            ? t('opencode_quota.pending')
            : quota.lastError
              ? t('opencode_quota.poll_failed', { message: quota.lastError })
              : t('opencode_quota.empty_data')}
        </div>
      )}
      {windows.map((window, index) => {
        // The endpoint reports percent USED; the shared meter paints the remainder.
        const remaining =
          window.usedPercent === null ? null : Math.max(0, Math.min(100, 100 - window.usedPercent));
        const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
        const resetDisplay = buildResetDisplay(
          null,
          window.resetAtMs,
          now,
          i18n.resolvedLanguage
        );
        const soon = window.id === soonestRowId;
        const windowLabel = translateOr(t, `opencode_quota.window_${window.id}`, window.id);
        const statusNote =
          window.status && window.status !== 'ok'
            ? translateOr(t, `opencode_quota.status_${window.status}`, window.status)
            : null;

        return (
          <div
            key={window.id}
            className={classes.quotaRow}
            title={soon ? t('quota_management.soonest_row_hint') : undefined}
          >
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>
                {windowLabel}
                {statusNote ? ` · ${statusNote}` : ''}
              </span>
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
      {windows.length > 0 && quota.lastError && (
        <div className={classes.quotaMessage} role="status">
          {t('opencode_quota.poll_failed', { message: quota.lastError })}
        </div>
      )}
    </>
  );
}
