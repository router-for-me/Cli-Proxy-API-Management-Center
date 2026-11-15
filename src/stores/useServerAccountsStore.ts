/**
 * Client copy of prox-history's account read model (`GET /prox/accounts`) and of the routing rule
 * that decides which accounts are served from it.
 *
 * An account is served from the server only when `/prox/inventory` answered with this session's
 * key, its source instance is in that inventory, and its provider is claude or codex. Everything
 * else (the other providers, an instance the server does not list, prox-history absent or
 * rejecting the key) stays hub-direct through the existing adapters.
 *
 * One poller for the app: every consumer holds it with `acquire()`; it reads about every 30 s
 * while the page is visible and again on focus, with `If-None-Match`, so an unchanged read is a
 * 304. A connection change (sign-out, sign-in, another server) starts over.
 */
import { create } from 'zustand';
import type { AccountRefreshResult, ServerAccount } from '@/domain/quotaPool/accounts';
import { createQuotaAccountsApi, type InventorySourceEntry } from '@/services/api/quotaAccounts';
import { useAuthStore } from './useAuthStore';

export const SERVER_ACCOUNTS_POLL_MS = 30_000;

export type ServerRouting =
  | { status: 'unknown' }
  | { status: 'unavailable' }
  | { status: 'ready'; sources: ReadonlySet<string> };

const sourceKey = (instanceId: string, provider: string) => `${instanceId}\0${provider}`;

/** The one routing rule: inventory succeeded, the source is in it, the provider is claude/codex. */
export function servedByServer(
  routing: ServerRouting,
  instanceId: string | undefined,
  provider: string
): boolean {
  return (
    routing.status === 'ready' &&
    instanceId !== undefined &&
    (provider === 'claude' || provider === 'codex') &&
    routing.sources.has(sourceKey(instanceId, provider))
  );
}

export interface ServerAccountsRuntime {
  /** A fresh API per call: it captures the connection that is current when the poll starts. */
  api: () => ReturnType<typeof createQuotaAccountsApi>;
  now: () => number;
  /** False until the app is signed in and connected: nothing is asked before that. */
  connected: () => boolean;
  visible: () => boolean;
  onVisibilityChange: (listener: () => void) => () => void;
  onFocus: (listener: () => void) => () => void;
  every: (ms: number, run: () => void) => () => void;
  sleep: (ms: number) => Promise<void>;
}

export interface ServerAccountsState {
  routing: ServerRouting;
  /** By `sourceAccountId`, the identity a browser builds from a source and an auth index. */
  accounts: Readonly<Record<string, ServerAccount>>;
  version: string | null;
  lastRefreshAtMs: number | null;
  nextRefreshAtMs: number | null;
  /** When the accounts were last confirmed current (a changed read or a 304). */
  readAtMs: number | null;
  poll(): Promise<void>;
  /**
   * A read that starts after now: waits for a poll already in flight (it may have read before the
   * change the caller is waiting for) and then reads again.
   */
  pollFresh(): Promise<void>;
  /** Hold the poller; returns the release. The first holder starts it, the last stops it. */
  acquire(): () => void;
  /** One targeted read of an account; null when the request itself failed. */
  refreshAccount(sourceAccountId: string): Promise<AccountRefreshResult | null>;
  /**
   * The page-wide refresh: asks for a collection and reads the accounts until it is done.
   * `started` is false when the server's 4 minute floor skipped it; null when the request failed.
   */
  refreshAll(): Promise<{ started: boolean; nextRefreshAtMs: number | null } | null>;
  refreshing: boolean;
  /** Forget everything: the connection changed. */
  reset(): void;
}

const INITIAL = {
  routing: { status: 'unknown' } as ServerRouting,
  accounts: {} as Readonly<Record<string, ServerAccount>>,
  version: null,
  lastRefreshAtMs: null,
  nextRefreshAtMs: null,
  readAtMs: null,
  refreshing: false,
};

