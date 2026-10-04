import { buildResetDisplay, formatRelativeInstant, type ResetDisplay } from '@/utils/quota';

export interface QuotaObservation {
  capturedAt?: string;
  source?: string;
}

/** Record a provider response once; reading or enriching the cache never renews it. */
export function withQuotaObservation<T extends QuotaObservation>(state: T, capturedAt: string): T {
  return { ...state, capturedAt: state.capturedAt ?? capturedAt, source: 'provider_query' };
}

export function observationAge(capturedAt: string | undefined, now: number) {
  const captured = capturedAt ? Date.parse(capturedAt) : NaN;
  if (!Number.isFinite(captured)) return null;
  const seconds = Math.max(0, Math.floor((now - captured) / 1000));
  const unit =
    seconds < 60 ? 'second' : seconds < 3600 ? 'minute' : seconds < 86400 ? 'hour' : 'day';
  const value = Math.floor(seconds / { second: 1, minute: 60, hour: 3600, day: 86400 }[unit]);
  return {
    captured,
    compact: new Intl.NumberFormat(undefined, {
      style: 'unit',
      unit,
      unitDisplay: 'narrow',
      maximumFractionDigits: 0,
    }).format(value),
    relative: new Intl.RelativeTimeFormat(undefined, { numeric: 'always' }).format(-value, unit),
    timestamp: new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'long',
    }).format(captured),
    stale: seconds > 900,
  };
}

/** Auth Files respects browser regional preferences, including 12/24-hour time. */
export function browserResetDisplay(
  ...[absolute, atMs, now]: Parameters<typeof buildResetDisplay>
): ResetDisplay | null {
  if (typeof atMs !== 'number' || !Number.isFinite(atMs)) {
    return buildResetDisplay(absolute, atMs, now);
  }
  return {
    absolute: new Intl.DateTimeFormat(undefined, {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(atMs),
    relative: formatRelativeInstant(atMs, now),
  };
}
