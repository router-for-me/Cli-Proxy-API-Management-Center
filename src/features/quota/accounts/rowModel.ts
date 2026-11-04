/**
 * Account grid rows: one line per credential with a cell per quota window.
 *
 * React-free. Provider states disagree about where a window lives and what its
 * percentage means, so each is read on its own terms and normalized to
 * "percent remaining" here; everything else stays in the provider bodies shown
 * in a row's details.
 */

import type { TFunction } from 'i18next';
import type { QuotaHistoryAccount, QuotaHistoryRouting } from '@/services/api/quotaHistory';
import type { AuthFileItem } from '@/types/authFile';
import { HOUR_MS } from '@/utils/time/durations';
import { parseTimestampMs } from '@/utils/timestamp';
import type { QuotaProviderType } from '../providers/types';

export type AccountWindowCell = {
  /** Column identity, shared by every account of a provider. */
  id: string;
  label: string;
  /** Percent remaining, 0..100. */
  remaining: number | null;
  resetAtMs: number | null;
};

export type AccountColumn = { id: string; label: string };

/** Routing strategy that spends weekly quota in the order it would expire (backend fork). */
export const WEEKLY_RESET_STRATEGY = 'weekly-reset-weighted-round-robin';
/** Column id of the 5-hour session window, for Claude and Codex alike. */
export const SESSION_WINDOW_ID = 'five-hour';
const MAX_WINDOW_COLUMNS = 4;

const clamp = (value: number) => Math.min(100, Math.max(0, value));
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

type UsedWindow = {
  id?: string;
  label?: string;
  usedPercent?: number | null;
  resetAtMs?: number | null;
};

/** Cells from a loaded quota state; empty when nothing is summarizable. */
export function liveWindowCells(
  type: QuotaProviderType,
  quota: unknown,
  t: TFunction
): AccountWindowCell[] {
  const state = quota as { status?: string } | undefined;
  if (!state || state.status !== 'success') return [];

  if (type === 'claude' || type === 'codex') {
    return ((quota as { windows?: UsedWindow[] }).windows ?? []).map((window, index) => ({
      id: window.id || `window-${index}`,
      label: window.label ?? '',
      remaining: finite(window.usedPercent) ? clamp(100 - window.usedPercent) : null,
      resetAtMs: finite(window.resetAtMs) ? window.resetAtMs : null,
    }));
  }

  if (type === 'devin') {
    const windows =
      (
        quota as {
          windows?: {
            id: string;
            label?: string;
            remainingPercent: number | null;
            resetAtMs: number | null;
          }[];
        }
      ).windows ?? [];
    return windows.map((window) => ({
      id: window.id,
      label: window.label || t(`devin_quota.${window.id}`),
      remaining: finite(window.remainingPercent) ? clamp(window.remainingPercent) : null,
      resetAtMs: finite(window.resetAtMs) ? window.resetAtMs : null,
    }));
  }

  if (type === 'kimi') {
    const rows =
      (
        quota as {
          rows?: {
            id: string;
            label?: string;
            labelKey?: string;
            labelParams?: Record<string, string | number>;
            used: number;
            limit: number;
            resetAtMs?: number | null;
          }[];
        }
      ).rows ?? [];
    return rows.map((row) => ({
      id: row.id,
      label: row.label || (row.labelKey ? t(row.labelKey, row.labelParams) : row.id),
      remaining: row.limit > 0 ? clamp((1 - row.used / row.limit) * 100) : null,
      resetAtMs: finite(row.resetAtMs) ? row.resetAtMs : null,
    }));
  }

  if (type === 'meta') {
    const windows =
      (
        quota as {
          data?: {
            windows?: { id: 'window' | 'weekly'; usedPercent: number | null; resetAt?: number }[];
          };
        }
      ).data?.windows ?? [];
    return windows.map((window) => ({
      id: window.id,
      label: t(`meta_quota.${window.id}`),
      remaining: finite(window.usedPercent) ? clamp(100 - window.usedPercent) : null,
      resetAtMs: finite(window.resetAt) ? window.resetAt * 1000 : null,
    }));
  }

  if (type === 'antigravity' || type === 'plugin') {
    const groups =
      (
        quota as {
          groups?: {
            id: string;
            label: string;
            buckets: {
              id: string;
              label: string;
              remainingFraction: number;
              resetAtMs?: number | null;
            }[];
          }[];
        }
      ).groups ?? [];
    return groups.flatMap((group) =>
      group.buckets.map((bucket) => ({
        id: `${group.id}:${bucket.id}`,
        label: bucket.label || group.label,
        remaining: finite(bucket.remainingFraction) ? clamp(bucket.remainingFraction * 100) : null,
        resetAtMs: finite(bucket.resetAtMs) ? bucket.resetAtMs : null,
      }))
    );
  }

  return [];
}

