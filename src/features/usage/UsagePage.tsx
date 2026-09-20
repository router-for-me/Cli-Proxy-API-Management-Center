import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { usageStatsApi } from '@/services/api';
import { downloadBlob } from '@/utils/download';
import { USAGE_RANGES } from './constants';
import {
  buildUsageRange,
  cleanAccountName,
  formatDuration,
  formatTokenCount,
  generateUsageCsv,
  summarizeBuckets,
} from './logic';
import { UsageDistributionCard } from './UsageDistributionCard';
import { UsageRecordsTable } from './UsageRecordsTable';
import { UsageTrendChart } from './UsageTrendChart';
import type {
  BreakdownRow,
  UsageBucket,
  UsageFilter,
  UsageMetric,
  UsageRange,
  UsageRangeQuery,
  UsageRecord,
} from './types';
import styles from './UsagePage.module.scss';

function getErrorStatus(err: unknown): number | undefined {
  if (typeof err === 'object' && err !== null && 'response' in err) {
    const res = (err as { response?: { status?: number } }).response;
    return typeof res?.status === 'number' ? res.status : undefined;
  }
  return undefined;
}

export function UsagePage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const connected = connectionStatus === 'connected';

  const [range, setRange] = useState<UsageRange>('24h');
  const [metric, setMetric] = useState<UsageMetric>('tokens');
  const [query, setQuery] = useState<UsageRangeQuery>(() => buildUsageRange('24h'));

  // Aggregated data
  const [buckets, setBuckets] = useState<UsageBucket[]>([]);
  const [modelBreakdown, setModelBreakdown] = useState<BreakdownRow[]>([]);
  const [accountBreakdown, setAccountBreakdown] = useState<BreakdownRow[]>([]);
  const [endpointBreakdown, setEndpointBreakdown] = useState<BreakdownRow[]>([]);
  const [breakdownError, setBreakdownError] = useState('');

  // Master lists of available models and accounts across queries
  const [knownModels, setKnownModels] = useState<string[]>([]);
  const [knownAccounts, setKnownAccounts] = useState<string[]>([]);

  // Records data
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [snapshotId, setSnapshotId] = useState<string | undefined>(undefined);

  // Filters for records & CSV
  const [filter, setFilter] = useState<UsageFilter>({});

  // Loading & error states
  const [loading, setLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState('');
  const [recordsError, setRecordsError] = useState('');
  const [notice, setNotice] = useState('');

  // CSV export state
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  const exportCancelledRef = useRef(false);

  // Concurrency tracking
  const requestId = useRef(0);
  const recordsRequestId = useRef(0);

  // Fetch aggregated data (timeseries & breakdowns)
  const refreshAggregated = useCallback(
    async (currentQuery: UsageRangeQuery, currentFilter: UsageFilter, id: number) => {
      try {
        const p = currentFilter.provider ? currentFilter.provider.trim() : undefined;
        const m = currentFilter.model ? currentFilter.model.trim() : undefined;
        const a = currentFilter.account ? currentFilter.account.trim() : undefined;

        const [seriesRes, modelRes, accountRes, endpointRes] = await Promise.allSettled([
          usageStatsApi.timeseries({
            from: currentQuery.from,
            to: currentQuery.to,
            step: currentQuery.step,
            range_mode: 'exact',
            provider: p,
            model: m,
            account: a,
          }),
          usageStatsApi.breakdown({
            from: currentQuery.from,
            to: currentQuery.to,
            dimension: 'model',
            provider: p,
            model: m,
            account: a,
          }),
          usageStatsApi.breakdown({
            from: currentQuery.from,
            to: currentQuery.to,
            dimension: 'account',
            provider: p,
            model: m,
            account: a,
          }),
          usageStatsApi.breakdown({
            from: currentQuery.from,
            to: currentQuery.to,
            dimension: 'endpoint',
            provider: p,
            model: m,
            account: a,
          }),
        ]);

        if (id !== requestId.current) return;

        if (seriesRes.status === 'fulfilled') {
          setBuckets(seriesRes.value.buckets ?? []);
        } else {
          setError(seriesRes.reason instanceof Error ? seriesRes.reason.message : t('usage.load_error'));
        }

        if (modelRes.status === 'fulfilled') {
          const rows = modelRes.value.rows ?? [];
          setModelBreakdown(rows);
          setKnownModels((prev) =>
            Array.from(new Set([...prev, ...rows.map((r) => r.key).filter(Boolean)])).sort()
          );
        }
        if (accountRes.status === 'fulfilled') {
          const rows = accountRes.value.rows ?? [];
          setAccountBreakdown(rows);
          setKnownAccounts((prev) =>
            Array.from(
              new Set([
                ...prev,
                ...rows.map((r) => cleanAccountName(r.key)).filter((k) => k && k !== '—'),
              ])
            ).sort()
          );
        }
        if (endpointRes.status === 'fulfilled') {
          setEndpointBreakdown(endpointRes.value.rows ?? []);
        }

        if (
          modelRes.status === 'rejected' ||
          accountRes.status === 'rejected' ||
          endpointRes.status === 'rejected'
        ) {
          setBreakdownError(t('usage.breakdown_unavailable'));
        } else {
          setBreakdownError('');
        }
      } catch (err: unknown) {
        if (id !== requestId.current) return;
        setError(err instanceof Error ? err.message : t('usage.load_error'));
      }
    },
    [t]
  );

  // Fetch records page (snapshot-bound)
  const fetchInitialRecords = useCallback(
    async (currentQuery: UsageRangeQuery, currentFilter: UsageFilter, recId: number) => {
      setRecordsLoading(true);
      setRecordsError('');
      try {
        const page = await usageStatsApi.records({
          from: currentQuery.from,
          to: currentQuery.to,
          limit: 50,
          offset: 0,
          snapshot: 'new',
          provider: currentFilter.provider ? currentFilter.provider.trim() : undefined,
          model: currentFilter.model ? currentFilter.model.trim() : undefined,
          account: currentFilter.account ? currentFilter.account.trim() : undefined,
          failed: currentFilter.failed ? true : undefined,
        });

        if (recId !== recordsRequestId.current) return;

        setRecords(page.records ?? []);
        setHasMore(Boolean(page.has_more));
        setOffset(page.next_offset ?? page.records?.length ?? 0);
        setSnapshotId(page.snapshot_id);

        if (page.records) {
          setKnownModels((prev) =>
            Array.from(new Set([...prev, ...page.records.map((r) => r.model).filter(Boolean)])).sort()
          );
          setKnownAccounts((prev) =>
            Array.from(
              new Set([
                ...prev,
                ...page.records
                  .map((r) => cleanAccountName(r.account))
                  .filter((k) => k && k !== '—'),
              ])
            ).sort()
          );
        }
      } catch (err: unknown) {
        if (recId !== recordsRequestId.current) return;
        setRecordsError(err instanceof Error ? err.message : t('usage.load_error'));
      } finally {
        if (recId === recordsRequestId.current) {
          setRecordsLoading(false);
        }
      }
    },
    [t]
  );

  // Full page refresh
  const refresh = useCallback(async () => {
    if (!connected) {
      setBuckets([]);
      setModelBreakdown([]);
      setAccountBreakdown([]);
      setEndpointBreakdown([]);
      setRecords([]);
      setHasMore(false);
      setError('');
      setRecordsError('');
      return;
    }

    const id = ++requestId.current;
    const recId = ++recordsRequestId.current;
    const nextQuery = buildUsageRange(range);
    setQuery(nextQuery);
    setLoading(true);
    setError('');
    setNotice('');

    try {
      await Promise.all([
        refreshAggregated(nextQuery, filter, id),
        fetchInitialRecords(nextQuery, filter, recId),
      ]);
    } finally {
      if (id === requestId.current) {
        setLoading(false);
      }
    }
  }, [connected, fetchInitialRecords, filter, range, refreshAggregated]);

  useHeaderRefresh(refresh, connected);

  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
      recordsRequestId.current += 1;
    };
  }, [refresh]);

  // Global filter change affecting charts, KPIs, breakdowns, and records
  const handleGlobalFilterChange = useCallback(
    (newFilter: Partial<UsageFilter>) => {
      const updated: UsageFilter = { ...filter, ...newFilter };
      if (updated.model === '') updated.model = undefined;
      if (updated.account === '') updated.account = undefined;
      if (updated.provider === '') updated.provider = undefined;

      setFilter(updated);
      const id = ++requestId.current;
      const recId = ++recordsRequestId.current;
      void refreshAggregated(query, updated, id);
      void fetchInitialRecords(query, updated, recId);
    },
    [fetchInitialRecords, filter, query, refreshAggregated]
  );

  // Range change (24h / 7d)
  const handleRangeChange = (nextRange: UsageRange) => {
    setRange(nextRange);
    const nextQuery = buildUsageRange(nextRange);
    setQuery(nextQuery);
    const id = ++requestId.current;
    const recId = ++recordsRequestId.current;
    void refreshAggregated(nextQuery, filter, id);
    void fetchInitialRecords(nextQuery, filter, recId);
  };

  const summary = useMemo(() => summarizeBuckets(buckets), [buckets]);

  // Load more pagination
  const loadMore = useCallback(async () => {
    if (!connected || recordsLoading || !hasMore) return;
    setRecordsLoading(true);
    setRecordsError('');
    const recId = recordsRequestId.current;

    try {
      const page = await usageStatsApi.records({
        from: query.from,
        to: query.to,
        limit: 50,
        offset,
        snapshot: snapshotId,
        provider: filter.provider ? filter.provider.trim() : undefined,
        model: filter.model ? filter.model.trim() : undefined,
        account: filter.account ? filter.account.trim() : undefined,
        failed: filter.failed ? true : undefined,
      });

      if (recId !== recordsRequestId.current) return;

      // Protocol check: prevent infinite loops if has_more is true but offset did not advance
      const nextOff = page.next_offset ?? offset + (page.records?.length ?? 0);
      if (page.has_more && nextOff <= offset) {
        setHasMore(false);
        setRecordsError(t('usage.pagination_protocol_error'));
        return;
      }

      setRecords((current) => [...current, ...(page.records ?? [])]);
      setHasMore(Boolean(page.has_more));
      setOffset(nextOff);
      if (page.snapshot_id) {
        setSnapshotId(page.snapshot_id);
      }
    } catch (err: unknown) {
      if (recId !== recordsRequestId.current) return;
      if (getErrorStatus(err) === 409) {
        setRecordsError(t('usage.snapshot_expired'));
        setHasMore(false);
      } else {
        setRecordsError(err instanceof Error ? err.message : t('usage.load_error'));
      }
    } finally {
      if (recId === recordsRequestId.current) {
        setRecordsLoading(false);
      }
    }
  }, [connected, filter, hasMore, offset, query.from, query.to, recordsLoading, snapshotId, t]);

  // Safe CSV export using snapshot, capped at 2000 records
  const handleExportCsv = async () => {
    if (!connected || exporting) return;
    setExporting(true);
    exportCancelledRef.current = false;
    setNotice('');
    setExportProgress(t('usage.exporting_csv'));

    const allExportedRecords: UsageRecord[] = [];
    let curOffset = 0;
    let curSnapshot = 'new';
    const batchSize = 200;
    const maxExport = 2000;
    let isTruncated = false;

    try {
      while (allExportedRecords.length < maxExport) {
        if (exportCancelledRef.current) {
          setNotice(t('usage.export_cancelled'));
          return;
        }

        const fetchLimit = Math.min(batchSize, maxExport - allExportedRecords.length);
        const res = await usageStatsApi.records({
          from: query.from,
          to: query.to,
          limit: fetchLimit,
          offset: curOffset,
          snapshot: curSnapshot,
          provider: filter.provider ? filter.provider.trim() : undefined,
          model: filter.model ? filter.model.trim() : undefined,
          account: filter.account ? filter.account.trim() : undefined,
          failed: filter.failed ? true : undefined,
        });

        if (exportCancelledRef.current) {
          setNotice(t('usage.export_cancelled'));
          return;
        }

        const pageRecords = res.records ?? [];
        allExportedRecords.push(...pageRecords);
        setExportProgress(`${allExportedRecords.length} / ${maxExport}`);

        if (allExportedRecords.length >= maxExport && res.has_more) {
          isTruncated = true;
          break;
        }

        if (!res.has_more || pageRecords.length === 0) {
          break;
        }

        const nextOff = res.next_offset ?? curOffset + pageRecords.length;
        if (nextOff <= curOffset) {
          throw new Error(t('usage.pagination_protocol_error'));
        }

        curOffset = nextOff;
        if (res.snapshot_id) {
          curSnapshot = res.snapshot_id;
        }
      }

      if (allExportedRecords.length === 0) {
        setNotice(t('usage.no_records'));
        return;
      }

      const csv = generateUsageCsv(allExportedRecords);
      const safeFrom = query.from.slice(0, 10);
      const safeTo = query.to.slice(0, 10);
      const filename = `usage-${safeFrom}-${safeTo}.csv`;

      downloadBlob({
        filename,
        blob: new Blob([csv], { type: 'text/csv;charset=utf-8;' }),
      });

      if (isTruncated) {
        setNotice(t('usage.export_truncated'));
      }
    } catch (err: unknown) {
      if (getErrorStatus(err) === 409) {
        setNotice(t('usage.snapshot_expired'));
      } else {
        setNotice(err instanceof Error ? err.message : t('usage.export_failed'));
      }
    } finally {
      setExporting(false);
      setExportProgress('');
    }
  };

  const cancelExport = () => {
    exportCancelledRef.current = true;
  };

  const rangeLabel = (value: UsageRange) => t(`usage.range_${value}`);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t('usage.eyebrow')}</p>
          <h1>{t('usage.title')}</h1>
          <p className={styles.description}>{t('usage.description')}</p>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          loading={loading}
          onClick={() => void refresh()}
        >
          {t('usage.refresh')}
        </Button>
      </header>

      {/* Top Toolbar with Range, Metric, Model Filter, Account Filter, and Reset */}
      <div className={styles.toolbar} role="group" aria-label={t('usage.range_label')}>
        <div className={styles.segmented}>
          {USAGE_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              className={value === range ? styles.segmentActive : styles.segment}
              onClick={() => handleRangeChange(value)}
              aria-pressed={value === range}
            >
              {rangeLabel(value)}
            </button>
          ))}
        </div>

        <label className={styles.metricControl}>
          <span>{t('usage.metric_label')}</span>
          <select value={metric} onChange={(event) => setMetric(event.target.value as UsageMetric)}>
            <option value="tokens">{t('usage.metric_tokens')}</option>
            <option value="requests">{t('usage.metric_requests')}</option>
          </select>
        </label>

        {/* Model Filter */}
        <label className={styles.metricControl}>
          <span>{t('usage.filter_model')}</span>
          <select
            value={filter.model ?? ''}
            onChange={(e) => handleGlobalFilterChange({ model: e.target.value || undefined })}
          >
            <option value="">{t('usage.all_models')}</option>
            {knownModels.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>

        {/* Account Filter */}
        <label className={styles.metricControl}>
          <span>{t('usage.filter_account')}</span>
          <select
            value={filter.account ?? ''}
            onChange={(e) => handleGlobalFilterChange({ account: e.target.value || undefined })}
          >
            <option value="">{t('usage.all_accounts')}</option>
            {knownAccounts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>

        {/* Clear Filters button */}
        {(filter.model || filter.account || filter.provider || filter.failed) && (
          <button
            type="button"
            className={styles.clearFilterBtn}
            onClick={() =>
              handleGlobalFilterChange({
                model: undefined,
                account: undefined,
                provider: undefined,
                failed: undefined,
              })
            }
            title={t('usage.clear_filters')}
          >
            {t('usage.clear_filters')} ✕
          </button>
        )}
      </div>

      {!connected && (
        <EmptyState title={t('usage.disconnected')} description={t('usage.disconnected_hint')} />
      )}
      {error && <div className={styles.errorBanner}>{error}</div>}
      {notice && <div className={styles.noticeBanner}>{notice}</div>}

      {connected && (
        <>
          {/* 11 KPIs Grid */}
          <section className={styles.kpiGrid} aria-label={t('usage.summary')}>
            <Kpi
              label={t('usage.total_tokens')}
              value={formatTokenCount(summary.totalTokens)}
              title={`${summary.totalTokens.toLocaleString()} tokens`}
            />
            <Kpi
              label={t('usage.uncached_input')}
              value={formatTokenCount(summary.uncachedInputTokens)}
              title={`${summary.uncachedInputTokens.toLocaleString()} tokens`}
            />
            <Kpi
              label={t('usage.output')}
              value={formatTokenCount(summary.outputTokens)}
              title={`${summary.outputTokens.toLocaleString()} tokens`}
            />
            <Kpi
              label={t('usage.cache_read')}
              value={formatTokenCount(summary.cacheReadTokens)}
              title={`${summary.cacheReadTokens.toLocaleString()} tokens`}
            />
            <Kpi
              label={t('usage.cache_write')}
              value={formatTokenCount(summary.cacheWriteTokens)}
              title={`${summary.cacheWriteTokens.toLocaleString()} tokens`}
            />
            <Kpi
              label={t('usage.reasoning_subset')}
              value={formatTokenCount(summary.reasoningTokens)}
              title={`${summary.reasoningTokens.toLocaleString()} tokens`}
            />
            <Kpi
              label={t('usage.requests')}
              value={formatTokenCount(summary.requests)}
              title={`${summary.requests.toLocaleString()} requests`}
            />
            <Kpi
              label={t('usage.error_rate')}
              value={summary.requests > 0 ? `${summary.errorRate.toFixed(1)}%` : '—'}
            />
            <Kpi label={t('usage.avg_latency')} value={formatDuration(summary.avgLatencyMs)} />
            <Kpi label={t('usage.avg_ttft')} value={formatDuration(summary.avgTtftMs)} />
            <Kpi
              label={t('usage.cache_hit_rate')}
              value={summary.cacheHitRate !== null ? `${summary.cacheHitRate.toFixed(1)}%` : '—'}
            />
          </section>

          {/* 4 Charts Grid (2x2 matching sub2api) */}
          <div className={styles.chartsGrid}>
            <UsageDistributionCard
              title={t('usage.distribution_model_title')}
              dimension="model"
              rows={modelBreakdown}
              error={breakdownError}
              onSelectKey={(k) =>
                handleGlobalFilterChange({ model: filter.model === k ? undefined : k })
              }
              selectedKey={filter.model}
            />
            <UsageDistributionCard
              title={t('usage.distribution_account_title')}
              dimension="account"
              rows={accountBreakdown}
              error={breakdownError}
              onSelectKey={(k) =>
                handleGlobalFilterChange({ account: filter.account === k ? undefined : k })
              }
              selectedKey={filter.account}
            />
            <UsageDistributionCard
              title={t('usage.distribution_endpoint_title')}
              dimension="endpoint"
              rows={endpointBreakdown}
              error={breakdownError}
            />
            <Card
              title={t('usage.trend_title')}
              extra={<span className={styles.cardMeta}>{t(`usage.step_${query.step}`)}</span>}
            >
              <UsageTrendChart buckets={buckets} metric={metric} step={query.step} />
            </Card>
          </div>

          {/* Records Table with Filters & CSV Export */}
          <Card
            title={t('usage.records_title')}
            extra={
              <div className={styles.recordsCardHeader}>
                <span className={styles.cardMeta}>{records.length.toLocaleString()}</span>
                <div className={styles.exportWrap}>
                  {exporting ? (
                    <>
                      <span className={styles.exportProgress}>{exportProgress}</span>
                      <Button type="button" variant="secondary" size="sm" onClick={cancelExport}>
                        {t('usage.cancel')}
                      </Button>
                    </>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => void handleExportCsv()}
                      title={t('usage.export_csv_hint')}
                    >
                      {t('usage.export_csv')}
                    </Button>
                  )}
                </div>
              </div>
            }
          >
            {/* Filter Bar */}
            <div className={styles.filterBar}>
              <input
                type="text"
                className={styles.filterInput}
                placeholder={t('usage.filter_placeholder_provider')}
                value={filter.provider ?? ''}
                onChange={(e) =>
                  handleGlobalFilterChange({ provider: e.target.value || undefined })
                }
              />
              <input
                type="text"
                className={styles.filterInput}
                placeholder={t('usage.filter_placeholder_model')}
                value={filter.model ?? ''}
                onChange={(e) => handleGlobalFilterChange({ model: e.target.value || undefined })}
              />
              <input
                type="text"
                className={styles.filterInput}
                placeholder={t('usage.filter_account')}
                value={filter.account ?? ''}
                onChange={(e) =>
                  handleGlobalFilterChange({ account: e.target.value || undefined })
                }
              />
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={Boolean(filter.failed)}
                  onChange={(e) =>
                    handleGlobalFilterChange({ failed: e.target.checked || undefined })
                  }
                />
                <span>{t('usage.filter_failed_only')}</span>
              </label>
            </div>

            {recordsError && <div className={styles.errorBanner}>{recordsError}</div>}

            <UsageRecordsTable
              records={records}
              hasMore={hasMore}
              loading={recordsLoading}
              onLoadMore={() => void loadMore()}
            />
          </Card>
        </>
      )}
    </div>
  );
}

interface KpiProps {
  label: string;
  value: string;
  title?: string;
}

function Kpi({ label, value, title }: KpiProps) {
  return (
    <Card className={styles.kpiCard}>
      <span className={styles.kpiLabel}>{label}</span>
      <span className={styles.kpiValue} title={title}>
        {value}
      </span>
    </Card>
  );
}
