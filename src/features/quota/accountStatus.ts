/**
 * Plain-language account status derived from structured credential fields
 * (cooldown records, observed rate-limit windows, status flags), so cards never
 * have to show raw upstream error bodies or routing jargon as the headline.
 */

import type { TFunction } from 'i18next';
import type { AuthFileItem, ObservedRateLimits, RateLimitWindowId } from '@/types';
import { getAuthFileStatusMessage, hasAuthFileStatusWarning } from '@/features/authFiles/constants';
import { cooldownReasonKey } from '@/features/authFiles/cooldowns';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';

const QUOTA_COOLDOWN_REASONS = new Set(['quota', 'credential_quota']);

export type UpstreamProblem = 'rate-limited' | 'auth' | 'overloaded' | 'unknown';

export type AccountStatus =
  | { kind: 'available' }
  | { kind: 'disabled' }
  | { kind: 'limited'; window: RateLimitWindowId | null; backAtMs: number }
  | { kind: 'models-limited'; modelCount: number; backAtMs: number }
  | { kind: 'paused'; reason: string; backAtMs: number }
  | { kind: 'failing'; problem: UpstreamProblem };

export type LimitedAccountStatus = Extract<AccountStatus, { kind: 'limited' }>;

export function classifyUpstreamProblem(message: string): UpstreamProblem {
  if (/rate[\s_-]?limit|\b429\b|too many requests/i.test(message)) return 'rate-limited';
  if (
    /unauthori[sz]ed|authentication|permission_error|invalid_grant|token expired|\b401\b/i.test(
      message
    )
  )
    return 'auth';
  if (/overloaded|\b529\b/i.test(message)) return 'overloaded';
  return 'unknown';
}

function limitingWindow(rateLimits: ObservedRateLimits | undefined): RateLimitWindowId | null {
  if (!rateLimits) return null;
  return rateLimits.windows.find((window) => window.rejected)?.id ?? rateLimits.binding;
}

/**
 * Deadlines come from the server-measured `remaining_seconds` anchored to local
 * receipt, never from `retry_at` against a possibly skewed local clock.
 */
function activeCooldowns(file: AuthFileItem, nowMs: number) {
  const snapshot = file.cooldownSnapshot;
  return (snapshot?.records ?? [])
    .map((record) => ({
      record,
      backAtMs: snapshot!.receivedAtMs + record.remainingSeconds * 1000,
    }))
    .filter((cooldown) => cooldown.backAtMs > nowMs)
    .sort((a, b) => a.backAtMs - b.backAtMs);
}

export function deriveAccountStatus(file: AuthFileItem, nowMs: number): AccountStatus {
  const status = typeof file.status === 'string' ? file.status.trim().toLowerCase() : '';
  if (file.disabled === true || status === 'disabled') return { kind: 'disabled' };

  const cooldowns = activeCooldowns(file, nowMs);
  const credentialCooldown = cooldowns.find(({ record }) => record.scope === 'credential');
  if (credentialCooldown) {
    return QUOTA_COOLDOWN_REASONS.has(credentialCooldown.record.reason)
      ? {
          kind: 'limited',
          window: limitingWindow(file.rateLimits),
          backAtMs: credentialCooldown.backAtMs,
        }
      : {
          kind: 'paused',
          reason: credentialCooldown.record.reason,
          backAtMs: credentialCooldown.backAtMs,
        };
  }

  const rejected = file.rateLimits?.windows.find(
    (window) => window.rejected && window.resetAtMs !== null && window.resetAtMs > nowMs
  );
  if (rejected) return { kind: 'limited', window: rejected.id, backAtMs: rejected.resetAtMs! };

  const quotaModels = cooldowns.filter(({ record }) => QUOTA_COOLDOWN_REASONS.has(record.reason));
  if (quotaModels.length > 0) {
    return {
      kind: 'models-limited',
      modelCount: quotaModels.length,
      backAtMs: quotaModels[0].backAtMs,
    };
  }
  if (cooldowns.length > 0) {
    return { kind: 'paused', reason: cooldowns[0].record.reason, backAtMs: cooldowns[0].backAtMs };
  }

  if (status === 'error' || file.unavailable === true || hasAuthFileStatusWarning(file)) {
    return { kind: 'failing', problem: classifyUpstreamProblem(getAuthFileStatusMessage(file)) };
  }
  return { kind: 'available' };
}

export type StatusTone = 'danger' | 'warning' | 'muted' | 'ok';

export interface StatusDescription {
  tone: StatusTone;
  headline: string;
  /** e.g. "back at 17:20 (in 3 hours)"; null when there is no deadline. */
  when: string | null;
}

/** `17:20` today, `Sun 05:00` on another day — always 24-hour, browser-local. */
export function formatClockTime(atMs: number, nowMs: number, locale?: string): string {
  const sameDay = new Date(atMs).toDateString() === new Date(nowMs).toDateString();
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    ...(sameDay ? {} : { weekday: 'short' }),
  };
  try {
    return new Intl.DateTimeFormat(locale, options).format(atMs);
  } catch {
    return new Intl.DateTimeFormat(undefined, options).format(atMs);
  }
}

export function formatBackAt(
  t: TFunction,
  key: 'back_at' | 'retry_at',
  atMs: number,
  nowMs: number,
  locale?: string
): string {
  return t(`account_status.${key}`, {
    time: formatClockTime(atMs, nowMs, locale),
    relative: formatRelativeInstant(atMs, nowMs, locale),
  });
}

export function describeAccountStatus(
  status: AccountStatus,
  t: TFunction,
  nowMs: number,
  locale?: string
): StatusDescription {
  switch (status.kind) {
    case 'available':
      return { tone: 'ok', headline: t('account_status.available'), when: null };
    case 'disabled':
      return { tone: 'muted', headline: t('account_status.disabled'), when: null };
    case 'limited':
      return {
        tone: 'danger',
        headline: status.window
          ? t('account_status.window_limit_reached', {
              window: t(`account_status.window_${status.window}`),
            })
          : t('account_status.limit_reached'),
        when: formatBackAt(t, 'back_at', status.backAtMs, nowMs, locale),
      };
    case 'models-limited':
      return {
        tone: 'warning',
        headline: t('account_status.models_limited', { count: status.modelCount }),
        when: formatBackAt(t, 'back_at', status.backAtMs, nowMs, locale),
      };
    case 'paused':
      return {
        tone: 'warning',
        headline: t('account_status.paused', { reason: t(cooldownReasonKey(status.reason)) }),
        when: formatBackAt(t, 'retry_at', status.backAtMs, nowMs, locale),
      };
    case 'failing':
      return {
        tone: status.problem === 'auth' ? 'danger' : 'warning',
        headline: t(`account_status.failing_${status.problem.replace('-', '_')}`),
        when: null,
      };
  }
}

/** Pretty-print a JSON upstream body for the details disclosure; other text passes through. */
export function formatRawStatusMessage(message: string): string {
  try {
    return JSON.stringify(JSON.parse(message), null, 2);
  } catch {
    return message;
  }
}
