import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatPoolNumber } from './presentation';
import type { PoolDashboard, PoolProviderId, QuotaPool } from '@/domain/quotaPool/types';
import { poolKey } from './poolOrder';
import { PoolGraph } from './PoolGraph';
import { PoolGraphToggle } from './PoolGraphToggle';
import { PoolComparisonChart } from './PoolChart';
import { metricField, type ChartMode } from './chartGeometry';
import styles from './QuotaPoolPage.module.scss';

export function CombinedPoolCard({
  pools,
  dashboard,
  provider,
  mode,
  savedData,
  onRefresh,
}: {
  pools: QuotaPool[];
  dashboard: PoolDashboard;
  provider: PoolProviderId | 'all';
  mode: ChartMode;
  savedData: boolean;
  /** The page's one "Refresh now", beside a partial or stale notice. */
  onRefresh?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const id = useId();
  const [minimized, setMinimized] = useState(false);
  const [view, setView] = useState<'providers' | 'stacked'>('stacked');
  const total = dashboard.combined?.[provider];
  // Without a server total there is nothing to stack; each provider's own line still is.
  const stackable = Boolean(total?.layers && total.series);
  const shownView = stackable ? view : 'providers';
  const series =
    shownView === 'providers'
      ? pools
      : pools.flatMap((pool) => total!.layers!.filter((layer) => poolKey(layer) === poolKey(pool)));
  const headline = total?.series ? total.series[metricField[mode]] : null;
  const windowLabel = t(`quota_pool.${dashboard.window === 'weekly' ? 'weekly' : 'five_hour'}`);
  // Count the accounts that hold the total back, as each provider card does.
  const accounts = pools.flatMap((pool) => pool.accounts);
  const count = (status: (typeof accounts)[number]['status'][]) =>
    accounts.filter((account) => status.includes(account.status)).length;
  const stateNote = (state: string) => {
    const missing = count(['error', 'missing-window']);
    const stale = count(['stale']);
    // A total with estimated accounts is still shown; the note says so instead of "withheld".
    const estimated = total?.series?.remainingPoints != null
      ? pools.reduce((sum, pool) => sum + (pool.estimatedCount ?? 0), 0)
      : 0;
    if (estimated > 0)
      return t('quota_pool.estimated_count', { count: estimated, total: accounts.length });
    if (state === 'partial' && missing)
      return t('quota_pool.unavailable_count', { count: missing, total: accounts.length });
    if (state === 'stale' && stale)
      return t('quota_pool.stale_count', { count: stale, total: accounts.length });
    return t(`quota_pool.state_note.${state}`, { window: windowLabel });
  };
  const viewSelect = (
    <label>
      <span className={styles.srOnly}>{t('quota_pool.series_view')}</span>
      <select value={shownView} onChange={(event) => setView(event.target.value as typeof view)}>
        <option value="providers">{t('quota_pool.provider_lines')}</option>
        <option value="stacked" disabled={!stackable}>
          {t('quota_pool.stacked_providers')}
        </option>
      </select>
    </label>
  );
  const headlineContext = (
    <div className={styles.headlineContext}>
      <p className={styles.metricLabel}>
        {mode !== 'remaining'
          ? t('quota_pool.recorded_rate', {
              rate: t(`quota_pool.${mode}`),
              hours: dashboard.lookbackHours,
            })
          : t('quota_pool.window_remaining', { window: windowLabel })}
      </p>
      {/* Remaining adds its scale on a second line; rates keep their unit beside the number. */}
      {mode === 'remaining' && total?.series && (
        <span>
          {t('quota_pool.of_capacity', {
            capacity: formatPoolNumber(total.series.capacityPoints, i18n.language),
          })}
        </span>
      )}
    </div>
  );
  return (
    <section className={`${styles.pool} ${styles.combined}`} aria-labelledby={`${id}-title`}>
      <div className={styles.graphHeader}>
        <h2 id={`${id}-title`}>{t('quota_pool.combined_usage')}</h2>
        {/* The chart's view control sits beside the actions on wide cards; below the title row otherwise. */}
        <div className={styles.combinedOptions}>{viewSelect}</div>
        <span className={styles.reorder}>
          <PoolGraphToggle
            minimized={minimized}
            onToggle={() => setMinimized((value) => !value)}
            label={t('quota_pool.combined_usage')}
            controls={`${id}-plot`}
          />
        </span>
      </div>
      {/* Same headline block as a provider card, so an unavailable total keeps its caption. */}
      <div
        className={styles.headline}
        data-unavailable={headline === null}
        data-rate={mode !== 'remaining'}
      >
        {/* Rate views read label, then number; Remaining keeps its caption beside the number. */}
        {mode !== 'remaining' && headlineContext}
        <strong>
          {/* Same as the provider cards: the value slot says the total is missing. */}
          {headline === null ? (
            // Sources that may share accounts aren't summed; missing data withholds the total.
            <span className={styles.unavailableValue}>
              {t(
                total?.unavailableReason === 'ambiguous-sources'
                  ? 'quota_pool.value_not_summed'
                  : 'quota_pool.value_withheld'
              )}
            </span>
          ) : (
            <>
              {formatPoolNumber(headline, i18n.language)}
              {mode !== 'remaining' && <small> {t('quota_pool.points_hour')}</small>}
            </>
          )}
        </strong>
        {mode === 'remaining' && headlineContext}
      </div>
      {/* What the selected rate counts, from About these numbers, so the number isn't a guess. */}
      {mode !== 'remaining' && (
        <p className={styles.rateDefinition}>{t(`quota_pool.${mode}_definition`)}</p>
      )}
      {/* Partial or stale data withholds the total; say why under the headline, as the provider cards do. */}
      {headline === null && total?.series && total.series.forecastState !== 'ready' && (
        <p className={styles.stateNote} role="status" data-state={total.series.forecastState}>
          <span>{stateNote(total.series.forecastState)}</span>
          {onRefresh &&
            (total.series.forecastState === 'partial' ||
              total.series.forecastState === 'stale') && (
              <button type="button" className={styles.noteAction} onClick={onRefresh}>
                {t('quota_pool.refresh_now')}
              </button>
            )}
        </p>
      )}
      {/* Why there is no total to stack, under the headline it explains. */}
      {!stackable && (
        <p className={styles.stateNote} role="status">
          {t(
            total?.unavailableReason === 'ambiguous-sources'
              ? 'quota_pool.total_ambiguous'
              : 'quota_pool.total_unavailable'
          )}
        </p>
      )}
      <PoolGraph id={`${id}-plot`} title={t('quota_pool.history_forecast')} minimized={minimized}>
        {series.length > 0 && (
          <PoolComparisonChart
            key={`${mode}-${dashboard.fromMs}-${shownView}`}
            pools={series}
            stackedTotal={shownView === 'stacked' ? (total?.series ?? undefined) : undefined}
            dashboard={dashboard}
            mode={mode}
            minimized={minimized}
            savedData={savedData}
          />
        )}
      </PoolGraph>
    </section>
  );
}
