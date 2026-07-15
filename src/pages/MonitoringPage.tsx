import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { IconRefreshCw, IconX } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  usageEventsApi,
  type ModelPrice,
  type ModelPriceAlias,
  type UsageAccountStat,
  type UsageEvent,
  type UsageFilterOptions,
  type UsageQuery,
  type UsageSummary,
} from '@/services/api/usageEvents';
import { apiClient } from '@/services/api/client';
import { useNotificationStore } from '@/stores';
import { getErrorMessage } from '@/utils/helpers';
import styles from './MonitoringPage.module.scss';

type RangeKey = 'today' | '7d' | '14d' | '30d' | 'all';
type TabKey = 'realtime' | 'accounts' | 'prices';

const AUTO_OPTIONS = [
  { label: 'Off', value: 0 },
  { label: '5s', value: 5_000 },
  { label: '10s', value: 10_000 },
  { label: '30s', value: 30_000 },
] as const;

const startOfTodayMs = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

const rangeToMs = (key: RangeKey): { from_ms?: number; to_ms?: number } => {
  const now = Date.now();
  if (key === 'all') return {};
  if (key === 'today') return { from_ms: startOfTodayMs(), to_ms: now };
  const days = key === '7d' ? 7 : key === '14d' ? 14 : 30;
  return { from_ms: now - days * 24 * 60 * 60 * 1000, to_ms: now };
};

const formatNumber = (value: number | undefined | null, digits = 0) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits > 0 ? Math.min(digits, 2) : 0,
  }).format(value);
};

const formatUsd = (value: number | undefined | null) => {
  if (value === undefined || value === null || !Number.isFinite(value) || value <= 0) return '—';
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
};

const formatDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
};

const formatTime = (ms: number) => {
  if (!ms) return '—';
  return new Date(ms).toLocaleString();
};

const formatTokensCompact = (e: UsageEvent) => {
  const parts = [`I ${formatNumber(e.input_tokens)}`, `O ${formatNumber(e.output_tokens)}`];
  if (e.reasoning_tokens) parts.push(`R ${formatNumber(e.reasoning_tokens)}`);
  if (e.cache_read_tokens || e.cached_tokens) {
    parts.push(`C ${formatNumber(e.cache_read_tokens || e.cached_tokens)}`);
  }
  return parts.join(' · ');
};

