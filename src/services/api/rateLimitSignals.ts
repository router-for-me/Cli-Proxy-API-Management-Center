import type {
  ObservedRateLimitWindow,
  ObservedRateLimits,
  RateLimitWindowId,
} from '@/types/authFile';
import { isRecord } from '@/utils/helpers';
import { parseUnixToMs } from '@/utils/quota/resetInstants';
import { normalizeCooldownTimestamp } from './authFileCooldowns';

const UNIFIED_PREFIX = 'anthropic-ratelimit-unified-';

const WINDOW_HEADER_KEYS: Record<RateLimitWindowId, string> = {
  'five-hour': '5h',
  'seven-day': '7d',
};

const CLAIM_WINDOWS: Record<string, RateLimitWindowId> = {
  five_hour: 'five-hour',
  seven_day: 'seven-day',
};

function readSnapshot(value: unknown): ObservedRateLimits | null {
  if (!isRecord(value) || !isRecord(value.signals)) return null;
  const observedAt = normalizeCooldownTimestamp(value.observed_at);
  if (!observedAt) return null;

  const signals = new Map<string, string>();
  Object.entries(value.signals).forEach(([key, signal]) => {
    if (typeof signal === 'string') signals.set(key.trim().toLowerCase(), signal.trim());
  });
  const read = (suffix: string) => signals.get(`${UNIFIED_PREFIX}${suffix}`);

  const windows = (Object.keys(WINDOW_HEADER_KEYS) as RateLimitWindowId[])
    .map((id): ObservedRateLimitWindow | null => {
      const key = WINDOW_HEADER_KEYS[id];
      const utilization = Number(read(`${key}-utilization`));
      if (!Number.isFinite(utilization) || utilization < 0) return null;
      return {
        id,
        usedPercent: utilization * 100,
        resetAtMs: parseUnixToMs(read(`${key}-reset`)),
        rejected: read(`${key}-status`)?.toLowerCase() === 'rejected',
      };
    })
    .filter((window): window is ObservedRateLimitWindow => window !== null);
  if (windows.length === 0) return null;

  const claim = read('representative-claim')?.toLowerCase() ?? '';
  return { observedAt, windows, binding: CLAIM_WINDOWS[claim] ?? null };
}

/**
 * Usage only grows inside one window instance, so snapshots that share a reset
 * instant merge to their highest reading; a later reset instant supersedes.
 */
function mergeWindow(
  current: ObservedRateLimitWindow | undefined,
  next: ObservedRateLimitWindow
): ObservedRateLimitWindow {
  if (!current) return next;
  const currentReset = current.resetAtMs ?? 0;
  const nextReset = next.resetAtMs ?? 0;
  if (nextReset !== currentReset) return nextReset > currentReset ? next : current;
  return {
    ...current,
    usedPercent: Math.max(current.usedPercent, next.usedPercent),
    rejected: current.rejected || next.rejected,
  };
}

/**
 * Read the backend's passive observations: the Anthropic unified rate-limit
 * headers of the credential's last upstream response (`quota`) and of the last
 * response per model (`model_quotas`). The unified limits are account-wide, so
 * every snapshot describes the same windows.
 */
export function normalizeObservedRateLimits(
  quota: unknown,
  modelQuotas?: unknown
): ObservedRateLimits | undefined {
  const snapshots = [quota, ...(isRecord(modelQuotas) ? Object.values(modelQuotas) : [])]
    .map(readSnapshot)
    .filter((snapshot): snapshot is ObservedRateLimits => snapshot !== null)
    .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  const latest = snapshots[snapshots.length - 1];
  if (!latest) return undefined;

  const windows = new Map<RateLimitWindowId, ObservedRateLimitWindow>();
  snapshots.forEach((snapshot) =>
    snapshot.windows.forEach((window) =>
      windows.set(window.id, mergeWindow(windows.get(window.id), window))
    )
  );
  return {
    observedAt: latest.observedAt,
    windows: (Object.keys(WINDOW_HEADER_KEYS) as RateLimitWindowId[])
      .map((id) => windows.get(id))
      .filter((window): window is ObservedRateLimitWindow => window !== undefined),
    binding: latest.binding,
  };
}
