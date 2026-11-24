/**
 * Quota Overview model: pure functions over the upstream quota cache and the
 * quota CLIProxy observes from proxied traffic.
 *
 * Fork-only code (see src/custom/README.md). It reads the same quota states the
 * upstream Quota page stores, so provider fetching and parsing stay upstream's.
 */

import i18n from '@/i18n';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import {
  resolveAntigravityBucketLabelKey,
  resolveAntigravityGroupLabelKey,
} from '@/features/quota/providers/antigravity/labels';
import { nextRecoveryMs } from '@/features/quota/resetSchedule';
import type { QuotaFileEntry } from '@/features/quota/logic';
import type { QuotaCardState } from '@/features/quota/providers';
import type { QuotaProviderType } from '@/features/quota/providers/types';
import type { AntigravityQuotaGroup, AuthFileItem } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import type { HistorySample, QuotaHistory } from './history';
import { readPassiveQuota } from './passiveQuota';
import type { PoolAccount } from './poolForecast';
import type { RoutingAccount, RoutingPool } from './routing';
import type { AnthropicResetGrant } from '@/services/api/claudeResetGrants';

export const FABLE_WINDOW_ID = 'seven-day-fable';
/** Golden yellow; the light-theme step keeps small labels readable. */
export const fableColor = (theme: string) => (theme === 'dark' ? '#ffcc4d' : '#9a6d00');

/** Use the reported label or cleared windows, never a grant ID or its expiry. */
export function resetGrantKind(grant: Pick<AnthropicResetGrant, 'label' | 'clears'>) {
  if (/\bfable\b/i.test(grant.label)) return 'fable' as const;
  if (grant.clears.includes('seven_day') || grant.clears.includes('five_hour'))
    return 'shared' as const;
  return 'unknown' as const;
}

/** One limit on one credential, normalized to percent remaining. */
export interface OverviewWindow {
  id: string;
  label: string;
  /** Percent remaining, 0..100; null when the provider reported no usage. */
  remaining: number | null;
  resetAtMs: number | null;
  periodHours: number | null;
  /** Quota pool, for providers whose pools are exhausted independently (Antigravity). */
  pool?: string;
}

export interface OverviewCredential {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  windows: OverviewWindow[];
  /** The window that governs weekly capacity, when one is known. */
  primary: OverviewWindow | null;
  plan: string | null;
  /** When an exhausted limit gives capacity back; null when nothing is exhausted. */
  backAtMs: number | null;
  /** The proxy's own credential cooldown, from the auth-files snapshot. */
  cooldownUntilMs: number | null;
  priority: number;
  /**
   * Where the windows came from: a quota request made from this panel, or
   * CLIProxy's reading of the credential's last proxied response.
   */
  source: 'live' | 'proxy' | null;
  /** When the source read the limits; null when it doesn't say. */
  observedAtMs: number | null;
  /** The weekly reading as observed (before rolling past resets), for history. */
  sample: HistorySample | null;
  /** Scoped readings keep their own observation time, even after a newer header read. */
  fableSample: HistorySample | null;
  fableObservedAtMs: number | null;
  /** Backend decision for the selected new-session request context, when available. */
  routing?: RoutingAccount & { next: boolean; pool: RoutingPool | null };
}

export interface OverviewProviderPool {
  provider: QuotaProviderType;
  credentialCount: number;
  /** Credentials with a weekly reading, in routing order. */
  accounts: PoolAccount[];
  /** Fable allowance, separate from and never added to shared weekly capacity. */
  fableAccounts: PoolAccount[];
}

const WEEKLY_HOURS = 168;
const HOUR_MS = 3_600_000;

const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

const finiteOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

interface UsedWindowLike {
  id?: string;
  label?: string;
  usedPercent?: number | null;
  resetAtMs?: number | null;
  periodHours?: number | null;
}

const fromUsedWindows = (windows: readonly UsedWindowLike[] | undefined): OverviewWindow[] =>
  (windows ?? []).map((window, index) => {
    const used = finiteOrNull(window.usedPercent);
    return {
      id: window.id || `window-${index}`,
      label: window.label || window.id || `#${index + 1}`,
      remaining: used === null ? null : clampPercent(100 - used),
      resetAtMs: finiteOrNull(window.resetAtMs),
      periodHours: finiteOrNull(window.periodHours),
    };
  });

