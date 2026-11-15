import {
  billingFromClaudeProfile,
  billingFromCodexSubscription,
  type AccountBilling,
} from '../../src/domain/accountBilling';
import { buildApiCallApi } from '../../src/services/api/apiCall';
import { readJson } from '../http/readJson';
import { readFile } from 'node:fs/promises';
import type { DeploymentSource } from '../../src/domain/providerSources/types';
import { loadSourceManifest } from '../providerSources/config';
import { LEGACY_SOURCE_MAPPING, legacyAccountId } from './identity';
import type { TFunction } from 'i18next';
import type {
  AccountQuotaWindow,
  AccountResets,
  PoolDashboard,
  PoolProviderId,
} from '../../src/domain/quotaPool/types';
import { buildClaudeQuotaWindows } from '../../src/domain/quotaWindows/claude';
import { buildCodexQuotaWindows } from '../../src/domain/quotaWindows/codex';
import { laneOf } from '../../src/domain/quotaWindows/lanes';
import {
  CLAUDE_PROFILE_URL,
  CLAUDE_USAGE_WINDOW_KEYS,
  CLAUDE_REQUEST_HEADERS,
  CODEX_USAGE_URL,
  CODEX_SUBSCRIPTION_URL,
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_REQUEST_HEADERS,
} from '../../src/utils/quota/constants';
import { parseClaudeUsagePayload, parseCodexUsagePayload } from '../../src/utils/quota/parsers';
import { normalizeClaudeUsageSnapshot } from '../../src/services/api/claudeUsage';
import type { ClaudeUsageSnapshot } from '../../src/types/quota';
import { isRecord } from '../../src/utils/helpers';
import { planFromClaudeProfile, planFromCodexUsage } from './plans';
import { QuotaStore } from './store';
import type { InventorySourceState, InventorySourceStatus } from './inventory';
import { codexCreditExpiries, readAccountResets, withCodexCreditDetails } from './resets';
import { normalizeCodexResetCreditsPayload } from '../../src/utils/quota/resetCredits';
import {
  ANTHROPIC_API_ORIGIN,
  ANTHROPIC_RESET_GRANT_STATUS_PATH,
} from '../../src/services/api/claudeResetGrants';
import {
  MANUAL_REFRESH_INTERVAL_MS,
  REFRESH_INTERVAL_MS,
  QUOTA_PROVIDERS,
  type InventoryChange,
  type QuotaSample,
  type QuotaSourceView,
  type ResetReading,
  type StoredAccount,
} from './types';

/** A targeted read of one account starts at most this often. */
const ACCOUNT_REFRESH_FLOOR_MS = 20_000;
const PLAN_REFRESH_MS = 6 * 60 * 60 * 1000;
/** Codex credit details are re-read at most this often while their count is unchanged. */
const RESET_CREDITS_REFRESH_MS = 60 * 60 * 1000;
/** Floor between credit-detail attempts, so a failing endpoint is not hit every collection. */
const RESET_CREDITS_RETRY_MS = 15 * 60 * 1000;
/** Inventory-only syncs start at least this far apart, so a burst cannot hammer CLI-Proxy. */
const SYNC_FLOOR_MS = 1000;
/**
 * A read already in flight when the user deletes a credential can see the deletion and retire
 * (and scrub) the account before the explicit delete sync names it. The names of accounts retired
 * in the last few minutes stay in memory, never on disk, so that sync can still purge them.
 */
const RETIRED_NAME_MEMORY_MS = 10 * 60_000;

interface CollectorDependencies {
  fetcher?: typeof fetch;
  now?: () => number;
  /** Waits out the sync floor; injected by tests. */
  sleep?: (ms: number) => Promise<void>;
}
type CollectorOptions = CollectorDependencies &
  (
    | { sources: readonly DeploymentSource[]; revision: string }
    // Compatibility for existing injected tests only. Production always supplies the manifest.
    | { keyFile: string; origins?: Record<PoolProviderId, string>; fetcher: typeof fetch }
  );

interface CollectionSource {
  instanceId?: string;
  label: string;
  upstreamOrigin: string;
  managementKeyFile: string;
  providers: readonly PoolProviderId[];
}

/** One live account of its validated source, as handed to `withManagedAccount`. */
export interface ManagedAccount {
  provider: PoolProviderId;
  authIndex: string;
  chatgptAccountId: string | null;
  /** The hub's `/requests/api-call`, shaped as the shared src/services/api helpers expect. */
  api: ReturnType<typeof buildApiCallApi>;
  /** Any other management POST. Throws unless the hub answers 2xx. */
  post(path: string, body: Record<string, unknown>): Promise<unknown>;
}

interface InventoryAccount {
  account: StoredAccount;
  authIndex: string;
  chatgptAccountId: string | null;
}

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
// Builders require i18next's branded function; labels are not persisted or exposed here.
const label = ((key: string) => key) as TFunction;

function boundedString(value: unknown, max: number): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= max &&
    [...value].every((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
  );
}

