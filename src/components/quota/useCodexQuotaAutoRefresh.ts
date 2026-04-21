import { useCallback, useEffect, useRef, useState } from 'react';
import { CODEX_QUOTA_AUTO_REFRESH_INTERVAL_SECONDS } from '@/features/codexCustomization/shared';

const STORAGE_KEY = 'quota_management.codex_auto_refresh';

const readPreference = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
};

const writePreference = (active: boolean) => {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, String(active));
  } catch {
    // Ignore storage errors.
  }
};

interface UseCodexQuotaAutoRefreshOptions {
  enabled: boolean;
  disabled: boolean;
  refreshing: boolean;
  triggerRefresh: () => Promise<void>;
  intervalSeconds?: number;
}

export function useCodexQuotaAutoRefresh({
  enabled,
  disabled,
  refreshing,
  triggerRefresh,
  intervalSeconds = CODEX_QUOTA_AUTO_REFRESH_INTERVAL_SECONDS,
}: UseCodexQuotaAutoRefreshOptions) {
  const [active, setActive] = useState(readPreference);
  const [countdown, setCountdown] = useState(intervalSeconds);
  const [pageVisible, setPageVisible] = useState(
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  );

  const refreshSeenRef = useRef(Boolean(refreshing));
  const triggerInFlightRef = useRef(false);

  useEffect(() => {
    setCountdown(intervalSeconds);
  }, [intervalSeconds]);

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') {
      return;
    }

    const handleVisibilityChange = () => {
      const visible = document.visibilityState === 'visible';
      setPageVisible(visible);
      if (visible && active && !refreshing && !disabled && !triggerInFlightRef.current) {
        setCountdown(intervalSeconds);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [active, disabled, enabled, intervalSeconds, refreshing]);

  useEffect(() => {
    if (!enabled) {
      refreshSeenRef.current = false;
      return;
    }

    if (refreshing) {
      refreshSeenRef.current = true;
      return;
    }

    if (refreshSeenRef.current) {
      refreshSeenRef.current = false;
      if (active && pageVisible && !disabled && !triggerInFlightRef.current) {
        setCountdown(intervalSeconds);
      }
    }
  }, [active, disabled, enabled, intervalSeconds, pageVisible, refreshing]);

  useEffect(() => {
    if (
      !enabled ||
      !active ||
      disabled ||
      refreshing ||
      !pageVisible ||
      triggerInFlightRef.current
    ) {
      return;
    }

    if (countdown <= 0) {
      triggerInFlightRef.current = true;
      void triggerRefresh()
        .catch(() => {})
        .finally(() => {
          triggerInFlightRef.current = false;
          if (active && pageVisible && !disabled) {
            setCountdown(intervalSeconds);
          }
        });
      return;
    }

    const timer = window.setTimeout(() => {
      setCountdown((current) => Math.max(current - 1, 0));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    active,
    countdown,
    disabled,
    enabled,
    intervalSeconds,
    pageVisible,
    refreshing,
    triggerRefresh,
  ]);

  const toggle = useCallback(() => {
    if (!enabled) {
      return;
    }

    setActive((current) => {
      const next = !current;
      writePreference(next);
      return next;
    });
    setCountdown(intervalSeconds);
  }, [enabled, intervalSeconds]);

  return {
    active: enabled ? active : false,
    countdown,
    pageVisible,
    toggle,
  };
}