/** Short pool names: Gemini, and Other for the shared Claude and GPT pool. */
const ANTIGRAVITY_POOL_KEYS: Record<string, string> = {
  group_gemini_models: 'pd_overview.pool_gemini',
  group_claude_gpt_models: 'pd_overview.pool_other',
};
const ANTIGRAVITY_WINDOW_KEYS: Record<string, string> = {
  five_hour_limit: 'pd_overview.window_five_hour',
  daily_limit: 'pd_overview.window_daily',
  weekly_limit: 'pd_overview.window_weekly',
  monthly_limit: 'pd_overview.window_monthly',
};

const isGeminiGroup = (group: AntigravityQuotaGroup) =>
  resolveAntigravityGroupLabelKey(group.label) === 'group_gemini_models';

/** Gemini first: it drives the charts, and partial summaries can list it last. */
export const geminiFirst = (groups: readonly AntigravityQuotaGroup[]): AntigravityQuotaGroup[] => [
  ...groups.filter(isGeminiGroup),
  ...groups.filter((group) => !isGeminiGroup(group)),
];

const antigravityPoolName = (group: AntigravityQuotaGroup) => {
  const key = ANTIGRAVITY_POOL_KEYS[resolveAntigravityGroupLabelKey(group.label) ?? ''];
  return key ? i18n.t(key) : group.label;
};

const antigravityWindowName = (bucket: AntigravityQuotaGroup['buckets'][number]) => {
  const key =
    ANTIGRAVITY_WINDOW_KEYS[resolveAntigravityBucketLabelKey(bucket.label, bucket.window) ?? ''];
  return key ? i18n.t(key) : bucket.label;
};

/** Each Antigravity bucket is its own window, named by its pool: "Gemini 5-hour". */
const antigravityWindows = (groups: readonly AntigravityQuotaGroup[]): OverviewWindow[] =>
  geminiFirst(groups).flatMap((group) => {
    const pool = antigravityPoolName(group);
    return group.buckets.map((bucket) => ({
      id: `${group.id}:${bucket.id}`,
      label: i18n.t('pd_overview.pool_window', { pool, window: antigravityWindowName(bucket) }),
      remaining: clampPercent(bucket.remainingFraction * 100),
      resetAtMs: finiteOrNull(bucket.resetAtMs),
      periodHours: finiteOrNull(bucket.periodHours),
      pool: group.id,
    }));
  });

/**
 * The quota the Quota Overview charts read. Antigravity keeps only its Gemini
 * pool, with short labels; the ledger still lists every pool.
 */
export function chartQuota(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined
): QuotaCardState | undefined {
  if (provider !== 'antigravity' || quota?.status !== 'success') return quota;
  const groups = (quota as { groups?: AntigravityQuotaGroup[] }).groups ?? [];
  const gemini = groups.filter(isGeminiGroup);
  if (gemini.length === 0) return quota;
  return {
    ...quota,
    groups: gemini.map((group) => ({
      ...group,
      label: antigravityPoolName(group),
      buckets: group.buckets.map((bucket) => ({ ...bucket, label: antigravityWindowName(bucket) })),
    })),
  } as QuotaCardState;
}

/**
 * Every limit on a credential. Claude, Codex and Antigravity keep per-window
 * reset instants; other providers fall back to the upstream timeline lane,
 * which carries labels and remaining percentages but a single reset anchor.
 */
export function overviewWindows(
  provider: QuotaProviderType,
  quota: QuotaCardState | undefined,
  name: string
): OverviewWindow[] {
  if (!quota || quota.status !== 'success') return [];
  if (provider === 'claude' || provider === 'codex') {
    return fromUsedWindows((quota as { windows?: UsedWindowLike[] }).windows);
  }
  if (provider === 'antigravity') {
    return antigravityWindows((quota as { groups?: AntigravityQuotaGroup[] }).groups ?? []);
  }
  const lane = buildTimelineLane({ name, displayName: name, provider, quota });
  return lane.limits.map((limit, index) => ({
    id: `${provider}-${index}`,
    label: limit.label,
    remaining: clampPercent(limit.remaining),
    resetAtMs: index === 0 ? lane.anchorMs : null,
    periodHours: index === 0 ? lane.periodHours : null,
  }));
}

/**
 * The weekly account limit: Claude's `seven-day`, Codex's `weekly`, otherwise
 * the longest window that is at most a week long.
 */
