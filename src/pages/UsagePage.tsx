import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { usageApi } from '@/services/api/usage';
import type { KeyStats } from '@/utils/usage';

interface UsagePayload {
  total_requests?: number;
  success_requests?: number;
  failed_requests?: number;
  total_tokens?: number;
  cached_tokens?: number;
  reasoning_tokens?: number;
  rpm_30m?: number;
  tpm_30m?: number;
  [key: string]: any;
}

export function UsagePage() {
  const { t } = useTranslation();

  const [usage, setUsage] = useState<UsagePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [keyStats, setKeyStats] = useState<KeyStats | null>(null);

  const loadUsage = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await usageApi.getUsage();
      const payload = data?.usage ?? data;
      setUsage(payload);
      const stats = await usageApi.getKeyStats(payload);
      setKeyStats(stats);
    } catch (err: any) {
      setError(err?.message || t('usage_stats.loading_error'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsage();
  }, []);

  const overviewItems = [
    { label: t('usage_stats.total_requests'), value: usage?.total_requests },
    { label: t('usage_stats.success_requests'), value: usage?.success_requests },
    { label: t('usage_stats.failed_requests'), value: usage?.failed_requests },
    { label: t('usage_stats.total_tokens'), value: usage?.total_tokens },
    { label: t('usage_stats.cached_tokens'), value: usage?.cached_tokens },
    { label: t('usage_stats.reasoning_tokens'), value: usage?.reasoning_tokens },
    { label: t('usage_stats.rpm_30m'), value: usage?.rpm_30m },
    { label: t('usage_stats.tpm_30m'), value: usage?.tpm_30m }
  ];

  return (
    <div className="stack">
      <Card
        title={t('usage_stats.title')}
        extra={
          <Button variant="secondary" size="sm" onClick={loadUsage} disabled={loading}>
            {t('usage_stats.refresh')}
          </Button>
        }
      >
        {error && <div className="error-box">{error}</div>}
        {loading ? (
          <div className="hint">{t('common.loading')}</div>
        ) : (
          <div className="grid cols-2">
            {overviewItems.map((item) => (
              <div key={item.label} className="stat-card">
                <div className="stat-label">{item.label}</div>
                <div className="stat-value">{item.value ?? '-'}</div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={t('usage_stats.api_details')}>
        {loading ? (
          <div className="hint">{t('common.loading')}</div>
        ) : keyStats && Object.keys(keyStats.bySource || {}).length ? (
          <div className="table">
            <div className="table-header">
              <div>{t('usage_stats.api_endpoint')}</div>
              <div>{t('stats.success')}</div>
              <div>{t('stats.failure')}</div>
            </div>
            {Object.entries(keyStats.bySource || {}).map(([source, bucket]) => (
              <div key={source} className="table-row">
                <div className="cell item-subtitle">{source}</div>
                <div className="cell">{bucket.success}</div>
                <div className="cell">{bucket.failure}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="hint">{t('usage_stats.no_data')}</div>
        )}
      </Card>
    </div>
  );
}
