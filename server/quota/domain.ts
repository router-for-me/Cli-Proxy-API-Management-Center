import type { AccountBilling } from '../../src/domain/accountBilling';
import { combinedPools } from './combined';
import { maskIdentifier } from '../../src/domain/quotaPool/mask';
import { sumKnown, weeklyOnlyAccountIds } from './values';
import type {
  AccountQuotaWindow,
  AccountResets,
  PoolAccount,
  PoolDashboard,
  PoolPoint,
  PoolProviderId,
  PoolReset,
  PoolWindow,
  QuotaPool,
} from '../../src/domain/quotaPool/types';
import { DAY_MS, HOUR_MS, MIN_RATE_SPAN_MS, REFRESH_INTERVAL_MS, STALE_MS } from './types';
import { planWeight, POINTS_PER_UNIT } from './plans';
import {
  QUOTA_PROVIDERS,
  type QuotaSample,
  type QuotaSourceView,
  type StoredAccount,
} from './types';

export interface DashboardOptions {
  nowMs: number;
  window: PoolWindow;
  lookbackHours: 1 | 3 | 6;
  multiplier: 0 | 0.5 | 1 | 2;
  offsetDays: number;
  reveal: boolean;
}
export interface CollectionState {
  historyStartedAtMs: number | null;
  lastRefreshAtMs: number | null;
  nextRefreshAtMs: number;
  refreshing: boolean;
  issues: PoolDashboard['issues'];
  sources?: readonly QuotaSourceView[];
  billing?: ReadonlyMap<string, AccountBilling>;
  /**
   * Accounts whose newest reading was weekly-only (`weeklyOnlyAccountIds` over every window's
   * latest samples). The dashboard is built from one window's samples, so the caller supplies it;
   * without it, the samples given are searched.
   */
  weeklyOnly?: ReadonlySet<string>;
  resets?: ReadonlyMap<string, AccountResets>;
  windows?: ReadonlyMap<string, readonly AccountQuotaWindow[]>;
}
type Rates = { burn: number | null; drain: number | null };

function latestIndex(samples: QuotaSample[], atMs: number): number {
  let lo = 0;
  let hi = samples.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (samples[mid].observedAtMs <= atMs) lo = mid + 1;
    else hi = mid;
  }
  return lo - 1;
}

/** Only measured intervals count. Gaps and resets never become fabricated consumption. */
export function measuredRates(samples: QuotaSample[], atMs: number, hours: number): Rates {
  const end = latestIndex(samples, atMs);
  if (
    end < 1 ||
    samples[end].remainingPercent === null ||
    atMs - samples[end].observedAtMs > STALE_MS
  )
    return { burn: null, drain: null };
  let burn = 0;
  let burnSpan = 0;
  let net = 0;
  let netSpan = 0;
  const since = atMs - hours * HOUR_MS;
  for (let i = end; i > 0; i--) {
    const current = samples[i];
    const previous = samples[i - 1];
    if (previous.observedAtMs < since) break;
    if (current.remainingPercent === null || previous.remainingPercent === null) continue;
    const elapsed = current.observedAtMs - previous.observedAtMs;
    if (elapsed <= 0 || elapsed > STALE_MS) continue;
    const delta = previous.remainingPercent - current.remainingPercent;
    net += delta;
    netSpan += elapsed;
    // Absolute reset times may differ slightly when derived from seconds remaining.
    const sameCycle =
      previous.resetAtMs !== null &&
      current.resetAtMs !== null &&
      Math.abs(previous.resetAtMs - current.resetAtMs) <= 60_000 &&
      previous.resetAtMs > current.observedAtMs;
    if (sameCycle && delta >= 0) {
      burn += delta;
      burnSpan += elapsed;
    }
  }
  return {
    burn: burnSpan >= MIN_RATE_SPAN_MS ? (burn * HOUR_MS) / burnSpan : null,
    drain: netSpan >= MIN_RATE_SPAN_MS ? (net * HOUR_MS) / netSpan : null,
  };
}

function currentSample(
  samples: QuotaSample[],
  atMs: number
): (QuotaSample & { remainingPercent: number }) | undefined {
  const sample = samples[latestIndex(samples, atMs)];
  if (!sample || sample.remainingPercent === null || atMs - sample.observedAtMs > STALE_MS) return;
  if (sample.resetAtMs !== null && sample.resetAtMs <= atMs) return;
  return { ...sample, remainingPercent: sample.remainingPercent };
}