export function pickPrimaryWindow(windows: readonly OverviewWindow[]): OverviewWindow | null {
  const preferred = windows.find((window) => window.id === 'seven-day' || window.id === 'weekly');
  if (preferred) return preferred;
  let best: OverviewWindow | null = null;
  for (const window of windows) {
    if (window.periodHours === null || window.periodHours > WEEKLY_HOURS) continue;
    if (best === null || (best.periodHours ?? 0) < window.periodHours) best = window;
  }
  return best ?? windows[0] ?? null;
}

/** Latest reset among exhausted limits: the instant the credential is usable again. */
export function backAtMs(windows: readonly OverviewWindow[], nowMs: number): number | null {
  let back: number | null = null;
  for (const window of windows) {
    if (window.remaining === null || window.remaining > 0) continue;
    if (window.resetAtMs === null || window.resetAtMs <= nowMs) continue;
    if (back === null || window.resetAtMs > back) back = window.resetAtMs;
  }
  return back;
}

/** Credential-scoped cooldown the proxy itself is enforcing, if any. */
export function cooldownUntilMs(file: AuthFileItem, nowMs: number): number | null {
  const records = file.cooldownSnapshot?.records ?? [];
  let until: number | null = null;
  for (const record of records) {
    if (record.scope !== 'credential') continue;
    const at = Date.parse(record.retryAt);
    if (!Number.isFinite(at) || at <= nowMs) continue;
    if (until === null || at > until) until = at;
  }
  return until;
}

const readPlan = (quota: QuotaCardState | undefined): string | null => {
  if (!quota || quota.status !== 'success') return null;
  const state = quota as { planType?: unknown; plan?: unknown; data?: { planName?: unknown } };
  const plan = state.planType ?? state.plan ?? state.data?.planName;
  return typeof plan === 'string' && plan.trim() ? plan.trim() : null;
};

/** When a loaded quota state was fetched, if the provider adapter records it. */
const liveObservedAtMs = (quota: QuotaCardState | undefined): number | null => {
  const state = quota as { observedAt?: unknown; observedAtMs?: unknown } | undefined;
  const at =
    typeof state?.observedAtMs === 'number'
      ? state.observedAtMs
      : typeof state?.observedAt === 'string'
        ? Date.parse(state.observedAt)
        : NaN;
  return Number.isFinite(at) ? at : null;
};

/**
 * A reading taken before a window reset says nothing about the new window
 * except that it started full: move such windows to 100% and their next reset.
 */
export function rollPastResets(
  windows: readonly OverviewWindow[],
  nowMs: number
): OverviewWindow[] {
  return windows.map((window) => {
    if (window.resetAtMs === null || window.resetAtMs > nowMs) return window;
    const periodMs = window.periodHours === null ? 0 : window.periodHours * HOUR_MS;
    const resetAtMs =
      periodMs > 0
        ? window.resetAtMs + (Math.floor((nowMs - window.resetAtMs) / periodMs) + 1) * periodMs
        : null;
    return { ...window, remaining: window.remaining === null ? null : 100, resetAtMs };
  });
}

/**
 * Resets this close together are the same cycle. The usage endpoint and the
 * response headers report the same instant with different precision.
 */
const SAME_CYCLE_TOLERANCE_MS = 5 * 60_000;
/** The two sources round the same usage at most about a point apart. */
const ROUNDING_GAP_PERCENT = 2;

/**
 * The usage endpoint and the rate-limit headers round the same usage about a
 * point apart, so picking the newer reading alone makes the percentage bounce
 * between them. Within one cycle usage only rises: keep the older reading when
 * it shows slightly more usage. Across a reset, or after a larger drop such as
 * a spent reset grant, the newer reading wins.
 */
export function reconcileWindow(newer: OverviewWindow, older: OverviewWindow): OverviewWindow {
  if (newer.remaining === null || older.remaining === null) return newer;
  if (newer.resetAtMs === null || older.resetAtMs === null) return newer;
  if (Math.abs(newer.resetAtMs - older.resetAtMs) > SAME_CYCLE_TOLERANCE_MS) return newer;
  const gap = newer.remaining - older.remaining;
  return gap > 0 && gap <= ROUNDING_GAP_PERCENT ? { ...newer, remaining: older.remaining } : newer;
}

