import type { PoolDashboard } from '@/domain/quotaPool/types';
import type { createQuotaPoolApi, PoolQuery, PoolRefresh } from '@/services/api/quotaPool';
import { onPoolAccountRefreshed } from './accountSync';

interface PoolSnapshot {
  data: PoolDashboard | null;
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  refreshError: boolean;
  /** HTTP status of the last failed read or refresh; null when the server never answered. */
  errorStatus: number | null;
  refreshErrorStatus: number | null;
  refreshStatus: PoolRefresh | null;
  /** When the next once-a-minute collection fires, for the on-page countdown. */
  nextCollectAtMs: number | null;
}

const EMPTY: PoolSnapshot = {
  data: null,
  loading: true,
  refreshing: false,
  error: false,
  refreshError: false,
  errorStatus: null,
  refreshErrorStatus: null,
  refreshStatus: null,
  nextCollectAtMs: null,
};

const statusOf = (error: unknown) => {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === 'number' ? status : null;
};

/** How a pool resource takes part in the credential inventory's single commit. */
export interface PoolInventoryLink {
  /** Have the inventory read this query in each refresh; returns the detach function. */
  attach(key: string, read: (signal: AbortSignal) => Promise<PoolDashboard>): () => void;
  /** The pool a commit last read for this query, with the revision of that commit. */
  committed(key: string): { data: PoolDashboard; revision: number } | null;
  /** Called on every inventory change; `committed` says whether the pool is new. */
  subscribe(listener: () => void): () => void;
  /** A read carried this inventory version; the inventory looks again if it is not its own. */
  noteVersion(version: string): void;
}

/** Owns transport lifetime only; quota values and refresh policy belong to the server. */
export function createPoolResource(
  api: ReturnType<typeof createQuotaPoolApi>,
  query: PoolQuery,
  isCurrent: () => boolean,
  inventory?: PoolInventoryLink
) {
  const key = JSON.stringify(query);
  let adoptedRevision = -1;
  let detachInventory: (() => void) | undefined;
  let unsubscribeCommits: (() => void) | undefined;
  let stopListeningForAccounts: (() => void) | undefined;
  let snapshot = EMPTY;
  let active = false;
  let generation = 0;
  let read: AbortController | undefined;
  let mutation: AbortController | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let collector: ReturnType<typeof setInterval> | undefined;
  let completionPoll: ReturnType<typeof setTimeout> | undefined;
  const targeted = new Set<AbortController>();
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<PoolSnapshot>) => {
    snapshot = { ...snapshot, ...patch };
    listeners.forEach((listener) => listener());
  };
  const reload = async () => {
    if (!active || !isCurrent()) return;
    clearTimeout(completionPoll);
    read?.abort();
    const controller = new AbortController();
    read = controller;
    const request = ++generation;
    const valid = () =>
      active && isCurrent() && request === generation && !controller.signal.aborted;
    publish({ loading: true });
    try {
      const data = await api.get(query, controller.signal);
      if (valid()) {
        publish({ data, error: false, errorStatus: null, loading: false, refreshStatus: null });
        if (data.inventoryVersion) inventory?.noteVersion(data.inventoryVersion);
        // Collection is asynchronous. Observe its completion promptly instead of leaving
        // a finished job looking busy until the ordinary 15-second dashboard poll.
        // These reads never request another collection and never overlap a pending read.
        if (data.refreshing) completionPoll = setTimeout(() => void reload(), 1_000);
      }
    } catch (error) {
      if (valid()) publish({ error: true, errorStatus: statusOf(error), loading: false });
    }
  };
  // The inventory commits this pool together with the credential files. A read still in flight
  // was requested before that commit and could resurrect an account it removed, so it is dropped.
  const adopt = () => {
    const committed = inventory?.committed(key);
    if (!active || !isCurrent() || !committed || committed.revision === adoptedRevision) return;
    adoptedRevision = committed.revision;
    generation += 1;
    read?.abort();
    clearTimeout(completionPoll);
    publish({
      data: committed.data,
      error: false,
      errorStatus: null,
      loading: false,
      refreshStatus: null,
    });
    if (committed.data.refreshing) completionPoll = setTimeout(() => void reload(), 1_000);
  };
  const refresh = async (accountId?: string) => {
    if (accountId) {
      if (!active || !isCurrent()) return false;
      const controller = new AbortController();
      targeted.add(controller);
      try {
        const result = await api.refreshAccount(accountId, controller.signal).catch(() => null);
        if (!result?.refreshed && active && isCurrent() && !controller.signal.aborted) {
          await api.refresh(controller.signal).catch(() => {});
        }
      } finally {
        targeted.delete(controller);
      }
      await reload();
      return !snapshot.error;
    }
    if (!active || !isCurrent()) return false;
    if (mutation) return true;
    const controller = new AbortController();
    mutation = controller;
    publish({ refreshing: true, refreshError: false, refreshErrorStatus: null });
    try {
      const refreshStatus = await api.refresh(controller.signal);
      if (!active || !isCurrent() || controller.signal.aborted) return false;
      publish({ refreshStatus });
      await reload();
      return !snapshot.error;
    } catch (error) {
      if (active && isCurrent() && !controller.signal.aborted) {
        publish({ refreshError: true, refreshErrorStatus: statusOf(error) });
      }
      return false;
    } finally {
      if (mutation === controller) mutation = undefined;
      if (active && isCurrent() && !controller.signal.aborted) publish({ refreshing: false });
    }
  };
  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => EMPTY,
    reload,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!active) {
        active = true;
        if (inventory) {
          detachInventory = inventory.attach(key, (signal) => api.get(query, signal));
          unsubscribeCommits = inventory.subscribe(adopt);
        }
        // A reset made on any page re-reads its account on the server; show that reading here.
        stopListeningForAccounts = onPoolAccountRefreshed(() => void reload());
        void reload();
        timer = setInterval(() => {
          // A slow backend must get a chance to finish before the next poll.
          if (!snapshot.loading) void reload();
        }, 15_000);
        // While graphs are on screen, ask the server to collect fresh usage every minute
        // (the server's own schedule is 5 minutes and it allows one collection per 4 minutes).
        publish({ nextCollectAtMs: Date.now() + 60_000 });
        collector = setInterval(() => {
          publish({ nextCollectAtMs: Date.now() + 60_000 });
          const visible = typeof document === 'undefined' || document.visibilityState !== 'hidden';
          if (visible && snapshot.data?.pools.length) void refresh();
        }, 60_000);
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        active = false;
        generation += 1;
        detachInventory?.();
        unsubscribeCommits?.();
        stopListeningForAccounts?.();
        detachInventory = undefined;
        unsubscribeCommits = undefined;
        stopListeningForAccounts = undefined;
        adoptedRevision = -1;
        read?.abort();
        mutation?.abort();
        targeted.forEach((controller) => controller.abort());
        targeted.clear();
        mutation = undefined;
        clearInterval(timer);
        clearInterval(collector);
        clearTimeout(completionPoll);
        // Discard revealed data on privacy/filter/session changes and unmount.
        snapshot = EMPTY;
      };
    },
  };
}
