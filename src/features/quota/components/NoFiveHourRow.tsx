import { useTranslation } from 'react-i18next';
import type { QuotaClassMap } from '../types';
import { QuotaMeter } from './QuotaMeter';

/**
 * The 5-hour row of an account the server marks as having no 5-hour limit. It reads like Quota
 * Management's "No 5-hour limit" (the same key), where a missing window would show "5-hour limit –".
 */
export function NoFiveHourRow({
  labelKey,
  classes,
  slotId,
}: {
  labelKey: string;
  classes: QuotaClassMap;
  slotId?: string;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={classes.quotaRow}
      {...(slotId ? { 'data-slot': slotId, 'data-slot-filled': '' } : {})}
    >
      <div className={classes.quotaRowHeader}>
        <span className={classes.quotaModel}>{t(labelKey)}</span>
        <div className={classes.quotaMeta}>
          <span className={classes.quotaPercent}>
            {t('quota_pool.no_window_limit', { window: t('quota_pool.five_hour') })}
          </span>
        </div>
      </div>
      <QuotaMeter percent={null} classes={classes} />
    </div>
  );
}
