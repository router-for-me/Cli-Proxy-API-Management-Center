import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { IconRefreshCw, IconX } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  usageEventsApi,
  type ModelPrice,
  type ModelPriceAlias,
  type PriceSyncCandidateSet,
  type PriceSyncResult,
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
  { label: 'Off', value: '0' },
  { label: '5s', value: '5000' },
  { label: '10s', value: '10000' },
  { label: '30s', value: '30000' },
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

const formatRate = (value: number | undefined | null) => {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return formatNumber(value, 4);
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

  const [priceModel, setPriceModel] = useState('');
  const [pricePrompt, setPricePrompt] = useState('');
  const [priceCompletion, setPriceCompletion] = useState('');
  const [aliasFrom, setAliasFrom] = useState('');
  const [aliasTo, setAliasTo] = useState('');

  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<PriceSyncResult | null>(null);
  const [candidatePicks, setCandidatePicks] = useState<Record<string, string>>({});
  const [overrideManual, setOverrideManual] = useState(false);

  // Build the query at call time so refresh / auto-refresh always use a fresh
  // upper bound. Memoizing with to_ms: Date.now() freezes the window and makes
  // later refreshes look broken (new events fall after the stale to_ms).
  const buildQuery = useCallback((): UsageQuery => {
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
      const query = buildQuery();
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
      setError(getErrorMessage(err));
      setEvents([]);
      setSummary(null);
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  const loadAccounts = useCallback(async () => {
    try {
      const res = await usageEventsApi.getAccountStats(buildQuery());
      setAccounts(res.accounts || []);
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  }, [buildQuery, showNotification]);

  const applyPricesResponse = useCallback(
    (res: {
      prices?: ModelPrice[];
      aliases?: ModelPriceAlias[];
      unpriced_models?: string[];
    }) => {
      setPrices(res.prices || []);
      setAliases(res.aliases || []);
      setUnpriced(res.unpriced_models || []);
    },
    []
  );

  const loadPrices = useCallback(async () => {
    try {
      const res = await usageEventsApi.getModelPrices();
      applyPricesResponse(res);
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  }, [applyPricesResponse, showNotification]);

  const refresh = useCallback(async () => {
    await loadCore();
    if (tab === 'accounts') await loadAccounts();
    if (tab === 'prices') await loadPrices();
  }, [loadCore, loadAccounts, loadPrices, tab]);

  useHeaderRefresh(refresh);

  // Re-fetch when filters change (buildQuery identity) or active tab changes.
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

  const savePrice = async (asManual = true) => {
    const modelName = priceModel.trim();
    if (!modelName) return;
    try {
      await usageEventsApi.putModelPrices([
        {
          model: modelName,
          prompt_per_1m: Number(pricePrompt) || 0,
          completion_per_1m: Number(priceCompletion) || 0,
          source: asManual ? 'manual' : 'override',
        },
      ]);
      showNotification(t('monitoring.price_saved'), 'success');
      setPriceModel('');
      setPricePrompt('');
      setPriceCompletion('');
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const startEditPrice = (p: ModelPrice) => {
    setPriceModel(p.model);
    setPricePrompt(String(p.prompt_per_1m ?? ''));
    setPriceCompletion(String(p.completion_per_1m ?? ''));
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

  const syncPrices = async () => {
    setSyncing(true);
    try {
      const result = await usageEventsApi.syncModelPrices({
        override_manual: overrideManual,
        apply_matched: true,
      });
      setSyncResult(result);
      applyPricesResponse({
        prices: result.prices,
        aliases: result.aliases,
        unpriced_models: result.unpriced_models,
      });
      const picks: Record<string, string> = {};
      for (const set of result.candidates || []) {
        if (set.candidates?.[0]) {
          picks[set.model] = set.candidates[0].source_model_id;
        }
      }
      setCandidatePicks(picks);
      showNotification(
        t('monitoring.sync_success', {
          imported: result.imported,
          candidates: result.candidates?.length ?? 0,
          unmatched: result.unmatched?.length ?? 0,
        }),
        'success'
      );
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    } finally {
      setSyncing(false);
    }
  };

  const applyCandidate = async (set: PriceSyncCandidateSet) => {
    const pickId = candidatePicks[set.model];
    const cand = set.candidates.find((c) => c.source_model_id === pickId) || set.candidates[0];
    if (!cand) return;
    try {
      // Store rates under the local model id so usage rows resolve without an extra alias.
      const price: ModelPrice = {
        model: set.model,
        prompt_per_1m: cand.price.prompt_per_1m,
        completion_per_1m: cand.price.completion_per_1m,
        cache_per_1m: cand.price.cache_per_1m,
        cache_read_per_1m: cand.price.cache_read_per_1m,
        cache_creation_per_1m: cand.price.cache_creation_per_1m,
        source: cand.price.source || 'sync',
      };
      await usageEventsApi.putModelPrices([price]);
      showNotification(t('monitoring.candidate_applied', { model: set.model }), 'success');
      setSyncResult((prev) =>
        prev
          ? {
              ...prev,
              candidates: (prev.candidates || []).filter((c) => c.model !== set.model),
            }
          : prev
      );
      await loadPrices();
      await loadCore();
    } catch (err) {
      showNotification(getErrorMessage(err), 'error');
    }
  };

  const statsOff = statsEnabledHint === false;

  const rangeOptions: Array<[RangeKey, string]> = [
    ['today', t('monitoring.range_today')],
    ['7d', '7d'],
    ['14d', '14d'],
    ['30d', '30d'],
    ['all', t('monitoring.range_all')],
  ];

  const providerOptions = useMemo(
    () => [
      { value: '', label: t('monitoring.filter_providers') },
      ...(filterOptions?.providers || []).map((p) => ({ value: p, label: p })),
    ],
    [filterOptions?.providers, t]
  );

  const modelOptions = useMemo(
    () => [
      { value: '', label: t('monitoring.filter_models') },
      ...(filterOptions?.models || []).map((m) => ({ value: m, label: m })),
    ],
    [filterOptions?.models, t]
  );

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_statuses') },
      { value: 'success', label: t('monitoring.status_success') },
      { value: 'failed', label: t('monitoring.status_failed') },
    ],
    [t]
  );

  const autoOptions = useMemo(
    () =>
      AUTO_OPTIONS.map((opt) => ({
        value: opt.value,
        label: `${t('monitoring.auto_prefix')} ${opt.label}`,
      })),
    [t]
  );

  const tabs: Array<[TabKey, string, number | null]> = [
    ['realtime', t('monitoring.tab_realtime'), events.length],
    ['accounts', t('monitoring.tab_accounts'), null],
    ['prices', t('monitoring.tab_prices'), null],
  ];

  return (
    <div className={styles.container}>
      <div className={styles.filterSection}>
        <div className={styles.filterPrimary}>
          <div className={styles.rangeGroup} role="group" aria-label={t('monitoring.range_today')}>
            {rangeOptions.map(([key, label]) => (
              <button
                key={key}
                type="button"
                className={`${styles.rangeChip} ${range === key ? styles.rangeChipActive : ''}`}
                onClick={() => setRange(key)}
              >
                {label}
              </button>
            ))}
          </div>

          <div className={styles.searchWrap}>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('monitoring.search_placeholder')}
              aria-label={t('monitoring.search_placeholder')}
            />
          </div>

          <div className={styles.filterActions}>
            <Button variant="secondary" size="sm" onClick={() => void refresh()} disabled={loading}>
              <IconRefreshCw size={16} />
              {t('common.refresh')}
            </Button>
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <IconX size={16} />
              {t('monitoring.clear')}
            </Button>
            <Select
              className={styles.filterSelect}
              value={String(autoMs)}
              options={autoOptions}
              onChange={(v) => setAutoMs(Number(v))}
              ariaLabel={t('monitoring.auto_refresh')}
              size="sm"
            />
          </div>
        </div>

        <div className={styles.filterSecondary}>
          <Select
            className={styles.filterSelect}
            value={provider}
            options={providerOptions}
            onChange={setProvider}
            ariaLabel={t('monitoring.filter_providers')}
            size="sm"
          />
          <Select
            className={styles.filterSelect}
            value={model}
            options={modelOptions}
            onChange={setModel}
            ariaLabel={t('monitoring.filter_models')}
            size="sm"
          />
          <Select
            className={styles.filterSelect}
            value={statusFilter}
            options={statusOptions}
            onChange={(v) => setStatusFilter(v as 'all' | 'success' | 'failed')}
            ariaLabel={t('monitoring.filter_statuses')}
            size="sm"
          />
        </div>
      </div>

      {statsOff ? (
        <div className={styles.banner}>
          <span>{t('monitoring.stats_disabled_hint')}</span>
          <Button size="sm" onClick={() => void enableStatistics()}>
            {t('monitoring.enable_stats')}
          </Button>
        </div>
      ) : null}

      {error ? (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_calls')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.total_calls)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_success')}</div>
          <div className={`${styles.summaryValue} ${styles.summaryValueSuccess}`}>
            {summary ? `${(summary.success_rate * 100).toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_failed')}</div>
          <div className={`${styles.summaryValue} ${styles.summaryValueDanger}`}>
            {formatNumber(summary?.failure_calls)}
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_cost')}</div>
          <div className={styles.summaryValue}>{formatUsd(summary?.estimated_cost)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_tokens')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.total_tokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_input')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.input_tokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_output')}</div>
          <div className={styles.summaryValue}>{formatNumber(summary?.output_tokens)}</div>
        </div>
        <div className={styles.summaryCard}>
          <div className={styles.summaryLabel}>{t('monitoring.card_cached')}</div>
          <div className={styles.summaryValue}>
            {formatNumber((summary?.cache_read_tokens || 0) + (summary?.cached_tokens || 0))}
          </div>
        </div>
      </div>

      <div className={styles.tabBar} role="tablist" aria-label={t('nav.monitoring')}>
        {tabs.map(([key, label, count]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={`${styles.tabItem} ${tab === key ? styles.tabActive : ''}`}
            onClick={() => {
              setTab(key);
              if (key === 'accounts') void loadAccounts();
              if (key === 'prices') void loadPrices();
            }}
          >
            {label}
            {count !== null ? <span className={styles.tabCount}>{count}</span> : null}
          </button>
        ))}
      </div>

      {tab === 'realtime' ? (
        <Card className={styles.sectionCard}>
          {events.length === 0 ? (
            <div className={styles.emptyWrap}>
              <EmptyState
                title={t('monitoring.empty_events')}
                description={t('monitoring.empty_events_hint')}
              />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.col_source')}</TableHead>
                  <TableHead>{t('monitoring.col_model')}</TableHead>
                  <TableHead>{t('monitoring.col_effort')}</TableHead>
                  <TableHead>{t('monitoring.col_status')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_ttft')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_elapsed')}</TableHead>
                  <TableHead>{t('monitoring.col_time')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_usage')}</TableHead>
                  <TableHead alignRight>{t('monitoring.col_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <div className={styles.cellStack}>
                        <span className={`${styles.cellPrimary} ${styles.mono}`}>
                          {e.source || e.auth_index || '—'}
                        </span>
                        {e.provider ? (
                          <span className={styles.cellSecondary}>{e.provider}</span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className={styles.mono}>{e.model || e.alias || '—'}</span>
                    </TableCell>
                    <TableCell>{e.reasoning_effort || '—'}</TableCell>
                    <TableCell>
                      <div className={styles.cellStack}>
                        {e.failed ? (
                          <span className={styles.statusFail}>
                            {e.fail_status_code || t('monitoring.status_failed')}
                          </span>
                        ) : (
                          <span className={styles.statusOk}>{t('monitoring.status_success')}</span>
                        )}
                        {e.fail_summary ? (
                          <span className={styles.cellSecondary} title={e.fail_summary}>
                            {e.fail_summary.slice(0, 64)}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell alignRight>
                      <span className={styles.num}>{formatDuration(e.ttft_ms)}</span>
                    </TableCell>
                    <TableCell alignRight>
                      <span className={styles.num}>{formatDuration(e.latency_ms)}</span>
                    </TableCell>
                    <TableCell>
                      <span className={styles.cellSecondary}>{formatTime(e.timestamp_ms)}</span>
                    </TableCell>
                    <TableCell alignRight>
                      <div className={styles.cellStack} style={{ alignItems: 'flex-end' }}>
                        <span className={styles.num}>{formatNumber(e.total_tokens)}</span>
                        <span className={styles.cellSecondary}>{formatTokensCompact(e)}</span>
                      </div>
                    </TableCell>
                    <TableCell alignRight>
                      <span className={styles.num}>{formatUsd(e.estimated_cost)}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}

      {tab === 'accounts' ? (
        <Card className={styles.sectionCard}>
          {accounts.length === 0 ? (
            <div className={styles.emptyWrap}>
              <EmptyState title={t('monitoring.empty_accounts')} />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('monitoring.col_source')}</TableHead>
                  <TableHead>{t('monitoring.col_auth')}</TableHead>
                  <TableHead>{t('monitoring.col_provider')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_calls')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_success')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_tokens')}</TableHead>
                  <TableHead alignRight>{t('monitoring.card_cost')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((a, idx) => (
                  <TableRow key={`${a.auth_index}-${a.source_hash}-${idx}`}>
                    <TableCell>
                      <span className={styles.mono}>{a.source || '—'}</span>
                    </TableCell>
                    <TableCell>
                      <span className={styles.mono}>{a.auth_index || '—'}</span>
                    </TableCell>
                    <TableCell>{a.provider || '—'}</TableCell>
                    <TableCell alignRight className={styles.num}>
                      {formatNumber(a.total_calls)}
                    </TableCell>
                    <TableCell alignRight className={styles.num}>
                      {a.total_calls
                        ? `${((a.success_calls / a.total_calls) * 100).toFixed(1)}%`
                        : '—'}
                    </TableCell>
                    <TableCell alignRight className={styles.num}>
                      {formatNumber(a.total_tokens)}
                    </TableCell>
                    <TableCell alignRight className={styles.num}>
                      {formatUsd(a.estimated_cost)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      ) : null}

      {tab === 'prices' ? (
        <div className={styles.pricesLayout}>
          <Card className={styles.sectionCard}>
            <div className={styles.pricesToolbar}>
              <div className={styles.pricesToolbarMeta}>
                <h3 className={styles.pricesTitle}>{t('monitoring.prices_editor')}</h3>
                <p className={styles.pricesHint}>{t('monitoring.prices_hint')}</p>
              </div>
              <div className={styles.pricesActions}>
                <label className={styles.overrideRow}>
                  <input
                    type="checkbox"
                    checked={overrideManual}
                    onChange={(e) => setOverrideManual(e.target.checked)}
                  />
                  {t('monitoring.override_manual')}
                </label>
                <Button loading={syncing} onClick={() => void syncPrices()}>
                  {t('monitoring.sync_prices')}
                </Button>
              </div>
            </div>

            {syncResult ? (
              <div className={styles.syncResult}>
                <span className={styles.syncPill}>
                  {t('monitoring.sync_imported')}: {syncResult.imported}
                </span>
                <span className={styles.syncPill}>
                  {t('monitoring.sync_candidates')}: {syncResult.candidates?.length ?? 0}
                </span>
                <span className={styles.syncPill}>
                  {t('monitoring.sync_unmatched')}: {syncResult.unmatched?.length ?? 0}
                </span>
                {(syncResult.skipped_manual ?? 0) > 0 ? (
                  <span className={styles.syncPill}>
                    {t('monitoring.sync_skipped_manual')}: {syncResult.skipped_manual}
                  </span>
                ) : null}
                {(syncResult.sources || []).length > 0 ? (
                  <span className={styles.syncPill}>
                    {t('monitoring.sync_sources')}: {(syncResult.sources || []).join(', ')}
                  </span>
                ) : null}
              </div>
            ) : null}
          </Card>

          {(syncResult?.candidates?.length ?? 0) > 0 ? (
            <Card title={t('monitoring.candidates_title')} className={styles.sectionCard}>
              <p className={styles.muted}>{t('monitoring.candidates_hint')}</p>
              <div className={styles.candidatesCard}>
                {(syncResult?.candidates || []).map((set) => {
                  const options = set.candidates.map((c) => ({
                    value: c.source_model_id,
                    label: `${c.source_model_id} · ${Math.round(c.score * 100)}% · $${formatRate(c.price.prompt_per_1m)} / $${formatRate(c.price.completion_per_1m)}`,
                  }));
                  return (
                    <div key={set.model} className={styles.candidateBlock}>
                      <div className={styles.candidateHeader}>
                        <span className={styles.candidateModel}>{set.model}</span>
                        <div className={styles.candidateControls}>
                          <Select
                            className={styles.candidateSelect}
                            value={candidatePicks[set.model] || options[0]?.value || ''}
                            options={options}
                            onChange={(v) =>
                              setCandidatePicks((prev) => ({ ...prev, [set.model]: v }))
                            }
                            size="sm"
                            ariaLabel={t('monitoring.candidates_title')}
                          />
                          <Button size="sm" onClick={() => void applyCandidate(set)}>
                            {t('monitoring.apply_candidate')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          ) : null}

          <Card title={t('monitoring.manual_price_title')} className={styles.sectionCard}>
            <p className={styles.muted}>{t('monitoring.manual_price_hint')}</p>
            <div className={styles.formGrid}>
              <Input
                label={t('monitoring.col_model')}
                value={priceModel}
                onChange={(e) => setPriceModel(e.target.value)}
                placeholder="gpt-5.5"
              />
              <Input
                label={t('monitoring.price_prompt')}
                value={pricePrompt}
                onChange={(e) => setPricePrompt(e.target.value)}
                placeholder="1.25"
              />
              <Input
                label={t('monitoring.price_completion')}
                value={priceCompletion}
                onChange={(e) => setPriceCompletion(e.target.value)}
                placeholder="10"
              />
              <div className={styles.formActions}>
                <Button onClick={() => void savePrice(true)}>{t('monitoring.save_price')}</Button>
              </div>
            </div>

            {unpriced.length > 0 ? (
              <div style={{ marginTop: 16 }}>
                <div className={styles.muted}>{t('monitoring.unpriced_models')}</div>
                <div className={styles.unpricedRow}>
                  {unpriced.slice(0, 24).map((m) => (
                    <button
                      key={m}
                      type="button"
                      className={styles.unpricedChip}
                      onClick={() => {
                        setPriceModel(m);
                        setAliasFrom(m);
                      }}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </Card>

          <Card title={t('monitoring.alias_editor')} className={styles.sectionCard}>
            <p className={styles.muted}>{t('monitoring.alias_hint')}</p>
            <div className={styles.formGrid}>
              <Input
                label={t('monitoring.alias_from')}
                value={aliasFrom}
                onChange={(e) => setAliasFrom(e.target.value)}
                placeholder="brand-gpt-5.5"
              />
              <Input
                label={t('monitoring.alias_to')}
                value={aliasTo}
                onChange={(e) => setAliasTo(e.target.value)}
                placeholder="gpt-5.5"
              />
              <div className={styles.formActions}>
                <Button onClick={() => void saveAlias()}>{t('monitoring.save_alias')}</Button>
              </div>
            </div>
          </Card>

          <Card title={t('monitoring.price_book')} className={styles.sectionCard}>
            {prices.length === 0 ? (
              <div className={styles.emptyWrap}>
                <EmptyState
                  title={t('monitoring.empty_prices')}
                  description={t('monitoring.empty_prices_hint')}
                />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('monitoring.col_model')}</TableHead>
                    <TableHead alignRight>{t('monitoring.price_prompt')}</TableHead>
                    <TableHead alignRight>{t('monitoring.price_completion')}</TableHead>
                    <TableHead>{t('monitoring.price_source')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prices.map((p) => (
                    <TableRow key={p.model}>
                      <TableCell>
                        <span className={styles.mono}>{p.model}</span>
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatRate(p.prompt_per_1m)}
                      </TableCell>
                      <TableCell alignRight className={styles.num}>
                        {formatRate(p.completion_per_1m)}
                      </TableCell>
                      <TableCell>
                        <span className={styles.cellSecondary}>{p.source || 'manual'}</span>
                      </TableCell>
                      <TableCell>
                        <div className={styles.formActions}>
                          <Button variant="ghost" size="sm" onClick={() => startEditPrice(p)}>
                            {t('common.edit')}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => void deletePrice(p.model)}
                          >
                            {t('common.delete')}
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Card>

          {aliases.length > 0 ? (
            <Card title={t('monitoring.alias_list')} className={styles.sectionCard}>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('monitoring.alias_from')}</TableHead>
                    <TableHead>{t('monitoring.alias_to')}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {aliases.map((a) => (
                    <TableRow key={a.alias}>
                      <TableCell>
                        <span className={styles.mono}>{a.alias}</span>
                      </TableCell>
                      <TableCell>
                        <span className={styles.mono}>{a.target_model}</span>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm" onClick={() => void deleteAlias(a.alias)}>
                          {t('common.delete')}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