/** Backend window ids → the ids and labels the live Claude/Codex states use. */
const HISTORY_WINDOWS: Record<string, Record<string, { id: string; labelKey: string }>> = {
  claude: {
    five_hour: { id: 'five-hour', labelKey: 'claude_quota.five_hour' },
    seven_day: { id: 'seven-day', labelKey: 'claude_quota.seven_day' },
    seven_day_fable: { id: 'seven-day-fable', labelKey: 'claude_quota.seven_day_fable' },
    seven_day_opus: { id: 'seven-day-opus', labelKey: 'claude_quota.seven_day_opus' },
    seven_day_sonnet: { id: 'seven-day-sonnet', labelKey: 'claude_quota.seven_day_sonnet' },
    seven_day_oauth_apps: {
      id: 'seven-day-oauth-apps',
      labelKey: 'claude_quota.seven_day_oauth_apps',
    },
    seven_day_cowork: { id: 'seven-day-cowork', labelKey: 'claude_quota.seven_day_cowork' },
  },
  codex: {
    five_hour: { id: 'five-hour', labelKey: 'codex_quota.primary_window' },
    seven_day: { id: 'weekly', labelKey: 'codex_quota.secondary_window' },
    monthly: { id: 'monthly', labelKey: 'codex_quota.team_secondary_window' },
  },
};

/**
 * Cells from the latest recorded sample of each window, so rows show quota
 * without a live read. A reset that has passed since the sample reads as full.
 * Windows the credential no longer reports are left out, so they read "not on
 * this plan" as after a live read.
 */
export function historyWindowCells(
  account: QuotaHistoryAccount | undefined,
  nowMs: number,
  t: TFunction
): { cells: AccountWindowCell[]; observedAtMs: number | null } {
  const mapping = account ? HISTORY_WINDOWS[account.provider] : undefined;
  if (!account || !mapping) return { cells: [], observedAtMs: null };
  let observedAtMs: number | null = null;
  const cells: AccountWindowCell[] = [];
  Object.entries(mapping).forEach(([historyId, column]) => {
    const window = account.windows.find((candidate) => candidate.id === historyId);
    const latest = window?.points[window.points.length - 1];
    if (!window || !latest || window.droppedAt !== null) return;
    observedAtMs = Math.max(observedAtMs ?? 0, latest.t);
    const resetPassed = latest.resetAt !== null && latest.resetAt <= nowMs;
    const periodMs = window.periodSeconds ? window.periodSeconds * 1000 : null;
    let resetAtMs = latest.resetAt;
    if (resetPassed && resetAtMs !== null && periodMs) {
      resetAtMs += Math.ceil((nowMs - resetAtMs + 1) / periodMs) * periodMs;
    }
    cells.push({
      id: column.id,
      label: t(column.labelKey),
      remaining: resetPassed ? 100 : clamp(100 - latest.used),
      resetAtMs: resetPassed && !periodMs ? null : resetAtMs,
    });
  });
  return { cells, observedAtMs };
}

/** Shared columns for a provider section, in first-seen order. */
export function sectionColumns(rows: AccountWindowCell[][]): AccountColumn[] {
  const columns: AccountColumn[] = [];
  rows.forEach((cells) =>
    cells.forEach((cell) => {
      if (!columns.some((column) => column.id === cell.id)) {
        columns.push({ id: cell.id, label: cell.label });
      }
    })
  );
  return columns.slice(0, MAX_WINDOW_COLUMNS);
}

/** The window the reset-aware routing watches. */
const WEEKLY_WINDOW_ID: Partial<Record<QuotaProviderType, string>> = {
  claude: 'seven-day',
  codex: 'weekly',
};

export const weeklyResetMs = (
  type: QuotaProviderType,
  cells: AccountWindowCell[]
): number | null => {
  const id = WEEKLY_WINDOW_ID[type];
  return cells.find((cell) => cell.id === id)?.resetAtMs ?? null;
};

/** Whether the router can pick a credential right now, and until when it can't. */
export type CredentialStatus = 'serving' | 'cooling' | 'unavailable' | 'disabled' | 'error';

