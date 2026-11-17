import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  IconAlertTriangle,
  IconChevronDown,
  IconDollarSign,
  IconModelCluster,
  IconNetwork,
} from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { Sparkline } from '@/features/dashboard/components/Sparkline';
import {
  API_KEY_STATS_WINDOWS,
  aggregateModelUsage,
  apiKeyPolicyUsageApi,
  mergeAccounts,
  mergeDims,
  type ApiKeyAccountUsage,
  type ApiKeyRequestEntry,
  type ApiKeyDimUsage,
  type ApiKeyModelUsage,
  type ApiKeyPolicyUsage,
  type ApiKeyStatsWindow,
  type ApiKeyWindowUsage,
} from '@/services/api/apiKeyPolicyUsage';
import { formatCompactNumber, formatDateTimeValue, maskApiKey } from '@/utils/format';
import { Donut } from './components/Donut';
import { RequestLog } from './components/RequestLog';
import { SeriesLegend, TrendChart, type SeriesInfo } from './components/TrendChart';
import {
  OTHER_SERIES,
  TOTAL_TREND_DAYS,
  buildTrend,
  keyColorSlots,
  metricValue,
  modelColorSlots,
  seriesOf,
  serverCalendar,
  sumTotals,
  toShareRows,
  trendPoints,
  type UsageMetric,
} from './usageModel';
import styles from './UsagePage.module.scss';

const PREFIX = 'usage_page';
const ALL_KEYS = '__all__';
const METRICS: UsageMetric[] = ['tokens', 'requests', 'cost'];

const formatCost = (value: number) =>
  value <= 0
    ? '$0'
    : `$${value < 0.01 ? value.toFixed(4) : value < 100 ? value.toFixed(2) : Math.round(value).toLocaleString()}`;
const formatTokens = (value: number) => (value > 0 ? formatCompactNumber(value) : '0');
const formatCount = (value: number) => (value > 0 ? formatCompactNumber(value) : '0');
const formatPct = (value: number) => `${(value * 100).toFixed(value > 0 && value < 0.1 ? 2 : 1)}%`;

const slotColor = (slot: number | undefined) =>
  slot === undefined ? 'var(--series-other)' : `var(--series-${slot + 1})`;

interface KpiCardProps {
  label: string;
  value: string;
  sub: ReactNode;
  icon: ReactNode;
  tone: 'blue' | 'violet' | 'green' | 'amber';
  points: number[];
  ariaLabel: string;
}

function KpiCard({ label, value, sub, icon, tone, points, ariaLabel }: KpiCardProps) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiHead}>
        <span className={styles.kpiLabel}>{label}</span>
        <span className={`${styles.kpiIcon} ${styles[`tone_${tone}`]}`} aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className={styles.kpiValue}>{value}</div>
      <div className={styles.kpiSub}>{sub}</div>
      <Sparkline
        className={styles.kpiSpark}
        points={points}
        color={`var(--kpi-${tone})`}
        ariaLabel={ariaLabel}
      />
    </div>
  );
}

const REJECT_REASONS = ['api_key_disabled', 'api_key_expired', 'api_key_quota_exceeded'];

function KeyStatusBadge({ entry }: { entry: ApiKeyPolicyUsage }) {
  const { t } = useTranslation();
  if (entry.disabled) return <span className={styles.badgeBad}>{t(`${PREFIX}.disabled`)}</span>;
  if (entry.expired) return <span className={styles.badgeBad}>{t(`${PREFIX}.expired`)}</span>;
  return <span className={styles.badgeOk}>{t(`${PREFIX}.active`)}</span>;
}

