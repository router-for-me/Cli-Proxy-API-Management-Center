/**
 * Loads recorded quota history and refreshes it while the page is open.
 *
 * Responses from an older request or an earlier connection session are
 * dropped, matching the quota cards' session isolation.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { quotaHistoryApi, type QuotaHistory } from '@/services/api/quotaHistory';
import { useQuotaStore } from '@/stores';

const AUTO_REFRESH_MS = 5 * 60 * 1000;

export type QuotaHistoryState = {
  history: QuotaHistory | null;
  loading: boolean;
  error: string;
  /** The backend has no history endpoint (an official build). */
  unsupported: boolean;
};

const INITIAL_STATE: QuotaHistoryState = {
  history: null,
  loading: true,
  error: '',
  unsupported: false,
};

const statusOf = (error: unknown): number | undefined =>
  typeof error === 'object' && error !== null && 'status' in error
    ? (error as { status?: number }).status
    : undefined;

export function useQuotaHistory(
  fromMs: number,
  enabled: boolean,
  refreshKey: number
): QuotaHistoryState {
  const generation = useQuotaStore((state) => state.cacheGeneration);
  const [state, setState] = useState<QuotaHistoryState>(INITIAL_STATE);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const requestId = ++requestRef.current;
    const isCurrent = () =>
      requestId === requestRef.current && generation === useQuotaStore.getState().cacheGeneration;
    setState((previous) => ({ ...previous, loading: true }));
    try {
      const history = await quotaHistoryApi.get(fromMs, Date.now());
      if (!isCurrent()) return;
      setState({ history, loading: false, error: '', unsupported: false });
    } catch (error: unknown) {
      if (!isCurrent()) return;
      const status = statusOf(error);
      setState({
        history: null,
        loading: false,
        error: error instanceof Error ? error.message : String(error),
        unsupported: status === 404,
      });
    }
  }, [fromMs, generation]);

  useEffect(() => {
    if (!enabled) {
      requestRef.current += 1;
      setState(INITIAL_STATE);
      return;
    }
    void load();
    const timer = window.setInterval(() => void load(), AUTO_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      requestRef.current += 1;
    };
  }, [enabled, load, refreshKey]);

  return state;
}
