/**
 * Usage Statistics page — token usage and cost analytics.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { IconRefreshCw } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { usageStatisticsApi } from '@/services/api/usageStatistics';
import type {
  GroupByValue,
  SummaryRow,
  UsageStatisticsSummaryResponse,
  CostSummary,
} from '@/types/usageStatistics';
import { formatCost, formatTokens } from '@/types/usageStatistics';
import styles from './UsageStatisticsPage.module.scss';

// ─── Date helpers ──────────────────────────────────────────────────────────────

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function todayDate(): string {
  return toDateStr(new Date());
}

function daysAgoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days + 1);
  return toDateStr(d);
}

type PresetKey = 'today' | '7d' | '30d';

interface PresetConfig {
  labelKey: string;
  from: () => string;
  to: () => string;
}

const PRESETS: Record<PresetKey, PresetConfig> = {
  today: { labelKey: 'usage_statistics.preset_today', from: todayDate, to: todayDate },
  '7d': { labelKey: 'usage_statistics.preset_7d', from: () => daysAgoDate(7), to: todayDate },
  '30d': { labelKey: 'usage_statistics.preset_30d', from: () => daysAgoDate(30), to: todayDate },
};

const GROUP_BY_OPTIONS: { value: GroupByValue; labelKey: string }[] = [
  { value: 'day', labelKey: 'usage_statistics.group_by_day' },
  { value: 'provider', labelKey: 'usage_statistics.group_by_provider' },
  { value: 'model', labelKey: 'usage_statistics.group_by_model' },
  { value: 'api_key', labelKey: 'usage_statistics.group_by_api_key' },
  { value: 'auth', labelKey: 'usage_statistics.group_by_auth' },
  { value: 'call_type', labelKey: 'usage_statistics.group_by_call_type' },
];

// ─── Formatting helpers ────────────────────────────────────────────────────────

function formatUnknownCell(cost: CostSummary): string {
  return cost.unknown_requests > 0 ? String(cost.unknown_requests) : '-';
}

function formatLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── Summary card component ───────────────────────────────────────────────────

interface SummaryCardProps {
  label: string;
  value: string;
  sublabel?: string;
}

function SummaryCard({ label, value, sublabel }: SummaryCardProps) {
  return (
    <div className={styles.summaryCard}>
      <span className={styles.summaryValue}>{value}</span>
      <span className={styles.summaryLabel}>{label}</span>
      {sublabel && <span className={styles.summarySublabel}>{sublabel}</span>}
    </div>
  );
}

// ─── Main page component ──────────────────────────────────────────────────────

export function UsageStatisticsPage() {
  const { t } = useTranslation();

  // Filter state
  const [activePreset, setActivePreset] = useState<PresetKey | null>('today');
  const [from, setFrom] = useState(todayDate());
  const [to, setTo] = useState(todayDate());
  const [groupBy, setGroupBy] = useState<GroupByValue>('day');

  // Data state
  const [data, setData] = useState<UsageStatisticsSummaryResponse | null>(null);
  const [, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const result = await usageStatisticsApi.getSummary({
        from,
        to,
        group_by: groupBy,
        recent_limit: 100,
      });
      setData(result);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[UsageStatistics] fetch failed:', msg);
      setError(t('usage_statistics.error_description'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [from, to, groupBy, t]);

  // Fetch on mount and filter change
  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Header refresh support
  useHeaderRefresh(fetchData);

  // Preset handlers
  const handlePreset = useCallback((key: PresetKey) => {
    const config = PRESETS[key];
    setFrom(config.from());
    setTo(config.to());
    setActivePreset(key);
  }, []);

  // Manual date change → deselect preset
  const handleFromChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setFrom(e.target.value);
    setActivePreset(null);
  }, []);

  const handleToChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTo(e.target.value);
    setActivePreset(null);
  }, []);

  // ─── Group table column definitions ──────────────────────────────────────

  const groupColumns = useMemo(() => {
    const cols: { key: string; label: string; render: (row: SummaryRow) => React.ReactNode }[] = [];

    // Key column
    const keyLabel =
      groupBy === 'day'
        ? t('usage_statistics.col_date')
        : groupBy === 'provider'
          ? t('usage_statistics.col_provider')
          : groupBy === 'model'
            ? t('usage_statistics.col_model')
            : groupBy === 'api_key'
              ? t('usage_statistics.col_key_id')
              : t('usage_statistics.col_auth');

    cols.push({
      key: 'key',
      label: keyLabel,
      render: (row) => (
        <span className={styles.cellKey} title={row.key}>
          {row.key}
        </span>
      ),
    });

    cols.push({
      key: 'requests',
      label: t('usage_statistics.col_requests'),
      render: (row) => formatTokens(row.requests),
    });

    cols.push({
      key: 'success',
      label: t('usage_statistics.col_success'),
      render: (row) => formatTokens(row.success),
    });

    cols.push({
      key: 'failed',
      label: t('usage_statistics.col_failed'),
      render: (row) => formatTokens(row.failed),
    });

    // Tokens columns
    if (groupBy === 'day' || groupBy === 'model') {
      cols.push({
        key: 'input_tokens',
        label: t('usage_statistics.col_input_tokens'),
        render: (row) => formatTokens(row.tokens.input_tokens),
      });
      cols.push({
        key: 'output_tokens',
        label: t('usage_statistics.col_output_tokens'),
        render: (row) => formatTokens(row.tokens.output_tokens),
      });
    }

    cols.push({
      key: 'total_tokens',
      label: t('usage_statistics.col_total_tokens'),
      render: (row) => formatTokens(row.tokens.total_tokens),
    });

    cols.push({
      key: 'cost',
      label: t('usage_statistics.col_cost'),
      render: (row) => formatCost(row.cost),
    });

    cols.push({
      key: 'unknown',
      label: t('usage_statistics.col_unknown'),
      render: (row) => formatUnknownCell(row.cost),
    });

    return cols;
  }, [groupBy, t]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('usage_statistics.title')}</h1>
        <p className={styles.description}>{t('usage_statistics.description')}</p>
      </div>

      {/* Filter bar */}
      <div className={styles.filterBar}>
        <div className={styles.presetRow}>
          {(Object.keys(PRESETS) as PresetKey[]).map((key) => (
            <button
              key={key}
              type="button"
              className={`${styles.presetButton} ${activePreset === key ? styles.presetButtonActive : ''}`}
              onClick={() => handlePreset(key)}
            >
              {t(PRESETS[key].labelKey)}
            </button>
          ))}
        </div>

        <div className={styles.dateRow}>
          <label className={styles.dateField}>
            <span className={styles.dateLabel}>{t('usage_statistics.from_label')}</span>
            <input
              type="date"
              value={from}
              onChange={handleFromChange}
              className={styles.dateInput}
            />
          </label>
          <label className={styles.dateField}>
            <span className={styles.dateLabel}>{t('usage_statistics.to_label')}</span>
            <input
              type="date"
              value={to}
              onChange={handleToChange}
              className={styles.dateInput}
            />
          </label>
        </div>

        <div className={styles.groupByRow}>
          <span className={styles.groupByLabel}>{t('usage_statistics.group_by_label')}</span>
          <div className={styles.groupByButtons}>
            {GROUP_BY_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`${styles.groupButton} ${groupBy === opt.value ? styles.groupButtonActive : ''}`}
                onClick={() => setGroupBy(opt.value)}
              >
                {t(opt.labelKey)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className={styles.errorBox}>
          <span className={styles.errorText}>{t('usage_statistics.error_title')}</span>
          <span className={styles.errorDetail}>{error}</span>
          <Button size="sm" onClick={fetchData}>
            <IconRefreshCw size={14} />
            {t('usage_statistics.retry_button')}
          </Button>
        </div>
      )}

      {/* Summary cards */}
      {data?.summary && !error && (
        <div className={styles.summaryRow}>
          <SummaryCard
            label={t('usage_statistics.summary_requests')}
            value={formatTokens(data.summary.requests)}
          />
          <SummaryCard
            label={t('usage_statistics.summary_success_fail')}
            value={`${formatTokens(data.summary.success)} / ${formatTokens(data.summary.failed)}`}
          />
          <SummaryCard
            label={t('usage_statistics.summary_tokens')}
            value={formatTokens(data.summary.tokens.total_tokens)}
          />
          <SummaryCard
            label={t('usage_statistics.summary_cost')}
            value={formatCost(data.summary.cost)}
            sublabel={
              !data.summary.cost.known && data.summary.cost.unknown_requests > 0
                ? t('usage_statistics.summary_unknown_hint', { count: data.summary.cost.unknown_requests })
                : undefined
            }
          />
        </div>
      )}

      {/* Group table */}
      {data?.groups && !error && (
        <div className={styles.tableSection}>
          <Table>
            <TableHeader>
              <TableRow>
                {groupColumns.map((col) => (
                  <TableHead key={col.key}>{col.label}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.groups.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={groupColumns.length}>
                    <EmptyState
                      title={t('usage_statistics.empty_title')}
                      description={t('usage_statistics.empty_desc')}
                    />
                  </TableCell>
                </TableRow>
              ) : (
                data.groups.map((row, i) => (
                  <TableRow key={`${row.key}-${i}`}>
                    {groupColumns.map((col) => (
                      <TableCell key={col.key}>{col.render(row)}</TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Recent records */}
      {data?.recent && data.recent.length > 0 && !error && (
        <div className={styles.tableSection}>
          <h3 className={styles.sectionHeading}>{t('usage_statistics.recent_title')}</h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('usage_statistics.col_time')}</TableHead>
                <TableHead>{t('usage_statistics.col_request_id')}</TableHead>
                <TableHead>{t('usage_statistics.col_provider')}</TableHead>
                <TableHead>{t('usage_statistics.col_model')}</TableHead>
                <TableHead>{t('usage_statistics.col_status')}</TableHead>
                <TableHead>{t('usage_statistics.col_total_tokens')}</TableHead>
                <TableHead>{t('usage_statistics.col_cost')}</TableHead>
                <TableHead>{t('usage_statistics.col_key_id')}</TableHead>
                <TableHead>{t('usage_statistics.col_latency')}</TableHead>
                <TableHead>{t('usage_statistics.col_error')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.recent.map((rec) => (
                <TableRow key={rec.request_id}>
                  <TableCell>
                    <span className={styles.cellMono}>
                      {new Date(rec.time).toLocaleString()}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={styles.cellMono} title={rec.request_id}>
                      {rec.request_id.slice(0, 8)}
                    </span>
                  </TableCell>
                  <TableCell>{rec.provider}</TableCell>
                  <TableCell>
                    <span className={styles.cellModel} title={rec.model}>
                      {rec.model}
                    </span>
                  </TableCell>
                  <TableCell>
                    <span className={`${styles.statusCode} ${rec.failed ? styles.statusFailed : styles.statusOk}`}>
                      {rec.status_code}
                    </span>
                  </TableCell>
                  <TableCell>{formatTokens(rec.tokens.total_tokens)}</TableCell>
                  <TableCell>{formatCost(rec.cost)}</TableCell>
                  <TableCell>
                    <span className={styles.cellMono} title={rec.api_key_id}>
                      {rec.api_key_id}
                    </span>
                  </TableCell>
                  <TableCell>{formatLatency(rec.latency_ms)}</TableCell>
                  <TableCell>
                    <span className={styles.cellMono}>
                      {rec.error_type || '-'}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

    </div>
  );
}
