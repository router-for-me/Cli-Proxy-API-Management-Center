import { formatDateTimeValue } from '@/utils/format';
import { isRecord } from '@/utils/helpers';

export const PLUGIN_STORE_RATE_LIMITED_CODE = 'plugin_store_rate_limited';

/**
 * Viewer-local label for when a rate-limited plugin store request may be retried.
 *
 * The management API reports `retry_at` as UTC RFC3339, which operators cannot
 * read at a glance. Returns null unless the error carries the rate-limit code and
 * a parseable `retry_at`, so callers keep the server message in every other case.
 */
export function formatPluginStoreRetryTime(error: unknown, locale?: string): string | null {
  if (!isRecord(error) || error.apiCode !== PLUGIN_STORE_RATE_LIMITED_CODE) return null;
  const retryAt = isRecord(error.details) ? error.details.retry_at : undefined;
  if (typeof retryAt !== 'string' || !Number.isFinite(Date.parse(retryAt))) return null;
  return formatDateTimeValue(retryAt, locale) || null;
}
