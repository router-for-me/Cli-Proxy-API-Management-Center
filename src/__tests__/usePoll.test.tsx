import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { useState } from 'react';
import { usePoll } from '@/hooks/usePoll';

function PollHarness({
  callback,
  intervalMs,
  pauseWhenHidden,
  runOnMount
}: {
  callback: (signal: AbortSignal) => void | Promise<void>;
  intervalMs: number | null;
  pauseWhenHidden?: boolean;
  runOnMount?: boolean;
}) {
  usePoll(callback, intervalMs, { pauseWhenHidden, runOnMount });
  return null;
}

describe('usePoll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not run the callback on mount by default', () => {
    const cb = vi.fn();
    render(<PollHarness callback={cb} intervalMs={1000} />);
    expect(cb).not.toHaveBeenCalled();
  });

  it('runs on each interval', async () => {
    const cb = vi.fn();
    render(<PollHarness callback={cb} intervalMs={1000} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3500);
    });
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('runs on mount when runOnMount=true', async () => {
    const cb = vi.fn();
    render(<PollHarness callback={cb} intervalMs={1000} runOnMount />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('pauses when intervalMs is null', async () => {
    const cb = vi.fn();
    render(<PollHarness callback={cb} intervalMs={null} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('passes an AbortSignal that aborts on unmount', async () => {
    let captured: AbortSignal | null = null;
    const cb = vi.fn(async (signal: AbortSignal) => {
      captured = signal;
      await new Promise((r) => setTimeout(r, 100));
    });
    const { unmount } = render(<PollHarness callback={cb} intervalMs={1000} runOnMount />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(captured).not.toBeNull();
    expect(captured!.aborted).toBe(false);
    unmount();
    expect(captured!.aborted).toBe(true);
  });

  it('aborts the previous callback when the next tick fires', async () => {
    const seen: AbortSignal[] = [];
    const cb = vi.fn(async (signal: AbortSignal) => {
      seen.push(signal);
    });
    render(<PollHarness callback={cb} intervalMs={500} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(seen.length).toBeGreaterThanOrEqual(2);
    // Earlier signals should have been aborted by the next tick.
    expect(seen[0].aborted).toBe(true);
    expect(seen[seen.length - 1].aborted).toBe(false);
  });

  it('survives intervalMs changes by re-arming', async () => {
    const cb = vi.fn();
    function ChangingHarness() {
      const [interval, setInterval] = useState<number | null>(1000);
      usePoll(cb, interval);
      return (
        <button data-testid="pause" onClick={() => setInterval(null)}>
          pause
        </button>
      );
    }
    const { getByTestId } = render(<ChangingHarness />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(cb).toHaveBeenCalledTimes(2);
    act(() => {
      getByTestId('pause').click();
    });
    cb.mockClear();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(cb).not.toHaveBeenCalled();
  });

  it('respects the latest callback reference across ticks', async () => {
    const first = vi.fn();
    const second = vi.fn();
    function ChangingCallback() {
      const [cb, setCb] = useState(() => first);
      usePoll(cb, 500);
      return (
        <button data-testid="swap" onClick={() => setCb(() => second)}>
          swap
        </button>
      );
    }
    const { getByTestId } = render(<ChangingCallback />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    act(() => {
      getByTestId('swap').click();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // The hook re-runs the effect on callback change (since cb prop is
    // referentially different); either way the latest callback fires.
    expect(second).toHaveBeenCalled();
  });
});