function inventory(payload: unknown, provider: PoolProviderId, nowMs: number): InventoryAccount[] {
  if (
    !isRecord(payload) ||
    !Array.isArray(payload.files) ||
    payload.files.length > 10_000 ||
    (payload.has_more !== undefined && payload.has_more !== false) ||
    (payload.total !== undefined && payload.total !== payload.files.length) ||
    (payload.page !== undefined && payload.page !== 1)
  ) {
    throw new Error('Invalid quota inventory');
  }
  const accounts: InventoryAccount[] = [];
  const seen = new Set<string>();
  for (const file of payload.files) {
    if (!isRecord(file)) throw new Error('Invalid quota inventory');
    // Only `<name>.json` files are credentials. A listed `.lock` (or any other name) must neither
    // become an account nor make the whole inventory look malformed and block retirement.
    if (typeof file.name === 'string' && !file.name.endsWith('.json')) continue;
    const kind = file.provider ?? file.type;
    if (
      !boundedString(kind, 64) ||
      (file.provider !== undefined && file.type !== undefined && file.provider !== file.type)
    ) {
      throw new Error('Invalid quota inventory');
    }
    if (kind !== provider) continue;
    if (
      !boundedString(file.auth_index, 256) ||
      !boundedString(file.name, 1024) ||
      typeof file.disabled !== 'boolean' ||
      (file.email !== undefined && file.email !== null && !boundedString(file.email, 1024)) ||
      seen.has(file.auth_index)
    ) {
      throw new Error('Invalid quota inventory');
    }
    seen.add(file.auth_index);
    const id = legacyAccountId(provider, file.auth_index);
    accounts.push({
      authIndex: file.auth_index,
      chatgptAccountId:
        isRecord(file.id_token) && boundedString(file.id_token.chatgpt_account_id, 256)
          ? file.id_token.chatgpt_account_id
          : null,
      account: {
        id,
        provider,
        name: file.name,
        email: file.email ?? null,
        disabled: file.disabled,
        retired: false,
        lastSeenAtMs: nowMs,
        lastErrorAtMs: null,
      },
    });
  }
  return accounts;
}

export function quotaSamples(
  provider: PoolProviderId,
  accountId: string,
  body: unknown,
  observedAtMs: number
): { samples: QuotaSample[]; windows: AccountQuotaWindow[] } {
  const parsed =
    provider === 'claude'
      ? { provider: 'claude' as const, payload: parseClaudeUsagePayload(body) }
      : { provider: 'codex' as const, payload: parseCodexUsagePayload(body) };
  if (!isRecord(parsed.payload)) throw new Error('Invalid quota response');
  const payload: Record<string, unknown> = parsed.payload;
  // Parsers intentionally accept broad JSON for the UI. Validate its envelope before building.
  const keys =
    provider === 'claude'
      ? [...CLAUDE_USAGE_WINDOW_KEYS.map(({ key }) => key), 'limits']
      : [
          'rate_limit',
          'rateLimit',
          'code_review_rate_limit',
          'codeReviewRateLimit',
          'additional_rate_limits',
          'additionalRateLimits',
        ];
  if (!keys.some((key) => Object.prototype.hasOwnProperty.call(payload, key))) {
    throw new Error('Invalid quota response');
  }
  for (const key of keys) {
    const value = payload[key];
    if (value === undefined || value === null) continue;
    const arrayField =
      key === 'limits' || key === 'additional_rate_limits' || key === 'additionalRateLimits';
    if (arrayField ? !Array.isArray(value) : !isRecord(value)) {
      throw new Error('Invalid quota response');
    }
  }
  const windows =
    parsed.provider === 'claude'
      ? buildClaudeQuotaWindows(parsed.payload, label)
      : buildCodexQuotaWindows(parsed.payload, label);
  const samples: QuotaSample[] = [];
  for (const entry of windows) {
    const window = laneOf(provider, entry.id);
    if (window !== 'five-hour' && window !== 'weekly') continue;
    if (
      entry.usedPercent === null ||
      !Number.isFinite(entry.usedPercent) ||
      entry.usedPercent < 0 ||
      entry.usedPercent > 100
    ) {
      throw new Error('Invalid quota response');
    }
    samples.push({
      accountId,
      window,
      observedAtMs,
      remainingPercent: 100 - entry.usedPercent,
      resetAtMs: entry.resetAtMs ?? null,
      periodHours: entry.periodHours ?? null,
    });
  }
  // Explicit missing observations supersede earlier balances without inventing zero usage.
  for (const window of ['weekly', 'five-hour'] as const) {
    if (!samples.some((sample) => sample.window === window)) {
      samples.push({
        accountId,
        window,
        observedAtMs,
        remainingPercent: null,
        resetAtMs: null,
        periodHours: null,
      });
    }
  }
  return {
    samples,
    windows: windows.map((entry) => ({
      id: entry.id,
      labelKey: entry.labelKey ?? entry.label,
      ...('labelParams' in entry && entry.labelParams
        ? { labelParams: entry.labelParams as Record<string, string | number> }
        : {}),
      remainingPercent:
        entry.usedPercent !== null && Number.isFinite(entry.usedPercent)
          ? Math.min(100, Math.max(0, 100 - entry.usedPercent))
          : null,
      resetAtMs: entry.resetAtMs ?? null,
      periodHours: entry.periodHours ?? null,
    })),
  };
}

/**
 * Log detail for a failed poll: numeric status, retry-after seconds and header names only, so
 * upstream bodies, header values and identities never reach the log.
 */
function failureDetail(accountId: string, response: unknown): string {
  const status =
    isRecord(response) && typeof response.status_code === 'number'
      ? response.status_code
      : 'no-status';
  const headers = isRecord(response) && isRecord(response.header) ? response.header : {};
  const names = Object.keys(headers)
    .filter((name) => /^[A-Za-z0-9-]+$/.test(name))
    .map((name) => name.toLowerCase())
    .sort();
  const retry = Object.entries(headers).find(([name]) => name.toLowerCase() === 'retry-after')?.[1];
  const seconds =
    Array.isArray(retry) && /^\d{1,6}$/.test(String(retry[0])) ? String(retry[0]) : 'none';
  return `${status} account=${accountId.slice(-8)} retry-after=${seconds} headers=${names.join(',') || 'none'}`;
}

