import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { getAuthFileIcon, getTypeLabel, type ResolvedTheme } from '@/features/authFiles/constants';
import { ForecastChart, type ChartAnnotation, type ChartBand } from './ForecastChart';
import {
  formatDayTick,
  formatDuration,
  formatJump,
  formatMonthDay,
  formatPoolPercent,
  formatRate,
  formatUpcoming,
  formatWeight,
} from './format';
import { dayStarts, niceCeiling, type PoolForecast } from './model';
import type { ForecastPool } from './pools';
import { burnWindowDays, type ForecastView } from './prefs';
import styles from './PoolForecastCard.module.scss';

/** Provider identity colors for the pool line, stepped per theme. */
const SERIES_COLORS: Record<string, { dark: string; light: string }> = {
  claude: { dark: '#e2987f', light: '#c2603d' },
  codex: { dark: '#90aadb', light: '#3f68b5' },
};

/** Smallest reset (pool percent) that gets a "+N%" label. */
const MIN_LABELED_RESET = 5;

/** Validated categorical order (dark steps) for the per-account breakdown. */
const BREAKDOWN_COLORS = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
];
const BREAKDOWN_OTHER = '#6f6f6f';

export type PoolForecastCardProps = {
  pool: ForecastPool;
  forecast: PoolForecast;
  view: ForecastView;
  burnWindowHours: number;
  showAccounts: boolean;
  from: number;
  to: number;
  now: number;
  horizon: number;
  resolvedTheme: ResolvedTheme;
  planLabel: (plan: string) => string;
};

