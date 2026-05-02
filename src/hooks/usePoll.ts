import { useEffect, useRef } from 'react';

export interface UsePollOptions {
  /**
   * If true (default), the polling interval pauses while the document is
   * hidden (other tab, minimized window). The currently in-flight callback
   * is aborted via the AbortSignal handed to it.
   */
  pauseWhenHidden?: boolean;
  /**
   * If true, fire the callback immediately on mount in addition to the
   * recurring interval. Defaults to false to match the historical
   * useInterval semantics — callers usually do their initial fetch in a
   * separate useEffect.
   */
  runOnMount?: boolean;
}

/**
 * Recurring async polling hook with built-in cancellation and
 * visibility-aware pausing.
 *
 *   - Pass `intervalMs = null` (or 0) to pause polling entirely. The hook
 *     re-arms when intervalMs becomes a positive number again.
 *   - The callback receives an AbortSignal that aborts on the next tick,
 *     on unmount, on intervalMs change, and (if pauseWhenHidden) when the
 *     document becomes hidden. Callers that pass the signal to fetch()
 *     get free in-flight cancellation.
 *   - Errors thrown by the callback are swallowed — the hook keeps
 *     polling. If the caller cares about errors, they handle them inside
 *     the callback (notification, store state, etc.). This matches the
 *     existing useInterval / setInterval call-site contracts in this app.
 *
 * Replaces ad-hoc setInterval / useInterval pollers identified in
 * bench/inventory/pollers.md as network polls.
 */
export function usePoll(
  callback: (signal: AbortSignal) => void | Promise<void>,
  intervalMs: number | null,
  options?: UsePollOptions
): void {
  const { pauseWhenHidden = true, runOnMount = false } = options ?? {};

  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (intervalMs === null || intervalMs <= 0) return;

    let active = true;
    let controller: AbortController | null = null;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const run = async () => {
      if (!active) return;
      controller?.abort();
      controller = new AbortController();
      const signal = controller.signal;
      try {
        await callbackRef.current(signal);
      } catch {
        // Caller-owned error policy. Keep polling.
      }
    };

    const start = () => {
      if (intervalId !== null) return;
      intervalId = setInterval(() => {
        void run();
      }, intervalMs);
    };

    const stop = () => {
      if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    const isHiddenNow = () =>
      typeof document !== 'undefined' && document.visibilityState === 'hidden';

    const handleVisibility = () => {
      if (isHiddenNow()) {
        stop();
        controller?.abort();
      } else {
        start();
      }
    };

    if (runOnMount && !(pauseWhenHidden && isHiddenNow())) {
      void run();
    }

    if (!(pauseWhenHidden && isHiddenNow())) {
      start();
    }

    if (pauseWhenHidden && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibility);
    }

    return () => {
      active = false;
      stop();
      controller?.abort();
      if (pauseWhenHidden && typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibility);
      }
    };
  }, [intervalMs, pauseWhenHidden, runOnMount]);
}
