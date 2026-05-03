import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProviderEditChrome } from '@/components/providers/useProviderEditChrome';

// Codex Phase D round-1 IMPORTANT #2: pin the Escape-key + cleanup
// invariants the hook is supposed to provide. The hook is consumed by
// every AiProvidersXxxEditPage and a regression here would silently
// break Escape-to-back behavior on all four edit screens.

describe('useProviderEditChrome', () => {
  let onBack: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onBack = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a ref consumers can attach to the shell', () => {
    const { result } = renderHook(() => useProviderEditChrome(onBack));
    expect(result.current).toBeDefined();
    expect(typeof result.current).toBe('object');
  });

  it('fires onBack when Escape is pressed', () => {
    renderHook(() => useProviderEditChrome(onBack));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('does not fire onBack on other keys', () => {
    renderHook(() => useProviderEditChrome(onBack));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('removes the listener on unmount', () => {
    const { unmount } = renderHook(() => useProviderEditChrome(onBack));
    unmount();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(onBack).not.toHaveBeenCalled();
  });

  it('refreshes the listener when onBack identity changes', () => {
    const firstOnBack = vi.fn();
    const secondOnBack = vi.fn();

    const { rerender } = renderHook(
      ({ cb }: { cb: () => void }) => useProviderEditChrome(cb),
      { initialProps: { cb: firstOnBack } },
    );

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(firstOnBack).toHaveBeenCalledTimes(1);
    expect(secondOnBack).not.toHaveBeenCalled();

    rerender({ cb: secondOnBack });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(firstOnBack).toHaveBeenCalledTimes(1);
    expect(secondOnBack).toHaveBeenCalledTimes(1);
  });
});
