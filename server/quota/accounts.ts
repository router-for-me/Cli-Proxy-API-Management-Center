import { createHash } from 'node:crypto';
import type { AccountBilling } from '../../src/domain/accountBilling';
import { maskIdentifier } from '../../src/domain/quotaPool/mask';
import type {
  ServerAccount,
  ServerAccountWindow,
  ServerAccountsBody,
} from '../../src/domain/quotaPool/accounts';
import type {
  AccountQuotaWindow,
  AccountResets,
  PoolProviderId,
  PoolWindow,
} from '../../src/domain/quotaPool/types';
import { laneOf, poolWindowId } from '../../src/domain/quotaWindows/lanes';
import type { ClaudeUsageSnapshot } from '../../src/types/quota';
import { planWeight } from './plans';
import { STALE_MS, type QuotaSample, type StoredAccount } from './types';
import { weeklyOnlyAccountIds } from './values';

/** What the stored weekly/five-hour samples say when no window list is held in memory. */
const SAMPLE_LABEL_KEYS: Record<PoolProviderId, Record<PoolWindow, string>> = {
  claude: { 'five-hour': 'claude_quota.five_hour', weekly: 'claude_quota.seven_day' },
  codex: { 'five-hour': 'codex_quota.primary_window', weekly: 'codex_quota.secondary_window' },
  antigravity: {
    'five-hour': 'antigravity_quota.five_hour_limit',
    weekly: 'antigravity_quota.weekly_limit',
  },
};

export interface AccountsInput {
  accounts: readonly StoredAccount[];
  /** Each account's newest stored sample per window. */
  latestSamples: readonly QuotaSample[];
  /** The collector's memory: refilled by the next reading after a restart. */
  windows: ReadonlyMap<string, readonly AccountQuotaWindow[]>;
  resets: ReadonlyMap<string, AccountResets>;
  billing: ReadonlyMap<string, AccountBilling>;
  balances: ReadonlyMap<string, Pick<ClaudeUsageSnapshot, 'extraUsage' | 'dollarWindows'>>;
  /** Codex credit balances from the usage payload; memory-only. */
  credits?: ReadonlyMap<string, { balance: string | null; unlimited: boolean }>;
  nowMs: number;
  reveal: boolean;
  collection: Pick<ServerAccountsBody, 'lastRefreshAtMs' | 'nextRefreshAtMs' | 'refreshing'>;
}

function storedWindows(provider: PoolProviderId, samples: readonly QuotaSample[]) {
  return samples.map((sample): ServerAccountWindow => ({
    id: poolWindowId(provider, sample.window),
    lane: sample.window,
    labelKey: SAMPLE_LABEL_KEYS[provider][sample.window],
    remainingPercent: sample.remainingPercent,
    resetAtMs: sample.resetAtMs,
    periodHours: sample.periodHours,
  }));
}

function liveWindows(provider: PoolProviderId, windows: readonly AccountQuotaWindow[]) {
  return windows.map((window): ServerAccountWindow => ({
    id: window.id,
    lane: laneOf(provider, window.id),
    labelKey: window.labelKey,
    ...(window.labelParams ? { labelParams: window.labelParams } : {}),
    remainingPercent: window.remainingPercent,
    resetAtMs: window.resetAtMs,
    periodHours: window.periodHours ?? null,
  }));
}

/**
 * The read model behind `GET /v1/accounts`: one entry per non-retired account. A disabled account
 * is never read by the collector, so it carries its last stored weekly/five-hour sample and the
 * time of that sample. Nothing here depends on the request time, so the same readings serialize
 * to the same bytes (and the same ETag) until the status of an account ages into `stale`.
 */
export function buildAccounts(input: AccountsInput): ServerAccountsBody {
  const { nowMs } = input;
  const samples = new Map<string, QuotaSample[]>();
  for (const sample of input.latestSamples) {
    const list = samples.get(sample.accountId) ?? [];
    list.push(sample);
    samples.set(sample.accountId, list);
  }
  // Claude and Codex only: Antigravity cards stay hub-direct, and browsers reject other providers.
  const live = input.accounts
    .filter((account) => !account.retired && account.provider !== 'antigravity')
    .sort(
      (a, b) =>
        (a.instanceId ?? '').localeCompare(b.instanceId ?? '') ||
        a.provider.localeCompare(b.provider) ||
        a.id.localeCompare(b.id)
    );
  const position = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const account of live) {
    const group = `${account.instanceId ?? ''}\0${account.provider}`;
    const next = (counts.get(group) ?? 0) + 1;
    counts.set(group, next);
    position.set(account.id, next);
  }
  const weeklyOnly = weeklyOnlyAccountIds(input.latestSamples);
  const accounts = live.map((account): ServerAccount => {
    const stored = samples.get(account.id) ?? [];
    const observedAtMs = stored.reduce<number | null>(
      (latest, sample) => Math.max(latest ?? 0, sample.observedAtMs),
      null
    );
    const memory = account.disabled ? undefined : input.windows.get(account.id);
    const windows = memory
      ? liveWindows(account.provider, memory)
      : storedWindows(account.provider, stored);
    const status: ServerAccount['status'] = account.disabled
      ? 'disabled'
      : account.lastErrorAtMs !== null &&
          (observedAtMs === null ||
            (account.lastErrorAtMs >= observedAtMs && nowMs - observedAtMs > STALE_MS))
        ? 'error'
        : observedAtMs === null ||
            nowMs - observedAtMs > STALE_MS ||
            nowMs - account.lastSeenAtMs > STALE_MS
          ? 'stale'
          : 'ok';
    const plan = planWeight(account.provider, account.plan);
    // The same two rules as the dashboard's `noFiveHourLimit`: Claude Ultra answered with limits
    // but no five-hour one; Codex's latest successful reading had only a weekly window.
    const noFiveHourLimit =
      account.provider === 'codex'
        ? weeklyOnly.has(account.id)
        : plan.multiplier === 20 &&
          windows.length > 0 &&
          !windows.some((window) => window.lane === 'five-hour' && window.remainingPercent !== null);
    const balances = account.disabled ? undefined : input.balances.get(account.id);
    const credits = account.disabled ? undefined : input.credits?.get(account.id);
    return {
      id: account.id,
      sourceAccountId: account.sourceAccountId ?? null,
      instanceId: account.instanceId ?? null,
      provider: account.provider,
      disabled: account.disabled,
      status,
      observedAtMs,
      label: `${account.provider === 'claude' ? 'Claude' : 'Codex'} ${position.get(account.id)}`,
      identifier: maskIdentifier(account.email || account.name),
      ...(input.reveal ? { email: account.email || account.name } : {}),
      plan: { label: plan.label, known: plan.known, type: account.plan ?? null },
      ...(noFiveHourLimit ? { noFiveHourLimit } : {}),
      windows,
      resets: input.resets.get(account.id) ?? null,
      billing: input.billing.get(account.id) ?? null,
      ...(balances
        ? { extraUsage: balances.extraUsage, dollarWindows: balances.dollarWindows }
        : {}),
      ...(credits ? { credits } : {}),
    };
  });
  return { accounts, ...input.collection };
}

/**
 * A hash of the serialized body: equal readings give one version, any change gives another. The
 * version rides in the body too (like the inventory's), so a browser can ask `If-None-Match`
 * without needing the `ETag` header exposed to it.
 */
export function accountsVersion(body: string): string {
  return createHash('sha256').update(body).digest('hex').slice(0, 24);
}
