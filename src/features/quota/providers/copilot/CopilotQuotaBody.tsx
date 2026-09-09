import { useTranslation } from 'react-i18next';
import type { CopilotQuotaState } from '@/types';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import type { QuotaBodyProps } from '../../types';

export function CopilotQuotaBody({ quota, classes }: QuotaBodyProps<CopilotQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const format = (value: number) =>
    value.toLocaleString(i18n.language, { maximumFractionDigits: 1 });
  if (!quota.rows.length)
    return <div className={classes.quotaMessage}>{t('github_copilot_quota.empty_data')}</div>;
  return (
    <>
      {quota.plan ? (
        <div className={classes.codexPlan}>
          {t('github_copilot_quota.plan')}: {quota.plan}
        </div>
      ) : null}
      {quota.rows.map((row, index) => {
        const reset = buildResetDisplay(null, row.resetAtMs, now, i18n.resolvedLanguage);
        return (
          <div className={classes.quotaRow} key={row.id}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>
                {t(`github_copilot_quota.${row.id}`, { defaultValue: row.id.replace(/_/g, ' ') })}
              </span>
              <span className={classes.quotaPercent}>
                {row.unlimited
                  ? t('github_copilot_quota.unlimited')
                  : row.percent === null
                    ? '—'
                    : t('github_copilot_quota.remaining', { percent: format(row.percent) })}
              </span>
            </div>
            {row.unlimited ? null : (
              <QuotaMeter percent={row.percent} classes={classes} index={index} />
            )}
            {row.used !== null && row.entitlement !== null && !row.unlimited ? (
              <div className={classes.quotaAmount}>
                {t('github_copilot_quota.used', {
                  used: format(row.used),
                  total: format(row.entitlement),
                })}
              </div>
            ) : null}
            <div className={classes.quotaMeta}>
              {reset ? <QuotaResetLabel display={reset} classes={classes} /> : null}
              {row.overageAllowed !== null ? (
                <span>
                  {t(
                    row.overageAllowed
                      ? 'github_copilot_quota.overage_enabled'
                      : 'github_copilot_quota.overage_disabled'
                  )}
                  {row.overage !== null && row.overage > 0 ? ` · ${format(row.overage)}` : ''}
                </span>
              ) : null}
            </div>
          </div>
        );
      })}
    </>
  );
}
