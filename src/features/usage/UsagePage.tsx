import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore } from '@/stores';
import { usageStatsApi } from '@/services/api';
import { USAGE_RANGES } from './constants';
import { buildUsageRange, formatTokenCount, summarizeBuckets } from './logic';
import { UsageRecordsTable } from './UsageRecordsTable';
import { UsageTrendChart } from './UsageTrendChart';
import type {
  UsageBucket,
  UsageMetric,
  UsageRange,
  UsageRangeQuery,
  UsageRecord,
} from './types';
import styles from './UsagePage.module.scss';

export function UsagePage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const connected = connectionStatus === 'connected';
  const [range, setRange] = useState<UsageRange>('24h');
  const [metric, setMetric] = useState<UsageMetric>('tokens');
  const [query, setQuery] = useState<UsageRangeQuery>(() => buildUsageRange('24h'));
  const [buckets, setBuckets] = useState<UsageBucket[]>([]);
  const [records, setRecords] = useState<UsageRecord[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [recordsLoading, setRecordsLoading] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(0);

  const refresh = useCallback(async () => {
    if (!connected) {
      setBuckets([]);
      setRecords([]);
      setHasMore(false);
      setError('');
      return;
    }
    const id = ++requestId.current;
    const nextQuery = buildUsageRange(range);
    setQuery(nextQuery);
    setLoading(true);
    setRecordsLoading(true);
    setError('');
    try {
      const [series, page] = await Promise.all([
        usageStatsApi.timeseries(nextQuery),
        usageStatsApi.records({ from: nextQuery.from, to: nextQuery.to, limit: 50, offset: 0 }),
      ]);
      if (id !== requestId.current) return;
      setBuckets(series.buckets ?? []);
      setRecords(page.records ?? []);
      setHasMore(Boolean(page.has_more));
      setOffset(page.next_offset ?? page.records?.length ?? 0);
    } catch (err: unknown) {
      if (id !== requestId.current) return;
      setError(err instanceof Error ? err.message : t('usage.load_error'));
    } finally {
      if (id === requestId.current) {
        setLoading(false);
        setRecordsLoading(false);
      }
    }
  }, [connected, range, t]);

  useHeaderRefresh(refresh, connected);

  useEffect(() => {
    void refresh();
    return () => {
      requestId.current += 1;
    };
  }, [refresh]);

  const summary = useMemo(() => summarizeBuckets(buckets), [buckets]);

  const loadMore = useCallback(async () => {
    if (!connected || recordsLoading || !hasMore) return;
    setRecordsLoading(true);
    try {
      const page = await usageStatsApi.records({
        from: query.from,
        to: query.to,
        limit: 50,
        offset,
      });
      setRecords((current) => [...current, ...(page.records ?? [])]);
      setHasMore(Boolean(page.has_more));
      setOffset(page.next_offset ?? offset + (page.records?.length ?? 0));
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : t('usage.load_error'));
    } finally {
      setRecordsLoading(false);
    }
  }, [connected, hasMore, offset, query.from, query.to, recordsLoading, t]);

  const rangeLabel = (value: UsageRange) => t(`usage.range_${value}`);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{t('usage.eyebrow')}</p>
          <h1>{t('usage.title')}</h1>
          <p className={styles.description}>{t('usage.description')}</p>
        </div>
        <Button type="button" variant="secondary" size="sm" loading={loading} onClick={() => void refresh()}>
          {t('usage.refresh')}
        </Button>
      </header>

      <div className={styles.toolbar} role="group" aria-label={t('usage.range_label')}>
        <div className={styles.segmented}>
          {USAGE_RANGES.map((value) => (
            <button
              key={value}
              type="button"
              className={value === range ? styles.segmentActive : styles.segment}
              onClick={() => setRange(value)}
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
      </div>

      {!connected && <EmptyState title={t('usage.disconnected')} description={t('usage.disconnected_hint')} />}
      {error && <div className={styles.errorBanner}>{error}</div>}

      {connected && (
        <>
          <section className={styles.kpiGrid} aria-label={t('usage.summary')}>
            <Kpi label={t('usage.total_tokens')} value={formatTokenCount(summary.totalTokens)} />
            <Kpi label={t('usage.input')} value={formatTokenCount(summary.inputTokens)} />
            <Kpi label={t('usage.output')} value={formatTokenCount(summary.outputTokens)} />
            <Kpi label={t('usage.requests')} value={formatTokenCount(summary.requests)} />
            <Kpi label={t('usage.error_rate')} value={`${summary.errorRate.toFixed(1)}%`} />
          </section>

          <Card title={t('usage.trend_title')} extra={<span className={styles.cardMeta}>{t(`usage.step_${query.step}`)}</span>}>
            <UsageTrendChart buckets={buckets} metric={metric} step={query.step} />
          </Card>

          <Card title={t('usage.records_title')} extra={<span className={styles.cardMeta}>{records.length.toLocaleString()}</span>}>
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.kpi}>
      <span className={styles.kpiLabel}>{label}</span>
      <strong className={styles.kpiValue}>{value}</strong>
    </div>
  );
}
