/**
 * Server-served quota, React-free: how a prox-history account becomes the card state the
 * hub-direct adapters build, and how it reaches the source session's one shared quota store.
 *
 * The numbers are the server's; nothing here computes a lane, a percent or a reset. A reading the
 * page itself took from the hub (a disabled account's explicit Refresh) is newer than the stored
 * sample the server serves for it, so the newer one stays until the server has something newer.
 */
import type { TFunction } from 'i18next';
import type { AccountResets } from '@/domain/quotaPool/types';
import type { ServerAccount, ServerAccountWindow } from '@/domain/quotaPool/accounts';
import { resolveQuotaProviderType } from '@/features/quota/logic';
import type {
  AnthropicResetGrant,
  AnthropicResetGrantStatus,
} from '@/services/api/claudeResetGrants';
import type { SourceOwner } from '@/services/api/sourceSession';
import type { QuotaStore } from '@/stores/useQuotaStore';
import {
  servedByServer,
  useServerAccountsStore,
  type ServerRouting,
} from '@/stores/useServerAccountsStore';
import type {
  AuthFileItem,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  CodexQuotaState,
  CodexQuotaWindow,
} from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { formatQuotaResetTime } from '@/utils/quota/formatters';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';
import { formatReadTime } from '@/features/quota/quotaFreshness';
import { heldResets, poolSourceAccountId } from './resetAccounts';

const iso = (ms: number) => new Date(ms).toISOString();

const CLAUDE_PLAN_KEYS: Readonly<Record<string, string>> = {
  claude_pro: 'plan_pro',
  default_claude_pro: 'plan_pro',
  default_claude_max: 'plan_max',
  default_claude_max_5x: 'plan_max5',
  default_claude_max_20x: 'plan_max20',
  default_claude_ultra: 'plan_max20',
  claude_team: 'plan_team',
};

const usedPercent = (window: ServerAccountWindow) =>
  window.remainingPercent === null ? null : 100 - window.remainingPercent;
const resetLabel = (window: ServerAccountWindow) =>
  window.resetAtMs === null ? '-' : formatQuotaResetTime(iso(window.resetAtMs));

const claudeWindow = (window: ServerAccountWindow, t: TFunction): ClaudeQuotaWindow => ({
  id: window.id,
  label: t(window.labelKey),
  labelKey: window.labelKey,
  usedPercent: usedPercent(window),
  resetLabel: resetLabel(window),
  resetAtMs: window.resetAtMs,
  periodHours: window.periodHours,
});

const codexWindow = (window: ServerAccountWindow, t: TFunction): CodexQuotaWindow => ({
  id: window.id,
  label: t(window.labelKey, window.labelParams),
  labelKey: window.labelKey,
  ...(window.labelParams ? { labelParams: window.labelParams } : {}),
  usedPercent: usedPercent(window),
  resetLabel: resetLabel(window),
  resetAtMs: window.resetAtMs,
  periodHours: window.periodHours,
});

/** A reading the server could not refresh recently is shown as the last one it has, marked stale. */
const isStale = (account: ServerAccount) =>
  account.status === 'stale' || account.status === 'error';

export function serverClaudeState(account: ServerAccount, t: TFunction): ClaudeQuotaState {
  return {
    status: 'success',
    windows: account.windows.map((window) => claudeWindow(window, t)),
    extraUsage: account.extraUsage ?? null,
    dollarWindows: account.dollarWindows ?? [],
    planType: account.plan.type ? (CLAUDE_PLAN_KEYS[account.plan.type] ?? null) : null,
    billing: account.billing,
    observedAt: account.observedAtMs === null ? null : iso(account.observedAtMs),
    stale: isStale(account),
  };
}

export function serverCodexState(account: ServerAccount, t: TFunction): CodexQuotaState {
  const resets = account.resets;
  return {
    status: 'success',
    windows: account.windows.map((window) => codexWindow(window, t)),
    planType: account.plan.type,
    billing: account.billing,
    rateLimitResetCreditsAvailableCount: resets?.available ?? null,
    rateLimitResetCreditsApplicableAvailableCount: resets?.usable ?? null,
    rateLimitResetCredits: (resets?.expiries ?? []).map((expiresAtMs, index) => ({
      id: String(index),
      status: 'available',
      grantedAt: '',
      expiresAt: iso(expiresAtMs),
    })),
  };
}

