import type { NotificationType } from '@/types';

export interface VersionCheckResult {
  type: NotificationType;
  messageKey:
    | 'system_info.version_update_available'
    | 'system_info.version_is_latest'
    | 'system_info.version_current_missing'
    | 'system_info.version_check_error';
  version?: string;
  detail?: string;
}

const parseVersionSegments = (version?: string | null) => {
  if (!version) return null;
  const cleaned = version.trim().replace(/^v/i, '');
  if (!cleaned) return null;
  const parts = cleaned
    .split(/[^0-9]+/)
    .filter(Boolean)
    .map((segment) => Number.parseInt(segment, 10))
    .filter(Number.isFinite);
  return parts.length ? parts : null;
};

export const getVersionCheckResult = (
  latest: string,
  current?: string | null
): VersionCheckResult => {
  const version = latest.trim();
  const latestParts = parseVersionSegments(version);
  if (!latestParts) return { type: 'error', messageKey: 'system_info.version_check_error' };
  const currentParts = parseVersionSegments(current);
  if (!currentParts) return { type: 'warning', messageKey: 'system_info.version_current_missing' };

  const length = Math.max(latestParts.length, currentParts.length);
  for (let i = 0; i < length; i++) {
    const latestSegment = latestParts[i] || 0;
    const currentSegment = currentParts[i] || 0;
    if (latestSegment > currentSegment) {
      return { type: 'info', messageKey: 'system_info.version_update_available', version };
    }
    if (latestSegment < currentSegment) break;
  }
  return { type: 'success', messageKey: 'system_info.version_is_latest' };
};