/** Requests the key policy refused in this period, by reason, with the latest attempt. */
function RejectedNotice({ usage }: { usage: ApiKeyWindowUsage }) {
  const { t, i18n } = useTranslation();
  const reasons = Object.entries(usage.rejectedReasons).sort((a, b) => b[1] - a[1]);
  return (
    <div className={styles.rejected} role="note">
      <IconAlertTriangle size={16} aria-hidden="true" />
      <div>
        <strong>{t(`${PREFIX}.rejected_title`, { count: usage.rejected })}</strong>
        <div className={styles.rejectedDetail}>
          {reasons
            .map(
              ([reason, count]) =>
                `${t(
                  `${PREFIX}.reason_${REJECT_REASONS.includes(reason) ? reason : 'other'}`
                )}: ${count}`
            )
            .join(' · ')}
          {usage.lastRejectedAt && (
            <>
              {reasons.length > 0 ? ' · ' : ''}
              {t(`${PREFIX}.rejected_last`, {
                time: formatDateTimeValue(usage.lastRejectedAt, i18n.resolvedLanguage),
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const EFFORT_SLOTS: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
  xhigh: 3,
  minimal: 4,
  max: 5,
  none: 6,
};
const TIER_SLOTS: Record<string, number> = {
  standard: 0,
  priority: 1,
  flex: 2,
  fast: 3,
  auto: 4,
  scale: 5,
  batch: 6,
};
const effortColor = (name: string) => slotColor(EFFORT_SLOTS[name]);
const tierColor = (name: string) => slotColor(TIER_SLOTS[name]);

const formatDuration = (ms: number) => {
  if (ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
};
const avg = (sum: number, count: number) => (count > 0 ? sum / count : 0);

function useDimLabel() {
  const { t } = useTranslation();
  return (name: string) =>
    name === 'default'
      ? t(`${PREFIX}.dim_default`)
      : name === 'other'
        ? t(`${PREFIX}.dim_other`)
        : name;
}

function DimTable({
  title,
  rows,
  colorOf,
}: {
  title: string;
  rows: ApiKeyDimUsage[];
  colorOf: (name: string) => string;
}) {
  const { t } = useTranslation();
  const label = useDimLabel();
  const total = rows.reduce((sum, row) => sum + row.requests, 0);
  return (
    <div className={styles.dimBlock}>
      <h4 className={styles.dimTitle}>{title}</h4>
      <table className={styles.dimTable}>
        <thead>
          <tr>
            <th>{title}</th>
            <th>{t(`${PREFIX}.col_requests`)}</th>
            <th>{t(`${PREFIX}.col_share`)}</th>
            <th>{t(`${PREFIX}.col_error_rate`)}</th>
            <th>{t(`${PREFIX}.col_total`)}</th>
            <th>{t(`${PREFIX}.col_reasoning`)}</th>
            <th>{t(`${PREFIX}.col_latency`)}</th>
            <th>{t(`${PREFIX}.col_cost`)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const share = total > 0 ? row.requests / total : 0;
            return (
              <tr key={row.name}>
                <td>
                  <span className={styles.dot} style={{ background: colorOf(row.name) }} />
                  {label(row.name)}
                </td>
                <td>{row.requests.toLocaleString()}</td>
                <td>
                  <span className={styles.shareCell}>
                    <span className={styles.shareTrack}>
                      <span
                        className={styles.shareFill}
                        style={{ width: `${share * 100}%`, background: colorOf(row.name) }}
                      />
                    </span>
                    {formatPct(share)}
                  </span>
                </td>
                <td className={row.failed > 0 ? styles.bad : styles.muted}>
                  {row.requests > 0 ? formatPct(row.failed / row.requests) : '—'}
                </td>
                <td title={row.tokens.toLocaleString()}>{formatTokens(row.tokens)}</td>
                <td title={row.reasoningTokens.toLocaleString()}>
                  {formatTokens(row.reasoningTokens)}
                </td>
                <td>{formatDuration(avg(row.latencyMs, row.latencyCount))}</td>
                <td>{row.cost > 0 ? formatCost(row.cost) : '—'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ModelDetail({ row }: { row: ApiKeyModelUsage }) {
  const { t } = useTranslation();
  const stats = [
    [t(`${PREFIX}.detail_avg_latency`), formatDuration(avg(row.latencyMs, row.latencyCount))],
    [t(`${PREFIX}.detail_ttft`), formatDuration(avg(row.ttftMs, row.ttftCount))],
    [
      t(`${PREFIX}.detail_stream`),
      row.requests > 0 ? formatPct(Math.min(row.streamed / row.requests, 1)) : '—',
    ],
    [t(`${PREFIX}.detail_reasoning`), formatTokens(row.reasoningTokens)],
    [
      t(`${PREFIX}.detail_reasoning_share`),
      row.outputTokens > 0 ? formatPct(Math.min(row.reasoningTokens / row.outputTokens, 1)) : '—',
    ],
    [t(`${PREFIX}.detail_cache_write`), formatTokens(row.cacheWriteTokens)],
    [
      t(`${PREFIX}.detail_tokens_per_request`),
      row.requests > 0 ? formatTokens(row.tokens / row.requests) : '—',
    ],
  ];
  return (
    <div className={styles.detail}>
      <dl className={styles.detailStats}>
        {stats.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {row.efforts.length === 0 && row.tiers.length === 0 ? (
        <p className={styles.mutedText}>{t(`${PREFIX}.no_dim_data`)}</p>
      ) : (
        <div className={styles.dimGrid}>
          {row.efforts.length > 0 && (
            <DimTable
              title={t(`${PREFIX}.effort_title`)}
              rows={row.efforts}
              colorOf={effortColor}
            />
          )}
          {row.tiers.length > 0 && (
            <DimTable title={t(`${PREFIX}.tier_title`)} rows={row.tiers} colorOf={tierColor} />
          )}
        </div>
      )}
    </div>
  );
}

const MODEL_COLUMNS = 12;

function ModelTable({
  rows,
  colorOf,
}: {
  rows: ApiKeyModelUsage[];
  colorOf: (m: string) => string;
}) {
  const { t } = useTranslation();
  const label = useDimLabel();
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (model: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(model)) next.add(model);
      return next;
    });
  const totalTokens = rows.reduce((sum, row) => sum + row.tokens, 0);
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead aria-label={t(`${PREFIX}.details`)} />
          <TableHead>{t(`${PREFIX}.col_model`)}</TableHead>
          <TableHead>{t(`${PREFIX}.col_effort`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_requests`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_error_rate`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_latency`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_input`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_cached`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_output`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_total`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_share`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_cost`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const share = totalTokens > 0 ? row.tokens / totalTokens : 0;
          const expanded = open.has(row.model);
          return (
            <Fragment key={row.model}>
              <TableRow>
                <TableCell>
                  <button
                    type="button"
                    className={`${styles.expand} ${expanded ? styles.expandOpen : ''}`}
                    aria-expanded={expanded}
                    aria-label={t(`${PREFIX}.toggle_details`, { model: row.model })}
                    onClick={() => toggle(row.model)}
                  >
                    <IconChevronDown size={16} />
                  </button>
                </TableCell>
                <TableCell className={styles.model}>
                  <span className={styles.dot} style={{ background: colorOf(row.model) }} />
                  {row.model}
                </TableCell>
                <TableCell>
                  <span className={styles.chips}>
                    {row.efforts.length === 0 ? (
                      <span className={styles.muted}>—</span>
                    ) : (
                      row.efforts.slice(0, 3).map((effort) => (
                        <span key={effort.name} className={styles.chip}>
                          <span
                            className={styles.chipDot}
                            style={{ background: effortColor(effort.name) }}
                          />
                          {label(effort.name)}
                          <strong>{effort.requests.toLocaleString()}</strong>
                        </span>
                      ))
                    )}
                    {row.efforts.length > 3 && (
                      <span className={styles.chip}>+{row.efforts.length - 3}</span>
                    )}
                  </span>
                </TableCell>
                <TableCell alignRight className={styles.num}>
                  {row.requests.toLocaleString()}
                </TableCell>
                <TableCell
                  alignRight
                  className={`${styles.num} ${row.failed > 0 ? styles.bad : styles.muted}`}
                  title={t(`${PREFIX}.failed_hint`, { count: row.failed })}
                >
                  {row.requests > 0 ? formatPct(row.failed / row.requests) : '—'}
                </TableCell>
                <TableCell alignRight className={styles.num}>
                  {formatDuration(avg(row.latencyMs, row.latencyCount))}
                </TableCell>
                <TableCell
                  alignRight
                  className={styles.num}
                  title={row.inputTokens.toLocaleString()}
                >
                  {formatTokens(row.inputTokens)}
                </TableCell>
                <TableCell
                  alignRight
                  className={styles.num}
                  title={row.cachedTokens.toLocaleString()}
                >
                  {formatTokens(row.cachedTokens)}
                </TableCell>
                <TableCell
                  alignRight
                  className={styles.num}
                  title={row.outputTokens.toLocaleString()}
                >
                  {formatTokens(row.outputTokens)}
                </TableCell>
                <TableCell alignRight className={styles.num} title={row.tokens.toLocaleString()}>
                  <strong>{formatTokens(row.tokens)}</strong>
                </TableCell>
                <TableCell alignRight className={styles.num}>
                  <span className={styles.shareCell}>
                    <span className={styles.shareTrack}>
                      <span
                        className={styles.shareFill}
                        style={{ width: `${share * 100}%`, background: colorOf(row.model) }}
                      />
                    </span>
                    {formatPct(share)}
                  </span>
                </TableCell>
                <TableCell alignRight className={styles.num}>
                  {row.cost > 0 ? formatCost(row.cost) : '—'}
                </TableCell>
              </TableRow>
              {expanded && (
                <TableRow>
                  <TableCell colSpan={MODEL_COLUMNS} className={styles.detailCell}>
                    <ModelDetail row={row} />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function UsagePage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || 'en';
  const [period, setPeriod] = useState<ApiKeyStatsWindow>('day');
  const [selectedKey, setSelectedKey] = useState<string>(ALL_KEYS);
  const [metric, setMetric] = useState<UsageMetric>('tokens');
  const [entries, setEntries] = useState<ApiKeyPolicyUsage[]>([]);
  const [requestLog, setRequestLog] = useState<ApiKeyRequestEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [usage, requests] = await Promise.all([
        apiKeyPolicyUsageApi.list(),
        // Older backends have no request log; the page still works without it.
        apiKeyPolicyUsageApi.requests().catch(() => null),
      ]);
      setEntries(usage);
      setRequestLog(requests);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useHeaderRefresh(load);

  const keyLabel = useCallback(
    (entry: ApiKeyPolicyUsage) => entry.name || maskApiKey(entry.key),
    []
  );
  const effectiveKey = entries.some((e) => e.key === selectedKey) ? selectedKey : ALL_KEYS;
  const scoped = useMemo(
    () => (effectiveKey === ALL_KEYS ? entries : entries.filter((e) => e.key === effectiveKey)),
    [entries, effectiveKey]
  );

  // Colors follow the entity across every filter, so they come from all keys.
  const modelSlots = useMemo(() => modelColorSlots(entries), [entries]);
  const keySlots = useMemo(() => keyColorSlots(entries), [entries]);
  const modelColor = useCallback(
    (model: string) => slotColor(model === OTHER_SERIES ? undefined : modelSlots.get(model)),
    [modelSlots]
  );
  const keyColor = useCallback((key: string) => slotColor(keySlots.get(key)), [keySlots]);

  const calendar = useMemo(() => serverCalendar(entries), [entries]);
  const trend = useCallback(
    (m: Parameters<typeof buildTrend>[4]) =>
      calendar ? buildTrend(scoped, period, calendar, modelSlots, m, locale) : [],
    [calendar, scoped, period, modelSlots, locale]
  );
  const trendSlots = useMemo(() => trend(metric), [trend, metric]);
  const spark = useMemo(() => {
    const requests = trendPoints(trend('requests'));
    const failed = trendPoints(trend('failed'));
    return {
      requests,
      tokens: trendPoints(trend('tokens')),
      cost: trendPoints(trend('cost')),
      errorRate: requests.map((r, i) => (r > 0 ? (failed[i] ?? 0) / r : 0)),
    };
  }, [trend]);

  const totals = useMemo(() => sumTotals(scoped, period), [scoped, period]);
  const models = useMemo(() => aggregateModelUsage(scoped, period), [scoped, period]);
  const elapsedSlots = Math.max(1, trendSlots.filter((s) => !s.future).length);
  const errorRate = totals.requests > 0 ? totals.failed / totals.requests : 0;
  const cacheShare = totals.inputTokens > 0 ? totals.cachedTokens / totals.inputTokens : 0;
  const perSlot = period === 'day' ? t(`${PREFIX}.per_hour`) : t(`${PREFIX}.per_day`);
  const topErrorModel = [...models].sort((a, b) => b.failed - a.failed)[0];

  const formatMetric = useCallback(
    (value: number) =>
      metric === 'cost'
        ? formatCost(value)
        : metric === 'tokens'
          ? formatTokens(value)
          : formatCount(value),
    [metric]
  );
  const metricName = t(`${PREFIX}.metric_${metric}`);
  const periodName = t(`${PREFIX}.window_${period}`);

  const modelRows = useMemo(() => {
    const folded = new Map<string, number>();
    for (const row of models) {
      const id = seriesOf(row.model, modelSlots);
      folded.set(id, (folded.get(id) ?? 0) + metricValue(row, metric));
    }
    return toShareRows(
      [...folded.entries()].map(([id, value]) => ({
        id,
        label: id === OTHER_SERIES ? t(`${PREFIX}.other_models`) : id,
        value,
      }))
    );
  }, [models, modelSlots, metric, t]);

  const keyRows = useMemo(
    () =>
      toShareRows(
        entries.map((entry) => ({
          id: entry.key,
          label: keyLabel(entry),
          value:
            metric === 'cost'
              ? entry.usage[period].cost
              : metric === 'tokens'
                ? entry.usage[period].tokens
                : entry.usage[period].requests,
        }))
      ),
    [entries, period, metric, keyLabel]
  );

  // Account colors follow all-time token rank across every key, like model colors.
  const accountSlots = useMemo(() => {
    const all = entries.reduce<ApiKeyAccountUsage[]>(
      (acc, entry) => mergeAccounts(acc, entry.usage.total.accounts),
      []
    );
    const ranked = [...all].sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
    return new Map(ranked.slice(0, 7).map((row, index) => [row.id, index]));
  }, [entries]);
  const accountColor = useCallback((id: string) => slotColor(accountSlots.get(id)), [accountSlots]);
  const accountRows = useMemo(
    () =>
      toShareRows(
        scoped
          .reduce<ApiKeyAccountUsage[]>(
            (acc, entry) => mergeAccounts(acc, entry.usage[period].accounts),
            []
          )
          .map((row) => ({
            id: row.id,
            label: row.plan ? `${row.name} · ${row.plan}` : row.name,
            value: metric === 'cost' ? row.cost : metric === 'tokens' ? row.tokens : row.requests,
          }))
      ),
    [scoped, period, metric]
  );
  const keySummary = useMemo(() => {
    const lifetime = sumTotals(entries, 'total');
    return [
      [t(`${PREFIX}.sum_keys`), String(entries.length)],
      [t(`${PREFIX}.sum_active`), String(entries.filter((e) => !e.disabled && !e.expired).length)],
      [t(`${PREFIX}.sum_disabled`), String(entries.filter((e) => e.disabled).length)],
      [t(`${PREFIX}.sum_expired`), String(entries.filter((e) => e.expired).length)],
      [
        t(`${PREFIX}.sum_used`, { period: periodName }),
        String(entries.filter((e) => e.usage[period].requests > 0).length),
      ],
      [t(`${PREFIX}.sum_lifetime_requests`), formatCount(lifetime.requests)],
      [t(`${PREFIX}.sum_lifetime_tokens`), formatTokens(lifetime.tokens)],
      [t(`${PREFIX}.sum_lifetime_cost`), formatCost(lifetime.cost)],
      [t(`${PREFIX}.sum_rejected`), formatCount(lifetime.rejected)],
    ];
  }, [entries, period, periodName, t]);

  const dimLabel = useDimLabel();
  const dimRows = useCallback(
    (pick: (row: ApiKeyModelUsage) => ApiKeyDimUsage[]) =>
      toShareRows(
        models
          .reduce<ApiKeyDimUsage[]>((acc, row) => mergeDims(acc, pick(row)), [])
          .map((dim) => ({
            id: dim.name,
            label: dimLabel(dim.name),
            value: metric === 'cost' ? dim.cost : metric === 'tokens' ? dim.tokens : dim.requests,
          }))
      ),
    [models, metric, dimLabel]
  );
  const effortRows = useMemo(() => dimRows((row) => row.efforts), [dimRows]);
  const tierRows = useMemo(() => dimRows((row) => row.tiers), [dimRows]);

  const compositionRows = useMemo(
    () =>
      toShareRows([
        {
          id: 'input',
          label: t(`${PREFIX}.part_input`),
          value: Math.max(totals.inputTokens - totals.cachedTokens - totals.cacheWriteTokens, 0),
        },
        { id: 'cached', label: t(`${PREFIX}.part_cached`), value: totals.cachedTokens },
        {
          id: 'cache_write',
          label: t(`${PREFIX}.part_cache_write`),
          value: totals.cacheWriteTokens,
        },
        { id: 'output', label: t(`${PREFIX}.part_output`), value: totals.outputTokens },
      ]),
    [totals, t]
  );
  const compositionColor = (id: string) =>
    slotColor({ input: 0, cached: 2, cache_write: 3 }[id] ?? 1);

  const trendSeries: SeriesInfo[] = useMemo(() => {
    const present = new Set<string>();
    trendSlots.forEach((slot) => slot.values.forEach((_, id) => present.add(id)));
    return [...present]
      .sort((a, b) => (modelSlots.get(a) ?? 99) - (modelSlots.get(b) ?? 99))
      .map((id) => ({
        id,
        label: id === OTHER_SERIES ? t(`${PREFIX}.other_models`) : id,
        color: modelColor(id),
      }));
  }, [trendSlots, modelSlots, modelColor, t]);

  const keyOptions = useMemo(
    () => [
      { value: ALL_KEYS, label: t(`${PREFIX}.all_keys`) },
      ...entries.map((entry) => ({
        value: entry.key,
        label: [
          entry.name ? `${entry.name} (${maskApiKey(entry.key)})` : maskApiKey(entry.key),
          entry.disabled ? t(`${PREFIX}.disabled`) : entry.expired ? t(`${PREFIX}.expired`) : '',
        ]
          .filter(Boolean)
          .join(' · '),
      })),
    ],
    [entries, t]
  );

  const trendRange =
    period === 'day'
      ? t(`${PREFIX}.range_hourly`)
      : period === 'total'
        ? t(`${PREFIX}.range_last_days`, { count: TOTAL_TREND_DAYS })
        : t(`${PREFIX}.range_daily`);

  const selectKey = (key: string) => {
    setSelectedKey(key);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!loading && !error && entries.length === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.title}>{t(`${PREFIX}.title`)}</h1>
        <EmptyState title={t(`${PREFIX}.no_keys`)} description={t(`${PREFIX}.no_keys_hint`)} />
      </div>
    );
  }

  return (
    <div className={`${styles.page} ${loading && entries.length > 0 ? styles.refreshing : ''}`}>
      <div className={styles.header}>
        <h1 className={styles.title}>{t(`${PREFIX}.title`)}</h1>
        <p className={styles.subtitle}>{t(`${PREFIX}.subtitle`)}</p>
      </div>

      <div className={styles.filters}>
        <div className={styles.segmented} role="tablist" aria-label={t(`${PREFIX}.window_label`)}>
          {API_KEY_STATS_WINDOWS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={period === id}
              className={`${styles.segment} ${period === id ? styles.segmentActive : ''}`}
              onClick={() => setPeriod(id)}
            >
              {t(`${PREFIX}.window_${id}`)}
            </button>
          ))}
        </div>
        <div className={styles.keySelect}>
          <Select
            value={effectiveKey}
            options={keyOptions}
            onChange={setSelectedKey}
            ariaLabel={t(`${PREFIX}.key_filter`)}
            size="sm"
          />
        </div>
        <div className={styles.segmented} role="tablist" aria-label={t(`${PREFIX}.metric_label`)}>
          {METRICS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={metric === id}
              className={`${styles.segment} ${metric === id ? styles.segmentActive : ''}`}
              onClick={() => setMetric(id)}
            >
              {t(`${PREFIX}.metric_${id}`)}
            </button>
          ))}
        </div>
      </div>

      {error && <div className={styles.error}>{t(`${PREFIX}.load_failed`, { error })}</div>}

      <div className={styles.kpis}>
        <KpiCard
          tone="blue"
          icon={<IconNetwork size={18} />}
          label={t(`${PREFIX}.kpi_requests`, { period: periodName })}
          value={formatCount(totals.requests)}
          sub={t(`${PREFIX}.kpi_avg`, {
            unit: perSlot,
            value: formatCount(totals.requests / elapsedSlots),
          })}
          points={spark.requests}
          ariaLabel={t(`${PREFIX}.kpi_requests`, { period: periodName })}
        />
        <KpiCard
          tone="violet"
          icon={<IconModelCluster size={18} />}
          label={t(`${PREFIX}.kpi_tokens`, { period: periodName })}
          value={formatTokens(totals.tokens)}
          sub={t(`${PREFIX}.kpi_cached`, {
            value: formatTokens(totals.cachedTokens),
            pct: formatPct(cacheShare),
          })}
          points={spark.tokens}
          ariaLabel={t(`${PREFIX}.kpi_tokens`, { period: periodName })}
        />
        <KpiCard
          tone="green"
          icon={<IconDollarSign size={18} />}
          label={t(`${PREFIX}.kpi_cost`, { period: periodName })}
          value={formatCost(totals.cost)}
          sub={
            totals.cost > 0
              ? t(`${PREFIX}.kpi_avg`, {
                  unit: perSlot,
                  value: formatCost(totals.cost / elapsedSlots),
                })
              : t(`${PREFIX}.kpi_no_price`)
          }
          points={spark.cost}
          ariaLabel={t(`${PREFIX}.kpi_cost`, { period: periodName })}
        />
        <KpiCard
          tone="amber"
          icon={<IconAlertTriangle size={18} />}
          label={t(`${PREFIX}.kpi_error_rate`)}
          value={formatPct(errorRate)}
          sub={
            totals.rejected > 0
              ? t(`${PREFIX}.kpi_rejected`, { count: totals.rejected })
              : totals.failed > 0 && topErrorModel
                ? t(`${PREFIX}.kpi_top_error`, { count: totals.failed, model: topErrorModel.model })
                : t(`${PREFIX}.kpi_no_errors`)
          }
          points={spark.errorRate}
          ariaLabel={t(`${PREFIX}.kpi_error_rate`)}
        />
      </div>

      <div className={styles.split}>
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <h2>{t(`${PREFIX}.by_model`)}</h2>
            <span>{t(`${PREFIX}.panel_sub`, { metric: metricName, period: periodName })}</span>
          </header>
          <Donut
            rows={modelRows}
            colorOf={modelColor}
            format={formatMetric}
            centerLabel={metricName}
            centerValue={formatMetric(modelRows.reduce((sum, r) => sum + r.value, 0))}
            emptyText={t(`${PREFIX}.no_usage`)}
            ariaLabel={t(`${PREFIX}.by_model`)}
          />
        </section>

        {effectiveKey === ALL_KEYS ? (
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <h2>{t(`${PREFIX}.by_key`)}</h2>
              <span>{t(`${PREFIX}.panel_sub`, { metric: metricName, period: periodName })}</span>
            </header>
            <Donut
              rows={keyRows}
              colorOf={keyColor}
              format={formatMetric}
              centerLabel={metricName}
              centerValue={formatMetric(keyRows.reduce((sum, r) => sum + r.value, 0))}
              emptyText={t(`${PREFIX}.no_usage`)}
              ariaLabel={t(`${PREFIX}.by_key`)}
              onSelect={selectKey}
            />
          </section>
        ) : (
          <section className={styles.panel}>
            <header className={styles.panelHead}>
              <h2>{t(`${PREFIX}.composition`)}</h2>
              <span>{t(`${PREFIX}.composition_sub`, { period: periodName })}</span>
            </header>
            <Donut
              rows={compositionRows}
              colorOf={compositionColor}
              format={formatTokens}
              centerLabel={t(`${PREFIX}.metric_tokens`)}
              centerValue={formatTokens(totals.inputTokens + totals.outputTokens)}
              emptyText={t(`${PREFIX}.no_usage`)}
              ariaLabel={t(`${PREFIX}.composition`)}
            />
          </section>
        )}
      </div>

      <div className={styles.split}>
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <h2>{t(`${PREFIX}.by_effort`)}</h2>
            <span>{t(`${PREFIX}.panel_sub`, { metric: metricName, period: periodName })}</span>
          </header>
          <Donut
            rows={effortRows}
            colorOf={effortColor}
            format={formatMetric}
            centerLabel={metricName}
            centerValue={formatMetric(effortRows.reduce((sum, r) => sum + r.value, 0))}
            emptyText={t(`${PREFIX}.no_dim_data`)}
            ariaLabel={t(`${PREFIX}.by_effort`)}
          />
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <h2>{t(`${PREFIX}.by_tier`)}</h2>
            <span>{t(`${PREFIX}.panel_sub`, { metric: metricName, period: periodName })}</span>
          </header>
          <Donut
            rows={tierRows}
            colorOf={tierColor}
            format={formatMetric}
            centerLabel={metricName}
            centerValue={formatMetric(tierRows.reduce((sum, r) => sum + r.value, 0))}
            emptyText={t(`${PREFIX}.no_dim_data`)}
            ariaLabel={t(`${PREFIX}.by_tier`)}
          />
        </section>
      </div>

      <div className={styles.split}>
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <h2>{t(`${PREFIX}.by_account`)}</h2>
            <span>{t(`${PREFIX}.panel_sub`, { metric: metricName, period: periodName })}</span>
          </header>
          <Donut
            rows={accountRows}
            colorOf={accountColor}
            format={formatMetric}
            centerLabel={metricName}
            centerValue={formatMetric(accountRows.reduce((sum, r) => sum + r.value, 0))}
            emptyText={t(`${PREFIX}.no_dim_data`)}
            ariaLabel={t(`${PREFIX}.by_account`)}
          />
        </section>
        <section className={styles.panel}>
          <header className={styles.panelHead}>
            <h2>{t(`${PREFIX}.key_summary`)}</h2>
            <span>{t(`${PREFIX}.key_summary_sub`)}</span>
          </header>
          <dl className={styles.summary}>
            {keySummary.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      </div>

      <section className={styles.panel}>
        <header className={styles.panelHead}>
          <h2>{t(`${PREFIX}.trend_title`, { metric: metricName })}</h2>
          <span>{trendRange}</span>
        </header>
        {trendSeries.length > 0 && <SeriesLegend series={trendSeries} />}
        <TrendChart
          slots={trendSlots}
          series={trendSeries}
          format={formatMetric}
          ariaLabel={t(`${PREFIX}.trend_title`, { metric: metricName })}
        />
        {metric === 'cost' && totals.cost <= 0 && (
          <p className={styles.note}>{t(`${PREFIX}.kpi_no_price`)}</p>
        )}
      </section>

      {effectiveKey === ALL_KEYS && (
        <>
          <h3 className={styles.sectionTitle}>{t(`${PREFIX}.keys_section`)}</h3>
          <div className={styles.keyGrid}>
            {[...entries]
              .sort((a, b) => b.usage[period].tokens - a.usage[period].tokens)
              .map((entry) => {
                const usage = entry.usage[period];
                const top = usage.models.slice(0, 3);
                const maxTop = top[0]?.tokens ?? 0;
                return (
                  <article key={entry.key} className={styles.keyCard}>
                    <div className={styles.keyCardHead}>
                      <div className={styles.keyIdentity}>
                        <span className={styles.dot} style={{ background: keyColor(entry.key) }} />
                        <div>
                          <div className={styles.keyName}>
                            {entry.name || t(`${PREFIX}.unnamed`)}
                          </div>
                          <code className={styles.keyMask}>{maskApiKey(entry.key)}</code>
                        </div>
                      </div>
                      <KeyStatusBadge entry={entry} />
                    </div>
                    <dl className={styles.keyStats}>
                      <div>
                        <dt>{t(`${PREFIX}.metric_requests`)}</dt>
                        <dd>{formatCount(usage.requests)}</dd>
                      </div>
                      <div>
                        <dt>{t(`${PREFIX}.metric_tokens`)}</dt>
                        <dd>{formatTokens(usage.tokens)}</dd>
                      </div>
                      <div>
                        <dt>{t(`${PREFIX}.metric_cost`)}</dt>
                        <dd>{formatCost(usage.cost)}</dd>
                      </div>
                      <div>
                        <dt>{t(`${PREFIX}.kpi_error_rate`)}</dt>
                        <dd className={usage.failed > 0 ? styles.bad : undefined}>
                          {usage.requests > 0 ? formatPct(usage.failed / usage.requests) : '—'}
                        </dd>
                      </div>
                    </dl>
                    {usage.rejected > 0 && <RejectedNotice usage={usage} />}
                    {top.length > 0 ? (
                      <ul className={styles.topModels}>
                        {top.map((row) => (
                          <li key={row.model}>
                            <span className={styles.topModelName} title={row.model}>
                              {row.model}
                            </span>
                            <span className={styles.topTrack}>
                              <span
                                className={styles.topFill}
                                style={{
                                  width: `${maxTop > 0 ? Math.max((row.tokens / maxTop) * 100, 2) : 0}%`,
                                  background: modelColor(seriesOf(row.model, modelSlots)),
                                }}
                              />
                            </span>
                            <span className={styles.num}>{formatTokens(row.tokens)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className={styles.mutedText}>{t(`${PREFIX}.no_usage`)}</p>
                    )}
                    <button
                      type="button"
                      className={styles.detailsButton}
                      onClick={() => selectKey(entry.key)}
                    >
                      {t(`${PREFIX}.details`)}
                    </button>
                  </article>
                );
              })}
          </div>
        </>
      )}

      <h3 className={styles.sectionTitle}>{t(`${PREFIX}.models_section`)}</h3>
      <section className={styles.panel}>
        {models.length > 0 ? (
          <ModelTable rows={models} colorOf={(model) => modelColor(seriesOf(model, modelSlots))} />
        ) : (
          <p className={styles.mutedText}>{t(`${PREFIX}.no_usage`)}</p>
        )}
      </section>

      <h3 className={styles.sectionTitle}>{t(`${PREFIX}.log_section`)}</h3>
      <section className={styles.panel}>
        <RequestLog
          entries={requestLog ?? []}
          scopeKey={effectiveKey === ALL_KEYS ? '' : effectiveKey}
          available={requestLog !== null || loading}
        />
      </section>

      <p className={styles.footnote}>{t(`${PREFIX}.footnote`)}</p>
    </div>
  );
}
