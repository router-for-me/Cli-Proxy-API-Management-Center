import { useTranslation } from 'react-i18next';
import type { CursorQuotaState } from '@/types';
import { QuotaMeter } from '../../components/QuotaMeter';
import type { QuotaBodyProps } from '../../types';

const rows = [
  {
    id: 'cursor_models',
    key: 'autoPercentUsed',
    note: 'cursor_models_note',
  },
  {
    id: 'other_models',
    key: 'apiPercentUsed',
    note: 'other_models_note',
  },
] as const;

export function CursorQuotaBody({ quota, classes }: QuotaBodyProps<CursorQuotaState>) {
  const { t } = useTranslation();
  const data = quota.data;
  if (!data) return <div className={classes.quotaMessage}>{t('cursor_quota.empty_data')}</div>;
  const included = includedSpend(t, data);

  return (
    <>
      <div className={classes.codexPlan}>
        <span className={classes.codexPlanItem}>
          <span className={classes.codexPlanLabel}>{t('cursor_quota.plan')}</span>
          <span className={classes.codexPlanValue}>
            {[data.planName, data.price].filter(Boolean).join(' ')}
          </span>
        </span>
        {data.resetsAt && (
          <span className={classes.codexPlanValue}>
            {t('cursor_quota.resets', { time: formatReset(data.resetsAt) })}
          </span>
        )}
      </div>
      {included && <div className={classes.quotaMessage}>{included}</div>}
      {data.displayMessage && <div className={classes.quotaMessage}>{data.displayMessage}</div>}
      {rows.map((row, index) => {
        const used = data[row.key];
        const detail =
          row.id === 'other_models' && data.apiDisplayMessage
            ? data.apiDisplayMessage
            : t(`cursor_quota.${row.note}`);
        return (
          <div key={row.id} className={classes.quotaRow}>
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{t(`cursor_quota.${row.id}`)}</span>
              <span className={classes.quotaPercent}>{formatUsed(t, used)}</span>
            </div>
            <QuotaMeter percent={displayedUsed(used)} classes={classes} index={index} mode="used" />
            <div className={classes.quotaMessage}>{detail}</div>
          </div>
        );
      })}
      {data.grokBotPercentUsed !== null && (
        <div className={classes.quotaRow}>
          <div className={classes.quotaMessage}>{data.grokBotLabel || t('cursor_quota.grok_bot')}</div>
          <div className={classes.quotaRowHeader}>
            <span className={classes.quotaModel}>{t('cursor_quota.weekly_usage')}</span>
            <span className={classes.quotaPercent}>{formatUsed(t, data.grokBotPercentUsed)}</span>
          </div>
          <QuotaMeter
            percent={displayedUsed(data.grokBotPercentUsed)}
            classes={classes}
            index={rows.length}
            mode="used"
          />
          {data.grokBotResetsAt && (
            <div className={classes.quotaMessage}>
              {t('cursor_quota.resets', { time: formatReset(data.grokBotResetsAt) })}
            </div>
          )}
        </div>
      )}
      {data.grokBotPercentUsed === null && (
        <div className={classes.quotaMessage}>{t('cursor_quota.grok_bot_unavailable')}</div>
      )}
      <div className={classes.quotaMessage}>{formatOnDemand(t, data)}</div>
    </>
  );
}

function formatReset(value: string) {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return value;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(parsed));
}

function displayedUsed(value: number | null) {
  if (value === null || value <= 0) return value === null ? null : 0;
  if (value < 1) return 1;
  return Math.round(value);
}

function formatUsed(
  t: (key: string, options?: Record<string, unknown>) => string,
  value: number | null
) {
  const shown = displayedUsed(value);
  if (shown === null) return t('cursor_quota.unknown');
  return t('cursor_quota.used', { percent: shown });
}

function includedSpend(
  t: (key: string, options?: Record<string, unknown>) => string,
  data: NonNullable<CursorQuotaState['data']>
) {
  if (typeof data.includedSpendCents !== 'number' || typeof data.includedLimitCents !== 'number') {
    return '';
  }
  if (data.includedLimitCents <= 0) return '';
  return t('cursor_quota.included_spend', {
    used: dollars(data.includedSpendCents),
    limit: dollars(data.includedLimitCents),
  });
}

function dollars(cents: number) {
  const value = cents / 100;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
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