export function buildOverviewCredential(
  entry: QuotaFileEntry,
  quota: QuotaCardState | undefined,
  nowMs: number
): OverviewCredential {
  const live = overviewWindows(entry.type, quota, entry.file.name);
  const liveAt = live.length > 0 ? liveObservedAtMs(quota) : null;
  const passive = readPassiveQuota(entry.type, entry.file);
  const passiveById = new Map((passive?.windows ?? []).map((window) => [window.id, window]));
  let observed = live.map((window) => {
    const other = passiveById.get(window.id);
    return other ? reconcileWindow(window, other) : window;
  });
  let source: OverviewCredential['source'] = live.length > 0 ? 'live' : null;
  let observedAtMs = liveAt;
  // Prefer whichever reading is newer; the proxy's lacks some limits, so keep
  // the live ones it doesn't report.
  if (passive && (liveAt === null || passive.observedAtMs > liveAt)) {
    observed = [
      ...live.map((window) => {
        const newer = passiveById.get(window.id);
        return newer ? reconcileWindow(newer, window) : window;
      }),
      ...passive.windows.filter((window) => !live.some((own) => own.id === window.id)),
    ];
    source = 'proxy';
    observedAtMs = passive.observedAtMs;
  }
  const observedPrimary = pickPrimaryWindow(observed);
  const observedFable =
    entry.type === 'claude' ? observed.find((window) => window.id === FABLE_WINDOW_ID) : null;
  const fableObservedAtMs =
    source === 'proxy' && passive?.windows.some((window) => window.id === FABLE_WINDOW_ID)
      ? passive.observedAtMs
      : liveAt;
  const windows = rollPastResets(observed, nowMs);
  const primary = pickPrimaryWindow(windows);
  // A spent pool blocks only its own models, so only the primary pool's limits block the account.
  const blocking = primary?.pool
    ? windows.filter((window) => window.pool === primary.pool)
    : windows;
  return {
    entry,
    quota,
    windows,
    primary,
    plan: readPlan(quota),
    backAtMs: backAtMs(blocking, nowMs),
    cooldownUntilMs: cooldownUntilMs(entry.file, nowMs),
    priority: typeof entry.file.priority === 'number' ? entry.file.priority : 0,
    source,
    observedAtMs,
    sample:
      observedPrimary && observedPrimary.remaining !== null
        ? [observedAtMs ?? nowMs, observedPrimary.remaining, observedPrimary.resetAtMs]
        : null,
    fableSample:
      observedFable && observedFable.remaining !== null
        ? [fableObservedAtMs ?? nowMs, observedFable.remaining, observedFable.resetAtMs]
        : null,
    fableObservedAtMs,
  };
}

/**
 * Use backend rank within each provider when available. Without a backend
 * snapshot, priority and name are only a display order.
 */
export function compareRoutingOrder(a: OverviewCredential, b: OverviewCredential): number {
  if (a.entry.type !== b.entry.type) return a.entry.type.localeCompare(b.entry.type);
  const aRank = a.routing?.rank || Number.POSITIVE_INFINITY;
  const bRank = b.routing?.rank || Number.POSITIVE_INFINITY;
  if (aRank !== bRank) return aRank - bRank;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.entry.file.name < b.entry.file.name ? -1 : a.entry.file.name > b.entry.file.name ? 1 : 0;
}

export const isCredentialAvailable = (credential: OverviewCredential): boolean =>
  !credential.entry.file.disabled &&
  credential.cooldownUntilMs === null &&
  credential.backAtMs === null &&
  credential.quota?.status !== 'error';

/**
 * Only backend predictions mark an account as next for a new session.
 * Names are provider-scoped so similarly named credentials cannot share a badge.
 */
export function firstInLine(credentials: readonly OverviewCredential[]): Set<string> {
  return new Set(
    credentials
      .filter((credential) => credential.routing?.next && credential.routing.eligible)
      .map((credential) => `${credential.entry.type}:${credential.entry.file.name}`)
  );
}

export const OVERVIEW_SORT_MODES = ['routing', 'soonest', 'remaining', 'name'] as const;
export type OverviewSortMode = (typeof OVERVIEW_SORT_MODES)[number];

export function sortCredentials(
  credentials: readonly OverviewCredential[],
  mode: OverviewSortMode,
  nowMs: number
): OverviewCredential[] {
  const sorted = [...credentials];
  if (mode === 'routing') return sorted.sort(compareRoutingOrder);
  if (mode === 'name') {
    return sorted.sort((a, b) => a.entry.file.name.localeCompare(b.entry.file.name));
  }
  if (mode === 'remaining') {
    return sorted.sort(
      (a, b) =>
        (b.primary?.remaining ?? -1) - (a.primary?.remaining ?? -1) || compareRoutingOrder(a, b)
    );
  }
  const key = (credential: OverviewCredential) =>
    nextRecoveryMs(credential.entry.type, credential.quota, nowMs) ?? Number.POSITIVE_INFINITY;
  return sorted.sort((a, b) => key(a) - key(b) || compareRoutingOrder(a, b));
}

