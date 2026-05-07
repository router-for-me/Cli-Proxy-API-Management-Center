// Lightweight pub-sub for "refresh all balances" on the OpenAI Compatibility
// section. Each OpenAICompatBalancePanel registers its `refresh` callback on
// mount; the section header's "refresh all" button calls `refreshAll()` to
// trigger every registered callback in parallel.
//
// Why a bus instead of lifting state to the section: the panels already own
// their per-(provider, entry) request state, which keeps the data model
// simple. Centralizing it would mean the section needs a dynamic Map keyed
// by (provider, entry, index) and would have to forward every result back
// down — strictly more bookkeeping for no benefit.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';

type RefreshFn = () => Promise<void>;

interface OpenAICompatRefreshBus {
  register: (id: string, fn: RefreshFn) => () => void;
  refreshAll: () => Promise<void>;
}

const Context = createContext<OpenAICompatRefreshBus | null>(null);

export function OpenAICompatRefreshProvider({ children }: { children: ReactNode }) {
  const callbacksRef = useRef<Map<string, RefreshFn>>(new Map());

  const register = useCallback((id: string, fn: RefreshFn) => {
    callbacksRef.current.set(id, fn);
    return () => {
      // Only delete if the registered fn still matches — guards against a
      // stale unsubscribe wiping out a newer registration with the same id.
      if (callbacksRef.current.get(id) === fn) {
        callbacksRef.current.delete(id);
      }
    };
  }, []);

  const refreshAll = useCallback(async () => {
    const fns = Array.from(callbacksRef.current.values());
    await Promise.all(fns.map((fn) => fn().catch(() => {})));
  }, []);

  const value = useMemo<OpenAICompatRefreshBus>(
    () => ({ register, refreshAll }),
    [register, refreshAll]
  );

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function useOpenAICompatRefreshBus(): OpenAICompatRefreshBus | null {
  return useContext(Context);
}