interface ForecastInput {
  remaining: number;
  rate: number;
  resetAtMs: number;
  periodHours: number;
  /** Points restored at each reset. */
  capacity: number;
}
export function projectPool(inputs: ForecastInput[], nowMs: number, toMs: number) {
  const accounts = inputs.map((input) => ({ ...input }));
  const points: PoolPoint[] = [];
  const resets: PoolReset[] = [];
  let firstEmptyAtMs: number | null = null;
  let poolEmptyAtMs: number | null = null;
  let time = nowMs;
  const record = () => {
    const remaining = accounts.reduce((sum, a) => sum + a.remaining, 0);
    points.push({
      atMs: time,
      remainingPoints: remaining,
      burnPointsPerHour: null,
      drainPointsPerHour: null,
    });
    if (accounts.some((a) => a.remaining <= 1e-8) && firstEmptyAtMs === null) firstEmptyAtMs = time;
    if (remaining <= 1e-8 && poolEmptyAtMs === null) poolEmptyAtMs = time;
  };
  if (!accounts.length) return { points, resets, firstEmptyAtMs, poolEmptyAtMs };
  // The proxies route fill-first: the pool's whole measured demand lands on one account at a
  // time, and moves on when it drains. Serve from the account with quota whose window resets
  // soonest (use it before it expires), so a reset account takes over the demand instead of
  // idling at its own past rate.
  const demand = accounts.reduce((sum, a) => sum + a.rate, 0);
  record();
  while (time < toMs) {
    const nextReset = Math.min(...accounts.map((a) => a.resetAtMs));
    const serving = accounts.reduce<(typeof accounts)[number] | undefined>(
      (best, a) => (a.remaining > 1e-8 && (!best || a.resetAtMs < best.resetAtMs) ? a : best),
      undefined
    );
    const nextEmpty =
      serving && demand > 0 ? time + (serving.remaining / demand) * HOUR_MS : Infinity;
    const next = Math.min(time + HOUR_MS / 2, nextReset, nextEmpty, toMs);
    if (next < time || (next === time && nextEmpty !== time))
      throw new Error('Invalid forecast cycle');
    if (serving) {
      // Epoch timestamps lose sub-millisecond precision. The depletion event owns
      // the zero balance; subtracting elapsed time can leave a tiny residual.
      serving.remaining =
        nextEmpty <= next ? 0 : Math.max(0, serving.remaining - (demand * (next - time)) / HOUR_MS);
    }
    time = next;
    record();
    let gain = 0;
    for (const account of accounts) {
      if (account.resetAtMs <= time) {
        gain += account.capacity - account.remaining;
        account.remaining = account.capacity;
        account.resetAtMs += account.periodHours * HOUR_MS;
      }
    }
    if (nextReset <= time) {
      resets.push({ atMs: time, gainPoints: gain });
      record();
    }
  }
  return { points, resets, firstEmptyAtMs, poolEmptyAtMs };
}

function accountHistories(accounts: StoredAccount[], samples: QuotaSample[]) {
  // Percent of one account's window times its plan weight gives pool points.
  const weight = new Map(accounts.map((a) => [a.id, planWeight(a.provider, a.plan).multiplier]));
  const scale = (id: string, value: number | null) =>
    value === null ? null : value * weight.get(id)!;
  const histories = new Map<string, QuotaSample[]>();
  for (const a of accounts) histories.set(a.id, []);
  for (const sample of samples) histories.get(sample.accountId)?.push(sample);
  for (const history of histories.values()) history.sort((a, b) => a.observedAtMs - b.observedAtMs);
  return { scale, histories };
}

