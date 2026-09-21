import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CursorQuotaState } from '@/types';
import { buildResetDisplay } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

const modelRows = [
  { id: 'plan', label: 'cursor_models', key: 'autoPercentUsed', note: 'cursor_models_note' },
  { id: 'other', label: 'other_models', key: 'apiPercentUsed', note: 'other_models_note' },
] as const;

export function CursorQuotaBody({ quota, classes }: QuotaBodyProps<CursorQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const data = quota.data;
  const soonestRowId = useMemo(
    () => (data ? pickUrgentRowId(collectQuotaRowInstants('cursor', quota), now) : null),
    [data, quota, now]
  );
  if (!data) return <div className={classes.quotaMessage}>{t('cursor_quota.empty_data')}</div>;

  const planReset = resetAt(data.resetsAt, now, i18n.resolvedLanguage);
  const grokReset = resetAt(data.grokBotResetsAt, now, i18n.resolvedLanguage);
  const included = includedAmount(data);

  return (
    <>
      {(data.planName || data.price) && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanLabel}>{t('cursor_quota.plan')}</span>
          {data.planName && <span className={classes.codexPlanValue}>{data.planName}</span>}
          {data.price && <span className={classes.quotaAmount}>{data.price}</span>}
        </div>
      )}
      {included && (
        <div className={classes.codexPlan} title={plainText(data.displayMessage) || undefined}>
          <span className={classes.codexPlanLabel}>{t('cursor_quota.included')}</span>
          <span className={classes.quotaAmount}>{included}</span>
        </div>
      )}
      {modelRows.map((row, index) => (
        <LimitRow
          key={row.id}
          label={t(`cursor_quota.${row.label}`)}
          title={
            row.key === 'apiPercentUsed' && data.apiDisplayMessage
              ? plainText(data.apiDisplayMessage)
              : t(`cursor_quota.${row.note}`)
          }
          remaining={remainingOf(data[row.key])}
          reset={planReset}
          soon={row.id === 'plan' && soonestRowId === 'plan'}
          classes={classes}
          index={index}
        />
      ))}
      {data.grokBotPercentUsed !== null ? (
        <LimitRow
          label={t('cursor_quota.grok_bot')}
          title={plainText(data.grokBotLabel) || t('cursor_quota.weekly_usage')}
          remaining={remainingOf(data.grokBotPercentUsed)}
          reset={grokReset}
          soon={soonestRowId === 'grok-bot'}
          classes={classes}
          index={modelRows.length}
        />
      ) : (
        <div className={classes.quotaMessage}>{t('cursor_quota.grok_bot_unavailable')}</div>
      )}
      <div className={classes.codexPlan}>
        <span className={classes.codexPlanLabel}>{t('cursor_quota.on_demand')}</span>
        <OnDemandValue data={data} classes={classes} />
      </div>
    </>
  );
}

function LimitRow({
  label,
  title,
  remaining,
  reset,
  soon,
  classes,
  index,
}: {
  label: string;
  title: string;
  remaining: number | null;
  reset: ReturnType<typeof buildResetDisplay>;
  soon: boolean;
  classes: QuotaBodyProps<CursorQuotaState>['classes'];
  index: number;
}) {
  const { t } = useTranslation();
  return (
    <div className={classes.quotaRow} title={soon ? t('quota_management.soonest_row_hint') : title}>
      <div className={classes.quotaRowHeader}>
        <span className={classes.quotaModel}>{label}</span>
        <div className={classes.quotaMeta}>
          <span className={classes.quotaPercent}>
            {remaining === null ? t('cursor_quota.unknown') : `${remaining}%`}
          </span>
          {reset && <QuotaResetLabel display={reset} classes={classes} soon={soon} />}
        </div>
      </div>
      <QuotaMeter percent={remaining} classes={classes} index={index} />
    </div>
  );
}

function OnDemandValue({
  data,
  classes,
}: {
  data: NonNullable<CursorQuotaState['data']>;
  classes: QuotaBodyProps<CursorQuotaState>['classes'];
}) {
  const { t } = useTranslation();
  if (data.onDemandKind === 'disabled') {
    return <span className={classes.codexPlanValue}>{t('cursor_quota.disabled')}</span>;
  }
  if (data.onDemandKind === 'unlimited') {
    return (
      <span className={classes.quotaAmount}>
        {`${cents(data.onDemandUsedCents) ?? t('cursor_quota.unknown')} / ${t('cursor_quota.unlimited')}`}
      </span>
    );
  }
  if (typeof data.onDemandLimitCents === 'number') {
    return (
      <span className={classes.quotaAmount}>
        {`${cents(data.onDemandUsedCents) ?? t('cursor_quota.unknown')} / ${cents(data.onDemandLimitCents)}`}
      </span>
    );
  }
  return <span className={classes.codexPlanValue}>{t('cursor_quota.unknown')}</span>;
}

function remainingOf(used: number | null) {
  if (used === null || !Number.isFinite(used)) return null;
  const shown = used <= 0 ? 0 : used < 1 ? 1 : Math.round(used);
  return Math.max(0, Math.min(100, 100 - shown));
}

function resetAt(value: string | undefined, now: number, locale: string | undefined) {
  if (!value) return null;
  const atMs = Date.parse(value);
  if (!Number.isFinite(atMs)) return null;
  return buildResetDisplay(null, atMs, now, locale);
}

function includedAmount(data: NonNullable<CursorQuotaState['data']>) {
  if (typeof data.includedSpendCents !== 'number' || typeof data.includedLimitCents !== 'number') {
    return '';
  }
  if (data.includedLimitCents <= 0) return '';
  return `${dollars(data.includedSpendCents)} / ${dollars(data.includedLimitCents)}`;
}

function plainText(value: string | undefined) {
  if (!value) return '';
  return value
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function dollars(centsValue: number) {
  const value = centsValue / 100;
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

function cents(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? dollars(value) : null;
}
