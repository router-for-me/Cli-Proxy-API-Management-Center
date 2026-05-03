import { useEffect, useRef } from 'react';

// isAbortError returns true for the axios-shaped error produced when an
// AbortController fires during an in-flight request (axios v1 sets
// code === 'ERR_CANCELED'). The DOMException form (name === 'AbortError')
// is also recognised for callers using fetch directly.
//
// Pollers wired through usePoll abort their in-flight request on
// hidden-tab transition or unmount; that abort is expected and should
// not surface as a "request failed" page error or console.error
// (Codex Stage 1 exit round 2 FE-R2-5).
export function isAbortError(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err !== 'object') return false;
  const e = err as { code?: unknown; name?: unknown };
  return e.code === 'ERR_CANCELED' || e.name === 'CanceledError' || e.name === 'AbortError';
}

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
 * Replaces ad-hoc setInterval / useInterval pollers in network-poll
 * call sites.
 */
export function usePoll(
  callback: (signal: AbortSignal) => void | Promise<void>,
  intervalMs: number | null,
  options?: UsePollOptions
): void {
  const { pauseWhenHidden = true, runOnMount = false } = options ?? {};

  const callbackRef = useRef(callback);
  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

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
        // Fire once on resume so a long-interval poller (e.g. 240s) doesn't
        // wait up to a full interval after the tab returns visible. Then
        // re-arm the timer for subsequent ticks.
        void run();
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
