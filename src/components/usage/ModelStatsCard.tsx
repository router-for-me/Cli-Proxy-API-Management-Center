import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { formatTokensInMillions, formatUsd } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface ModelStat {
  model: string;
  requests: number;
  successCount: number;
  failureCount: number;
  tokens: number;
  cost: number;
}

export interface ModelStatsCardProps {
  modelStats: ModelStat[];
  loading: boolean;
  hasPrices: boolean;
}

type SortKey = 'model' | 'requests' | 'tokens' | 'cost';
type SortDir = 'asc' | 'desc';

export function ModelStatsCard({ modelStats, loading, hasPrices }: ModelStatsCardProps) {
  const { t } = useTranslation();
  const [sortKey, setSortKey] = useState<SortKey>('requests');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'model' ? 'asc' : 'desc');
    }
  };

  const sorted = useMemo(() => {
    const list = [...modelStats];
    const dir = sortDir === 'asc' ? 1 : -1;
    list.sort((a, b) => {
      if (sortKey === 'model') return dir * a.model.localeCompare(b.model);
      return dir * ((a[sortKey] as number) - (b[sortKey] as number));
    });
    return list;
  }, [modelStats, sortKey, sortDir]);

  const arrow = (key: SortKey) =>
    sortKey === key ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  return (
    <Card title={t('usage_stats.models')}>
      {loading ? (
        <div className={styles.hint}>{t('common.loading')}</div>
      ) : sorted.length > 0 ? (
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.sortableHeader} onClick={() => handleSort('model')}>
                  {t('usage_stats.model_name')}{arrow('model')}
                </th>
                <th className={styles.sortableHeader} onClick={() => handleSort('requests')}>
                  {t('usage_stats.requests_count')}{arrow('requests')}
                </th>
                <th className={styles.sortableHeader} onClick={() => handleSort('tokens')}>
                  {t('usage_stats.tokens_count')}{arrow('tokens')}
                </th>
                {hasPrices && (
                  <th className={styles.sortableHeader} onClick={() => handleSort('cost')}>
                    {t('usage_stats.total_cost')}{arrow('cost')}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {sorted.map((stat) => (
                <tr key={stat.model}>
                  <td className={styles.modelCell}>{stat.model}</td>
                  <td>
                    <span className={styles.requestCountCell}>
                      <span>{stat.requests.toLocaleString()}</span>
                      <span className={styles.requestBreakdown}>
                        (<span className={styles.statSuccess}>{stat.successCount.toLocaleString()}</span>{' '}
                        <span className={styles.statFailure}>{stat.failureCount.toLocaleString()}</span>)
                      </span>
                    </span>
                  </td>
                  <td>{formatTokensInMillions(stat.tokens)}</td>
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
