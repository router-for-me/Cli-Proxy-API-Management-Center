/**
 * Pooled quota: every account of a provider summed per rate-limit window, out
 * of N × 100%. React-free; `nowMs` is always injected.
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

export interface PoolAccountWindow {
  name: string;
  displayName: string;
  reading: PoolReading | null;
}

export interface PoolWindowSummary {
  id: PoolWindowId;
  accounts: PoolAccountWindow[];
  reporting: number;
  usedPercent: number;
  capacityPercent: number;
  nextReset: { displayName: string; atMs: number } | null;
}

export interface PoolUnavailableAccount {
  name: string;
  displayName: string;
  status: Exclude<AccountStatus, { kind: 'available' }>;
}

export interface ProviderPool {
  provider: QuotaProviderType;
  accountCount: number;
  windows: PoolWindowSummary[];
  unavailable: PoolUnavailableAccount[];
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

const backAtOf = (status: AccountStatus): number =>
  'backAtMs' in status ? status.backAtMs : Number.POSITIVE_INFINITY;

export function summarizeProviderPools(
  accounts: readonly PoolAccountInput[],
  nowMs: number
): ProviderPool[] {
  const byProvider = new Map<QuotaProviderType, PoolAccountInput[]>();
  accounts.forEach((account) => {
    if (!isPoolProvider(account.provider)) return;
    byProvider.set(account.provider, [...(byProvider.get(account.provider) ?? []), account]);
  });

  return Array.from(byProvider, ([provider, members]) => {
    const readings = members.map((account) => readPoolWindows(account, nowMs));

    const windows = POOL_WINDOW_IDS.map((id): PoolWindowSummary => {
      const perAccount = members.map((account, index) => ({
        name: account.name,
        displayName: account.displayName,
        reading: readings[index][id] ?? null,
      }));
      const reported = perAccount.filter(
        (account): account is PoolAccountWindow & { reading: PoolReading } =>
          account.reading !== null
      );
      const nextReset = reported
        .filter((account) => account.reading.usedPercent > 0 && account.reading.resetAtMs !== null)
        .reduce<PoolWindowSummary['nextReset']>(
          (soonest, account) =>
            soonest === null || account.reading.resetAtMs! < soonest.atMs
              ? { displayName: account.displayName, atMs: account.reading.resetAtMs! }
              : soonest,
          null
        );
      return {
        id,
        accounts: perAccount,
        reporting: reported.length,
        usedPercent: reported.reduce((sum, account) => sum + account.reading.usedPercent, 0),
        capacityPercent: reported.length * 100,
        nextReset,
      };
    });

    const unavailable = members
      .filter(
        (account): account is PoolAccountInput & { status: PoolUnavailableAccount['status'] } =>
          account.status.kind !== 'available'
      )
      .map(({ name, displayName, status }) => ({ name, displayName, status }))
      .sort((a, b) => backAtOf(a.status) - backAtOf(b.status));

    return { provider, accountCount: members.length, windows, unavailable };
  });
}
