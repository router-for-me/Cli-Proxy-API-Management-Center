import { memo, type ChangeEventHandler, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import styles from '@/pages/UsagePage.module.scss';

interface TimeRangeOption {
  value: string;
  label: string;
}

export interface UsagePageHeroProps {
  timeRange: string;
  timeRangeOptions: ReadonlyArray<TimeRangeOption>;
  selectedRangeLabel: string;
  visibleModelCount: number;
  selectedSeriesCount: number;
  lastRefreshedAt: Date | null;
  loading: boolean;
  exporting: boolean;
  importing: boolean;
  onTimeRangeChange: (value: string) => void;
  onExport: () => void;
  onImport: () => void;
  onRefresh: () => void;
  importInputRef: RefObject<HTMLInputElement | null>;
  onImportChange: ChangeEventHandler<HTMLInputElement>;
}

export const UsagePageHero = memo(function UsagePageHero({
  timeRange,
  timeRangeOptions,
  selectedRangeLabel,
  visibleModelCount,
  selectedSeriesCount,
  lastRefreshedAt,
  loading,
  exporting,
  importing,
  onTimeRangeChange,
  onExport,
  onImport,
  onRefresh,
  importInputRef,
  onImportChange,
}: UsagePageHeroProps) {
  const { t } = useTranslation();

  return (
    <section className={styles.hero}>
      <div className={styles.heroCopy}>
        <h1 className={styles.pageTitle}>{t('usage_stats.title')}</h1>
        <p className={styles.pageSubtitle}>{t('usage_stats.subtitle')}</p>
        <div className={styles.heroMeta}>
          <div className={styles.heroChip}>
            <span className={styles.heroChipLabel}>{t('usage_stats.range_filter')}</span>
            <span className={styles.heroChipValue}>{selectedRangeLabel}</span>
          </div>
          <div className={styles.heroChip}>
            <span className={styles.heroChipLabel}>{t('usage_stats.model_price_model')}</span>
            <span className={styles.heroChipValue}>{visibleModelCount}</span>
          </div>
          <div className={styles.heroChip}>
            <span className={styles.heroChipLabel}>{t('usage_stats.chart_series')}</span>
            <span className={styles.heroChipValue}>{selectedSeriesCount}</span>
          </div>
          {lastRefreshedAt && (
            <div className={styles.heroChip}>
              <span className={styles.heroChipLabel}>{t('usage_stats.last_updated')}</span>
              <span className={styles.heroChipValue}>{lastRefreshedAt.toLocaleString()}</span>
            </div>
          )}
        </div>
      </div>

      <div className={styles.heroActions}>
        <div className={styles.timeRangeGroup}>
          <span className={styles.timeRangeLabel}>{t('usage_stats.range_filter')}</span>
          <Select
            value={timeRange}
            options={timeRangeOptions}
            onChange={onTimeRangeChange}
            className={styles.timeRangeSelectControl}
            ariaLabel={t('usage_stats.range_filter')}
            fullWidth={false}
          />
        </div>

        <div className={styles.actionGrid}>
          <Button
            variant="secondary"
            size="sm"
            onClick={onExport}
            loading={exporting}
            disabled={loading || importing}
          >
            {t('usage_stats.export')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onImport}
            loading={importing}
            disabled={loading || exporting}
          >
            {t('usage_stats.import')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={onRefresh}
            disabled={loading || exporting || importing}
          >
            {loading ? t('common.loading') : t('usage_stats.refresh')}
          </Button>
        </div>

        <input
          ref={importInputRef}
          type="file"
          accept=".json,application/json"
          style={{ display: 'none' }}
          onChange={onImportChange}
        />
      </div>
    </section>
  );
});

UsagePageHero.displayName = 'UsagePageHero';
