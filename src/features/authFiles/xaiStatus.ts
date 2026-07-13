import type { AuthFileItem } from '@/types';

export const XAI_STATUS_FILTERS = [
  'all',
  'working',
  'cooldown',
  'denied_403',
  'other_403',
] as const;

export type XaiStatusFilter = (typeof XAI_STATUS_FILTERS)[number];
export type XaiAccountStatus = {
  kind: Exclude<XaiStatusFilter, 'all'> | 'other';
  cooldownUntil: Date | null;
};

const readNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && Number.isFinite(Number(value))
      ? Number(value)
      : null;

const readCooldownUntil = (file: AuthFileItem): Date | null => {
  const value = file.xai_cooldown_until;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const isPermissionDenied = (file: AuthFileItem): boolean => {
  const reason = String(
    file.disabled_reason ?? file.status_message ?? file.statusMessage ?? ''
  ).toLowerCase();
  return reason.includes('permission-denied') || reason.includes('access denied');
};

export const getXaiAccountStatus = (file: AuthFileItem, now = Date.now()): XaiAccountStatus => {
  const statusCode = readNumber(file.xai_last_error_status);
  const cooldownUntil = readCooldownUntil(file);
  const cooldownActive = cooldownUntil !== null && cooldownUntil.getTime() > now;
  const permissionDenied = statusCode === 403 && isPermissionDenied(file);

  if (permissionDenied) return { kind: 'denied_403', cooldownUntil };
  if (statusCode === 403) return { kind: 'other_403', cooldownUntil };
  if (cooldownActive) return { kind: 'cooldown', cooldownUntil };
  if (
    file.disabled !== true &&
    file.unavailable !== true &&
    (statusCode === null || statusCode < 400)
  ) {
    return { kind: 'working', cooldownUntil };
  }
  return { kind: 'other', cooldownUntil };
};

export const matchesXaiStatusFilter = (
  file: AuthFileItem,
  filter: XaiStatusFilter,
  now?: number
): boolean => filter === 'all' || getXaiAccountStatus(file, now).kind === filter;
