import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { usageApi } from '@/services/api';
import type { UsageResponse } from '@/types/usage';
import {
  buildTopModelRows,
  buildUsageRows,
  formatLargeNumber,
  toTrendPoints,
  type UsageTrendPoint,
} from '@/utils/usageStats';
import styles from './UsagePage.module.scss';

function StatCard({ label, value, meta }: { label: string; value: number; meta?: string }) {
  return (
    <div className={styles.statCard}>
      <span className={styles.statLabel}>{label}</span>
      <span className={styles.statValue}>{formatLargeNumber(value)}</span>
      {meta && <span className={styles.statMeta}>{meta}</span>}
    </div>
  );
}

function TrendCard({
  title,
  points,
  emptyText,
}: {
  title: string;
  points: UsageTrendPoint[];
  emptyText: string;
}) {
  const max = Math.max(0, ...points.map((point) => point.value));

  return (
    <Card title={title}>
      {points.length === 0 || max === 0 ? (
        <div className={styles.trendEmpty}>{emptyText}</div>
      ) : (
        <div className={styles.trendBars}>
          {points.map((point) => (
            <div className={styles.trendBar} key={point.label} title={`${point.label}: ${point.value}`}>
              <div
                className={styles.trendBarFill}
                style={{ height: `${Math.max(3, (point.value / max) * 100)}%` }}
              />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function UsagePage() {
  const { t } = useTranslation();
  const [payload, setPayload] = useState<UsageResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const loadUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const nextPayload = await usageApi.getUsage();
      setPayload(nextPayload);
      setLastUpdated(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message || t('usage_stats.load_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadUsage();
  }, [loadUsage]);

  useHeaderRefresh(loadUsage);

  const usage = payload?.usage ?? null;
  const apiRows = useMemo(() => buildUsageRows(usage), [usage]);
  const topModels = useMemo(() => buildTopModelRows(apiRows), [apiRows]);
  const requestPoints = useMemo(() => toTrendPoints(usage?.requests_by_hour), [usage]);
  const tokenPoints = useMemo(() => toTrendPoints(usage?.tokens_by_hour), [usage]);

  const totalRequests = usage?.total_requests ?? 0;
  const successCount = usage?.success_count ?? 0;
  const failureCount = usage?.failure_count ?? 0;
  const totalTokens = usage?.total_tokens ?? 0;

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
          <p className={styles.subtitle}>{t('usage_stats.subtitle')}</p>
        </div>
        <div className={styles.headerActions}>
          {lastUpdated && (
            <span className={styles.lastUpdated}>
              {t('usage_stats.last_updated')}: {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <Button variant="secondary" size="sm" onClick={() => void loadUsage()} loading={loading}>
            {t('usage_stats.refresh')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.statGrid} aria-busy={loading}>
        <StatCard label={t('usage_stats.total_requests')} value={totalRequests} />
        <StatCard label={t('usage_stats.total_tokens')} value={totalTokens} />
        <StatCard label={t('usage_stats.success')} value={successCount} />
        <StatCard label={t('usage_stats.failure')} value={failureCount} />
      </div>

      {loading && !payload ? (
        <div className={styles.emptyState}>
          <LoadingSpinner />
        </div>
      ) : (
        <>
          <div className={styles.chartGrid}>
            <TrendCard
              title={t('usage_stats.requests_by_hour')}
              points={requestPoints}
              emptyText={t('usage_stats.no_data')}
            />
            <TrendCard
              title={t('usage_stats.tokens_by_hour')}
              points={tokenPoints}
              emptyText={t('usage_stats.no_data')}
            />
          </div>

          <Card title={t('usage_stats.top_models')}>
            {topModels.length === 0 ? (
              <div className={styles.emptyState}>{t('usage_stats.no_data')}</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('usage_stats.api')}</th>
                      <th>{t('usage_stats.model')}</th>
                      <th className={styles.numberCell}>{t('usage_stats.requests')}</th>
                      <th className={styles.numberCell}>{t('usage_stats.tokens')}</th>
                      <th className={styles.numberCell}>{t('usage_stats.failures')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {topModels.map((row) => (
                      <tr key={`${row.apiName}:${row.modelName}`}>
                        <td className={styles.mono}>{row.displayApiName}</td>
                        <td className={styles.mono}>{row.modelName}</td>
                        <td className={styles.numberCell}>{formatLargeNumber(row.requests)}</td>
                        <td className={styles.numberCell}>{formatLargeNumber(row.tokens)}</td>
                        <td className={styles.numberCell}>{formatLargeNumber(row.failures)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card title={t('usage_stats.api_breakdown')}>
            {apiRows.length === 0 ? (
              <div className={styles.emptyState}>{t('usage_stats.no_data')}</div>
            ) : (
              <div className={styles.tableWrap}>
                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>{t('usage_stats.api')}</th>
                      <th className={styles.numberCell}>{t('usage_stats.requests')}</th>
                      <th className={styles.numberCell}>{t('usage_stats.tokens')}</th>
                      <th className={styles.numberCell}>{t('usage_stats.models')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {apiRows.map((row) => (
                      <tr key={row.apiName}>
                        <td className={styles.mono}>{row.displayApiName}</td>
                        <td className={styles.numberCell}>{formatLargeNumber(row.requests)}</td>
                        <td className={styles.numberCell}>{formatLargeNumber(row.tokens)}</td>
                        <td className={styles.numberCell}>{formatLargeNumber(row.models.length)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
