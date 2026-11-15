import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import type {
  AccountResetBlocker,
  AccountResetKind,
  AccountResets,
  PoolProviderId,
} from '@/domain/quotaPool/types';
import { providerOfCredential } from '@/features/authFiles/credentialFacts';
import type { AuthFileItem } from '@/types';
import { normalizeAuthIndex } from '@/utils/authIndex';

/**
 * The server's source-qualified account identity (server/quota/identity.ts: sourceAccountId of
 * legacyAccountId), which the browser can build from a source and a credential's auth index.
 */
export function poolSourceAccountId(
  instanceId: string,
  provider: PoolProviderId,
  authIndex: string
): string {
  const digest = bytesToHex(sha256(new TextEncoder().encode(`${provider}\0${authIndex}`)));
  return `${instanceId}:${provider}:${digest}`;
}

/** Match opaque pool identities only inside the authenticated source's inventory. */
export function findPoolResetFile(
  files: readonly AuthFileItem[],
  instanceId: string,
  provider: PoolProviderId,
  /** The server's source-qualified identity, never the pool row id (which may be legacy). */
  sourceAccountId: string | null
): AuthFileItem | undefined {
  if (!sourceAccountId) return undefined;
  const matches = files.filter((file) => {
    const authIndex = normalizeAuthIndex(file.auth_index ?? file.authIndex);
    if (
      !authIndex ||
      providerOfCredential(file) !== provider ||
      (file.provider !== undefined && file.type !== undefined && file.provider !== file.type)
    )
      return false;
    return sourceAccountId === poolSourceAccountId(instanceId, provider, authIndex);
  });
  // An ambiguous inventory must never choose a credential arbitrarily.
  return matches.length === 1 ? matches[0] : undefined;
}

export function poolResetReasonKey(blocker: AccountResetBlocker | null): string {
  if (blocker?.startsWith('ineligible:')) return 'quota_pool.reset_ineligible';
  return `quota_pool.reset_${blocker ?? 'unavailable'}`;
}

// This tab's attempts stay separate from the server's last collection.
const spentAt = new Map<string, number>();
export const markSpent = (accountId: string) => spentAt.set(accountId, Date.now());
export const wasSpent = (accountId: string, observedAtMs: number) =>
  (spentAt.get(accountId) ?? 0) > observedAtMs;

export function poolResetStatus(
  resets: AccountResets | null,
  provider: PoolProviderId,
  spent: boolean
) {
  if (!resets) return null;
  if (spent)
    return {
      valueKey: 'quota_pool.reset_requested',
      statusKey: 'quota_pool.reset_spent',
      early: false,
    };
  if (resets.available === 0)
    return { valueKey: 'quota_pool.reset_none', statusKey: null, early: false };
  const early = provider === 'codex' && resets.usable === 0 && resets.blocker === 'not_applicable';
  return {
    valueKey: 'quota_pool.reset_held',
    statusKey:
      resets.usable > 0
        ? resets.usable === resets.available
          ? 'quota_pool.reset_usable'
          : 'quota_pool.reset_usable_count'
        : early
          ? 'quota_pool.reset_early_status'
          : poolResetReasonKey(resets.blocker),
    early,
  };
}

/** Held resets with a known expiry that hasn't passed, soonest first, at most one per held reset. */
export function heldExpiries(resets: AccountResets, now: number): number[] {
  return heldResets(resets, now).map((reset) => reset.at);
}

/** As heldExpiries, with each reset's kind when the reading lists one per expiry. */
export function heldResets(
  resets: AccountResets,
  now: number
): { at: number; kind?: AccountResetKind }[] {
  const all = resets.expiries ?? (resets.nextExpiryAtMs === null ? [] : [resets.nextExpiryAtMs]);
  const kinds = resets.kinds?.length === all.length ? resets.kinds : undefined;
  return all
    .map((at, index) => (kinds ? { at, kind: kinds[index] } : { at }))
    .filter((reset) => reset.at > now)
    .slice(0, resets.available);
}

// Standard kinds first; Fable last, since it refills only what Fable models used.
const KIND_ORDER: readonly AccountResetKind[] = ['session', 'weekly', 'full', 'fable'];
export type ResetKindCount = { kind: AccountResetKind; count: number };

/** Held resets per kind, or null unless every held reset is dated and names its kind. */
export function heldResetKinds(resets: AccountResets, now: number): ResetKindCount[] | null {
  const held = heldResets(resets, now);
  if (!held.length || held.length !== resets.available || held.some((reset) => !reset.kind))
    return null;
  return countKinds(held.map((reset) => ({ kind: reset.kind!, count: 1 })));
}

/** Adds per-kind counts, in kind order; null when any part is unknown. */
export function sumResetKinds(
  parts: readonly (ResetKindCount[] | null)[]
): ResetKindCount[] | null {
  if (!parts.length || parts.some((part) => !part)) return null;
  return countKinds(parts.flatMap((part) => part!));
}

function countKinds(counts: readonly ResetKindCount[]): ResetKindCount[] {
  return KIND_ORDER.map((kind) => ({
    kind,
    count: counts.reduce((sum, entry) => (entry.kind === kind ? sum + entry.count : sum), 0),
  })).filter((entry) => entry.count > 0);
}

/**
 * Resets that end together and share a kind, as one entry with a count, in the order each first
 * appears. Readings sort only by expiry, so equal ends of different kinds may interleave.
 */
export function groupHeldResets<T extends { at: number; kind?: AccountResetKind }>(
  resets: readonly T[]
): (T & { count: number; first: number })[] {
  const groups = new Map<string, T & { count: number; first: number }>();
  resets.forEach((reset, index) => {
    const key = `${reset.at}\0${reset.kind ?? ''}`;
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { ...reset, count: 1, first: index });
  });
  return [...groups.values()];
}