/** The one server account of a credential, when this credential is served from the server. */
export function serverAccountFor(
  routing: ServerRouting,
  accounts: Readonly<Record<string, ServerAccount>>,
  instanceId: string | undefined,
  provider: string,
  file: AuthFileItem
): ServerAccount | undefined {
  if (!servedByServer(routing, instanceId, provider) || !instanceId) return undefined;
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  return authIndex
    ? accounts[poolSourceAccountId(instanceId, provider as 'claude' | 'codex', authIndex)]
    : undefined;
}

/** True for a credential the server serves, whether or not it has read the account yet. */
export function isServedFile(
  routing: ServerRouting,
  instanceId: string | undefined,
  file: AuthFileItem
): boolean {
  const type = resolveQuotaProviderType(file);
  return (type === 'claude' || type === 'codex') && servedByServer(routing, instanceId, type);
}

export type ServerReadOutcome =
  | { kind: 'read' }
  /** The server's read floor skipped it: the card says when the next read may run. */
  | { kind: 'waiting'; retryAtMs: number }
  | { kind: 'failed' };

/** The Refresh of one served credential: a targeted read on the history server, not on the hub. */
export async function refreshServedFile(args: {
  owner: SourceOwner;
  file: AuthFileItem;
  store: QuotaStore;
}): Promise<ServerReadOutcome> {
  const { owner, file, store } = args;
  const type = resolveQuotaProviderType(file);
  const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
  if ((type !== 'claude' && type !== 'codex') || !authIndex) return { kind: 'failed' };
  const result = await useServerAccountsStore
    .getState()
    .refreshAccount(poolSourceAccountId(owner.instanceId, type, authIndex));
  const key = getQuotaCacheKey(file);
  if (result?.refreshed) {
    store.getState().setNextReadAt(key, null);
    return { kind: 'read' };
  }
  if (result?.retryAtMs != null) {
    store.getState().setNextReadAt(key, result.retryAtMs);
    return { kind: 'waiting', retryAtMs: result.retryAtMs };
  }
  return { kind: 'failed' };
}

/** What a card's Refresh tells the user once the server answered. */
export function serverReadNotice(
  outcome: ServerReadOutcome,
  args: {
    name: string;
    t: TFunction;
    language: string;
    /** When the shown reading was taken, if there is one. */
    readAtMs: number | undefined;
    nowMs: number;
  }
): { text: string; type: 'success' | 'info' | 'error' } {
  const { name, t, language, readAtMs, nowMs } = args;
  if (outcome.kind === 'read')
    return { text: t('auth_files.quota_refresh_success', { name }), type: 'success' };
  if (outcome.kind === 'failed')
    return {
      text: t('auth_files.quota_refresh_failed', { name, message: t('common.unknown_error') }),
      type: 'error',
    };
  const time = formatReadTime(outcome.retryAtMs, language);
  return {
    text:
      readAtMs === undefined
        ? t('auth_files.quota_server_wait_unread', { name, time })
        : t('auth_files.quota_server_wait', {
            name,
            ago: formatRelativeInstant(readAtMs, nowMs, language),
            time,
          }),
    type: 'info',
  };
}

/**
 * The page-wide refresh for the served credentials among `files`: one collection request for all
 * of them. When the server's 4 minute floor skipped it, each card names the next scheduled read.
 */
export async function refreshServedPage(args: {
  files: readonly AuthFileItem[];
  store: QuotaStore;
}): Promise<ServerReadOutcome> {
  const outcome = await useServerAccountsStore.getState().refreshAll();
  if (!outcome) return { kind: 'failed' };
  for (const file of args.files) {
    const key = getQuotaCacheKey(file);
    args.store
      .getState()
      .setNextReadAt(
        key,
        outcome.started || outcome.nextRefreshAtMs === null ? null : outcome.nextRefreshAtMs
      );
  }
  return outcome.started || outcome.nextRefreshAtMs === null
    ? { kind: 'read' }
    : { kind: 'waiting', retryAtMs: outcome.nextRefreshAtMs };
}

