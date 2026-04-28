import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { collectorApi } from '@/services/api';
import type {
  CollectorCallRecord,
  CollectorCallRecordFilters,
  CollectorHealth,
  CollectorKafkaStatus,
  CollectorSettings,
  CollectorUsageSummary,
} from '@/types';
import { normalizeCollectorBase } from '@/utils/collectorConnection';
import styles from './CallRecordsPage.module.scss';

const SETTINGS_KEY = 'cli-proxy-collector-settings-v1';
const DEFAULT_PAGE_SIZE = 20;

const defaultSettings: CollectorSettings = {
  baseUrl: '',
  managementKey: '',
};

const defaultFilters: CollectorCallRecordFilters = {
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};

const formatNumber = (value: number | undefined | null) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString() : '-';

const formatDateTime = (value?: string) => {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

const statusClassName = (status?: number) => {
  if (!status) return styles.statusBadge;
  if (status >= 500) return `${styles.statusBadge} ${styles.statusError}`;
  if (status >= 400) return `${styles.statusBadge} ${styles.statusWarn}`;
  if (status >= 200 && status < 300) return `${styles.statusBadge} ${styles.statusOk}`;
  return styles.statusBadge;
};

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : '';

export function CallRecordsPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useLocalStorage<CollectorSettings>(SETTINGS_KEY, defaultSettings);
  const [baseDraft, setBaseDraft] = useState(settings.baseUrl);
  const [keyDraft, setKeyDraft] = useState(settings.managementKey);
  const [filters, setFilters] = useState<CollectorCallRecordFilters>(defaultFilters);
  const [health, setHealth] = useState<CollectorHealth | null>(null);
  const [summary, setSummary] = useState<CollectorUsageSummary | null>(null);
  const [kafkaStatus, setKafkaStatus] = useState<CollectorKafkaStatus | null>(null);
  const [records, setRecords] = useState<CollectorCallRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState<CollectorCallRecord | null>(null);
  const [error, setError] = useState('');

  const configured = Boolean(settings.baseUrl.trim());
  const pageCount = Math.max(Math.ceil(total / filters.pageSize), 1);

  const normalizedSettings = useMemo<CollectorSettings>(
    () => ({
      baseUrl: normalizeCollectorBase(settings.baseUrl),
      managementKey: settings.managementKey.trim(),
    }),
    [settings.baseUrl, settings.managementKey]
  );

  const loadData = useCallback(async () => {
    if (!normalizedSettings.baseUrl) {
      setHealth(null);
      setSummary(null);
      setKafkaStatus(null);
      setRecords([]);
      setTotal(0);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [healthResult, summaryResult, kafkaResult, recordsResult] = await Promise.allSettled([
        collectorApi.health(normalizedSettings),
        collectorApi.getUsageSummary(normalizedSettings),
        collectorApi.getKafkaStatus(normalizedSettings),
        collectorApi.getCallRecords(normalizedSettings, filters),
      ]);

      if (healthResult.status === 'fulfilled') setHealth(healthResult.value);
      if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
      if (kafkaResult.status === 'fulfilled') setKafkaStatus(kafkaResult.value);
      if (recordsResult.status === 'fulfilled') {
        setRecords(recordsResult.value.records);
        setTotal(recordsResult.value.total);
      } else {
        setRecords([]);
        setTotal(0);
        throw recordsResult.reason;
      }

      const rejected = [healthResult, summaryResult, kafkaResult].find(
        (result) => result.status === 'rejected'
      );
      if (rejected && rejected.status === 'rejected') {
        setError(errorMessage(rejected.reason) || t('collector.partial_load_error'));
      }
    } catch (err: unknown) {
      setError(errorMessage(err) || t('collector.load_error'));
    } finally {
      setLoading(false);
    }
  }, [filters, normalizedSettings, t]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const saveSettings = () => {
    const next = {
      baseUrl: normalizeCollectorBase(baseDraft),
      managementKey: keyDraft.trim(),
    };
    setSettings(next);
    setBaseDraft(next.baseUrl);
    setKeyDraft(next.managementKey);
    setFilters((prev) => ({ ...prev, page: 1 }));
  };

  const updateFilter = (key: keyof CollectorCallRecordFilters, value: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: value,
      page: 1,
    }));
  };

  const resetFilters = () => {
    setFilters(defaultFilters);
  };

  const openDetail = async (record: CollectorCallRecord) => {
    setSelectedRecord(record);
    if (!normalizedSettings.baseUrl) return;
    setDetailLoading(true);
    try {
      const detail = await collectorApi.getCallRecord(normalizedSettings, record.id);
      setSelectedRecord(detail);
    } catch {
      setSelectedRecord(record);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('collector.title')}</h1>
        <div className={styles.actions}>
          <Button variant="secondary" size="sm" onClick={() => void loadData()} disabled={loading}>
            {loading ? t('common.loading') : t('common.refresh')}
          </Button>
        </div>
      </div>

      <Card title={t('collector.connection_title')}>
        <div className={styles.settingsGrid}>
          <Input
            label={t('collector.base_url')}
            value={baseDraft}
            onChange={(event) => setBaseDraft(event.target.value)}
            placeholder="http://127.0.0.1:8320"
          />
          <Input
            label={t('collector.management_key')}
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            type="password"
          />
          <div className={styles.actions}>
            <Button variant="secondary" onClick={saveSettings}>
              {t('common.save')}
            </Button>
          </div>
        </div>
      </Card>

      {!configured ? (
        <EmptyState
          title={t('collector.not_configured_title')}
          description={t('collector.not_configured_desc')}
        />
      ) : (
        <>
          {error && <div className={styles.errorBox}>{error}</div>}

          <div className={styles.statusGrid}>
            <Card className={styles.metricCard}>
              <div className={styles.metricLabel}>{t('collector.health')}</div>
              <div className={styles.metricValue}>{health?.status || '-'}</div>
              <div className={styles.metricSub}>{health?.version || normalizedSettings.baseUrl}</div>
            </Card>
            <Card className={styles.metricCard}>
              <div className={styles.metricLabel}>{t('collector.total_requests')}</div>
              <div className={styles.metricValue}>{formatNumber(summary?.totalRequests)}</div>
              <div className={styles.metricSub}>
                {t('collector.failures')}: {formatNumber(summary?.failureCount)}
              </div>
            </Card>
            <Card className={styles.metricCard}>
              <div className={styles.metricLabel}>{t('collector.total_tokens')}</div>
              <div className={styles.metricValue}>{formatNumber(summary?.totalTokens)}</div>
              <div className={styles.metricSub}>
                {t('collector.avg_latency')}: {formatNumber(summary?.averageLatencyMs)} ms
              </div>
            </Card>
            <Card className={styles.metricCard}>
              <div className={styles.metricLabel}>Kafka</div>
              <div className={styles.metricValue}>
                {kafkaStatus?.enabled === false ? t('common.disabled') : t('common.enabled')}
              </div>
              <div className={styles.metricSub}>
                {t('collector.kafka_pending')}: {formatNumber(kafkaStatus?.pending)} /{' '}
                {t('collector.kafka_failed')}: {formatNumber(kafkaStatus?.failed)}
              </div>
            </Card>
          </div>

          <Card title={t('collector.filters')}>
            <div className={styles.filtersGrid}>
              <Input
                label={t('collector.api_key')}
                value={filters.apiKey || ''}
                onChange={(event) => updateFilter('apiKey', event.target.value)}
              />
              <Input
                label={t('collector.model')}
                value={filters.model || ''}
                onChange={(event) => updateFilter('model', event.target.value)}
              />
              <Input
                label={t('collector.path')}
                value={filters.path || ''}
                onChange={(event) => updateFilter('path', event.target.value)}
              />
              <Input
                label={t('collector.status')}
                value={filters.status || ''}
                onChange={(event) => updateFilter('status', event.target.value)}
                placeholder="2xx / 4xx / 500"
              />
              <Input
                label={t('collector.start_time')}
                value={filters.startTime || ''}
                onChange={(event) => updateFilter('startTime', event.target.value)}
                type="datetime-local"
              />
              <Input
                label={t('collector.end_time')}
                value={filters.endTime || ''}
                onChange={(event) => updateFilter('endTime', event.target.value)}
                type="datetime-local"
              />
              <Input
                label={t('collector.keyword')}
                value={filters.search || ''}
                onChange={(event) => updateFilter('search', event.target.value)}
              />
              <div className={styles.actions}>
                <Button variant="ghost" onClick={resetFilters}>
                  {t('logs.clear_filters')}
                </Button>
              </div>
            </div>
          </Card>

          <Card title={t('collector.records')}>
            {records.length === 0 && !loading ? (
              <EmptyState title={t('collector.empty_title')} description={t('collector.empty_desc')} />
            ) : (
              <>
                <div className={styles.tableWrap}>
                  <table className={styles.recordsTable}>
                    <thead>
                      <tr>
                        <th>{t('collector.time')}</th>
                        <th>{t('collector.api_key')}</th>
                        <th>{t('collector.method_path')}</th>
                        <th>{t('collector.model')}</th>
                        <th>{t('collector.status')}</th>
                        <th>{t('collector.latency')}</th>
                        <th>{t('collector.input')}</th>
                        <th>{t('common.actions')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {records.map((record) => (
                        <tr key={record.id}>
                          <td className={styles.mono}>{formatDateTime(record.createdAt)}</td>
                          <td className={styles.mono}>
                            {record.apiKeyMasked || record.apiKeyHash || '-'}
                          </td>
                          <td>
                            <div className={styles.mono}>
                              {record.method || '-'} {record.path || ''}
                            </div>
                            <div className={styles.muted}>{record.requestId || record.id}</div>
                          </td>
                          <td>{record.model || '-'}</td>
                          <td>
                            <span className={statusClassName(record.statusCode)}>
                              {record.statusCode || '-'}
                            </span>
                          </td>
                          <td>{formatNumber(record.latencyMs)} ms</td>
                          <td>
                            <div className={styles.promptPreview}>
                              {record.requestInputText || record.errorMessage || '-'}
                            </div>
                          </td>
                          <td>
                            <Button variant="ghost" size="sm" onClick={() => void openDetail(record)}>
                              {t('common.view')}
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.footer}>
                  <span className={styles.muted}>
                    {t('collector.pagination', {
                      page: filters.page,
                      pages: pageCount,
                      total,
                    })}
                  </span>
                  <div className={styles.actions}>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={filters.page <= 1 || loading}
                      onClick={() => setFilters((prev) => ({ ...prev, page: prev.page - 1 }))}
                    >
                      {t('common.previous')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={filters.page >= pageCount || loading}
                      onClick={() => setFilters((prev) => ({ ...prev, page: prev.page + 1 }))}
                    >
                      {t('common.next')}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </Card>
        </>
      )}

      <Modal
        open={Boolean(selectedRecord)}
        title={t('collector.detail_title')}
        onClose={() => setSelectedRecord(null)}
        width={860}
        closeDisabled={detailLoading}
      >
        {selectedRecord && (
          <>
            <div className={styles.detailGrid}>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>{t('collector.request_id')}</div>
                <div className={`${styles.detailValue} ${styles.mono}`}>
                  {selectedRecord.requestId || selectedRecord.id}
                </div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>{t('collector.time')}</div>
                <div className={styles.detailValue}>{formatDateTime(selectedRecord.createdAt)}</div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>{t('collector.api_key')}</div>
                <div className={`${styles.detailValue} ${styles.mono}`}>
                  {selectedRecord.apiKeyMasked || selectedRecord.apiKeyHash || '-'}
                </div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>{t('collector.method_path')}</div>
                <div className={`${styles.detailValue} ${styles.mono}`}>
                  {selectedRecord.method || '-'} {selectedRecord.path || ''}
                </div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>{t('collector.model')}</div>
                <div className={styles.detailValue}>{selectedRecord.model || '-'}</div>
              </div>
              <div className={styles.detailItem}>
                <div className={styles.detailLabel}>{t('collector.status')}</div>
                <div className={styles.detailValue}>{selectedRecord.statusCode || '-'}</div>
              </div>
            </div>

            <div className={styles.payloadBlock}>
              <div className={styles.detailLabel}>{t('collector.input')}</div>
              <pre className={styles.payloadText}>
                {selectedRecord.requestInputText || selectedRecord.requestBody || '-'}
              </pre>
            </div>
            <div className={styles.payloadBlock}>
              <div className={styles.detailLabel}>{t('collector.response_preview')}</div>
              <pre className={styles.payloadText}>
                {selectedRecord.responseBodyPreview || selectedRecord.errorMessage || '-'}
              </pre>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
