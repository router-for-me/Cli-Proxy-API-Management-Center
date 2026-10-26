import type { TFunction } from 'i18next';
import type { ClaudeQuotaState, ObservedRateLimits } from '@/types';
import type { AccountStatus } from '../../accountStatus';
import { claudePeriodHours } from '@/utils/quota/resetInstants';
import { formatInstantShort } from '@/utils/quota/relativeTime';

const WINDOW_SHAPES = {
  'five-hour': { labelKey: 'claude_quota.five_hour', payloadKey: 'five_hour' },
  'seven-day': { labelKey: 'claude_quota.seven_day', payloadKey: 'seven_day' },
} as const;

/**
 * Present the proxy's passive rate-limit observation in the same shape as a
 * loaded usage read, so the card body, timeline and pool render it unchanged
 * without calling the upstream usage endpoint.
 *
 * The observation is the last upstream response; an active limit on a window
 * is newer evidence, so that window reads as fully used.
 */
export function claudeQuotaFromObservation({
  observation,
  status,
  t,
}: {
  observation: ObservedRateLimits;
  status: AccountStatus;
  t: TFunction;
}): ClaudeQuotaState {
  const limitedWindow = status.kind === 'limited' ? status.window : null;
  return {
    status: 'success',
    observedAt: observation.observedAt,
    windows: observation.windows.map((window) => {
      const shape = WINDOW_SHAPES[window.id];
      return {
        id: window.id,
        label: t(shape.labelKey),
        labelKey: shape.labelKey,
        usedPercent: window.id === limitedWindow ? 100 : window.usedPercent,
        resetLabel: window.resetAtMs === null ? '-' : formatInstantShort(window.resetAtMs),
        resetAtMs: window.resetAtMs,
        periodHours: claudePeriodHours(shape.payloadKey),
      };
    }),
  };
}
