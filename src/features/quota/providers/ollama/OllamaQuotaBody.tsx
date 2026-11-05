import { useTranslation } from 'react-i18next';
import { useNow } from '@/hooks/useNow';
import { buildResetDisplay, formatQuotaResetTime, resolveResetMs } from '@/utils/quota';
import type { QuotaBodyProps } from '../../types';
import type { OllamaQuotaState } from './data';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { includedRemainingPercent } from './balanceMeter';

/** Same limit-row anatomy as Claude/Codex; historical usage is separate. */
export function OllamaQuotaBody({ quota, classes, planItems }: QuotaBodyProps<OllamaQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const data = quota.data;
  if (!data) return null;
  const locale = i18n.resolvedLanguage;
  const money = (value: number | null | undefined) =>
    typeof value === 'number' && Number.isFinite(value)
      ? new Intl.NumberFormat(locale, {
          style: 'currency',
          currency: 'USD',
          currencyDisplay: 'code',
          minimumFractionDigits: 2,
          maximumFractionDigits: 6,
        }).format(value)
      : '—';
  const row = (label: string, value: string | number) => (
    <div className={classes.quotaRow} key={label}>
      <div className={classes.quotaRowHeader}>
        <span className={classes.quotaModel}>{label}</span>
        <div className={classes.quotaMeta}>
          <span className={classes.quotaPercent}>{value}</span>
        </div>
      </div>
    </div>
  );
  const included = data.balance?.included;
  const includedPercent = includedRemainingPercent(included?.balance_usd, included?.allowance_usd);
  const limitRow = (
    label: string,
    percent: number | null,
    resetsAt?: string,
    amount?: string,
    index = 0
  ) => {
    const reset = buildResetDisplay(
      formatQuotaResetTime(resetsAt),
      resolveResetMs([resetsAt]),
      now,
      locale
    );
    return (
      <div className={classes.quotaRow} key={label}>
        <div className={classes.quotaRowHeader}>
          <span className={classes.quotaModel}>{label}</span>
          <div className={classes.quotaMeta}>
            <span className={classes.quotaPercent}>
              {percent === null ? '—' : `${Math.round(percent)}%`}
            </span>
            {reset && <QuotaResetLabel display={reset} classes={classes} />}
          </div>
        </div>
        <div
          role="progressbar"
          aria-label={label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent === null ? undefined : Math.round(percent * 100) / 100}
        >
          <QuotaMeter percent={percent} classes={classes} index={index} />
        </div>
        {amount && <div className={classes.quotaAmount}>{amount}</div>}
      </div>
    );
  };
  return (
    <>
      {quota.status === 'error' && (
        <div role="status" className={classes.codexResetCreditsError}>
          {t('ollama_quota.stale')}
        </div>
      )}
      {data.balance_error && (
        <div role="alert" className={classes.codexResetCreditsError}>
          {t('ollama_quota.balance_failed')}
        </div>
      )}
      {data.balance && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanItem}>
            <span className={classes.codexPlanLabel}>{t('ollama_quota.purchased')}</span>
            <span className={classes.codexPlanValue}>
              {money(data.balance.purchased?.balance_usd)}
            </span>
          </span>
        </div>
      )}
      {included?.balance_usd != null &&
        limitRow(
          t('ollama_quota.included'),
          includedPercent,
          included.period?.until,
          `${money(included.balance_usd)} / ${money(included.allowance_usd)}`
        )}
      {(['session', 'weekly'] as const).map((key, index) => {
        const limit = included?.[key];
        return limit
          ? limitRow(
              t(`ollama_quota.${key}`),
              limit.remaining_percent,
              limit.resets_at,
              undefined,
              index
            )
          : null;
      })}
      <details>
        <summary className={classes.quotaReset}>{t('ollama_quota.history')}</summary>
        <p className={classes.quotaMessage}>{t('ollama_quota.account_level')}</p>
        {planItems}
        {data.usage_error && (
          <div role="alert" className={classes.codexResetCreditsError}>
            {t('ollama_quota.usage_failed')}
          </div>
        )}
        {data.usage && (
          <>
            {row(t('ollama_quota.usage'), money(data.usage.totals.usage_usd))}
            {row(t('ollama_quota.requests'), data.usage.totals.request_count)}
            {row(t('ollama_quota.input_tokens'), data.usage.totals.input_tokens ?? '—')}
            {row(t('ollama_quota.output_tokens'), data.usage.totals.output_tokens ?? '—')}
            {data.usage.buckets.map((bucket) => (
              <div key={bucket.from} className={classes.quotaAmount}>
                {bucket.from} · {bucket.request_count} · {money(bucket.usage_usd)}
                {bucket.partial && ` (${t('ollama_quota.partial')})`}
              </div>
            ))}
          </>
        )}
        <div className={classes.quotaAmount}>
          {t('ollama_quota.updated')}: {new Date(data.fetched_at).toLocaleString(locale)}
        </div>
      </details>
    </>
  );
}
