/**
 * The one rule for re-reading quota: a credential whose quota was read successfully less than
 * QUOTA_REUSE_WINDOW_MS ago is reused, everything else is read again. Every refresh path (the
 * header, Auth Files' page and group buttons, a card's own icon, the Quota page) asks this module.
 * React-free; tests/quotaFreshness.test.ts consumes it directly.
 */
import type { AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';

export const QUOTA_REUSE_WINDOW_MS = 60_000;

/** When each credential's quota was last read successfully, by quota cache key. */
export type QuotaFetchTimes = Readonly<Record<string, number>>;

/** True when this read is recent enough to reuse. A time ahead of `now` is not trusted. */
export function isQuotaFresh(fetchedAt: number | undefined, now: number): boolean {
  if (fetchedAt === undefined) return false;
  const age = now - fetchedAt;
  return age >= 0 && age < QUOTA_REUSE_WINDOW_MS;
}

/** Splits refresh targets into those to read and those read recently enough to reuse. */
export function splitQuotaTargets<T extends { file: AuthFileItem }>(
  targets: readonly T[],
  fetchedAt: QuotaFetchTimes,
  now: number
): { due: T[]; reused: T[] } {
  const due: T[] = [];
  const reused: T[] = [];
  for (const target of targets) {
    (isQuotaFresh(fetchedAt[getQuotaCacheKey(target.file)], now) ? reused : due).push(target);
  }
  return { due, reused };
}

/** `HH:MM` in the viewer's locale and time zone: when the server's next read may run. */
export function formatReadTime(ms: number, language: string): string {
  return new Date(ms).toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit' });
}

export type QuotaAge = { unit: 'seconds' | 'minutes' | 'hours'; count: number };

/** How long ago a read happened, in the unit a card shows ("updated 25s ago"). */
export function quotaAge(fetchedAt: number | undefined, now: number): QuotaAge | null {
  if (fetchedAt === undefined) return null;
  const seconds = Math.max(0, Math.floor((now - fetchedAt) / 1000));
  if (seconds < 60) return { unit: 'seconds', count: seconds };
  if (seconds < 3600) return { unit: 'minutes', count: Math.floor(seconds / 60) };
  return { unit: 'hours', count: Math.floor(seconds / 3600) };
}
