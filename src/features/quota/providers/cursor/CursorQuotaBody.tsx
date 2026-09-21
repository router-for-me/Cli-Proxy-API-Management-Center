import { useTranslation } from 'react-i18next';
import type { CursorQuotaState } from '@/types';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

const rows = [
  { id: 'included', key: 'includedPercentUsed' },
  { id: 'auto', key: 'autoPercentUsed' },
  { id: 'api', key: 'apiPercentUsed' },
] as const;

export function CursorQuotaBody({ quota, classes }: QuotaBodyProps<CursorQuotaState>) {
  const { t } = useTranslation();
  const data = quota.data;
  if (!data) return <div className={classes.quotaMessage}>{t('cursor_quota.empty_data')}</div>;

  const onDemand = formatOnDemand(t, data);

  return (
    <>
      {data.planName && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanItem}>
            <span className={classes.codexPlanLabel}>{t('cursor_quota.plan')}</span>
            <span className={classes.codexPlanValue}>{data.planName}</span>
          </span>
          {data.resetsAt && (
            <span className={classes.codexPlanValue}>
              {t('cursor_quota.resets', { time: data.resetsAt })}
            </span>
          )}
        </div>
      )}
      {rows.map((row, index) => {
        const used = data[row.key];
        const remaining = used === null ? null : Math.max(0, Math.min(100, 100 - used));
        const label = t(`cursor_quota.${row.id}`);
        return (
          <div key={row.id} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{label}</span>
              <span className={classes.quotaPercent}>
                {remaining === null
                  ? t('cursor_quota.unknown')
                  : t('cursor_quota.remaining', { percent: Number(remaining.toFixed(1)) })}
              </span>
            </div>
            <QuotaMeter percent={remaining} classes={classes} index={index} />
          </div>
        );
      })}
      <div className={classes.quotaMessage}>{onDemand}</div>
    </>
  );
}

function formatOnDemand(
  t: (key: string, options?: Record<string, unknown>) => string,
  data: NonNullable<CursorQuotaState['data']>
) {
  const used =
    typeof data.onDemandUsedCents === 'number' ? (data.onDemandUsedCents / 100).toFixed(2) : null;
  if (data.onDemandKind === 'disabled') return t('cursor_quota.on_demand_disabled');
  if (data.onDemandKind === 'unlimited') {
    return t('cursor_quota.on_demand_unlimited', { used: used ?? t('cursor_quota.unknown') });
  }
  if (typeof data.onDemandLimitCents === 'number') {
    return t('cursor_quota.on_demand_fixed', {
      used: used ?? t('cursor_quota.unknown'),
      limit: (data.onDemandLimitCents / 100).toFixed(2),
    });
  }
  return t('cursor_quota.on_demand_unknown');
}
