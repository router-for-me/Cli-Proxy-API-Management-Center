import { useTranslation } from 'react-i18next';
import type { AnalyticsRequest, AnalyticsResponse } from '@/domain/analytics/types';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { CopyButton } from '@/features/oauth/components/CopyButton';
import { analyticsNumber, analyticsTime } from './format';
import styles from './AnalyticsPage.module.scss';

/** Explicit projection: extra transport properties never become a raw-data inspector. */
const detailFields = [
  'id',
  'request_id',
  'execution_id',
  'parent_execution_id',
  'record_kind',
  'usage_presence',
  'instance_id',
  'provider',
  'model',
  'requested_model',
  'resolved_model',
  'response_model',
  'status_code',
  'method',
  'path',
  'stream',
  'service_tier',
  'requested_service_tier',
  'effective_service_tier',
  'reasoning_effort',
  'executor_type',
  'account_label',
  'session_id',
  'parent_session_id',
  'trace_id',
  'client_ip',
  'user_agent',
  'error_summary',
  'input_tokens',
  'uncached_input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_creation_tokens',
  'reasoning_tokens',
  'total_tokens',
  'latency_ms',
  'ttft_ms',
  'output_tokens_per_second',
  'timing_method',
] as const satisfies readonly (keyof AnalyticsRequest)[];

/** Fields a search can match on; shown only when present, so a hit visibly says why it matched. */
const copyableFields = [
  'header_trace_id',
  'auth_file_snapshot',
] as const satisfies readonly (keyof AnalyticsRequest)[];

export function RequestDetails({ request }: { request: AnalyticsRequest }) {
  const { t, i18n } = useTranslation();
  return (
    <>
      <p className={styles.muted}>{t('analytics.detail_note')}</p>
      <dl className={styles.details}>
        <dt>{t('analytics.timestamp')}</dt>
        <dd>{analyticsTime(request.timestamp_ms, i18n.language)} UTC</dd>
        <dt>{t('analytics.outcome')}</dt>
        <dd>{t(`analytics.${request.failed ? 'failed_outcome' : 'success'}`)}</dd>
        {request.fail_summary && (
          <div className={styles.detailPair}>
            <dt>{t('analytics.fields.fail_summary')}</dt>
            <dd>
              <div
                className={styles.failureText}
                role="region"
                tabIndex={0}
                aria-label={t('analytics.fields.fail_summary')}
              >
                {request.fail_summary}
              </div>
            </dd>
          </div>
        )}
        {copyableFields.map((field) => {
          const value = request[field];
          if (!value) return null;
          const label = t(`analytics.fields.${field}`);
          return (
            <div key={field} className={styles.detailPair}>
              <dt>{label}</dt>
              <dd className={styles.copyValue}>
                <span className={styles.copyValueText}>{value}</span>
                <CopyButton value={value} label={t('analytics.copy_field', { field: label })} />
              </dd>
            </div>
          );
        })}
        {detailFields.map((field) => {
          const value = request[field];
          return (
            <div key={field} className={styles.detailPair}>
              <dt>{t(`analytics.fields.${field}`)}</dt>
              <dd>
                {value === undefined || value === null || value === ''
                  ? t('analytics.not_reported')
                  : field === 'record_kind' || field === 'usage_presence'
                    ? t(`analytics.presence_values.${value}`)
                    : typeof value === 'boolean'
                      ? t(`analytics.${value ? 'yes' : 'no'}`)
                      : typeof value === 'number'
                        ? analyticsNumber(value, i18n.language)
                        : value}
              </dd>
            </div>
          );
        })}
        <dt>{t('analytics.timing.origin')}</dt>
        <dd>
          {request.timing ? t('analytics.timing.execution_start') : t('analytics.not_reported')}
        </dd>
        {(
          ['upstream_start_ms', 'first_response_ms', 'first_content_ms', 'recorded_ms'] as const
        ).map((field) => (
          <div className={styles.detailPair} key={field}>
            <dt>{t(`analytics.timing.${field}`)}</dt>
            <dd>{analyticsNumber(request.timing?.[field], i18n.language)}</dd>
          </div>
        ))}
        <dt>{t('analytics.estimated_cost')}</dt>
        <dd>
          {analyticsNumber(request.cost.usd, i18n.language, true)} ·{' '}
          {t(`analytics.price_status.${request.cost.status}`)}
        </dd>
        {request.cost.reasons.length > 0 && (
          <>
            <dt>{t('analytics.price_reasons')}</dt>
            <dd>{request.cost.reasons.join(' · ')}</dd>
          </>
        )}
      </dl>
      <p className={styles.muted}>{t('analytics.price_note')}</p>
      <p className={styles.muted}>{t('analytics.timing_note')}</p>
    </>
  );
}