export function PoolForecastCard(props: PoolForecastCardProps) {
  const { pool, forecast, view, burnWindowHours, showAccounts, from, to, now, horizon } = props;
  const { resolvedTheme, planLabel } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const provider = pool.provider;
  const providerName = getTypeLabel(t, provider);
  const icon = getAuthFileIcon(provider, resolvedTheme);
  const colorSet = SERIES_COLORS[provider] ?? { dark: '#a3a3a3', light: '#525252' };
  const color = resolvedTheme === 'dark' ? colorSet.dark : colorSet.light;

  const nameOf = (key: string) => pool.accounts.find((account) => account.key === key)?.name ?? key;

  const notBy = t('quota_forecast.not_by', { date: formatMonthDay(horizon, locale) });
  const poolEmpty =
    forecast.poolEmptyAt !== null ? formatUpcoming(forecast.poolEmptyAt, now, locale) : notBy;
  const firstEmpty = forecast.firstEmpty
    ? forecast.firstEmpty.t <= now
      ? t('quota_forecast.empty_now', { name: nameOf(forecast.firstEmpty.key) })
      : t('quota_forecast.empty_in', {
          name: nameOf(forecast.firstEmpty.key),
          duration: formatDuration(forecast.firstEmpty.t - now),
        })
    : notBy;

  const weightNote = pool.plans
    .filter((plan) => plan.weight !== 1)
    .map((plan) =>
      t('quota_forecast.weight_note', {
        plan: planLabel(plan.plan),
        weight: formatWeight(plan.weight),
      })
    )
    .join(', ');

  const chart = useMemo(() => {
    const dayTicks = dayStarts(from, to).map((day) => ({
      t: day,
      label: formatDayTick(day, locale),
    }));
    if (view === 'drain') {
      const peak = Math.max(
        0,
        ...forecast.drainRecorded.map((point) => point.v),
        ...forecast.drainProjected.map((point) => point.v)
      );
      const yMax = niceCeiling(peak * 1.15);
      return {
        dayTicks,
        yMax,
        yTicks: [0, yMax / 2, yMax],
        formatValue: (value: number) => `${Number(value.toFixed(1))}%/h`,
        pool: { recorded: forecast.drainRecorded, projected: forecast.drainProjected },
        annotations: [] as ChartAnnotation[],
        bands: null,
        emptyMarker: null,
      };
    }
    const capacity = Math.max(forecast.capacity, 1);
    // Resets that refill under MIN_LABELED_RESET stay visible as steps but go unlabeled.
    const annotations: ChartAnnotation[] = [...forecast.recordedResets, ...forecast.projectedResets]
      .filter((reset) => reset.amount >= MIN_LABELED_RESET)
      .map((reset) => ({
        t: reset.t,
        v: valueAfter(reset.t, forecast),
        label: formatJump(reset.amount),
      }));
    const bands: ChartBand[] | null = showAccounts
      ? forecast.accounts.map((account, index) => ({
          key: account.key,
          name: account.name,
          weight: account.weight,
          color: BREAKDOWN_COLORS[index] ?? BREAKDOWN_OTHER,
          recorded: account.recorded,
          projected: account.projected,
        }))
      : null;
    return {
      dayTicks,
      yMax: capacity,
      yTicks: [0, capacity / 2, capacity],
      formatValue: formatPoolPercent,
      pool: { recorded: forecast.recorded, projected: forecast.projected },
      annotations,
      bands,
      emptyMarker:
        forecast.poolEmptyAt !== null
          ? {
              t: forecast.poolEmptyAt,
              label: t('quota_forecast.empty_marker', {
                time: formatUpcoming(forecast.poolEmptyAt, now, locale),
              }),
            }
          : null,
    };
  }, [forecast, from, locale, now, showAccounts, t, to, view]);

  return (
    <article className={styles.card} aria-label={providerName}>
      <header className={styles.header}>
        <div className={styles.identity}>
          <div className={styles.titleRow}>
            {icon && <img src={icon} alt="" className={styles.icon} />}
            <h2 className={styles.title}>{providerName}</h2>
            <span className={styles.subtle}>
              {t('quota_forecast.accounts_count', { count: pool.accounts.length })}
              {pool.unrecordedCount > 0 &&
                ` · ${t('quota_forecast.unrecorded_count', { count: pool.unrecordedCount })}`}
            </span>
          </div>
          <div className={styles.headline}>
            <span className={styles.bigValue}>{formatPoolPercent(forecast.remaining)}</span>
            <span className={styles.subtle}>
              {t('quota_forecast.of_capacity', { capacity: formatPoolPercent(forecast.capacity) })}
            </span>
            {weightNote && <span className={styles.subtle}>{weightNote}</span>}
          </div>
        </div>

        <dl className={styles.stats}>
          <div className={styles.stat}>
            <dt>{t('quota_forecast.pool_empty')}</dt>
            <dd className={forecast.poolEmptyAt === null ? styles.statQuiet : undefined}>
              {poolEmpty}
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>{t('quota_forecast.first_empty')}</dt>
            <dd className={forecast.firstEmpty === null ? styles.statQuiet : undefined}>
              {firstEmpty}
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>{t('quota_forecast.next_reset')}</dt>
            <dd>
              {forecast.nextReset ? (
                <>
                  {formatJump(forecast.nextReset.amount)}{' '}
                  <span className={styles.statLight}>
                    {formatUpcoming(forecast.nextReset.t, now, locale)}
                  </span>
                </>
              ) : (
                <span className={styles.statQuiet}>{t('quota_forecast.none')}</span>
              )}
            </dd>
          </div>
          <div className={styles.stat}>
            <dt>
              {burnWindowDays(burnWindowHours) === null
                ? t('quota_forecast.burn_last', { count: burnWindowHours })
                : t('quota_forecast.burn_last_days', { count: burnWindowDays(burnWindowHours) })}
            </dt>
            <dd>
              {forecast.burnRate !== null ? (
                formatRate(forecast.burnRate)
              ) : (
                <span className={styles.statQuiet}>{t('quota_forecast.none')}</span>
              )}
            </dd>
          </div>
        </dl>
      </header>

      <ForecastChart
        from={from}
        to={to}
        now={now}
        yMax={chart.yMax}
        yTicks={chart.yTicks}
        formatValue={chart.formatValue}
        color={color}
        pool={chart.pool}
        bands={chart.bands}
        annotations={chart.annotations}
        emptyMarker={chart.emptyMarker}
        dayTicks={chart.dayTicks}
        locale={locale}
        ariaLabel={t('quota_forecast.chart_label', {
          provider: providerName,
          remaining: formatPoolPercent(forecast.remaining),
          capacity: formatPoolPercent(forecast.capacity),
          poolEmpty,
        })}
        labels={{
          now: t('quota_forecast.now'),
          pool: t('quota_forecast.pool'),
          projected: t('quota_forecast.projected'),
        }}
      />

      <footer className={styles.legend}>
        <span className={styles.legendTitle}>
          {view === 'drain' ? t('quota_forecast.legend_drain') : t('quota_forecast.pool')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatchSolid} style={{ borderColor: color }} />
          {t('quota_forecast.recorded')}
        </span>
        <span className={styles.legendItem}>
          <span className={styles.swatchDashed} style={{ borderColor: color }} />
          {t('quota_forecast.projected')}
        </span>
        {chart.bands?.map((band) => (
          <span key={band.key} className={styles.legendItem}>
            <span className={styles.swatchBlock} style={{ background: band.color }} />
            {band.name}
          </span>
        ))}
      </footer>
    </article>
  );
}

/** Pool value right after a reset, for placing its label at the top of the jump. */
const valueAfter = (t: number, forecast: PoolForecast): number => {
  const series = [...forecast.recorded, ...forecast.projected];
  let value = 0;
  for (const point of series) {
    if (point.t === t) value = Math.max(value, point.v);
  }
  return value;
};
