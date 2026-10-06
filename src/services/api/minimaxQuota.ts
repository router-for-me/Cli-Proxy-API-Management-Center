import type { MinimaxQuotaData, MinimaxQuotaWindow } from '@/types';
import { isRecord } from '@/utils/helpers';

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

/**
 * MiniMax reports the remaining share of a window directly, so the value is
 * already a percentage rather than a used/consumed pair.
 */
const parseRemainingPercent = (value: unknown): number | null => {
  let parsed: number;
  if (typeof value === 'number') {
    parsed = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    parsed = Number(value);
  } else {
    return null;
  }
  if (!Number.isFinite(parsed)) return null;
  return Math.min(100, Math.max(0, parsed));
};

const parseEpochMs = (value: unknown): number | undefined => {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return parsed;
};

const buildWindow = (id: MinimaxQuotaWindow['id'], raw: unknown): MinimaxQuotaWindow | null => {
  const record = asRecord(raw);
  const remainingPercent = parseRemainingPercent(
    id === 'interval'
      ? record.current_interval_remaining_percent
      : record.current_weekly_remaining_percent
  );
  if (remainingPercent === null) return null;
  const resetAt = parseEpochMs(id === 'interval' ? record.end_time : record.weekly_end_time);
  const modelName =
    typeof record.model_name === 'string' && record.model_name.trim() !== ''
      ? record.model_name.trim()
      : undefined;
  return {
    id,
    remainingPercent,
    ...(resetAt === undefined ? {} : { resetAt }),
    ...(modelName === undefined ? {} : { modelName }),
  };
};

/**
 * Parses a /v1/token_plan/remains payload. The response reports one entry per
 * model, so entries are merged by window id and the lowest remaining share wins
 * — the panel should show the most constrained window.
 */
export function parseMinimaxQuotaPayload(payload: unknown): MinimaxQuotaData | null {
  const root = asRecord(payload);
  const remains = Array.isArray(root.model_remains) ? root.model_remains : [];
  if (remains.length === 0) return null;

  const windows: MinimaxQuotaWindow[] = [];
  for (const id of ['interval', 'weekly'] as const) {
    let best: MinimaxQuotaWindow | null = null;
    for (const entry of remains) {
      const window = buildWindow(id, entry);
      if (!window) continue;
      if (!best || window.remainingPercent < best.remainingPercent) {
        best = window;
      }
    }
    if (best) windows.push(best);
  }
  if (windows.length === 0) return null;
  return { windows };
}
