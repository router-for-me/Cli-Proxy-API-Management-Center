/**
 * What every page does after a confirmed reset attempt, wherever it was made: tell the quota
 * history server to re-read that one account now, then once more a little later in case the
 * provider lags, and let Quota Management reload its pool after each. The server owns the
 * limits (once per 20 s per account, single flight, full collections at least 4 minutes apart;
 * server/quota/RULES.md) and everything derived from a reading, so this is two best-effort
 * targeted requests; the attempt itself has already happened and never waits on them.
 */
import type { PoolProviderId } from '@/domain/quotaPool/types';
import type { createQuotaPoolApi } from '@/services/api/quotaPool';
import type { SourceOwner } from '@/services/api/sourceSession';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { poolSourceAccountId } from './resetAccounts';

/** The server allows one targeted read per account every 20 s; the follow-up waits just past it. */
export const FOLLOW_UP_DELAY_MS = 20_500;

const poolReloads = new Set<() => void>();
/** A mounted pool resource registers here to reload once an account was re-read. */
export function onPoolAccountRefreshed(reload: () => void): () => void {
  poolReloads.add(reload);
  return () => {
    poolReloads.delete(reload);
  };
}

type PoolApi = ReturnType<typeof createQuotaPoolApi>;
const flights = new Map<string, Promise<boolean>>();
const followUps = new Map<string, ReturnType<typeof setTimeout>>();

/** One targeted read per account at a time (a caller during one joins it); true when it ran. */
function readOnServer(api: PoolApi, accountId: string): Promise<boolean> {
  const pending = flights.get(accountId);
  if (pending) return pending;
  const flight = (async () => {
    let read = false;
    try {
      read = (await api.refreshAccount(accountId, new AbortController().signal)).refreshed;
    } catch {
      // The reset already happened; the next collection reads the account if this missed.
    }
    poolReloads.forEach((reload) => reload());
    return read;
  })().finally(() => flights.delete(accountId));
  flights.set(accountId, flight);
  return flight;
}

/**
 * Re-read one account on the history server now and, if that read ran, once more after
 * FOLLOW_UP_DELAY_MS, then reload the pool pages that are open. Capture `api` before the reset is
 * sent: the reply can arrive after the user switched connection, and the refresh must still go to
 * the history server that reset belongs to.
 */
export async function refreshPoolAccountAfterReset(
  owner: SourceOwner,
  provider: PoolProviderId,
  authIndex: unknown,
  api: PoolApi
): Promise<void> {
  const index = normalizeAuthIndex(authIndex);
  if (!index) return;
  const accountId = poolSourceAccountId(owner.instanceId, provider, index);
  if (!(await readOnServer(api, accountId))) return;
  // One follow-up per account: a newer attempt moves it later, never adds a second.
  clearTimeout(followUps.get(accountId));
  followUps.set(
    accountId,
    setTimeout(() => {
      followUps.delete(accountId);
      void readOnServer(api, accountId);
    }, FOLLOW_UP_DELAY_MS)
  );
}
