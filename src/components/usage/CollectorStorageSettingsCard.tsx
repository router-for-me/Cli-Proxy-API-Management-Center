import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { copyToClipboard } from '@/utils/clipboard';
import {
  DEFAULT_COLLECTOR_STORAGE_DRAFT,
  buildCollectorStorageConfigYaml,
  normalizeCollectorStorageDraft,
  type CollectorStorageDraft,
  type CollectorStorageDriver
} from '@/utils/collectorStorageConfig';
import styles from '@/pages/UsagePage.module.scss';

const STORAGE_KEY = 'cli-proxy-collector-storage-draft-v1';

const STORAGE_DRIVER_OPTIONS: ReadonlyArray<{ value: CollectorStorageDriver; labelKey: string }> = [
  { value: 'sqlite', labelKey: 'usage_stats.collector_storage_driver_sqlite' },
  { value: 'mysql', labelKey: 'usage_stats.collector_storage_driver_mysql' }
];

export function CollectorStorageSettingsCard() {
  const { t } = useTranslation();
  const [rawDraft, setRawDraft] = useLocalStorage<CollectorStorageDraft>(
    STORAGE_KEY,
    DEFAULT_COLLECTOR_STORAGE_DRAFT
  );
  const [copied, setCopied] = useState(false);
  const draft = useMemo(() => normalizeCollectorStorageDraft(rawDraft), [rawDraft]);
  const yaml = useMemo(() => buildCollectorStorageConfigYaml(draft), [draft]);

  const updateDraft = <K extends keyof CollectorStorageDraft>(
    key: K,
    value: CollectorStorageDraft[K]
  ) => {
    setRawDraft((current) => ({
      ...normalizeCollectorStorageDraft(current),
      [key]: value
    }));
  };

  const handleCopy = async () => {
    const ok = await copyToClipboard(yaml);
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };

  const driverOptions = useMemo(
    () => STORAGE_DRIVER_OPTIONS.map((option) => ({
      value: option.value,
      label: t(option.labelKey)
    })),
    [t]
  );

  return (
    <Card
      title={t('usage_stats.collector_storage_title')}
      extra={
        <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
          {copied ? t('common.copied') : t('usage_stats.collector_storage_copy')}
        </Button>
      }
    >
      <div className={styles.collectorStorageLayout}>
        <div className={styles.collectorStorageIntro}>
          <p>{t('usage_stats.collector_storage_desc')}</p>
          <div className={styles.collectorStorageFacts}>
            <div>
              <span>{t('usage_stats.collector_storage_native_label')}</span>
              <strong>{t('usage_stats.collector_storage_native_value')}</strong>
            </div>
            <div>
              <span>{t('usage_stats.collector_storage_collector_label')}</span>
              <strong>{t('usage_stats.collector_storage_collector_value')}</strong>
            </div>
            <div>
              <span>{t('usage_stats.collector_storage_effective_label')}</span>
              <strong>{t('usage_stats.collector_storage_effective_value')}</strong>
            </div>
          </div>
          <a className={styles.collectorStorageLink} href="#/call-records">
            {t('usage_stats.collector_storage_records_link')}
          </a>
        </div>

        <div className={styles.collectorStorageForm}>
          <div className={styles.collectorStorageField}>
            <label>{t('usage_stats.collector_storage_driver')}</label>
            <Select
              value={draft.driver}
              options={driverOptions}
              onChange={(value) => updateDraft('driver', value as CollectorStorageDriver)}
              ariaLabel={t('usage_stats.collector_storage_driver')}
            />
          </div>

          {draft.driver === 'sqlite' ? (
            <Input
              label={t('usage_stats.collector_storage_sqlite_path')}
              value={draft.sqlitePath}
              onChange={(event) => updateDraft('sqlitePath', event.target.value)}
              placeholder="./data/collector.db"
            />
          ) : (
            <Input
              label={t('usage_stats.collector_storage_mysql_dsn')}
              value={draft.mysqlDsn}
              onChange={(event) => updateDraft('mysqlDsn', event.target.value)}
              placeholder="collector:password@tcp(127.0.0.1:3306)/collector?parseTime=true"
            />
          )}

          <div className={styles.collectorStorageToggleRow}>
            <ToggleSwitch
              checked={draft.kafkaEnabled}
              onChange={(value) => updateDraft('kafkaEnabled', value)}
              label={t('usage_stats.collector_storage_kafka_enabled')}
            />
          </div>

          {draft.kafkaEnabled && (
            <div className={styles.collectorStorageKafkaFields}>
              <Input
                label={t('usage_stats.collector_storage_kafka_brokers')}
                value={draft.kafkaBrokers}
                onChange={(event) => updateDraft('kafkaBrokers', event.target.value)}
                placeholder="127.0.0.1:9092"
              />
              <Input
                label={t('usage_stats.collector_storage_kafka_call_logs_topic')}
                value={draft.kafkaCallLogsTopic}
                onChange={(event) => updateDraft('kafkaCallLogsTopic', event.target.value)}
                placeholder="cli-proxy-api-call-logs"
              />
              <Input
                label={t('usage_stats.collector_storage_kafka_usage_stats_topic')}
                value={draft.kafkaUsageStatsTopic}
                onChange={(event) => updateDraft('kafkaUsageStatsTopic', event.target.value)}
                placeholder="cli-proxy-api-usage-stats"
              />
            </div>
          )}
        </div>

        <div className={styles.collectorStoragePreview}>
          <div className={styles.collectorStoragePreviewHeader}>
            <span>{t('usage_stats.collector_storage_yaml_title')}</span>
          </div>
          <textarea
            className={`input ${styles.collectorStorageYaml}`}
            value={yaml}
            readOnly
            spellCheck={false}
            aria-label={t('usage_stats.collector_storage_yaml_title')}
          />
        </div>
      </div>
    </Card>
  );
}
