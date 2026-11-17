import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/Table';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import {
  API_KEY_STATS_WINDOWS,
  aggregateModelUsage,
  apiKeyPolicyUsageApi,
  type ApiKeyModelUsage,
  type ApiKeyPolicyUsage,
  type ApiKeyStatsWindow,
} from '@/services/api/apiKeyPolicyUsage';
import { formatCompactNumber, maskApiKey } from '@/utils/format';
import styles from './UsagePage.module.scss';

const PREFIX = 'usage_page';

const formatCost = (value: number) =>
  value <= 0 ? '—' : `$${value < 0.01 ? value.toFixed(4) : value.toFixed(2)}`;

const formatTokens = (value: number) => (value > 0 ? formatCompactNumber(value) : '0');

function ModelTable({ rows }: { rows: ApiKeyModelUsage[] }) {
  const { t } = useTranslation();
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t(`${PREFIX}.col_model`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_requests`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_input`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_cached`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_output`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_total`)}</TableHead>
          <TableHead alignRight>{t(`${PREFIX}.col_cost`)}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.model}>
            <TableCell className={styles.model}>{row.model}</TableCell>
            <TableCell alignRight className={styles.num}>
              {row.requests.toLocaleString()}
              {row.failed > 0 && (
                <span
                  className={styles.failed}
                  title={t(`${PREFIX}.failed_hint`, { count: row.failed })}
                >
                  {' '}
                  ({row.failed} ✕)
                </span>
              )}
            </TableCell>
            <TableCell alignRight className={styles.num} title={row.inputTokens.toLocaleString()}>
              {formatTokens(row.inputTokens)}
            </TableCell>
            <TableCell alignRight className={styles.num} title={row.cachedTokens.toLocaleString()}>
              {formatTokens(row.cachedTokens)}
            </TableCell>
            <TableCell alignRight className={styles.num} title={row.outputTokens.toLocaleString()}>
              {formatTokens(row.outputTokens)}
            </TableCell>
            <TableCell alignRight className={styles.num} title={row.tokens.toLocaleString()}>
              <strong>{formatTokens(row.tokens)}</strong>
            </TableCell>
            <TableCell alignRight className={styles.num}>
              {formatCost(row.cost)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function Totals({ requests, tokens, cost }: { requests: number; tokens: number; cost: number }) {
  const { t } = useTranslation();
  return (
    <span className={styles.totals}>
      <span>{t(`${PREFIX}.total_requests`, { count: requests })}</span>
      <span>{t(`${PREFIX}.total_tokens`, { value: formatTokens(tokens) })}</span>
      {cost > 0 && <span>{formatCost(cost)}</span>}
    </span>
  );
}

export function UsagePage() {
  const { t } = useTranslation();
  const [window, setWindow] = useState<ApiKeyStatsWindow>('day');
  const [entries, setEntries] = useState<ApiKeyPolicyUsage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setEntries(await apiKeyPolicyUsageApi.list());
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

  const sorted = useMemo(
    () =>
      [...entries].sort(
        (a, b) =>
          b.usage[window].tokens - a.usage[window].tokens ||
          b.usage[window].requests - a.usage[window].requests
      ),
    [entries, window]
  );
  const overall = useMemo(() => aggregateModelUsage(entries, window), [entries, window]);
  const overallTotals = useMemo(
    () =>
      entries.reduce(
        (acc, e) => ({
          requests: acc.requests + e.usage[window].requests,
          tokens: acc.tokens + e.usage[window].tokens,
          cost: acc.cost + e.usage[window].cost,
        }),
        { requests: 0, tokens: 0, cost: 0 }
      ),
    [entries, window]
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>{t(`${PREFIX}.title`)}</h1>
          <p className={styles.subtitle}>{t(`${PREFIX}.subtitle`)}</p>
        </div>
        <div className={styles.toolbar}>
          <div className={styles.segmented} role="tablist" aria-label={t(`${PREFIX}.window_label`)}>
            {API_KEY_STATS_WINDOWS.map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={window === id}
                className={`${styles.segment} ${window === id ? styles.segmentActive : ''}`}
                onClick={() => setWindow(id)}
              >
                {t(`${PREFIX}.window_${id}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className={styles.error}>{t(`${PREFIX}.load_failed`, { error })}</div>}

      {!loading && !error && entries.length === 0 ? (
        <EmptyState title={t(`${PREFIX}.no_keys`)} description={t(`${PREFIX}.no_keys_hint`)} />
      ) : (
        <>
          <Card
            title={t(`${PREFIX}.all_keys`)}
            extra={<Totals {...overallTotals} />}
            className={styles.card}
          >
            {overall.length > 0 ? (
              <ModelTable rows={overall} />
            ) : (
              <p className={styles.muted}>{t(`${PREFIX}.no_usage`)}</p>
            )}
          </Card>

          {sorted.map((entry) => {
            const usage = entry.usage[window];
            return (
              <Card
                key={entry.key}
                className={styles.card}
                title={
                  <span className={styles.keyTitle}>
                    <span>{entry.name || t(`${PREFIX}.unnamed`)}</span>
                    <code className={styles.keyMask}>{maskApiKey(entry.key)}</code>
                    {entry.expired && (
                      <span className={styles.expired}>{t(`${PREFIX}.expired`)}</span>
                    )}
                  </span>
                }
                extra={<Totals requests={usage.requests} tokens={usage.tokens} cost={usage.cost} />}
              >
                {usage.models.length > 0 ? (
                  <ModelTable rows={usage.models} />
                ) : (
                  <p className={styles.muted}>{t(`${PREFIX}.no_usage`)}</p>
                )}
              </Card>
            );
          })}
          <p className={styles.footnote}>{t(`${PREFIX}.footnote`)}</p>
        </>
      )}
    </div>
  );
}
