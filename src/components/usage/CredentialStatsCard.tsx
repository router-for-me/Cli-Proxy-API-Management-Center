import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { computeKeyStats, formatCompactNumber } from '@/utils/usage';
import type { UsagePayload } from './hooks/useUsageData';
import styles from '@/pages/UsagePage.module.scss';

export interface CredentialStatsCardProps {
  usage: UsagePayload | null;
  loading: boolean;
}

interface CredentialRow {
  key: string;
  success: number;
  failure: number;
  total: number;
  successRate: number;
}

export function CredentialStatsCard({ usage, loading }: CredentialStatsCardProps) {
  const { t } = useTranslation();

  const rows = useMemo((): CredentialRow[] => {
    if (!usage) return [];
    const { byAuthIndex } = computeKeyStats(usage);
    return Object.entries(byAuthIndex)
      .map(([key, bucket]) => {
        const total = bucket.success + bucket.failure;
        return {
          key,
          success: bucket.success,
          failure: bucket.failure,
          total,
          successRate: total > 0 ? (bucket.success / total) * 100 : 100,
        };
      })
      .sort((a, b) => b.total - a.total);
  }, [usage]);

  return (
    <Card title={t('usage_stats.credential_stats')}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : rows.length > 0 ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage_stats.credential_name')}</th>
                <th>{t('usage_stats.requests_count')}</th>
                <th>{t('usage_stats.success_rate')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td className={styles.modelCell}>{row.key}</td>
                  <td>
                    <span className={styles.requestCountCell}>
                      <span>{formatCompactNumber(row.total)}</span>
                      <span className={styles.requestBreakdown}>
                        (<span className={styles.statSuccess}>{row.success.toLocaleString()}</span>{' '}
                        <span className={styles.statFailure}>{row.failure.toLocaleString()}</span>)
                      </span>
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        row.successRate >= 95
                          ? styles.statSuccess
                          : row.successRate >= 80
                            ? styles.statNeutral
                            : styles.statFailure
                      }
                    >
                      {row.successRate.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className={styles.hint}>{t('usage_stats.no_data')}</div>
      )}
    </Card>
  );
}