/**
 * Writes the server's reading of each served credential into the source session's shared quota
 * store, with the server's observation time as its read time (so every page says how old it is).
 * Only a changed reading is written, and never over a newer hub-direct one.
 */
export function projectServerAccounts(args: {
  owner: SourceOwner;
  files: readonly AuthFileItem[];
  routing: ServerRouting;
  accounts: Readonly<Record<string, ServerAccount>>;
  store: QuotaStore;
  t: TFunction;
}): void {
  const { owner, files, routing, accounts, store, t } = args;
  const claude: Record<string, ClaudeQuotaState> = {};
  const codex: Record<string, CodexQuotaState> = {};
  const stamps: Record<string, number> = {};
  const shown = projected.get(store) ?? new Map<string, ServerAccount>();
  projected.set(store, shown);
  const state = store.getState();
  for (const file of files) {
    const type = resolveQuotaProviderType(file);
    if (type !== 'claude' && type !== 'codex') continue;
    const account = serverAccountFor(routing, accounts, owner.instanceId, type, file);
    if (!account) continue;
    const key = getQuotaCacheKey(file);
    const readAt = account.observedAtMs;
    const held = state.fetchedAt[key];
    const current = type === 'claude' ? state.claudeQuota[key] : state.codexQuota[key];
    // A read the page is making right now (a disabled account's own Refresh) finishes first.
    if (current?.status === 'loading') continue;
    if (readAt === null || (held !== undefined && held > readAt)) continue;
    if (shown.get(key) === account && held === readAt) continue;
    if (type === 'claude') claude[key] = serverClaudeState(account, t);
    else codex[key] = serverCodexState(account, t);
    stamps[key] = readAt;
    shown.set(key, account);
  }
  if (!Object.keys(stamps).length) return;
  if (Object.keys(claude).length) state.setClaudeQuota((prev) => ({ ...prev, ...claude }));
  if (Object.keys(codex).length) state.setCodexQuota((prev) => ({ ...prev, ...codex }));
  store.setState((current) => ({ fetchedAt: { ...current.fetchedAt, ...stamps } }));
}

/** Which account object each key last showed, so an unchanged poll writes nothing. */
const projected = new WeakMap<QuotaStore, Map<string, ServerAccount>>();

/**
 * Grants a server reading stands in for: one per held reset, as the hub-direct read would list
 * them, so the same card and chooser code shows them. Real grants (ids the claim needs) are read
 * from the hub when the claim dialog opens.
 */
export function serverGrantStatus(
  resets: AccountResets | null,
  now: number
): AnthropicResetGrantStatus | null {
  if (!resets) return null;
  return {
    eligible: true,
    ineligibleReason: null,
    atLimit: true,
    grants: grantsFromResets(resets, now),
    nextGrantId: null,
    weeklyResetsAt: null,
    cooldownUntil: null,
  };
}

export function grantsFromResets(resets: AccountResets, now: number): AnthropicResetGrant[] {
  const dated = heldResets(resets, now);
  const grants = dated.map((reset, index): AnthropicResetGrant => ({
    id: `server-${index}`,
    label: '',
    resetsTotal: 1,
    resetsLeft: 1,
    startsAt: null,
    endsAt: iso(reset.at),
    clears: [],
    paused: false,
    usableNow: index < resets.usable,
    useRequiresLimit: false,
    percentUsed: {},
    kind: reset.kind ?? 'full',
  }));
  for (let index = dated.length; index < resets.available; index += 1) {
    grants.push({
      id: `server-${index}`,
      label: '',
      resetsTotal: 1,
      resetsLeft: 1,
      startsAt: null,
      endsAt: null,
      clears: [],
      paused: false,
      usableNow: index < resets.usable,
      useRequiresLimit: false,
      percentUsed: {},
      kind: 'full',
    });
  }
  return grants;
}
