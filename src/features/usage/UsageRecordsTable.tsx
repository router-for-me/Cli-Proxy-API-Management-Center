import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { formatLatency, formatTokenCount } from './logic';
import type { UsageRecord } from './types';
import styles from './UsagePage.module.scss';

interface UsageRecordsTableProps {
  records: UsageRecord[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}

const recordInput = (record: UsageRecord) => {
  const input = record.token_breakdown.input;
  return (input?.uncached_tokens ?? 0) + (input?.cache_read_tokens ?? 0) + (input?.cache_write_tokens ?? 0);
};

const recordOutput = (record: UsageRecord) => {
  const output = record.token_breakdown.output;
  return (output?.non_reasoning_tokens ?? 0) + (output?.reasoning_tokens ?? 0);
};

export function UsageRecordsTable({
  records,
  hasMore,
  loading,
  onLoadMore,
}: UsageRecordsTableProps) {
  const { t, i18n } = useTranslation();

  return (
    <div className={styles.recordsWrap}>
      <div className={styles.tableScroll}>
        <table className={styles.recordsTable}>
          <thead>
            <tr>
              <th>{t('usage.time')}</th>
              <th>{t('usage.provider')}</th>
              <th>{t('usage.model')}</th>
              <th>{t('usage.account')}</th>
              <th>{t('usage.tokens')}</th>
              <th>{t('usage.latency')}</th>
              <th>{t('usage.status')}</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record) => {
              const input = recordInput(record);
              const output = recordOutput(record);
              const title = [
                `${t('usage.input')}: ${formatTokenCount(input)}`,
                `${t('usage.output')}: ${formatTokenCount(output)}`,
                `${t('usage.cache_read')}: ${formatTokenCount(record.token_breakdown.input?.cache_read_tokens ?? 0)}`,
                `${t('usage.cache_write')}: ${formatTokenCount(record.token_breakdown.input?.cache_write_tokens ?? 0)}`,
                `${t('usage.reasoning')}: ${formatTokenCount(record.token_breakdown.output?.reasoning_tokens ?? 0)}`,
              ].join(' · ');
              return (
                <tr key={`${record.timestamp}-${record.request_id ?? record.model}`}>
                  <td className={styles.monoCell}>
                    {new Date(record.timestamp).toLocaleString(i18n.language)}
                  </td>
                  <td>{record.provider || '—'}</td>
                  <td>
                    <span className={styles.modelCell}>{record.alias || record.model || '—'}</span>
                    {record.alias && record.alias !== record.model && (
                      <small className={styles.secondaryCell}>{record.model}</small>
                    )}
                  </td>
                  <td className={styles.accountCell}>{record.account || '—'}</td>
                  <td title={title} className={styles.tokenCell}>
                    {formatTokenCount(record.token_breakdown.total_tokens ?? input + output)}
                  </td>
                  <td className={styles.monoCell}>{formatLatency(record)}</td>
                  <td>
                    <span className={`${styles.statusBadge} ${record.failed ? styles.statusFailed : styles.statusOk}`}>
                      {record.failed ? record.status_code || 500 : record.status_code || 200}
                    </span>
                    {record.error_message && <small className={styles.errorCell}>{record.error_message}</small>}
                  </td>
                </tr>
              );
            })}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={7} className={styles.emptyTable}>{t('usage.no_records')}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className={styles.loadMore}>
          <Button type="button" size="sm" variant="secondary" loading={loading} onClick={onLoadMore}>
            {t('usage.load_more')}
          </Button>
        </div>
      )}
    </div>
  );
}