export function MonitoringPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((s) => s.showNotification);

  const [range, setRange] = useState<RangeKey>('today');
  const [tab, setTab] = useState<TabKey>('realtime');
  const [search, setSearch] = useState('');
  const [model, setModel] = useState('');
  const [provider, setProvider] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'success' | 'failed'>('all');
  const [autoMs, setAutoMs] = useState(5_000);
  const [loading, setLoading] = useState(false);
  const [events, setEvents] = useState<UsageEvent[]>([]);
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [accounts, setAccounts] = useState<UsageAccountStat[]>([]);
  const [filterOptions, setFilterOptions] = useState<UsageFilterOptions | null>(null);
  const [prices, setPrices] = useState<ModelPrice[]>([]);
  const [aliases, setAliases] = useState<ModelPriceAlias[]>([]);
  const [unpriced, setUnpriced] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [statsEnabledHint, setStatsEnabledHint] = useState<boolean | null>(null);

  // price form
  const [priceModel, setPriceModel] = useState('');
  const [pricePrompt, setPricePrompt] = useState('1.25');
  const [priceCompletion, setPriceCompletion] = useState('10');
  const [aliasFrom, setAliasFrom] = useState('');
  const [aliasTo, setAliasTo] = useState('');

  const query = useMemo((): UsageQuery => {
    const base = rangeToMs(range);
    return {
      ...base,
      search: search.trim() || undefined,
      models: model ? [model] : undefined,
      providers: provider ? [provider] : undefined,
      failed_only: statusFilter === 'failed' || undefined,
      success_only: statusFilter === 'success' || undefined,
      limit: 200,
    };
  }, [range, search, model, provider, statusFilter]);

  const loadCore = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [eventsRes, summaryRes, filtersRes] = await Promise.all([
        usageEventsApi.listEvents(query),
        usageEventsApi.getSummary(query),
        usageEventsApi.getFilterOptions(query),
      ]);
      setEvents(eventsRes.events || []);
      setSummary(summaryRes.summary || null);
      setStatsEnabledHint(summaryRes.usage_statistics_enabled ?? null);
      setFilterOptions(filtersRes);
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      setEvents([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await usageEventsApi.getAccountStats(query);
      setAccounts(res.accounts || []);
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  }, [query, showNotification]);

  const loadPrices = useCallback(async () => {
    try {
      const res = await usageEventsApi.getModelPrices();
      setPrices(res.prices || []);
      setAliases(res.aliases || []);
      setUnpriced(res.unpriced_models || []);
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  }, [showNotification]);

  const refresh = useCallback(async () => {
    await loadCore();
    if (tab === 'accounts') await loadAccounts();
    if (tab === 'prices') await loadPrices();
  }, [loadCore, loadAccounts, loadPrices, tab]);

  useHeaderRefresh(refresh);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoMs) return;
    const id = window.setInterval(() => {
      void loadCore();
      if (tab === 'accounts') void loadAccounts();
    }, autoMs);
    return () => window.clearInterval(id);
  }, [autoMs, loadCore, loadAccounts, tab]);

  const clearFilters = () => {
    setSearch('');
    setModel('');
    setProvider('');
    setStatusFilter('all');
    setRange('today');
  };

  const enableStatistics = async () => {
    try {
      await apiClient.put('/usage-statistics-enabled', { value: true });
      setStatsEnabledHint(true);
      showNotification(t('monitoring.stats_enabled'), 'success');
      await refresh();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const savePrice = async () => {
    const modelName = priceModel.trim();
    if (!modelName) return;
    try {
      await usageEventsApi.putModelPrices([
        {
          model: modelName,
          prompt_per_1m: Number(pricePrompt) || 0,
          completion_per_1m: Number(priceCompletion) || 0,
          source: 'manual',
        },
      ]);
      showNotification(t('monitoring.price_saved'), 'success');
      setPriceModel('');
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const saveAlias = async () => {
    const from = aliasFrom.trim();
    const to = aliasTo.trim();
    if (!from || !to) return;
    try {
      await usageEventsApi.putModelPriceAliases([{ alias: from, target_model: to }]);
      showNotification(t('monitoring.alias_saved'), 'success');
      setAliasFrom('');
      setAliasTo('');
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const deleteAlias = async (alias: string) => {
    try {
      await usageEventsApi.deleteModelPriceAlias(alias);
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const deletePrice = async (modelName: string) => {
    try {
      await usageEventsApi.deleteModelPrice(modelName);
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const statsOff = statsEnabledHint === false;

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <div className={styles.rangeGroup}>
          {(
            [
              ['today', t('monitoring.range_today')],
              ['7d', '7d'],
              ['14d', '14d'],
              ['30d', '30d'],
              ['all', t('monitoring.range_all')],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${styles.rangeChip} ${range === key ? styles.active : ''}`}
              onClick={() => setRange(key)}
            >
              {label}
            </button>
          ))}
        </div>

        <div className={styles.searchRow}>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('monitoring.search_placeholder')}
            aria-label={t('monitoring.search_placeholder')}
          />
          <Button variant="secondary" onClick={() => void refresh()} disabled={loading}>
            <IconRefreshCw size={16} />
            {t('common.refresh')}
          </Button>
          <Button variant="ghost" onClick={clearFilters}>
            <IconX size={16} />
            {t('monitoring.clear')}
          </Button>
          <select
            className={styles.filterSelect}
            value={autoMs}
            onChange={(e) => setAutoMs(Number(e.target.value))}
            aria-label={t('monitoring.auto_refresh')}
          >
            {AUTO_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {t('monitoring.auto_prefix')} {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className={styles.filtersRow}>
        <select
          className={styles.filterSelect}
          value={provider}
          onChange={(e) => setProvider(e.target.value)}
        >
          <option value="">{t('monitoring.filter_providers')}</option>
          {(filterOptions?.providers || []).map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={model}
          onChange={(e) => setModel(e.target.value)}
        >
          <option value="">{t('monitoring.filter_models')}</option>
          {(filterOptions?.models || []).map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select
          className={styles.filterSelect}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as 'all' | 'success' | 'failed')}
        >
          <option value="all">{t('monitoring.filter_statuses')}</option>
          <option value="success">{t('monitoring.status_success')}</option>
          <option value="failed">{t('monitoring.status_failed')}</option>
        </select>
      </div>

      {statsOff ? (
        <div className={styles.banner}>
          <span>{t('monitoring.stats_disabled_hint')}</span>
          <Button onClick={() => void enableStatistics()}>{t('monitoring.enable_stats')}</Button>
        </div>
      ) : null}

      {error ? (
        <div className={styles.banner}>
          <span>{error}</span>
          <Button variant="secondary" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.label}>{t('monitoring.card_calls')}</div>
          <div className={styles.value}>{formatNumber(summary?.total_calls)}</div>
        </div>
        <div className={`${styles.summaryCard} ${styles.success}`}>
          <div className={styles.label}>{t('monitoring.card_success')}</div>
          <div className={styles.value}>
            {summary ? `${(summary.success_rate * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className={`${styles.summaryCard} ${styles.danger}`}>
          <div className={styles.label}>{t('monitoring.card_failed')}</div>
          <div className={styles.value}>{formatNumber(summary?.failure_calls)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.label}>{t('monitoring.card_cost')}</div>
          <div className={styles.value}>{formatUsd(summary?.estimated_cost)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.label}>{t('monitoring.card_tokens')}</div>
          <div className={styles.value}>{formatNumber(summary?.total_tokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.label}>{t('monitoring.card_input')}</div>
          <div className={styles.value}>{formatNumber(summary?.input_tokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.label}>{t('monitoring.card_output')}</div>
          <div className={styles.value}>{formatNumber(summary?.output_tokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.label}>{t('monitoring.card_cached')}</div>
          <div className={styles.value}>
            {formatNumber((summary?.cache_read_tokens || 0) + (summary?.cached_tokens || 0))}
          </div>
        </div>
      </div>

      <div className={styles.tabs}>
        {(
          [
            ['realtime', t('monitoring.tab_realtime')],
            ['accounts', t('monitoring.tab_accounts')],
            ['prices', t('monitoring.tab_prices')],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`${styles.rangeChip} ${tab === key ? styles.active : ''}`}
            onClick={() => {
              setTab(key);
              if (key === 'accounts') void loadAccounts();
              if (key === 'prices') void loadPrices();
            }}
          >
            {label}
            {key === 'realtime' ? ` ${events.length}` : ''}
          </button>
        ))}
      </div>

      {tab === 'realtime' ? (
        <Card>
          <div className={styles.tableWrap}>
            {events.length === 0 ? (
              <div className={styles.empty}>
                <EmptyState title={t('monitoring.empty_events')} description={t('monitoring.empty_events_hint')} />
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('monitoring.col_source')}</th>
                    <th>{t('monitoring.col_model')}</th>
                    <th>{t('monitoring.col_effort')}</th>
                    <th>{t('monitoring.col_status')}</th>
                    <th>{t('monitoring.col_ttft')}</th>
                    <th>{t('monitoring.col_elapsed')}</th>
                    <th>{t('monitoring.col_time')}</th>
                    <th>{t('monitoring.col_usage')}</th>
                    <th>{t('monitoring.col_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id}>
                      <td>
                        <div className={styles.mono}>{e.source || e.auth_index || '—'}</div>
                        <div className={styles.muted}>{e.provider || ''}</div>
                      </td>
                      <td className={styles.mono}>{e.model || e.alias || '—'}</td>
                      <td>{e.reasoning_effort || '—'}</td>
                      <td>
                        {e.failed ? (
                          <span className={styles.statusFail}>
                            {e.fail_status_code || t('monitoring.status_failed')}
                          </span>
                        ) : (
                          <span className={styles.statusOk}>{t('monitoring.status_success')}</span>
                        )}
                        {e.fail_summary ? (
                          <div className={styles.muted} title={e.fail_summary}>
                            {e.fail_summary.slice(0, 48)}
                          </div>
                        ) : null}
                      </td>
                      <td>{formatDuration(e.ttft_ms)}</td>
                      <td>{formatDuration(e.latency_ms)}</td>
                      <td>{formatTime(e.timestamp_ms)}</td>
                      <td>
                        <div className={styles.usageCell}>
                          <span>{formatNumber(e.total_tokens)}</span>
                          <span className={styles.muted}>{formatTokensCompact(e)}</span>
                        </div>
                      </td>
                      <td>{formatUsd(e.estimated_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      ) : null}

      {tab === 'accounts' ? (
        <Card>
          <div className={styles.tableWrap}>
            {accounts.length === 0 ? (
              <div className={styles.empty}>
                <EmptyState title={t('monitoring.empty_accounts')} />
              </div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('monitoring.col_source')}</th>
                    <th>{t('monitoring.col_auth')}</th>
                    <th>{t('monitoring.col_provider')}</th>
                    <th>{t('monitoring.card_calls')}</th>
                    <th>{t('monitoring.card_success')}</th>
                    <th>{t('monitoring.card_tokens')}</th>
                    <th>{t('monitoring.card_cost')}</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((a, idx) => (
                    <tr key={`${a.auth_index}-${a.source_hash}-${idx}`}>
                      <td className={styles.mono}>{a.source || '—'}</td>
                      <td className={styles.mono}>{a.auth_index || '—'}</td>
                      <td>{a.provider || '—'}</td>
                      <td>{formatNumber(a.total_calls)}</td>
                      <td>
                        {a.total_calls
                          ? `${((a.success_calls / a.total_calls) * 100).toFixed(1)}%`
                          : '—'}
                      </td>
                      <td>{formatNumber(a.total_tokens)}</td>
                      <td>{formatUsd(a.estimated_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </Card>
      ) : null}

      {tab === 'prices' ? (
        <div className={styles.pricesPanel}>
          <Card title={t('monitoring.prices_editor')}>
            <p className={styles.muted}>{t('monitoring.prices_hint')}</p>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>{t('monitoring.col_model')}</label>
                <Input value={priceModel} onChange={(e) => setPriceModel(e.target.value)} placeholder="gpt-5.5" />
              </div>
              <div className={styles.formField}>
                <label>{t('monitoring.price_prompt')}</label>
                <Input value={pricePrompt} onChange={(e) => setPricePrompt(e.target.value)} />
              </div>
              <div className={styles.formField}>
                <label>{t('monitoring.price_completion')}</label>
                <Input value={priceCompletion} onChange={(e) => setPriceCompletion(e.target.value)} />
              </div>
              <Button onClick={() => void savePrice()}>{t('monitoring.save_price')}</Button>
            </div>
          </Card>

          <Card title={t('monitoring.alias_editor')}>
            <p className={styles.muted}>{t('monitoring.alias_hint')}</p>
            <div className={styles.formRow}>
              <div className={styles.formField}>
                <label>{t('monitoring.alias_from')}</label>
                <Input
                  value={aliasFrom}
                  onChange={(e) => setAliasFrom(e.target.value)}
                  placeholder="brand-gpt-5.5"
                />
              </div>
              <div className={styles.formField}>
                <label>{t('monitoring.alias_to')}</label>
                <Input value={aliasTo} onChange={(e) => setAliasTo(e.target.value)} placeholder="gpt-5.5" />
              </div>
              <Button onClick={() => void saveAlias()}>{t('monitoring.save_alias')}</Button>
            </div>
            {unpriced.length > 0 ? (
              <div style={{ marginTop: '0.75rem' }}>
                <div className={styles.muted}>{t('monitoring.unpriced_models')}</div>
                <div className={styles.filtersRow}>
                  {unpriced.slice(0, 20).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={styles.rangeChip}
                      onClick={() => {
                        setAliasFrom(m);
                        setPriceModel(m);
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('monitoring.col_model')}</th>
                    <th>{t('monitoring.price_prompt')}</th>
                    <th>{t('monitoring.price_completion')}</th>
                    <th>{t('monitoring.price_source')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {prices.map((p) => (
                    <tr key={p.model}>
                      <td className={styles.mono}>{p.model}</td>
                      <td>{p.prompt_per_1m}</td>
                      <td>{p.completion_per_1m}</td>
                      <td>{p.source || 'manual'}</td>
                      <td>
                        <Button variant="ghost" onClick={() => void deletePrice(p.model)}>
                          {t('common.delete')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className={styles.tableWrap} style={{ marginTop: '1rem' }}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t('monitoring.alias_from')}</th>
                    <th>{t('monitoring.alias_to')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {aliases.map((a) => (
                    <tr key={a.alias}>
                      <td className={styles.mono}>{a.alias}</td>
                      <td className={styles.mono}>{a.target_model}</td>
                      <td>
                        <Button variant="ghost" onClick={() => void deleteAlias(a.alias)}>
                          {t('common.delete')}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}