/** Enumerates each instance once, then collects supported read-only quota observations. */
export class QuotaCollector {
  private readonly collectionSources: readonly CollectionSource[];
  readonly revision: string | undefined;
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private inFlight: Promise<void> | null = null;
  private readonly accountFlights = new Map<string, Promise<boolean>>();
  private readonly accountControllers = new Set<AbortController>();
  private readonly accountAttempts = new Map<string, number>();
  private lastAttemptAtMs: number | null = null;
  private lastRefresh: number | null = null;
  private nextRefresh: number;
  private currentIssues: PoolDashboard['issues'] = [];
  private readonly profileAttempts = new Map<string, number>();
  private readonly billingAttempts = new Map<string, number>();
  private readonly latestBilling = new Map<string, AccountBilling>();
  private readonly latestWindows = new Map<string, AccountQuotaWindow[]>();
  /** Claude's extra usage and dollar balances from the usage payload; memory-only, never pooled. */
  private readonly latestBalances = new Map<
    string,
    Pick<ClaudeUsageSnapshot, 'extraUsage' | 'dollarWindows'>
  >();
  private readonly latestReadingAt = new Map<string, number>();
  /** Reset claims in progress, so a full collection starts only after them like after a poll. */
  private readonly claimFlights = new Set<Promise<unknown>>();
  private readonly latestResets = new Map<string, AccountResets>();
  private readonly resetCreditAttempts = new Map<string, number>();
  /** Codex credit expiries from the details endpoint, keyed by account, with the count they list. */
  private readonly latestResetCredits = new Map<string, { expiries: number[]; atMs: number }>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private controller: AbortController | null = null;
  private readonly sleep: (ms: number) => Promise<void>;
  /** Per source: the last inventory read started, and the newest one whose result was applied. */
  private readonly inventorySeq = new Map<string, number>();
  private readonly appliedInventorySeq = new Map<string, number>();
  private readonly inventoryStates = new Map<string, InventorySourceState>();
  private syncedAtMs: number | null = null;
  private syncRunning: Promise<void> | null = null;
  private syncQueued: { names: Set<string>; promise: Promise<InventoryChange> } | null = null;
  private lastSyncStartedAtMs: number | null = null;
  private syncController = new AbortController();
  private readonly retiredNames = new Map<
    string,
    { name: string; sourceId: string; atMs: number }
  >();
  /** In-flight polls per account, so removing an account can abort them. */
  private readonly pollControllers = new Map<string, Set<AbortController>>();

  constructor(
    private readonly store: QuotaStore,
    options: CollectorOptions
  ) {
    if ('sources' in options) {
      this.revision = options.revision;
      const seen = new Set<string>();
      this.collectionSources = options.sources.map((source) => {
        if (!source.instanceId || seen.has(source.instanceId))
          throw new Error('Duplicate quota source');
        seen.add(source.instanceId);
        return Object.freeze({ ...source, providers: QUOTA_PROVIDERS });
      });
    } else {
      if (!options.fetcher) throw new Error('Legacy quota injection requires a fetcher');
      const manifest = options.origins
        ? undefined
        : loadSourceManifest(
            new URL('../../deploy/provider-sources.json', import.meta.url).pathname
          ).manifest;
      this.collectionSources = LEGACY_SOURCE_MAPPING.map(({ provider, instanceId }) => {
        const upstreamOrigin =
          options.origins?.[provider] ??
          manifest?.sources.find((source) => source.instanceId === instanceId)?.upstreamOrigin;
        if (!upstreamOrigin) throw new Error('Missing injected quota source');
        return {
          label: provider,
          upstreamOrigin,
          managementKeyFile: options.keyFile,
          providers: [provider],
        };
      });
    }
    this.fetcher = options.fetcher ?? fetch;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.nextRefresh = this.now();
  }