function recordedHistory(
  active: StoredAccount[],
  samples: QuotaSample[],
  options: DashboardOptions,
  fromMs: number,
  toMs: number,
  { scale, histories }: ReturnType<typeof accountHistories>,
  sharedTimes?: readonly number[]
): PoolPoint[] {
  const { nowMs, lookbackHours } = options;
  const bucketTimes = new Map<number, number>();
  for (const sample of samples) {
    if (
      !active.some((a) => a.id === sample.accountId) ||
      sample.observedAtMs < fromMs ||
      sample.observedAtMs > Math.min(nowMs, toMs)
    )
      continue;
    const bucket = Math.floor(sample.observedAtMs / REFRESH_INTERVAL_MS);
    bucketTimes.set(bucket, Math.max(bucketTimes.get(bucket) ?? 0, sample.observedAtMs));
  }
  const times = sharedTimes ? [...sharedTimes] : [...bucketTimes.values()].sort((a, b) => a - b);
  // No reports at all is drawn as the last balance held flat until the next report: the point
  // 1 ms before that report repeats the previous point, and it is the only one that follows a gap.
  if (!sharedTimes) {
    for (let i = times.length - 1; i > 0; i--) {
      if (times[i] - times[i - 1] > STALE_MS) times.splice(i, 0, times[i] - 1);
    }
  }
  return times.map((at, index): PoolPoint => {
    const held = index > 0 && at - times[index - 1] > STALE_MS;
    const time = held ? times[index - 1] : at;
    // An account joins the pool at its first stored sample. Before that it was not a member,
    // so adding an account does not turn the pool's earlier history unknown.
    const members = active.filter(
      (a) =>
        a.firstSampleAtMs === undefined || (a.firstSampleAtMs !== null && a.firstSampleAtMs <= time)
    );
    const snapshots = members.map((a) =>
      scale(a.id, currentSample(histories.get(a.id)!, time)?.remainingPercent ?? null)
    );
    const historicalRates = members.map((a) => {
      const measured = measuredRates(histories.get(a.id)!, time, lookbackHours);
      return { burn: scale(a.id, measured.burn), drain: scale(a.id, measured.drain) };
    });
    return {
      atMs: at,
      remainingPoints: sumKnown(snapshots),
      burnPointsPerHour: held ? null : sumKnown(historicalRates.map((r) => r.burn)),
      drainPointsPerHour: held ? null : sumKnown(historicalRates.map((r) => r.drain)),
    };
  });
}

