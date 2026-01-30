import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { formatTokensInMillions, formatUsd, type KeyUsageStat } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface KeyStatsCardProps {
  keyUsageStats: KeyUsageStat[];
  loading: boolean;
  hasPrices: boolean;
}

export function KeyStatsCard({ keyUsageStats, loading, hasPrices }: KeyStatsCardProps) {
  const { t } = useTranslation();

  return (
    <Card title={t('usage_stats.key_stats')}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : keyUsageStats.length > 0 ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>{t('usage_stats.key_name')}</th>
                <th>{t('usage_stats.key_requests')}</th>
                <th>{t('usage_stats.key_tokens')}</th>
                {hasPrices && <th>{t('usage_stats.key_cost')}</th>}
              </tr>
            </thead>
            <tbody>
              {keyUsageStats.map((stat) => (
                <tr key={stat.source}>
                  <td className={styles.modelCell}>{stat.displayName}</td>
                  <td>
                    <span className={styles.requestCountCell}>
                      <span>{stat.totalRequests.toLocaleString()}</span>
                      <span className={styles.requestBreakdown}>
                        (<span className={styles.statSuccess}>{stat.successRequests.toLocaleString()}</span>{' '}
                        <span className={styles.statFailure}>{stat.failureRequests.toLocaleString()}</span>)
                      </span>
                    </span>
                  </td>
                  <td>{formatTokensInMillions(stat.totalTokens)}</td>
                  {hasPrices && <td>{stat.cost > 0 ? formatUsd(stat.cost) : '--'}</td>}
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