/**
 * Per provider, the credentials whose weekly limit is known, with recorded
 * history attached, ready for the pool chart.
 */
export function buildProviderPools(
  credentials: readonly OverviewCredential[],
  providerOrder: readonly QuotaProviderType[],
  history: QuotaHistory
): OverviewProviderPool[] {
  return providerOrder
    .map((provider) => {
      const own = credentials
        .filter((credential) => credential.entry.type === provider)
        .sort(compareRoutingOrder);
      if (own.length === 0) return null;
      const toAccounts = (windowId?: string) =>
        own.flatMap((credential): PoolAccount[] => {
          const primary = windowId
            ? credential.windows.find((window) => window.id === windowId)
            : credential.primary;
          if (!primary || primary.remaining === null) return [];
          const key = historyKey(provider, getQuotaCacheKey(credential.entry.file), windowId);
          return [
            {
              key,
              name: credential.entry.file.name,
              label: credentialLabel(credential.entry.file),
              priority: credential.priority,
              enabled: !credential.entry.file.disabled,
              remaining: primary.remaining,
              resetAtMs: primary.resetAtMs,
              periodMs: primary.periodHours === null ? null : primary.periodHours * HOUR_MS,
              blockedUntilMs: maxOrNull(credential.backAtMs, credential.cooldownUntilMs),
              samples: history[key] ?? [],
            },
          ];
        });
      return {
        provider,
        credentialCount: own.length,
        accounts: toAccounts(),
        fableAccounts: provider === 'claude' ? toAccounts(FABLE_WINDOW_ID) : [],
      };
    })
    .filter((pool): pool is OverviewProviderPool => pool !== null);
}

/** History series key: one per provider credential identity. */
export const historyKey = (provider: QuotaProviderType, cacheKey: string, windowId?: string) =>
  windowId ? JSON.stringify([provider, cacheKey, windowId]) : `${provider}:${cacheKey}`;

const maxOrNull = (a: number | null, b: number | null) =>
  a === null ? b : b === null ? a : Math.max(a, b);

const EMAIL_PATTERN = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;

/** Mask the local part of every email address: `pdavis@x.com` becomes `p•••@x.com`. */
export const maskEmails = (text: string): string => text.replace(EMAIL_PATTERN, '$1•••@$2');

export const containsEmail = (text: string): boolean => new RegExp(EMAIL_PATTERN).test(text);

/** The account's Note when set (Auth Files › details), otherwise its email or file name. */
export const credentialLabel = (file: AuthFileItem): string =>
  file.note?.trim() || file.email?.trim() || file.name;

export type ResetUrgency = 'day' | 'week' | 'later' | 'none';

/** Reset credits expiring within a day are urgent; within a week, a warning. */
export function resetUrgency(expiresAtMs: number | null, nowMs: number): ResetUrgency {
  if (expiresAtMs === null) return 'none';
  const left = expiresAtMs - nowMs;
  if (left <= 24 * 3_600_000) return 'day';
  if (left <= 7 * 24 * 3_600_000) return 'week';
  return 'later';
}

/** "8 days", "5 hours", "40 minutes": the largest whole unit left, without "in". */
export function formatTimeLeft(targetMs: number, nowMs: number, locale?: string): string {
  const minutes = Math.max(0, Math.round((targetMs - nowMs) / 60000));
  const [value, unit] =
    minutes >= 2880
      ? [Math.floor(minutes / 1440), 'day']
      : minutes >= 120
        ? [Math.floor(minutes / 60), 'hour']
        : [minutes, 'minute'];
  return new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'long' }).format(value);
}

/** "2d 3h", "4h 10m", "12m": compact time until an instant. */
export function formatCountdown(targetMs: number, nowMs: number): string {
  const minutes = Math.max(0, Math.round((targetMs - nowMs) / 60000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

/** "Nov 8": month and day in the reader's locale. */
export const formatShortDate = (ms: number, locale?: string): string =>
  new Date(ms).toLocaleDateString(locale, { month: 'short', day: 'numeric' });