function buildPool(
  provider: PoolProviderId,
  source: StoredAccount[],
  samples: QuotaSample[],
  options: DashboardOptions,
  fromMs: number,
  toMs: number,
  inventoryFailed: boolean,
  weeklyOnly: ReadonlySet<string>
): QuotaPool {
  const { nowMs, lookbackHours, multiplier } = options;
  const accounts = source
    .filter((a) => a.provider === provider && !a.retired)
    .sort((a, b) => a.id.localeCompare(b.id));
  const { scale, histories } = accountHistories(accounts, samples);
  // Ultra accounts answered without a five-hour window: Anthropic removed that limit for verified
  // Ultra accounts on 2026-10-30. A successful answer is proof; a failed poll writes no sample.
  // Codex accounts are decided by the provider's own answer, not the plan: its latest successful
  // reading had a weekly window and no five-hour one (`weeklyOnlyAccountIds`).
  const lacksFiveHourLimit = (account: StoredAccount) => {
    const plan = planWeight(provider, account.plan);
    return (
      options.window === 'five-hour' &&
      ((provider === 'claude' && plan.known && plan.multiplier === 20) ||
        (provider === 'codex' && weeklyOnly.has(account.id)))
    );
  };
  const forecastInputs: ForecastInput[] = [];
  const accountViews: PoolAccount[] = accounts.map((account, index) => {
    const history = histories.get(account.id)!;
    const latest = history[latestIndex(history, nowMs)];
    const sample = currentSample(history, nowMs);
    const status: PoolAccount['status'] = account.disabled
      ? 'disabled'
      : // One failed poll must not hide a sample that is still fresh.
        account.lastErrorAtMs !== null &&
          (!latest ||
            (account.lastErrorAtMs >= latest.observedAtMs &&
              nowMs - latest.observedAtMs > STALE_MS))
        ? 'error'
        : nowMs - account.lastSeenAtMs > STALE_MS ||
            (latest && nowMs - latest.observedAtMs > STALE_MS)
          ? 'stale'
          : latest?.remainingPercent === null && lacksFiveHourLimit(account)
            ? 'no-limit'
            : latest?.remainingPercent === null
              ? 'missing-window'
              : latest && !sample
                ? 'stale'
                : !sample
                  ? 'missing-window'
                  : 'ok';
    const rates =
      status === 'ok' ? measuredRates(history, nowMs, lookbackHours) : { burn: null, drain: null };
    if (
      status === 'ok' &&
      sample?.resetAtMs &&
      sample.periodHours &&
      sample.periodHours > 0 &&
      rates.burn !== null
    ) {
      forecastInputs.push({
        remaining: scale(account.id, sample.remainingPercent)!,
        rate: scale(account.id, rates.burn)! * multiplier,
        resetAtMs: sample.resetAtMs,
        periodHours: sample.periodHours,
        capacity: scale(account.id, POINTS_PER_UNIT)!,
      });
    }
    const emptyAt =
      sample && rates.burn !== null && rates.burn * multiplier > 0
        ? nowMs + (sample.remainingPercent / (rates.burn * multiplier)) * HOUR_MS
        : null;
    const plan = planWeight(provider, account.plan);
    return {
      id: account.id,
      sourceAccountId: account.sourceAccountId ?? null,
      label: `${provider === 'claude' ? 'Claude' : 'Codex'} ${index + 1}`,
      plan: {
        label: plan.label,
        capacityPoints: POINTS_PER_UNIT * plan.multiplier,
        known: plan.known,
      },
      identifier: maskIdentifier(account.email || account.name),
      ...(options.reveal ? { email: account.email || account.name } : {}),
      disabled: account.disabled,
      status,
      observedAtMs: latest?.observedAtMs ?? null,
      remainingPercent: latest?.remainingPercent ?? null,
      resetAtMs: latest?.resetAtMs ?? null,
      burnPointsPerHour: scale(account.id, rates.burn),
      emptyAtMs:
        status !== 'ok'
          ? null
          : sample?.remainingPercent === 0
            ? nowMs
            : emptyAt !== null && sample?.resetAtMs && emptyAt <= sample.resetAtMs
              ? emptyAt
              : null,
      windows: [],
      // Filled by the collector's latest reset reading.
      resets: null,
      billing: null,
    };
  });
  // An account with no limit here has nothing to add to this window's pool.
  const unlimited = new Set(accountViews.filter((a) => a.status === 'no-limit').map((a) => a.id));
  const active = accounts.filter((a) => !a.disabled && !unlimited.has(a.id));
  const eligible = accountViews.filter((a) => !a.disabled && a.status !== 'no-limit');
  const loaded = eligible.filter((a) => a.status === 'ok');
  const complete = loaded.length === eligible.length && !inventoryFailed;
  const rates = active.map((a) => {
    const measured = measuredRates(histories.get(a.id)!, nowMs, lookbackHours);
    return { burn: scale(a.id, measured.burn), drain: scale(a.id, measured.drain) };
  });
  const forecastState: QuotaPool['forecastState'] = !eligible.length
    ? inventoryFailed
      ? 'partial'
      : unlimited.size
        ? 'no-limit'
        : 'no-accounts'
    : !complete
      ? eligible.some((a) => a.status === 'stale')
        ? 'stale'
        : 'partial'
      : forecastInputs.length !== active.length
        ? 'collecting'
        : 'ready';
  const projection =
    forecastState === 'ready'
      ? projectPool(forecastInputs, nowMs, Math.max(toMs, nowMs + 14 * DAY_MS))
      : { points: [], resets: [], firstEmptyAtMs: null, poolEmptyAtMs: null };
  const recorded = recordedHistory(active, samples, options, fromMs, toMs, { scale, histories });
  const nextResetAtMs = loaded.reduce<number | null>(
    (earliest, a) =>
      a.resetAtMs !== null && a.resetAtMs > nowMs
        ? Math.min(earliest ?? Infinity, a.resetAtMs)
        : earliest,
    null
  );
  return {
    provider,
    accountCount: accounts.length,
    eligibleCount: eligible.length,
    loadedCount: loaded.length,
    capacityPoints: eligible.reduce((sum, a) => sum + a.plan.capacityPoints, 0),
    remainingPoints: complete
      ? sumKnown(eligible.map((a) => scale(a.id, a.remainingPercent)))
      : null,
    burnPointsPerHour: complete ? sumKnown(rates.map((r) => r.burn)) : null,
    drainPointsPerHour: complete ? sumKnown(rates.map((r) => r.drain)) : null,
    forecastState,
    firstEmptyAtMs: projection.firstEmptyAtMs,
    poolEmptyAtMs: projection.poolEmptyAtMs,
    nextResetAtMs,
    nextResetGainPoints: projection.resets[0]?.gainPoints ?? null,
    recorded,
    projected: projection.points.filter((p) => p.atMs >= fromMs && p.atMs <= toMs),
    resets: projection.resets.filter((p) => p.atMs >= fromMs && p.atMs <= toMs),
    accounts: accountViews,
  };
}