export function RequestTable({
  data,
  selected,
  onSelect,
  onPrevious,
  onNext,
  canPrevious,
  canNext,
  page,
  providerLabels,
}: {
  data: AnalyticsResponse['requests'];
  selected: AnalyticsRequest | null;
  onSelect: (request: AnalyticsRequest | null) => void;
  onPrevious: () => void;
  onNext: () => void;
  canPrevious: boolean;
  canNext: boolean;
  page: number;
  /** Server display names for provider keys, as used by the breakdown charts. */
  providerLabels?: ReadonlyMap<string, string>;
}) {
  const { t, i18n } = useTranslation();
  const n = (value: number | null, currency = false) =>
    analyticsNumber(value, i18n.language, currency);
  return (
    <section className={`${styles.panel} ${styles.tablePanel}`}>
      <div className={styles.sectionHeader}>
        <h2>{t('analytics.tabs.requests')}</h2>
        <span className={styles.muted}>
          {t('analytics.event_count', { count: data.total_count })}
        </span>
      </div>
      {data.items.length === 0 ? (
        <p>{t('analytics.empty')}</p>
      ) : (
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label={t('analytics.tabs.requests')}
        >
          <table className={`${styles.requests} ${styles.stacked}`}>
            <caption className={styles.srOnly}>{t('analytics.tabs.requests')}</caption>
            <thead>
              <tr>
                {[
                  'timestamp',
                  'provider_model',
                  'outcome',
                  'tokens_in_out',
                  'cache_read_write',
                  'estimated_cost',
                  'duration',
                  'details',
                ].map((key) => (
                  <th scope="col" key={key}>
                    {t(`analytics.${key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.items.map((r) => (
                <tr key={r.id}>
                  <td data-label={t('analytics.timestamp')}>
                    {analyticsTime(r.timestamp_ms, i18n.language)}
                  </td>
                  <td data-label={t('analytics.provider_model')}>
                    <strong>{r.model}</strong>
                    <small className={styles.providerName} data-provider={r.provider}>
                      {providerLabels?.get(r.provider) ?? r.provider}
                    </small>
                    {r.requested_model && r.requested_model !== r.model && (
                      <small>
                        {`${t('analytics.fields.requested_model')}: ${r.requested_model}`}
                      </small>
                    )}
                  </td>
                  <td data-label={t('analytics.outcome')}>
                    <span className={r.failed ? styles.failure : styles.success}>
                      {t(`analytics.${r.failed ? 'failed_outcome' : 'success'}`)}
                    </span>
                    {r.status_code !== undefined && <small>{r.status_code}</small>}
                  </td>
                  <td data-label={t('analytics.tokens_in_out')} data-numeric>
                    {n(r.input_tokens)} / {n(r.output_tokens)}
                    <small>{t(`analytics.presence_values.${r.usage_presence ?? 'unknown'}`)}</small>
                  </td>
                  <td data-label={t('analytics.cache_read_write')} data-numeric>
                    {n(r.cache_read_tokens)} / {n(r.cache_creation_tokens)}
                  </td>
                  <td data-label={t('analytics.estimated_cost')} data-numeric>
                    {n(r.cost.usd, true)}
                    <small>{t(`analytics.price_status.${r.cost.status}`)}</small>
                  </td>
                  <td data-label={t('analytics.duration')} data-numeric>
                    {n(r.latency_ms)}
                  </td>
                  <td>
                    <Button
                      variant="secondary"
                      size="sm"
                      className={styles.rowAction}
                      onClick={() => onSelect(r)}
                      aria-label={t('analytics.open_request', { id: r.id })}
                    >
                      {t('analytics.details')}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={styles.pagination}>
        <Button variant="secondary" size="sm" disabled={!canPrevious} onClick={onPrevious}>
          {t('analytics.previous')}
        </Button>
        <span>{t('analytics.page', { page })}</span>
        <Button variant="secondary" size="sm" disabled={!canNext} onClick={onNext}>
          {t('analytics.next')}
        </Button>
      </div>
      <Modal
        open={selected !== null}
        title={t('analytics.request_detail')}
        width={740}
        onClose={() => onSelect(null)}
      >
        {selected && <RequestDetails request={selected} />}
      </Modal>
    </section>
  );
}
