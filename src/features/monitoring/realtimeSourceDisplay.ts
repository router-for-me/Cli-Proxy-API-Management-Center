import type { TFunction } from 'i18next';
import type { MonitoringEventRow } from '@/features/monitoring/hooks/useMonitoringData';

const hasReadableRealtimeValue = (value: string | null | undefined) => {
  const trimmed = String(value || '').trim();
  return Boolean(trimmed) && trimmed !== '-';
};

export const buildRealtimeSourceDisplay = (
  row: Pick<
    MonitoringEventRow,
    | 'account'
    | 'accountMasked'
    | 'authLabel'
    | 'channel'
    | 'channelHost'
    | 'provider'
    | 'sourceMasked'
  >,
  t: TFunction
) => {
  const channel = hasReadableRealtimeValue(row.channel) ? row.channel.trim() : '';
  const provider = hasReadableRealtimeValue(row.provider) ? row.provider.trim() : '';
  const host = hasReadableRealtimeValue(row.channelHost) ? row.channelHost.trim() : '';
  const account = [row.account, row.authLabel, row.accountMasked]
    .find(hasReadableRealtimeValue)
    ?.trim();
  const source = hasReadableRealtimeValue(row.sourceMasked) ? row.sourceMasked.trim() : '';
  const primary = channel || provider || host || account || source || '-';
  const metaCandidate = [
    { value: provider, label: t('monitoring.filter_provider') },
    { value: host, label: t('monitoring.column_host') },
    { value: account, label: '' },
    { value: source, label: t('monitoring.source') },
  ].find((candidate) => candidate.value && candidate.value !== primary);
  const meta =
    metaCandidate && metaCandidate.label
      ? `${metaCandidate.label}: ${metaCandidate.value}`
      : metaCandidate?.value || '';

  return {
    primary,
    meta,
  };
};