export function buildDashboard(
  accounts: StoredAccount[],
  samples: QuotaSample[],
  options: DashboardOptions,
  collection: CollectionState
): PoolDashboard {
  const fromMs = Math.floor(options.nowMs / DAY_MS) * DAY_MS + (options.offsetDays - 3) * DAY_MS;
  const toMs = fromMs + 14 * DAY_MS;
  const filtered = samples.filter((s) => s.window === options.window);
  const { sources, windows, resets, billing, weeklyOnly: suppliedWeeklyOnly, ...state } = collection;
  const scopes = new Map<string, QuotaSourceView>();
  for (const source of sources ?? []) scopes.set(source.instanceId, source);
  for (const entry of [...accounts, ...collection.issues]) {
    if (entry.instanceId !== undefined && !scopes.has(entry.instanceId)) {
      scopes.set(entry.instanceId, {
        instanceId: entry.instanceId,
        sourceLabel: ('sourceLabel' in entry ? entry.sourceLabel : undefined) ?? entry.instanceId,
      });
    }
  }
  const scoped = sources !== undefined || scopes.size > 0;
  const accountPlans = new Map(accounts.map((account) => [account.id, account.plan]));
  // From every window's samples (not `filtered`): the weekly view flags these accounts too.
  const weeklyOnly = suppliedWeeklyOnly ?? weeklyOnlyAccountIds(samples, options.nowMs);
  const allPools = (scoped ? [...scopes.values()] : [undefined]).flatMap((source) =>
    QUOTA_PROVIDERS.map((provider) => ({
      ...buildPool(
        provider,
        accounts.filter((account) => account.instanceId === source?.instanceId),
        filtered,
        options,
        fromMs,
        toMs,
        (sources !== undefined &&
          !sources.some((entry) => entry.instanceId === source?.instanceId)) ||
          collection.issues.some(
            (issue) =>
              issue.instanceId === source?.instanceId &&
              issue.provider === provider &&
              issue.code === 'inventory-unavailable'
          ),
        weeklyOnly
      ),
      ...source,
    }))
  );
  // A source containing one supported provider does not create an empty sibling-provider card.
  // Retain empty results when the entire source is empty, and preserve failure visibility.
  const pools = allPools
    .map((pool) => ({
      ...pool,
      accounts: pool.accounts.map((account) => ({
        ...account,
        windows: [...(windows?.get(account.id) ?? [])],
        resets: resets?.get(account.id) ?? null,
        billing: billing?.get(account.id) ?? null,
        ...((pool.provider === 'claude' &&
          planWeight(pool.provider, accountPlans.get(account.id)).multiplier === 20 &&
          (windows?.get(account.id)?.length ?? 0) > 0 &&
          !windows?.get(account.id)?.some((limit) => limit.id === 'five-hour')) ||
        (pool.provider === 'codex' && weeklyOnly.has(account.id))
          ? { noFiveHourLimit: true }
          : {}),
      })),
    }))
    .filter(
      (pool) =>
        !scoped ||
        pool.accountCount > 0 ||
        !allPools.some((other) => other.instanceId === pool.instanceId && other.accountCount > 0) ||
        collection.issues.some(
          (issue) => issue.instanceId === pool.instanceId && issue.provider === pool.provider
        )
    );
  const history = (selected: QuotaPool[], times?: number[]) => {
    const unlimited = new Set(
      selected.flatMap((pool) =>
        pool.accounts
          .filter((account) => account.status === 'no-limit')
          .map((account) => account.id)
      )
    );
    const active = accounts.filter(
      (account) =>
        !account.retired &&
        !account.disabled &&
        !unlimited.has(account.id) &&
        selected.some(
          (pool) => pool.provider === account.provider && pool.instanceId === account.instanceId
        )
    );
    return recordedHistory(
      active,
      filtered,
      options,
      fromMs,
      toMs,
      accountHistories(active, filtered),
      times
    );
  };
  const combined = (selected: QuotaPool[]) =>
    combinedPools(
      selected,
      (eligible) => history(eligible),
      (eligible, times) => eligible.map((pool) => history([pool], times))
    );
  return {
    nowMs: options.nowMs,
    fromMs,
    toMs,
    window: options.window,
    lookbackHours: options.lookbackHours,
    multiplier: options.multiplier,
    ...state,
    pools,
    combined: {
      all: combined(pools),
      claude: combined(pools.filter((pool) => pool.provider === 'claude')),
      codex: combined(pools.filter((pool) => pool.provider === 'codex')),
    },
    ...(scoped
      ? {
          unresolvedHistoryAccountCount: accounts.filter(
            (account) => account.instanceId === undefined
          ).length,
          combinations: QUOTA_PROVIDERS.flatMap((provider) => {
            const local = pools.filter(
              (pool) =>
                pool.provider === provider &&
                (pool.accountCount > 0 ||
                  collection.issues.some(
                    (issue) => issue.instanceId === pool.instanceId && issue.provider === provider
                  ))
            );
            return local.length < 2
              ? []
              : [
                  {
                    provider,
                    reason: 'cross-source-combination-unverified' as const,
                    occurrenceCount: local.reduce((count, pool) => count + pool.accountCount, 0),
                    capacityPoints: null,
                    remainingPoints: null,
                    burnPointsPerHour: null,
                    drainPointsPerHour: null,
                    firstEmptyAtMs: null,
                    poolEmptyAtMs: null,
                    recorded: [] as [],
                    projected: [] as [],
                  },
                ];
          }),
        }
      : {}),
  };
}
