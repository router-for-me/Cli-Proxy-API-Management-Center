/**
 * Provider overview: each account's 5-hour and weekly usage, grouped by
 * provider. React-free; `nowMs` is always injected.
 */

import type { RateLimitWindowId } from '@/types';
import type { AccountStatus } from './accountStatus';
import type { QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';

export type PoolWindowId = RateLimitWindowId;

export const POOL_WINDOW_IDS: readonly PoolWindowId[] = ['five-hour', 'seven-day'];

/** Provider window ids that are the account-wide 5-hour and weekly limits. */
const POOL_WINDOW_SOURCES: Partial<Record<QuotaProviderType, Record<string, PoolWindowId>>> = {
  claude: { 'five-hour': 'five-hour', 'seven-day': 'seven-day' },
  codex: { 'five-hour': 'five-hour', weekly: 'seven-day' },
};

export const isPoolProvider = (type: QuotaProviderType): boolean =>
  POOL_WINDOW_SOURCES[type] !== undefined;

export interface PoolReading {
  usedPercent: number;
  resetAtMs: number | null;
}

export interface PoolAccountInput {
  name: string;
  displayName: string;
  provider: QuotaProviderType;
  quota: QuotaCardState | undefined;
  status: AccountStatus;
}

export interface PoolAccount {
  name: string;
  displayName: string;
  status: AccountStatus;
  windows: Record<PoolWindowId, PoolReading | null>;
}

export interface ProviderPool {
  provider: QuotaProviderType;
  accounts: PoolAccount[];
}

interface WindowLike {
  id?: string;
  usedPercent?: number | null;
  resetAtMs?: number | null;
}

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

/** A reading whose reset has passed describes a window that already rolled over: empty. */
export function readPoolWindows(
  input: Pick<PoolAccountInput, 'provider' | 'quota'>,
  nowMs: number
): Partial<Record<PoolWindowId, PoolReading>> {
  const sources = POOL_WINDOW_SOURCES[input.provider];
  const readings: Partial<Record<PoolWindowId, PoolReading>> = {};
  if (!sources) return readings;

  if (input.quota?.status === 'success') {
    const windows = (input.quota as { windows?: WindowLike[] }).windows ?? [];
    windows.forEach((window) => {
      const id = window.id ? sources[window.id] : undefined;
      if (!id || typeof window.usedPercent !== 'number' || !Number.isFinite(window.usedPercent))
        return;
      const resetAtMs =
        typeof window.resetAtMs === 'number' && Number.isFinite(window.resetAtMs)
          ? window.resetAtMs
          : null;
      readings[id] =
        resetAtMs !== null && resetAtMs <= nowMs
          ? { usedPercent: 0, resetAtMs: null }
          : { usedPercent: clampPercent(window.usedPercent), resetAtMs };
    });
  }

  return readings;
}

export function summarizeProviderPools(
  accounts: readonly PoolAccountInput[],
  nowMs: number
): ProviderPool[] {
  const byProvider = new Map<QuotaProviderType, PoolAccount[]>();
  accounts.forEach((account) => {
    if (!isPoolProvider(account.provider)) return;
    const readings = readPoolWindows(account, nowMs);
    const member: PoolAccount = {
      name: account.name,
      displayName: account.displayName,
      status: account.status,
      windows: {
        'five-hour': readings['five-hour'] ?? null,
        'seven-day': readings['seven-day'] ?? null,
      },
    };
    byProvider.set(account.provider, [...(byProvider.get(account.provider) ?? []), member]);
  });

  return Array.from(byProvider, ([provider, members]) => ({ provider, accounts: members }));
}
