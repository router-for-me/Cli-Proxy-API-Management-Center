import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Doughnut } from 'react-chartjs-2';
import { Card } from '@/components/ui/Card';
import { formatTokensInMillions, type TokenBreakdown } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface TokenDistributionCardProps {
    loading: boolean;
    tokenBreakdown: TokenBreakdown;
}

export function TokenDistributionCard({ loading, tokenBreakdown }: TokenDistributionCardProps) {
    const { t } = useTranslation();

    const chartData = useMemo(
        () => ({
            labels: [
                t('usage_stats.input_tokens'),
                t('usage_stats.output_tokens'),
                t('usage_stats.reasoning_tokens'),
                t('usage_stats.cached_tokens'),
            ],
            datasets: [
                {
                    data: [
                        tokenBreakdown.inputTokens,
                        tokenBreakdown.outputTokens,
                        tokenBreakdown.reasoningTokens,
                        tokenBreakdown.cachedTokens,
                    ],
                    backgroundColor: ['#3b82f6', '#8b5cf6', '#f97316', '#10b981'],
                    borderWidth: 0,
                },
            ],
        }),
        [
            t,
            tokenBreakdown.inputTokens,
            tokenBreakdown.outputTokens,
            tokenBreakdown.reasoningTokens,
            tokenBreakdown.cachedTokens,
        ]
    );

    const hasData = tokenBreakdown.totalTokens > 0;

    return (
        <Card title={t('usage_stats.token_distribution')}>
            {loading ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : !hasData ? (
                <div className={styles.hint}>{t('usage_stats.no_data')}</div>
            ) : (
                <div className={styles.tokenDistributionWrap}>
                    <div className={styles.tokenDistributionChart}>
                        <Doughnut
                            data={chartData}
                            options={{
                                responsive: true,
                                maintainAspectRatio: false,
                                plugins: {
                                    legend: { display: false },
                                },
                                cutout: '66%',
                            }}
                        />
                    </div>
                    <div className={styles.tokenDistributionLegend}>
                        <div className={styles.tokenLegendItem}>
                            <span className={`${styles.tokenLegendDot} ${styles.tokenBreakdownInput}`} />
                            <span>{t('usage_stats.input_tokens')}</span>
                            <strong>{formatTokensInMillions(tokenBreakdown.inputTokens)}</strong>
                        </div>
                        <div className={styles.tokenLegendItem}>
                            <span className={`${styles.tokenLegendDot} ${styles.tokenBreakdownOutput}`} />
                            <span>{t('usage_stats.output_tokens')}</span>
                            <strong>{formatTokensInMillions(tokenBreakdown.outputTokens)}</strong>
                        </div>
                        <div className={styles.tokenLegendItem}>
                            <span className={`${styles.tokenLegendDot} ${styles.tokenBreakdownReasoning}`} />
                            <span>{t('usage_stats.reasoning_tokens')}</span>
                            <strong>{formatTokensInMillions(tokenBreakdown.reasoningTokens)}</strong>
                        </div>
                        <div className={styles.tokenLegendItem}>
                            <span className={`${styles.tokenLegendDot} ${styles.tokenBreakdownCached}`} />
                            <span>{t('usage_stats.cached_tokens')}</span>
                            <strong>{formatTokensInMillions(tokenBreakdown.cachedTokens)}</strong>
                        </div>
                    </div>
                </div>
            )}
        </Card>
    );
}
