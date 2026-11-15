import { useTranslation } from 'react-i18next';
import { useSecondNow } from '@/hooks/useNow';
import { formatReadTime, quotaAge } from '../quotaFreshness';

/**
 * "updated 25s ago": when this card's quota was last read. A refresh within a minute of that
 * reuses the reading, so the label says how current the shown numbers are. Its own component so
 * only this text re-renders every second.
 */
export function QuotaFreshness({
  fetchedAt,
  className,
  now: fixedNow,
  nextReadAtMs,
}: {
  fetchedAt: number | undefined;
  className?: string;
  /** Fixed time, for static rendering. */
  now?: number;
  /** A served credential's Refresh was skipped by the server's read floor: when the next read may run. */
  nextReadAtMs?: number;
}) {
  const { t, i18n } = useTranslation();
  const ticking = useSecondNow(fetchedAt !== undefined && fixedNow === undefined);
  const now = fixedNow ?? ticking;
  const age = quotaAge(fetchedAt, now);
  if (!age) return null;
  const waiting = nextReadAtMs !== undefined && nextReadAtMs > now;
  return (
    <span
      className={className}
      data-quota-fetched-at={fetchedAt}
      data-quota-next-read-at={waiting ? nextReadAtMs : undefined}
    >
      {t(`auth_files.quota_updated_${age.unit}`, { count: age.count })}
      {waiting &&
        ` · ${t('auth_files.quota_next_read', { time: formatReadTime(nextReadAtMs, i18n.language) })}`}
    </span>
  );
}
