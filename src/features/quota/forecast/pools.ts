/**
 * Builds forecast pools from recorded history and the current credential list.
 * Only enabled credentials that still exist and have samples join a pool.
 */

import type { AuthFileItem } from '@/types';
import type { QuotaHistory, QuotaHistoryAccount } from '@/services/api/quotaHistory';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { maskEmails } from '../emailMask';
import type { QuotaFileEntry } from '../logic';
import type { ForecastAccountInput } from './model';
import { planWeightKey } from './prefs';

/** Providers whose quota the backend collector records. */
export const FORECAST_PROVIDERS = ['claude', 'codex'] as const;
export type ForecastProvider = (typeof FORECAST_PROVIDERS)[number];

/** The pool tracks each account's weekly window. */
export const FORECAST_WINDOW_ID = 'seven_day';

export type PoolPlan = { key: string; plan: string; weight: number; count: number };

export type ForecastPool = {
  provider: ForecastProvider;
  accounts: ForecastAccountInput[];
  plans: PoolPlan[];
  /** Enabled credentials of this provider without recorded samples yet. */
  unrecordedCount: number;
};

const isEmail = (value: string) => /@/.test(value);

const matchesFile = (account: QuotaHistoryAccount, file: AuthFileItem): boolean => {
  const name = String(file.name ?? '');
  const id = String(file.id ?? '');
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  return (
    (account.fileName !== '' && account.fileName === name) ||
    (account.authId !== '' && (account.authId === name || account.authId === id)) ||
    (account.authIndex !== '' && authIndex !== null && account.authIndex === authIndex)
  );
};

/**
 * Display name for charts: the account email, masked while emails are hidden.
 * A non-email label wins; the file name is the last resort.
 */
export const accountDisplayName = (
  account: QuotaHistoryAccount,
  file: AuthFileItem,
  showEmails: boolean
): string => {
  const email = account.email || String(file.email ?? '');
  const label = account.label || String(file.label ?? '');
  if (label && !isEmail(label)) return label;
  const name = email || String(file.name ?? account.authId);
  return showEmails ? name : maskEmails(name, email);
};

/** `entries` are the page's classified quota files (disabled ones already removed). */
export function buildForecastPools(
  history: QuotaHistory | null,
  entries: QuotaFileEntry[],
  options: {
    planWeights: Record<string, number>;
    showEmails: boolean;
  }
): ForecastPool[] {
  const accounts = history?.accounts ?? [];
  return FORECAST_PROVIDERS.map((provider) => {
    const providerFiles = entries
      .filter((entry) => entry.type === provider)
      .map((entry) => entry.file)
      .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
    const plans = new Map<string, PoolPlan>();
    const inputs: ForecastAccountInput[] = [];
    let unrecordedCount = 0;

    providerFiles.forEach((file) => {
      const account = accounts.find(
        (candidate) => candidate.provider === provider && matchesFile(candidate, file)
      );
      const window = account?.windows.find((candidate) => candidate.id === FORECAST_WINDOW_ID);
      if (!account || !window || window.points.length === 0) {
        unrecordedCount += 1;
        return;
      }
      const key = planWeightKey(provider, account.plan);
      const weight = options.planWeights[key] ?? 1;
      const plan = plans.get(key) ?? { key, plan: account.plan, weight, count: 0 };
      plan.count += 1;
      plans.set(key, plan);
      inputs.push({
        key: String(file.name ?? account.authId),
        name: accountDisplayName(account, file, options.showEmails),
        weight,
        periodMs: window.periodSeconds ? window.periodSeconds * 1000 : 7 * 24 * 60 * 60 * 1000,
        samples: window.points,
      });
    });

    return { provider, accounts: inputs, plans: Array.from(plans.values()), unrecordedCount };
  });
}