  get refreshing(): boolean {
    return this.inFlight !== null;
  }
  get lastRefreshAtMs(): number | null {
    return this.lastRefresh;
  }
  get nextRefreshAtMs(): number {
    return this.nextRefresh;
  }
  get issues(): PoolDashboard['issues'] {
    // Providers are collected concurrently; report issues in a stable order, not completion order.
    return this.currentIssues
      .map((issue) => ({ ...issue }))
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  /** In memory only: refilled by the next collection after a restart. */
  get windows(): ReadonlyMap<string, readonly AccountQuotaWindow[]> {
    return this.latestWindows;
  }
  /** In memory only: refilled by the next successful reset reading. */
  get resets(): ReadonlyMap<string, AccountResets> {
    return this.latestResets;
  }
  get billing(): ReadonlyMap<string, AccountBilling> {
    return this.latestBilling;
  }
  /** In memory only: refilled by the next Claude reading after a restart. */
  get balances(): ReadonlyMap<string, Pick<ClaudeUsageSnapshot, 'extraUsage' | 'dollarWindows'>> {
    return this.latestBalances;
  }
  /**
   * When a targeted read of this account may next run, if the 20 s floor is what holds it back;
   * null when nothing does (never read, floor passed, or not an account the collector knows).
   */
  accountRetryAtMs(requestedId: string): number | null {
    const account = this.store
      .listAccounts()
      .find((entry) => entry.id === requestedId || entry.sourceAccountId === requestedId);
    const last = account ? this.accountAttempts.get(account.id) : undefined;
    return last !== undefined && last + ACCOUNT_REFRESH_FLOOR_MS > this.now()
      ? last + ACCOUNT_REFRESH_FLOOR_MS
      : null;
  }
  get sources(): QuotaSourceView[] | undefined {
    if (this.revision === undefined) return undefined;
    return this.collectionSources.map((source) => ({
      instanceId: source.instanceId!,
      sourceLabel: source.label,
    }));
  }

  /** Per instance and provider: whether the last inventory read succeeded. */
  get inventorySources(): InventorySourceStatus[] {
    return this.collectionSources.flatMap((source) =>
      source.instanceId === undefined
        ? []
        : source.providers.map((provider) => ({
            instanceId: source.instanceId!,
            provider,
            state: this.inventoryStates.get(this.stateKey(source, provider)) ?? 'unavailable',
          }))
    );
  }
  /** When the last inventory read finished, whether or not it succeeded. */
  get inventorySyncedAtMs(): number | null {
    return this.syncedAtMs;
  }

  /**
   * Re-reads every source's credential list and applies it, without touching provider usage APIs
   * and outside the manual-refresh limit. Single flight: a call during a read waits for it and then
   * gets one fresh read of its own (the read in flight may have started before the caller's
   * change). Reads start at least a second apart. A failed or malformed read retires nothing.
   * `deletedNames` are credential file names the user deleted; matching accounts that the fresh
   * inventory confirms are gone are purged immediately instead of after the grace period.
   */
  syncInventory(options: { deletedNames?: readonly string[] } = {}): Promise<InventoryChange> {
    const names = options.deletedNames ?? [];
    if (!this.syncRunning) return this.startSync(new Set(names));
    if (!this.syncQueued) {
      const queued = {
        names: new Set<string>(),
        promise: undefined as unknown as Promise<InventoryChange>,
      };
      queued.promise = this.syncRunning.then(() => {
        this.syncQueued = null;
        return this.startSync(queued.names);
      });
      this.syncQueued = queued;
    }
    for (const name of names) this.syncQueued.names.add(name);
    return this.syncQueued.promise;
  }

  private startSync(names: ReadonlySet<string>): Promise<InventoryChange> {
    const run = this.runSync(names);
    const settled: Promise<void> = run
      .then(
        () => undefined,
        () => undefined
      )
      .then(() => {
        if (this.syncRunning === settled) this.syncRunning = null;
      });
    this.syncRunning = settled;
    return run;
  }

  private async runSync(names: ReadonlySet<string>): Promise<InventoryChange> {
    if (this.lastSyncStartedAtMs !== null) {
      const wait = this.lastSyncStartedAtMs + SYNC_FLOOR_MS - this.now();
      if (wait > 0) await this.sleep(wait);
    }
    this.lastSyncStartedAtMs = this.now();
    const signal = this.syncController.signal;
    const change: InventoryChange = { added: [], removed: [], purged: [] };
    const fresh = new Set<string>();
    await Promise.all(
      this.collectionSources.map(async (source) => {
        const seq = this.startInventoryRead(source);
        let read: Awaited<ReturnType<QuotaCollector['readInventory']>>;
        try {
          read = await this.readInventory(source, signal);
        } catch {
          if (!signal.aborted) this.markInventoryUnavailable(source);
          return;
        }
        if (signal.aborted) return;
        const applied = this.applyInventory(source, read, seq, names);
        if (!applied) return;
        fresh.add(source.instanceId ?? source.label);
        change.added.push(...applied.change.added);
        change.removed.push(...applied.change.removed);
        change.purged.push(...applied.change.purged);
      })
    );
    // Accounts an earlier read already retired, whose names are no longer on disk. Purged only
    // when this sync read their own source fresh, like a purge on the read itself.
    const nowMs = this.now();
    const late = [...this.retiredNames]
      .filter(([, remembered]) => {
        return (
          fresh.has(remembered.sourceId) &&
          names.has(remembered.name) &&
          nowMs - remembered.atMs <= RETIRED_NAME_MEMORY_MS
        );
      })
      .map(([accountId]) => accountId);
    if (late.length) {
      const purged = this.store.purgeRetired(late);
      for (const accountId of late) this.retiredNames.delete(accountId);
      this.forget(purged);
      change.purged.push(...purged);
    }
    this.syncedAtMs = this.now();
    return change;
  }

  /** Clears every per-account memory of these accounts and aborts their in-flight polls. */
  forget(accountIds: readonly string[]): void {
    for (const id of accountIds) {
      this.accountAttempts.delete(id);
      this.profileAttempts.delete(id);
      this.billingAttempts.delete(id);
      this.latestBilling.delete(id);
      this.latestWindows.delete(id);
      this.latestBalances.delete(id);
      this.latestReadingAt.delete(id);
      this.latestResets.delete(id);
      this.resetCreditAttempts.delete(id);
      this.latestResetCredits.delete(id);
      this.pollControllers.get(id)?.forEach((controller) => controller.abort());
      this.pollControllers.delete(id);
    }
  }

  /**
   * One targeted first poll for each newly added account, one after another so a bulk upload
   * cannot burst the provider's usage endpoint. Separate from the inventory sync, which never
   * calls a usage API.
   */
  async pollAdded(accountIds: readonly string[]): Promise<void> {
    for (const id of accountIds) await this.refreshAccount(id).catch(() => false);
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const nowMs = this.now();
    if (
      this.lastAttemptAtMs !== null &&
      nowMs - this.lastAttemptAtMs < MANUAL_REFRESH_INTERVAL_MS
    ) {
      return Promise.resolve();
    }
    this.lastAttemptAtMs = nowMs;
    this.nextRefresh = nowMs + REFRESH_INTERVAL_MS;
    this.controller = new AbortController();
    const pendingAccounts = [...this.accountFlights.values(), ...this.claimFlights];
    const signal = this.controller.signal;
    this.inFlight = Promise.allSettled(pendingAccounts)
      .then(() => this.collect(signal))
      .catch(() => {
        if (!this.currentIssues.length) {
          for (const source of this.collectionSources) {
            for (const provider of source.providers)
              this.addIssue(source, provider, 'quota-unavailable');
          }
        }
        // Never propagate fetch, filesystem, or SQLite messages containing upstream data.
        throw new Error('Quota refresh failed');
      })
      .finally(() => {
        this.lastRefresh = this.now();
        this.nextRefresh = this.lastRefresh + REFRESH_INTERVAL_MS;
        this.inFlight = null;
        this.controller = null;
        if (this.running) this.schedule();
      });
    return this.inFlight;
  }

  /** What is held in memory for one account: its windows and reset counts, null before a poll. */
  reading(accountId: string): ResetReading | null {
    const windows = this.latestWindows.get(accountId);
    const observedAtMs = this.latestReadingAt.get(accountId);
    if (!windows || observedAtMs === undefined) return null;
    const resets = this.latestResets.get(accountId);
    return {
      observedAtMs,
      windows: windows.map(({ id, remainingPercent, resetAtMs }) => ({
        id,
        remainingPercent,
        resetAtMs,
      })),
      resets: resets
        ? { available: resets.available, usable: resets.usable, blocker: resets.blocker }
        : null,
    };
  }

  /**
   * Runs `use` against one live account of its validated source, serialized with collection like a
   * targeted refresh: it starts after a full collection in flight, and a new one waits for it.
   * Returns null when the account is not live and enabled. A failed inventory read throws.
   */
  async withManagedAccount<T>(
    accountId: string,
    use: (account: ManagedAccount) => Promise<T>
  ): Promise<T | null> {
    const live = this.liveAccount(accountId);
    if (!live) return null;
    const { stored, source } = live;
    // Not tied to stop(): a user's claim that is already on its way is let finish.
    const signal = new AbortController().signal;
    const flight = (async () => {
      await this.inFlight?.catch(() => {});
      const found = await this.inventoryEntry(source, accountId, signal);
      if (!found) return null;
      const { key, entry } = found;
      const post = (path: string, body: Record<string, unknown>, timeoutMs?: number) =>
        this.request(source, path.replace(/^\//, ''), key, signal, body, timeoutMs);
      return use({
        provider: stored.provider,
        authIndex: entry.authIndex,
        chatgptAccountId: entry.chatgptAccountId,
        api: buildApiCallApi({
          post: async <R>(path: string, body?: unknown, config?: { timeout?: number }) =>
            (await post(path, body as Record<string, unknown>, config?.timeout)) as R,
        }),
        post: (path, body) => post(path, body),
      });
    })();
    this.claimFlights.add(flight);
    try {
      return await flight;
    } finally {
      this.claimFlights.delete(flight);
    }
  }

  /** An enabled, live account and the source it belongs to; null otherwise. */
  private liveAccount(accountId: string) {
    const stored = this.store.listAccounts().find((account) => account.id === accountId);
    if (!stored || stored.disabled || stored.retired) return null;
    const source = this.collectionSources.find((entry) => entry.instanceId === stored.instanceId);
    return source ? { stored, source } : null;
  }

  /** Reads the source's credential list and finds this account's enabled entry in it. */
  private async inventoryEntry(source: CollectionSource, accountId: string, signal: AbortSignal) {
    const { key, groups } = await this.readInventory(source, signal);
    const entry = groups
      .flatMap((group) => group.accounts)
      .find(
        ({ account, authIndex }) =>
          this.store.accountIdFor(source.instanceId!, account.provider, authIndex) === accountId
      );
    return entry && !entry.account.disabled ? { key, entry } : null;
  }

  /**
   * `force` skips the 20-second floor and never adopts a poll already in flight (it may have read
   * the account before a claim was sent): it waits for that one, then reads again.
   */
  refreshAccount(requestedId: string, options: { force?: boolean } = {}): Promise<boolean> {
    // The stored id or the source-qualified one (`sourceAccountId`, which a browser can build
    // from a source and an auth index) name one account: one flight, one 20 s limit.
    const accountId =
      this.store
        .listAccounts()
        .find((account) => account.id === requestedId || account.sourceAccountId === requestedId)
        ?.id ?? requestedId;
    const existing = this.accountFlights.get(accountId);
    if (existing) {
      return options.force
        ? existing.catch(() => false).then(() => this.refreshAccount(accountId, options))
        : existing;
    }
    const live = this.liveAccount(accountId);
    if (!live) return Promise.resolve(false);
    const { stored, source } = live;
    const last = this.accountAttempts.get(accountId);
    if (!options.force && last !== undefined && this.now() - last < ACCOUNT_REFRESH_FLOOR_MS)
      return Promise.resolve(false);
    const fullCollection = this.inFlight;
    const controller = new AbortController();
    const signal = controller.signal;
    this.accountControllers.add(controller);
    const flight = (async () => {
      await fullCollection?.catch(() => {});
      if (signal.aborted) return false;
      const current = this.store.listAccounts().find((account) => account.id === accountId);
      if (!current || current.disabled || current.retired) return false;
      this.accountAttempts.set(accountId, this.now());
      try {
        const found = await this.inventoryEntry(source, accountId, signal);
        if (!found) return false;
        const { key, entry } = found;
        return await this.pollAccount(
          current,
          entry.authIndex,
          source,
          key,
          signal,
          new Map([[accountId, current.planObservedAtMs ?? null]]),
          entry.chatgptAccountId
        );
      } catch {
        if (!signal.aborted) this.addIssue(source, stored.provider, 'quota-unavailable');
        return false;
      }
    })().finally(() => {
      this.accountFlights.delete(accountId);
      this.accountControllers.delete(controller);
    });
    this.accountFlights.set(accountId, flight);
    return flight;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    // Scheduled failures remain visible through issues; manual callers receive the sanitized error.
    void this.refresh().catch(() => {});
    if (!this.inFlight) this.schedule();
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.accountControllers.forEach((controller) => controller.abort());
    this.syncController.abort();
    this.syncController = new AbortController();
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(
      () => {
        this.timer = null;
        void this.refresh().catch(() => {});
        if (!this.inFlight && this.running) this.schedule();
      },
      Math.max(0, this.nextRefresh - this.now())
    );
    this.timer.unref?.();
  }

  /** Plan weight is best-effort: a failed lookup leaves the stored plan as it was. */
  private async recordPlan(
    account: { id: string; provider: PoolProviderId },
    authIndex: string,
    source: CollectionSource,
    key: string,
    signal: AbortSignal,
    usageBody: unknown,
    storedPlans: Map<string, number | null>
  ): Promise<void> {
    let plan: string | null = null;
    if (account.provider === 'codex') {
      plan = planFromCodexUsage(usageBody);
    } else {
      // Claude names the plan only in its profile; plans change rarely, so ask every few hours.
      const observedAt = storedPlans.get(account.id) ?? null;
      const attemptedAt = this.profileAttempts.get(account.id) ?? null;
      const last = Math.max(observedAt ?? -Infinity, attemptedAt ?? -Infinity);
      if (this.profileAttempts.has(account.id) && this.now() - last < PLAN_REFRESH_MS) return;
      this.profileAttempts.set(account.id, this.now());
      try {
        const response = await this.request(source, 'requests/api-call', key, signal, {
          authIndex,
          method: 'GET',
          url: CLAUDE_PROFILE_URL,
          header: CLAUDE_REQUEST_HEADERS,
        });
        if (isRecord(response) && response.status_code === 200) {
          const billing = billingFromClaudeProfile(response.body);
          if (billing && !signal.aborted && this.store.isLive(account.id)) {
            this.latestBilling.set(account.id, billing);
          }
          plan = planFromClaudeProfile(response.body);
        }
      } catch {
        return;
      }
    }
    if (!plan || signal.aborted || !this.store.isLive(account.id)) return;
    try {
      this.store.recordPlan(account.id, plan, this.now());
    } catch {
      // The plan only weights points; keep the samples and try again next collection.
    }
  }

  private async recordCodexBilling(
    accountId: string,
    authIndex: string,
    chatgptAccountId: string | null,
    source: CollectionSource,
    key: string,
    signal: AbortSignal
  ): Promise<void> {
    if (!chatgptAccountId) return;
    const last = this.billingAttempts.get(accountId);
    if (last !== undefined && this.now() - last < PLAN_REFRESH_MS) return;
    this.billingAttempts.set(accountId, this.now());
    try {
      const response = await this.request(source, 'requests/api-call', key, signal, {
        authIndex,
        method: 'GET',
        url: `${CODEX_SUBSCRIPTION_URL}?account_id=${encodeURIComponent(chatgptAccountId)}`,
        header: { ...CODEX_REQUEST_HEADERS, 'Chatgpt-Account-Id': chatgptAccountId },
      });
      if (!signal.aborted && isRecord(response) && response.status_code === 200) {
        const billing = billingFromCodexSubscription(response.body);
        if (billing && this.store.isLive(accountId)) this.latestBilling.set(accountId, billing);
      }
    } catch {
      // Billing is best-effort. Retain the previous reading and the attempt gate.
    }
  }

  /** Fills in each held Codex credit's expiry when the usage reply only counted them. */
  private async recordCodexResetCredits(
    accountId: string,
    authIndex: string,
    chatgptAccountId: string | null,
    source: CollectionSource,
    key: string,
    signal: AbortSignal
  ): Promise<void> {
    const resets = this.latestResets.get(accountId);
    if (!resets || resets.available === 0 || (resets.expiries?.length ?? 0) >= resets.available)
      return;
    const cached = this.latestResetCredits.get(accountId);
    const fresh =
      cached !== undefined &&
      cached.expiries.length === resets.available &&
      this.now() - cached.atMs < RESET_CREDITS_REFRESH_MS;
    const last = this.resetCreditAttempts.get(accountId);
    if (!fresh && (last === undefined || this.now() - last >= RESET_CREDITS_RETRY_MS)) {
      this.resetCreditAttempts.set(accountId, this.now());
      try {
        const response = await this.request(source, 'requests/api-call', key, signal, {
          authIndex,
          method: 'GET',
          url: CODEX_RATE_LIMIT_RESET_CREDITS_URL,
          header: {
            ...CODEX_REQUEST_HEADERS,
            ...(chatgptAccountId ? { 'Chatgpt-Account-Id': chatgptAccountId } : {}),
            Accept: 'application/json',
            'OpenAI-Beta': 'codex-1',
            Originator: 'Codex Desktop',
          },
        });
        if (!signal.aborted && isRecord(response) && response.status_code === 200) {
          const summary = normalizeCodexResetCreditsPayload(response.body);
          if (!summary.invalidPayload && this.store.isLive(accountId))
            this.latestResetCredits.set(accountId, {
              expiries: codexCreditExpiries(summary.credits),
              atMs: this.now(),
            });
        }
      } catch {
        // Expiry detail is best-effort: the counts from the usage reply still stand.
      }
    }
    const details = this.latestResetCredits.get(accountId);
    const current = this.latestResets.get(accountId);
    if (details && current === resets)
      this.latestResets.set(accountId, withCodexCreditDetails(resets, details.expiries));
  }

  private addIssue(
    source: CollectionSource,
    provider: PoolProviderId,
    code: PoolDashboard['issues'][number]['code']
  ): void {
    if (
      !this.currentIssues.some(
        (issue) =>
          issue.instanceId === source.instanceId &&
          issue.provider === provider &&
          issue.code === code
      )
    ) {
      this.currentIssues.push({
        provider,
        code,
        ...(source.instanceId === undefined
          ? {}
          : {
              instanceId: source.instanceId,
              sourceLabel: source.label,
            }),
      });
    }
  }

  private async request(
    source: CollectionSource,
    path: string,
    key: string,
    signal: AbortSignal,
    body?: Record<string, unknown>,
    timeoutMs: number = REQUEST_TIMEOUT_MS
  ): Promise<unknown> {
    signal.throwIfAborted();
    const response = await this.fetcher(new URL(`/v8/management/${path}`, source.upstreamOrigin), {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
      redirect: 'error',
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error('Quota request unavailable');
    }
    return readJson(response.body, MAX_RESPONSE_BYTES, 'Quota response too large');
  }

  /** Polls one account unless it has left its inventory; `forget` aborts the poll mid-flight. */
  private async pollAccount(
    account: StoredAccount,
    authIndex: string,
    source: CollectionSource,
    key: string,
    outerSignal: AbortSignal,
    storedPlans: Map<string, number | null>,
    chatgptAccountId: string | null
  ): Promise<boolean> {
    if (!this.store.isLive(account.id)) return false;
    const own = new AbortController();
    const controllers = this.pollControllers.get(account.id) ?? new Set<AbortController>();
    controllers.add(own);
    this.pollControllers.set(account.id, controllers);
    try {
      return await this.pollLiveAccount(
        account,
        authIndex,
        source,
        key,
        AbortSignal.any([outerSignal, own.signal]),
        storedPlans,
        chatgptAccountId
      );
    } finally {
      controllers.delete(own);
      if (!controllers.size && this.pollControllers.get(account.id) === controllers) {
        this.pollControllers.delete(account.id);
      }
    }
  }

  private async pollLiveAccount(
    account: StoredAccount,
    authIndex: string,
    source: CollectionSource,
    key: string,
    signal: AbortSignal,
    storedPlans: Map<string, number | null>,
    chatgptAccountId: string | null
  ): Promise<boolean> {
    let samples: QuotaSample[];
    let windows: AccountQuotaWindow[];
    let usageBody: unknown;
    let upstream: unknown;
    try {
      const claude = account.provider === 'claude';
      const response = await this.request(source, 'requests/api-call', key, signal, {
        authIndex,
        method: 'GET',
        url: claude ? ANTHROPIC_API_ORIGIN + ANTHROPIC_RESET_GRANT_STATUS_PATH : CODEX_USAGE_URL,
        header: claude ? CLAUDE_REQUEST_HEADERS : CODEX_REQUEST_HEADERS,
      });
      upstream = response;
      if (
        !isRecord(response) ||
        response.status_code !== 200 ||
        !(typeof response.body === 'string' || isRecord(response.body))
      ) {
        throw new Error('Quota request unavailable');
      }
      ({ samples, windows } = quotaSamples(
        account.provider,
        account.id,
        response.body,
        this.now()
      ));
      usageBody = response.body;
    } catch {
      if (!signal.aborted && this.store.isLive(account.id)) {
        console.error(
          `Quota request failed: ${account.provider} ${failureDetail(account.id, upstream)}`
        );
        this.addIssue(source, account.provider, 'quota-unavailable');
        this.store.markAccountError(account.id, this.now());
      }
      return false;
    }
    // The account may have left its inventory while the request was in flight. Its rows can be
    // gone, so writing a sample would fail the whole collection; nothing may be stored for it.
    if (!signal.aborted && this.store.isLive(account.id)) {
      try {
        this.store.recordSamples(samples);
        this.latestWindows.set(account.id, windows);
        this.latestReadingAt.set(account.id, this.now());
        const resets = readAccountResets(account.provider, usageBody, this.now());
        if (resets) this.latestResets.set(account.id, resets);
        if (account.provider === 'claude') {
          const snapshot = normalizeClaudeUsageSnapshot(parseClaudeUsagePayload(usageBody));
          if (snapshot) {
            this.latestBalances.set(account.id, {
              extraUsage: snapshot.extraUsage,
              dollarWindows: snapshot.dollarWindows,
            });
          }
        }
      } catch {
        this.addIssue(source, account.provider, 'quota-unavailable');
        throw new Error('Quota sample persistence failed');
      }
      if (account.provider === 'codex') {
        await this.recordCodexResetCredits(
          account.id,
          authIndex,
          chatgptAccountId,
          source,
          key,
          signal
        );
        await this.recordCodexBilling(account.id, authIndex, chatgptAccountId, source, key, signal);
      }
      await this.recordPlan(account, authIndex, source, key, signal, usageBody, storedPlans);
    }
    return !signal.aborted && this.store.isLive(account.id);
  }

  private async readInventory(source: CollectionSource, signal: AbortSignal) {
    const key = (await readFile(source.managementKeyFile, 'utf8')).trim();
    if (!boundedString(key, 8192)) throw new Error('Invalid management key');
    const payload = await this.request(source, 'credentials', key, signal);
    const groups = source.providers.map((provider) => ({
      provider,
      accounts: inventory(payload, provider, this.now()),
    }));
    return { key, groups };
  }

  private stateKey(source: CollectionSource, provider: PoolProviderId): string {
    return JSON.stringify([source.instanceId ?? source.label, provider]);
  }

  /**
   * Numbers each inventory read of a source when it starts. A read whose result arrives after a
   * newer read's result was applied is stale (it may still list an account the newer read saw
   * removed) and must not be applied.
   */
  private startInventoryRead(source: CollectionSource): number {
    const id = source.instanceId ?? source.label;
    const seq = (this.inventorySeq.get(id) ?? 0) + 1;
    this.inventorySeq.set(id, seq);
    return seq;
  }

  private markInventoryUnavailable(source: CollectionSource): void {
    for (const provider of source.providers) {
      this.inventoryStates.set(this.stateKey(source, provider), 'unavailable');
      this.addIssue(source, provider, 'inventory-unavailable');
    }
  }

  /**
   * Records one validated inventory. Returns null when it is stale. Otherwise returns the accounts
   * to poll and what changed; accounts that left are forgotten here, after their rows are retired
   * or purged and before anything can poll them again.
   */
  private applyInventory(
    source: CollectionSource,
    {
      key,
      groups,
    }: { key: string; groups: { provider: PoolProviderId; accounts: InventoryAccount[] }[] },
    seq: number,
    deletedNames?: ReadonlySet<string>
  ): {
    pending: (InventoryAccount & { source: CollectionSource; key: string })[];
    change: InventoryChange;
  } | null {
    const id = source.instanceId ?? source.label;
    if (seq < (this.appliedInventorySeq.get(id) ?? 0)) return null;
    this.appliedInventorySeq.set(id, seq);
    const pending: (InventoryAccount & { source: CollectionSource; key: string })[] = [];
    const change: InventoryChange = { added: [], removed: [], purged: [] };
    const namesBefore = new Map(
      this.store
        .listAccounts()
        .filter((stored) => !stored.retired && stored.instanceId === source.instanceId)
        .map((stored) => [stored.id, stored.name])
    );
    for (const { provider, accounts } of groups) {
      try {
        for (const entry of accounts) {
          if (source.instanceId !== undefined) {
            entry.account.instanceId = source.instanceId;
            entry.account.id = this.store.accountIdFor(
              source.instanceId,
              provider,
              entry.authIndex
            );
          }
        }
        const changed = this.store.recordInventory(
          provider,
          accounts.map(({ account }) => account),
          this.now(),
          source.instanceId,
          deletedNames
        );
        change.added.push(...changed.added);
        change.removed.push(...changed.removed);
        change.purged.push(...changed.purged);
        this.inventoryStates.set(this.stateKey(source, provider), 'ok');
        this.currentIssues = this.currentIssues.filter(
          (issue) =>
            !(
              issue.instanceId === source.instanceId &&
              issue.provider === provider &&
              issue.code === 'inventory-unavailable'
            )
        );
        pending.push(
          ...accounts
            .filter(({ account }) => !account.disabled)
            .map((entry) => ({ ...entry, source, key }))
        );
      } catch {
        this.inventoryStates.set(this.stateKey(source, provider), 'unavailable');
        this.addIssue(source, provider, 'inventory-unavailable');
      }
    }
    const nowMs = this.now();
    for (const [accountId, remembered] of this.retiredNames) {
      if (nowMs - remembered.atMs > RETIRED_NAME_MEMORY_MS) this.retiredNames.delete(accountId);
    }
    for (const accountId of change.added) this.retiredNames.delete(accountId);
    for (const accountId of change.removed) {
      const name = namesBefore.get(accountId);
      if (name !== undefined) this.retiredNames.set(accountId, { name, sourceId: id, atMs: nowMs });
    }
    this.forget([...change.removed, ...change.purged]);
    return { pending, change };
  }

  private async collect(signal: AbortSignal): Promise<void> {
    this.currentIssues = [];
    this.forget(this.store.prune(this.now()));
    const inventories = await Promise.allSettled(
      this.collectionSources.map(async (source) => {
        const seq = this.startInventoryRead(source);
        let read: Awaited<ReturnType<QuotaCollector['readInventory']>>;
        try {
          read = await this.readInventory(source, signal);
        } catch {
          if (!signal.aborted) this.markInventoryUnavailable(source);
          return [];
        } finally {
          this.syncedAtMs = this.now();
        }
        if (signal.aborted) return [];
        return this.applyInventory(source, read, seq)?.pending ?? [];
      })
    );
    const accounts: (InventoryAccount & { source: CollectionSource; key: string })[] = [];
    for (const result of inventories) {
      if (result.status === 'rejected') throw new Error('Quota inventory persistence failed');
      accounts.push(...result.value);
    }
    const storedPlans = new Map(
      this.store.listAccounts().map((stored) => [stored.id, stored.planObservedAtMs ?? null])
    );
    let cursor = 0;
    const worker = async () => {
      while (cursor < accounts.length && !signal.aborted) {
        const { account, authIndex, chatgptAccountId, source, key } = accounts[cursor++];
        await this.pollAccount(
          account,
          authIndex,
          source,
          key,
          signal,
          storedPlans,
          chatgptAccountId
        );
      }
    };
    const workers = await Promise.allSettled([worker(), worker()]);
    if (workers.some((result) => result.status === 'rejected')) {
      throw new Error('Quota sample persistence failed');
    }
  }
}
