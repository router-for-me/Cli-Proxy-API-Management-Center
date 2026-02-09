import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { formatTokensInMillions, formatUsd, type ModelStatsEntry } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface ModelStatsCardProps {
    modelStats: ModelStatsEntry[];
    loading: boolean;
    hasPrices: boolean;
}

export function ModelStatsCard({ modelStats, loading, hasPrices }: ModelStatsCardProps) {
    const { t } = useTranslation();

    return (
        <Card title={t('usage_stats.models')}>
            {loading ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : modelStats.length > 0 ? (
                <div className={styles.tableWrapper}>
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th>{t('usage_stats.model_name')}</th>
                                <th>{t('usage_stats.requests_count')}</th>
                                <th>{t('usage_stats.input_tokens')}</th>
                                <th>{t('usage_stats.output_tokens')}</th>
                                <th>{t('usage_stats.tokens_count')}</th>
                                {hasPrices && <th>{t('usage_stats.total_cost')}</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {modelStats.map((stat) => (
                                <tr key={stat.model}>
                                    <td className={styles.modelCell}>{stat.model}</td>
                                    <td>
                                        <span className={styles.requestCountCell}>
                                            <span>{stat.requests.toLocaleString()}</span>
                                            <span className={styles.requestBreakdown}>
                                                (
                                                <span className={styles.statSuccess}>
                                                    {stat.successCount.toLocaleString()}
                                                </span>{' '}
                                                <span className={styles.statFailure}>
                                                    {stat.failureCount.toLocaleString()}
                                                </span>
                                                )
                                            </span>
                                        </span>
                                    </td>
                                    <td>{formatTokensInMillions(stat.inputTokens)}</td>
                                    <td>{formatTokensInMillions(stat.outputTokens)}</td>
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