export function createServerAccountsStore(runtime: ServerAccountsRuntime) {
  let epoch = 0;
  let running: Promise<void> | null = null;
  let holders = 0;
  // The accounts read itself failed before any reading arrived: stay hub-direct for this connection.
  let accountsUnreadable = false;

  return create<ServerAccountsState>()((set, get) => ({
    ...INITIAL,

    poll: () => {
      if (running) return running;
      if (!runtime.connected()) return Promise.resolve();
      const mine = epoch;
      const stale = () => mine !== epoch;
      const run = (async () => {
        const api = runtime.api();
        if (get().routing.status !== 'ready') {
          if (accountsUnreadable) return;
          let sources: InventorySourceEntry[];
          try {
            sources = await api.inventory();
          } catch {
            if (!stale()) set({ ...INITIAL, routing: { status: 'unavailable' } });
            return;
          }
          if (stale()) return;
          set({
            routing: {
              status: 'ready',
              sources: new Set(sources.map((s) => sourceKey(s.instanceId, s.provider))),
            },
          });
        }
        try {
          const read = await api.read(get().version);
          if (stale()) return;
          if (read.status === 'changed') {
            const { accounts } = read;
            set({
              accounts: Object.fromEntries(
                accounts.accounts.flatMap((account) =>
                  account.sourceAccountId ? [[account.sourceAccountId, account]] : []
                )
              ),
              version: accounts.version,
              lastRefreshAtMs: accounts.lastRefreshAtMs,
              nextRefreshAtMs: accounts.nextRefreshAtMs,
              refreshing: accounts.refreshing,
              readAtMs: runtime.now(),
            });
          } else {
            set({ readAtMs: runtime.now() });
          }
        } catch {
          if (stale()) return;
          // Without a first reading nothing can be served; later failures keep the last readings.
          if (get().version === null) {
            accountsUnreadable = true;
            set({ routing: { status: 'unavailable' } });
          }
        }
      })().finally(() => {
        if (running === run) running = null;
      });
      running = run;
      return run;
    },

    pollFresh: async () => {
      await running?.catch(() => {});
      await get().poll();
    },

    acquire: () => {
      holders += 1;
      let stopTimer: (() => void) | null = null;
      let unwatch: (() => void) | null = null;
      let unfocus: (() => void) | null = null;
      const start = () => {
        stopTimer ??= runtime.every(SERVER_ACCOUNTS_POLL_MS, () => void get().poll());
      };
      const stop = () => {
        stopTimer?.();
        stopTimer = null;
      };
      void get().poll();
      unwatch = runtime.onVisibilityChange(() => {
        if (runtime.visible()) {
          void get().poll(); // catch up on whatever changed while hidden
          start();
        } else {
          stop();
        }
      });
      unfocus = runtime.onFocus(() => void get().poll());
      if (runtime.visible()) start();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        holders -= 1;
        stop();
        unwatch?.();
        unfocus?.();
      };
    },

    refreshAccount: async (sourceAccountId) => {
      const mine = epoch;
      const result: AccountRefreshResult | null = await runtime
        .api()
        .refreshAccount(sourceAccountId)
        .catch(() => null);
      if (mine !== epoch) return null;
      await get().pollFresh();
      return result;
    },

    refreshAll: async () => {
      const mine = epoch;
      let status: Awaited<ReturnType<ReturnType<ServerAccountsRuntime['api']>['refreshAll']>>;
      try {
        status = await runtime.api().refreshAll();
      } catch {
        return null;
      }
      if (mine !== epoch) return null;
      await get().pollFresh();
      // The collection runs on after the answer: read until it is done (bounded).
      for (let waited = 0; waited < 30 && mine === epoch && get().refreshing; waited += 1) {
        await runtime.sleep(1000);
        await get().poll();
      }
      return { started: status.refreshing, nextRefreshAtMs: status.nextRefreshAtMs };
    },

    reset: () => {
      epoch += 1;
      running = null;
      accountsUnreadable = false;
      set({ ...INITIAL });
      if (holders > 0) void get().poll();
    },
  }));
}

function browserRuntime(): ServerAccountsRuntime {
  const hasDocument = typeof document !== 'undefined';
  return {
    api: createQuotaAccountsApi,
    now: Date.now,
    connected: () => {
      const auth = useAuthStore.getState();
      return auth.isAuthenticated && auth.connectionStatus === 'connected';
    },
    visible: () => !hasDocument || document.visibilityState !== 'hidden',
    onVisibilityChange: (listener) => {
      if (!hasDocument) return () => {};
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    onFocus: (listener) => {
      if (typeof window === 'undefined') return () => {};
      window.addEventListener('focus', listener);
      return () => window.removeEventListener('focus', listener);
    },
    every: (ms, run) => {
      const id = setInterval(run, ms);
      return () => clearInterval(id);
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

export const useServerAccountsStore = createServerAccountsStore(browserRuntime());

// A different connection is a different history server and key: nothing carries over.
useAuthStore.subscribe((current, previous) => {
  if (
    current.apiBase !== previous.apiBase ||
    current.managementKey !== previous.managementKey ||
    current.isAuthenticated !== previous.isAuthenticated ||
    current.connectionStatus !== previous.connectionStatus
  ) {
    useServerAccountsStore.getState().reset();
  }
});
