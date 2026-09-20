import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { cleanAccountName, formatDuration, formatLatency, formatTokenCount } from './logic';
import type { UsageRecord } from './types';
import styles from './UsagePage.module.scss';

interface UsageRecordsTableProps {
  records: UsageRecord[];
  hasMore: boolean;
  loading: boolean;
  onLoadMore: () => void;
}

const recordInput = (record: UsageRecord) => {
  const input = record.token_breakdown?.input;
  return (input?.uncached_tokens ?? 0) + (input?.cache_read_tokens ?? 0) + (input?.cache_write_tokens ?? 0);
};

const recordOutput = (record: UsageRecord) => {
  const output = record.token_breakdown?.output;
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
              <th>{t('usage.endpoint')}</th>
              <th>{t('usage.tokens')}</th>
              <th>{t('usage.reasoning_effort')}</th>
              <th>{t('usage.executor_type')}</th>
              <th>{t('usage.latency')}</th>
              <th>{t('usage.status')}</th>
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => {
              const input = recordInput(record);
              const output = recordOutput(record);
              const uncached = record.token_breakdown?.input?.uncached_tokens ?? 0;
              const cacheRead = record.token_breakdown?.input?.cache_read_tokens ?? 0;
              const cacheWrite = record.token_breakdown?.input?.cache_write_tokens ?? 0;
              const reasoning = record.token_breakdown?.output?.reasoning_tokens ?? 0;
              const totalTokens = record.token_breakdown?.total_tokens ?? input + output;

              const tooltipParts = [
                `${t('usage.uncached_input')}: ${uncached.toLocaleString()}`,
                `${t('usage.output')}: ${output.toLocaleString()}`,
                `${t('usage.cache_read')}: ${cacheRead.toLocaleString()}`,
                `${t('usage.cache_write')}: ${cacheWrite.toLocaleString()}`,
              ];
              if (reasoning > 0) {
                tooltipParts.push(`${t('usage.reasoning_subset')}: ${reasoning.toLocaleString()}`);
              }
              const title = tooltipParts.join(' · ');

              return (
                <tr key={`${record.timestamp}-${record.request_id ?? index}`}>
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
                  <td className={styles.accountCell} title={record.account}>
                    {cleanAccountName(record.account)}
                  </td>
                  <td className={styles.endpointCell} title={record.endpoint}>
                    {record.endpoint || '—'}
                  </td>
                  <td title={title} className={styles.tokenCell}>
                    <div title={`${totalTokens.toLocaleString()} tokens`}>{formatTokenCount(totalTokens)}</div>
                    <small
                      className={styles.secondaryCell}
                      title={`in: ${input.toLocaleString()} / out: ${output.toLocaleString()}`}
                    >
                      in:{formatTokenCount(input)} / out:{formatTokenCount(output)}
                    </small>
                  </td>
                  <td className={styles.monoCell}>
                    {record.reasoning_effort ? (
                      <span className={styles.effortBadge}>{record.reasoning_effort}</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <div className={styles.executorCell}>
                      <span>{record.executor_type || '—'}</span>
                      {record.stream && <span className={styles.streamBadge}>{t('usage.stream')}</span>}
                    </div>
                  </td>
                  <td className={styles.monoCell}>
                    <div>{formatLatency(record)}</div>
                    {record.stream && record.ttft_ms != null && record.ttft_ms > 0 && (
                      <small className={styles.secondaryCell} title="TTFT">
                        TTFT: {formatDuration(record.ttft_ms)}
                      </small>
                    )}
                  </td>
                  <td>
                    <span
                      className={`${styles.statusBadge} ${
                        record.failed ? styles.statusFailed : styles.statusOk
                      }`}
                    >
                      {record.failed ? record.status_code || 500 : record.status_code || 200}
                    </span>
                    {record.error_message && (
                      <small className={styles.errorCell} title={record.error_message}>
                        {record.error_message}
                      </small>
                    )}
                  </td>
                </tr>
              );
            })}
            {!loading && records.length === 0 && (
              <tr>
                <td colSpan={10} className={styles.emptyTable}>
                  {t('usage.no_records')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {hasMore && (
        <div className={styles.loadMore}>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            loading={loading}
            onClick={onLoadMore}
          >
            {t('usage.load_more')}
          </Button>
        </div>
      )}
    </div>
  );
}
