/**
 * Forecast preferences, persisted in localStorage so the chosen view and
 * capacity weights survive reloads.
 */

import { useCallback, useMemo } from 'react';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { isRecord } from '@/utils/helpers';
import { FUTURE_USAGE_MULTIPLIERS, type FutureUsage } from './model';

export type ForecastView = 'remaining' | 'drain';

export const FORECAST_VIEWS: readonly ForecastView[] = ['remaining', 'drain'];
export const BURN_WINDOW_HOURS: readonly number[] = [1, 3, 6, 24, 72];
/** Whole days for day-sized burn windows (24h -> 1), else null. */
export const burnWindowDays = (hours: number): number | null =>
  hours >= 24 && hours % 24 === 0 ? hours / 24 : null;
export const FUTURE_USAGE_OPTIONS = Object.keys(FUTURE_USAGE_MULTIPLIERS) as FutureUsage[];

export type ForecastPrefs = {
  view: ForecastView;
  burnWindowHours: number;
  futureUsage: FutureUsage;
  /** Draw each account's share of the pool. */
  showAccounts: boolean;
  showEmails: boolean;
  /** Capacity multiplier per `provider:plan`; absent means the plan's default (see pools). */
  planWeights: Record<string, number>;
};

export const DEFAULT_FORECAST_PREFS: ForecastPrefs = {
  view: 'remaining',
  burnWindowHours: 3,
  futureUsage: 'same',
  showAccounts: false,
  showEmails: false,
  planWeights: {},
};

const FORECAST_PREFS_KEY = 'quotaForecast.prefs';

export const MAX_PLAN_WEIGHT = 100;

export const planWeightKey = (provider: string, plan: string): string =>
  `${provider}:${plan || 'unknown'}`;

export const sanitizeForecastPrefs = (raw: unknown): ForecastPrefs => {
  if (!isRecord(raw)) return DEFAULT_FORECAST_PREFS;
  const planWeights: Record<string, number> = {};
  if (isRecord(raw.planWeights)) {
    Object.entries(raw.planWeights).forEach(([key, value]) => {
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
        planWeights[key] = Math.min(MAX_PLAN_WEIGHT, value);
      }
    });
  }
  return {
    view: FORECAST_VIEWS.includes(raw.view as ForecastView)
      ? (raw.view as ForecastView)
      : DEFAULT_FORECAST_PREFS.view,
    burnWindowHours: BURN_WINDOW_HOURS.includes(raw.burnWindowHours as number)
      ? (raw.burnWindowHours as number)
      : DEFAULT_FORECAST_PREFS.burnWindowHours,
    futureUsage: FUTURE_USAGE_OPTIONS.includes(raw.futureUsage as FutureUsage)
      ? (raw.futureUsage as FutureUsage)
      : DEFAULT_FORECAST_PREFS.futureUsage,
    showAccounts: raw.showAccounts === true,
    showEmails: raw.showEmails === true,
    planWeights,
  };
};

export function useForecastPrefs(): [ForecastPrefs, (patch: Partial<ForecastPrefs>) => void] {
  const [stored, setStored] = useLocalStorage<unknown>(FORECAST_PREFS_KEY, DEFAULT_FORECAST_PREFS);
  const prefs = useMemo(() => sanitizeForecastPrefs(stored), [stored]);
  const update = useCallback(
    (patch: Partial<ForecastPrefs>) =>
      setStored((current: unknown) => ({ ...sanitizeForecastPrefs(current), ...patch })),
    [setStored]
  );
  return [prefs, update];
}
