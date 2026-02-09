import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { formatCompactNumber, type RecentRequest } from '@/utils/usage';
import styles from '@/pages/UsagePage.module.scss';

export interface RequestHistoryCardProps {
    loading: boolean;
    requests: RecentRequest[];
}

const DEFAULT_VISIBLE_COUNT = 12;

export function RequestHistoryCard({ loading, requests }: RequestHistoryCardProps) {
    const { t } = useTranslation();
    const [visibleCount, setVisibleCount] = useState(DEFAULT_VISIBLE_COUNT);

    const visibleRequests = useMemo(() => requests.slice(0, visibleCount), [requests, visibleCount]);
    const hasMore = requests.length > visibleCount;

    return (
        <Card title={t('usage_stats.recent_requests')}>
            {loading ? (
                <div className={styles.hint}>{t('common.loading')}</div>
            ) : requests.length === 0 ? (
                <div className={styles.hint}>{t('usage_stats.no_data')}</div>
            ) : (
                <div className={styles.requestHistoryList}>
                    {visibleRequests.map((request, index) => (
                        <div key={`${request.timestamp}-${request.model}-${request.source}-${index}`} className={styles.requestHistoryItem}>
                            <div className={styles.requestHistoryHeader}>
                                <span className={request.failed ? styles.requestStatusFailed : styles.requestStatusSuccess}>
                                    {request.failed ? t('usage_stats.request_failed') : t('usage_stats.request_success')}
                                </span>
                                <span>{new Date(request.timestamp).toLocaleString()}</span>
                                <span className={styles.requestHistoryModel}>{request.model}</span>
                                <span>{request.source || '-'}</span>
                                <span>
                                    {t('usage_stats.request_auth')}: {request.authIndex ?? '-'}
                                </span>
                            </div>
                            <div className={styles.requestHistoryTokens}>
                                <span>
                                    {t('usage_stats.input_tokens')}: {formatCompactNumber(request.tokens.input)}
                                </span>
                                <span>
                                    {t('usage_stats.output_tokens')}: {formatCompactNumber(request.tokens.output)}
                                </span>
                                <span>
                                    {t('usage_stats.reasoning_tokens')}: {formatCompactNumber(request.tokens.reasoning)}
                                </span>
                                <span>
                                    {t('usage_stats.cached_tokens')}: {formatCompactNumber(request.tokens.cached)}
                                </span>
                                <span>
                                    {t('usage_stats.total_tokens')}: {formatCompactNumber(request.tokens.total)}
                                </span>
                            </div>
                        </div>
                    ))}
                    {hasMore && (
                        <div className={styles.requestHistoryActions}>
                            <Button variant="secondary" size="sm" onClick={() => setVisibleCount((prev) => prev + DEFAULT_VISIBLE_COUNT)}>
                                {t('usage_stats.show_more')}
                            </Button>
                        </div>
                    )}
                </div>
            )}
        </Card>
    );
}