export const credentialStatus = (
  file: AuthFileItem,
  nowMs: number
): { status: CredentialStatus; until: number | null } => {
  if (file.disabled) return { status: 'disabled', until: null };
  const snapshot = file.cooldownSnapshot;
  const active = (snapshot?.records ?? [])
    .map((record) => ({
      scope: record.scope,
      until: snapshot!.receivedAtMs + record.remainingSeconds * 1000,
    }))
    .filter((record) => record.until > nowMs);
  const credential = active.filter((record) => record.scope === 'credential');
  if (credential.length > 0) {
    return { status: 'cooling', until: Math.max(...credential.map((record) => record.until)) };
  }
  if (file.unavailable) {
    // Model cooldowns (a 429 on its models) are what keep it out: back when the first ends.
    if (active.length > 0) {
      return { status: 'cooling', until: Math.min(...active.map((record) => record.until)) };
    }
    // The router picks a flagged credential again once its retry time has passed; the
    // flag itself only clears on the next success.
    const retry = parseTimestampMs(file['next_retry_after']);
    if (Number.isFinite(retry)) {
      return retry > nowMs
        ? { status: 'unavailable', until: retry }
        : { status: 'serving', until: null };
    }
    return { status: 'unavailable', until: null };
  }
  if (String(file.status ?? '').toLowerCase() === 'error') return { status: 'error', until: null };
  return { status: 'serving', until: null };
};

/**
 * Credentials whose deadlines lie within this of the earliest one count as tied, and
 * then the session-limited ones go first (backend `WeeklyResetTieBand`).
 */
export const PRIORITY_TIE_BAND_HOURS = 1;

/**
 * Whether the weekly-reset router can rank a credential: it must be pickable now (one
 * cooling down, unavailable or disabled never counts) and have a known deadline.
 */
export const isPriorityEligible = (deadlineMs: number | null, status: CredentialStatus): boolean =>
  status === 'serving' && deadlineMs !== null;

/**
 * The candidates the weekly-reset router sends traffic to, as the backend ranks them:
 * the earliest effective deadline, where within `PRIORITY_TIE_BAND_HOURS` of it the
 * session-limited ones go first. Exact ties all count.
 */
export function firstInLine<T>(
  candidates: T[],
  deadlineOf: (candidate: T) => number,
  sessionLimitedOf: (candidate: T) => boolean
): T[] {
  if (candidates.length === 0) return [];
  const earliest = Math.min(...candidates.map(deadlineOf));
  let band = candidates.filter(
    (candidate) => deadlineOf(candidate) <= earliest + PRIORITY_TIE_BAND_HOURS * HOUR_MS
  );
  const limited = band.filter(sessionLimitedOf);
  if (limited.length > 0) band = limited;
  const first = Math.min(...band.map(deadlineOf));
  return band.filter((candidate) => deadlineOf(candidate) === first);
}

export type PriorityCandidate = {
  key: string;
  /**
   * Effective deadline from the backend's routing report (epoch ms), or the weekly
   * reset on backends without it.
   */
  deadlineMs: number | null;
  status: CredentialStatus;
  /** The credential has a 5-hour session limit. */
  sessionLimited: boolean;
};

/**
 * Keys of the credentials the weekly-reset router sends new requests to now, among
 * one provider's credentials.
 */
export const priorityKeys = (candidates: PriorityCandidate[]): Set<string> =>
  new Set(
    firstInLine(
      candidates.filter((candidate) => isPriorityEligible(candidate.deadlineMs, candidate.status)),
      (candidate) => candidate.deadlineMs as number,
      (candidate) => candidate.sessionLimited
    ).map((candidate) => candidate.key)
  );

/**
 * A credential's routing placement: the backend's report when present, otherwise its
 * weekly reset (if still ahead) and whether it shows a 5-hour window.
 */
export const routingPlacement = (
  routing: QuotaHistoryRouting | null | undefined,
  weeklyResetAtMs: number | null,
  hasSessionWindow: boolean,
  nowMs: number
): { deadlineMs: number | null; sessionLimited: boolean } =>
  routing
    ? { deadlineMs: routing.deadline, sessionLimited: routing.sessionLimited }
    : {
        deadlineMs: weeklyResetAtMs !== null && weeklyResetAtMs > nowMs ? weeklyResetAtMs : null,
        sessionLimited: hasSessionWindow,
      };

/** Severity of a remaining percentage, for the number's color. */
export const remainingTone = (remaining: number | null): 'normal' | 'low' | 'critical' => {
  if (remaining === null || remaining >= 60) return 'normal';
  return remaining >= 20 ? 'low' : 'critical';
};
