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
/** Recorded 5-hour session window; dropped on plans exempt from it. */
const SESSION_HISTORY_WINDOW_ID = 'five_hour';

export type PoolPlan = {
  key: string;
  plan: string;
  weight: number;
  /** Weight used when none is set in the preferences. */
  defaultWeight: number;
  count: number;
};

/**
 * Weekly quota of one account, in Pro accounts, per recorded plan: Max (5x)
 * holds five Pro weeks and Ultra (20x) ten. The pool's largest plan counts as
 * 1, so a pool of four Ultra accounts and one Pro holds 410%, not 500%.
 */
export const PLAN_WEEKLY_UNITS: Partial<Record<string, Record<string, number>>> = {
  claude: { pro: 1, max5: 5, max20: 10 },
};

/**
 * Default capacity weight of each plan in a pool, relative to the largest
 * plan with known units. Plans without known units count as 1.
 */
export const defaultPlanWeights = (provider: string, plans: string[]): Map<string, number> => {
  const units = PLAN_WEEKLY_UNITS[provider] ?? {};
  const known = plans.map((plan) => units[plan]).filter((value) => value !== undefined);
  const reference = known.length > 0 ? Math.max(...known) : 1;
  return new Map(plans.map((plan) => [plan, units[plan] ? units[plan] / reference : 1]));
};

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

    const recorded = providerFiles.flatMap((file) => {
      const account = accounts.find(
        (candidate) => candidate.provider === provider && matchesFile(candidate, file)
      );
      const window = account?.windows.find((candidate) => candidate.id === FORECAST_WINDOW_ID);
      if (!account || !window || window.points.length === 0) {
        unrecordedCount += 1;
        return [];
      }
      return [{ file, account, window }];
    });
    const defaults = defaultPlanWeights(
      provider,
      recorded.map(({ account }) => account.plan)
    );

    recorded.forEach(({ file, account, window }) => {
      const key = planWeightKey(provider, account.plan);
      const defaultWeight = defaults.get(account.plan) ?? 1;
      const weight = options.planWeights[key] ?? defaultWeight;
      const plan = plans.get(key) ?? {
        key,
        plan: account.plan,
        weight,
        defaultWeight,
        count: 0,
      };
      plan.count += 1;
      plans.set(key, plan);
      inputs.push({
        key: String(file.name ?? account.authId),
        name: accountDisplayName(account, file, options.showEmails),
        weight,
        periodMs: window.periodSeconds ? window.periodSeconds * 1000 : 7 * 24 * 60 * 60 * 1000,
        samples: window.points,
        sessionLimited:
          account.routing?.sessionLimited ??
          account.windows.some(
            (candidate) =>
              candidate.id === SESSION_HISTORY_WINDOW_ID &&
              candidate.points.length > 0 &&
              candidate.droppedAt === null
          ),
        sessionShare: account.routing?.sessionShare ?? null,
      });
    });

    return { provider, accounts: inputs, plans: Array.from(plans.values()), unrecordedCount };
  });
}
