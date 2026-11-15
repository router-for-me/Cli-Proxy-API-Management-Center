/**
 * What every page does after a confirmed reset attempt, wherever it was made: tell the quota
 * history server to re-read that one account, then let Quota Management pick up the new pool
 * reading. The server owns the limits (once per 20 s per account, single flight, full collections
 * at least 4 minutes apart; server/quota/RULES.md), so this is one best-effort targeted request;
 * the attempt itself has already happened and never waits on it.
 */
import type { PoolProviderId } from '@/domain/quotaPool/types';
import { createQuotaPoolApi } from '@/services/api/quotaPool';
import type { SourceOwner } from '@/services/api/sourceSession';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { poolSourceAccountId } from './resetAccounts';

const poolReloads = new Set<() => void>();
/** A mounted pool resource registers here to reload once an account was re-read. */
export function onPoolAccountRefreshed(reload: () => void): () => void {
  poolReloads.add(reload);
  return () => {
    poolReloads.delete(reload);
  };
}

const flights = new Map<string, Promise<void>>();

/** Re-read one account on the history server, then reload the pool pages that are open. */
export function refreshPoolAccountAfterReset(
  owner: SourceOwner,
  provider: PoolProviderId,
  authIndex: unknown
): Promise<void> {
  const index = normalizeAuthIndex(authIndex);
  if (!index) return Promise.resolve();
  const accountId = poolSourceAccountId(owner.instanceId, provider, index);
  const pending = flights.get(accountId);
  if (pending) return pending;
  const flight = (async () => {
    try {
      await createQuotaPoolApi().refreshAccount(accountId, new AbortController().signal);
    } catch {
      // The reset already happened; the next collection reads the account if this missed.
    }
    poolReloads.forEach((reload) => reload());
  })().finally(() => flights.delete(accountId));
  flights.set(accountId, flight);
  return flight;
}
