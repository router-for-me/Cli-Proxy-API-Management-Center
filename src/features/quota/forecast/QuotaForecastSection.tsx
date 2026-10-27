/**
 * Pool forecast section of the quota page: controls plus one chart card per
 * provider whose quota the backend records (Claude, Codex).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getTypeLabel, type ResolvedTheme } from '@/features/authFiles/constants';
import { useNow } from '@/hooks/useNow';
import type { QuotaHistory } from '@/services/api/quotaHistory';
import type { QuotaFileEntry } from '../logic';
import type { QuotaTabId } from '../constants';
import { ForecastToolbar, type WeightRow } from './ForecastToolbar';
import { formatMonthDay } from './format';
import {
  PROJECTION_HORIZON_DAYS,
  addLocalDays,
  buildPoolForecast,
  forecastRange,
  startOfLocalDay,
} from './model';
import { PoolForecastCard } from './PoolForecastCard';
import { FORECAST_PROVIDERS, buildForecastPools, type ForecastProvider } from './pools';
import type { ForecastPrefs } from './prefs';
import { useQuotaHistory } from './useQuotaHistory';
import styles from './QuotaForecastSection.module.scss';

export type QuotaForecastSectionProps = {
  entries: QuotaFileEntry[];
  tab: QuotaTabId;
  prefs: ForecastPrefs;
  onPrefsChange: (patch: Partial<ForecastPrefs>) => void;
  /** Bumped by "Refresh all" to reload history immediately. */
  refreshKey: number;
  /** Receives every loaded history so the account rows can reuse it. */
  onHistory?: (history: QuotaHistory | null) => void;
  enabled: boolean;
  resolvedTheme: ResolvedTheme;
};

export function QuotaForecastSection(props: QuotaForecastSectionProps) {
  const { entries, tab, prefs, onPrefsChange, refreshKey, onHistory, enabled, resolvedTheme } =
    props;
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';
  const now = useNow();
  const today = startOfLocalDay(now);
  const [anchorDay, setAnchorDay] = useState<number | null>(null);
  const activeDay = anchorDay ?? today;

  const range = useMemo(() => forecastRange(activeDay), [activeDay]);
  // History must cover the burn window and the sample just before the range.
  const burnDays = Math.ceil(prefs.burnWindowHours / 24);
  const fetchFrom = useMemo(
    () => addLocalDays(Math.min(range.from, addLocalDays(today, -1)), -burnDays),
    [burnDays, range.from, today]
  );

  const providersInTab = useMemo(
    () =>
      FORECAST_PROVIDERS.filter(
        (provider) =>
          (tab === 'all' || tab === provider) && entries.some((entry) => entry.type === provider)
      ),
    [entries, tab]
  );
  const active = enabled && providersInTab.length > 0;
  const { history, loading, error, unsupported } = useQuotaHistory(fetchFrom, active, refreshKey);
  useEffect(() => {
    onHistory?.(history);
  }, [history, onHistory]);

  const providerLabel = useCallback((provider: ForecastProvider) => getTypeLabel(t, provider), [t]);
  const planLabel = useCallback(
    (provider: string, plan: string) => {
      if (!plan) return t('quota_forecast.plan_unknown');
      const key = `${provider}_quota.plan_${plan}`;
      const translated = t(key);
      return translated !== key ? translated : plan.charAt(0).toUpperCase() + plan.slice(1);
    },
    [t]
  );

  const pools = useMemo(
    () =>
      buildForecastPools(history, entries, {
        planWeights: prefs.planWeights,
        showEmails: prefs.showEmails,
      }).filter((pool) => providersInTab.includes(pool.provider)),
    [entries, history, prefs.planWeights, prefs.showEmails, providersInTab]
  );

  const horizon = useMemo(() => addLocalDays(now, PROJECTION_HORIZON_DAYS), [now]);
  const forecasts = useMemo(
    () =>
      pools.map((pool) => ({
        pool,
        forecast: buildPoolForecast(pool.accounts, {
          now,
          from: range.from,
          to: range.to,
          burnWindowHours: prefs.burnWindowHours,
          futureUsage: prefs.futureUsage,
          horizon,
        }),
      })),
    [horizon, now, pools, prefs.burnWindowHours, prefs.futureUsage, range.from, range.to]
  );

  const weightRows = useMemo<WeightRow[]>(
    () =>
      pools.flatMap((pool) =>
        pool.plans.map((plan) => ({
          key: plan.key,
          label: `${providerLabel(pool.provider)} · ${planLabel(pool.provider, plan.plan)}`,
          weight: plan.weight,
          count: plan.count,
        }))
      ),
    [planLabel, pools, providerLabel]
  );

  if (!enabled || providersInTab.length === 0) return null;

  const rangeLabel = t('quota_forecast.range', {
    from: formatMonthDay(range.from, locale),
    to: formatMonthDay(addLocalDays(range.to, -1), locale),
  });

  let notice: string | null = null;
  if (unsupported) notice = t('quota_forecast.unsupported');
  else if (error) notice = t('quota_forecast.load_failed', { message: error });
  else if (history && !history.enabled) notice = t('quota_forecast.disabled');

  return (
    <section className={styles.section} aria-label={t('quota_forecast.section_label')}>
      <ForecastToolbar
        prefs={prefs}
        onPrefsChange={onPrefsChange}
        weightRows={weightRows}
        rangeLabel={rangeLabel}
        isCurrentRange={activeDay === today}
        onShiftRange={(direction) => setAnchorDay(addLocalDays(activeDay, direction * 7))}
        onToday={() => setAnchorDay(null)}
      />

      <div className={styles.cards}>
        {notice ? (
          <div className={styles.notice} role="status">
            {notice}
          </div>
        ) : (
          forecasts.map(({ pool, forecast }) =>
            pool.accounts.length > 0 ? (
              <PoolForecastCard
                key={pool.provider}
                pool={pool}
                forecast={forecast}
                view={prefs.view}
                burnWindowHours={prefs.burnWindowHours}
                showAccounts={prefs.showAccounts}
                from={range.from}
                to={range.to}
                now={now}
                horizon={horizon}
                resolvedTheme={resolvedTheme}
                planLabel={(plan) => planLabel(pool.provider, plan)}
              />
            ) : (
              <div key={pool.provider} className={styles.notice} role="status">
                {loading && !history
                  ? t('quota_forecast.loading', { provider: providerLabel(pool.provider) })
                  : t('quota_forecast.collecting', { provider: providerLabel(pool.provider) })}
              </div>
            )
          )
        )}
      </div>
    </section>
  );
}
