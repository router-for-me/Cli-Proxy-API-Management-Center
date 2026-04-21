import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi, logsApi } from '@/services/api';
import { useAuthStore, useUsageStatsStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { refreshCodexQuotaFiles } from '@/features/codexCustomization/shared';
import { parseLogLine } from '@/pages/hooks/logParsing';
import { normalizeAuthIndex } from '@/utils/usage';

const FAST_POLL_MS = 900;
const BASE_POLL_MS = 1800;
const IDLE_POLL_MS = 5000;
const HIGHLIGHT_MS = 4200;
const HIGHLIGHT_STAGGER_MS = 180;
const HIGHLIGHT_SCAN_LIMIT = 1200;
const HIGHLIGHT_BATCH_LIMIT = 24;
const RECENT_HIGHLIGHT_INDEX_LIMIT = 16;
const TRACEABLE_EXACT_PATHS = new Set(['/v1/chat/completions', '/v1/messages', '/v1/responses']);
const TRACEABLE_PREFIX_PATHS = ['/v1beta/models'];
const EMPTY_HIGHLIGHT_IDS = new Set<string>();
const EMPTY_AUTH_FILE_MAP = new Map<string, AuthFileItem>();

const normalizeTraceablePath = (value?: string) => {
  const normalized = String(value ?? '')
    .replace(/^"+|"+$/g, '')
    .split('?')[0]
    .trim()
    .replace(/\/+$/, '');

  return normalized || '';
};

const isTraceableRequestPath = (value?: string) => {
  const normalizedPath = normalizeTraceablePath(value);
  if (!normalizedPath) {
    return false;
  }

  if (TRACEABLE_EXACT_PATHS.has(normalizedPath)) {
    return true;
  }

  return TRACEABLE_PREFIX_PATHS.some((prefix) => normalizedPath.startsWith(prefix));
};

const countLiveUsageLogSignals = (lines: string[]) =>
  lines.reduce((count, line) => {
    if (!line.trim()) {
      return count;
    }

    const parsed = parseLogLine(line);
    if (
      isTraceableRequestPath(parsed.path) &&
      (typeof parsed.statusCode === 'number' || Boolean(parsed.latency))
    ) {
      return count + 1;
    }

    return count;
  }, 0);

interface LiveUsageRow {
  id: string;
  authIndex: string;
  timestampMs: number;
}

interface UseLiveUsageRefreshOptions {
  enabled?: boolean;
  rows: LiveUsageRow[];
}

export function useLiveUsageRefresh({ enabled = true, rows }: UseLiveUsageRefreshOptions) {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const usageScopeKey = useAuthStore((state) => `${state.apiBase}::${state.managementKey}`);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);
  const [highlightState, setHighlightState] = useState(() => ({
    scopeKey: usageScopeKey,
    expiresAtById: new Map<string, number>(),
  }));
  const [authFileMapState, setAuthFileMapState] = useState(() => ({
    scopeKey: usageScopeKey,
    map: new Map<string, AuthFileItem>(),
  }));

  const lastLogTimestampRef = useRef(0);
  const logSeededRef = useRef(false);
  const idleRoundsRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const seenRowIdsRef = useRef<Set<string>>(new Set());
  const highlightCleanupTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      return;
    }

    let cancelled = false;

    void authFilesApi
      .list()
      .then((result) => {
        if (cancelled) {
          return;
        }

        const files = Array.isArray(result) ? result : result?.files;
        if (!Array.isArray(files)) {
          return;
        }

        const nextMap = new Map<string, AuthFileItem>();
        files.forEach((file) => {
          const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
          if (authIndex) {
            nextMap.set(authIndex, file);
          }
        });
        setAuthFileMapState({
          scopeKey: usageScopeKey,
          map: nextMap,
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, usageScopeKey]);

  const authFileMap =
    authFileMapState.scopeKey === usageScopeKey ? authFileMapState.map : EMPTY_AUTH_FILE_MAP;

  useEffect(() => {
    lastLogTimestampRef.current = 0;
    logSeededRef.current = false;
    idleRoundsRef.current = 0;
    refreshInFlightRef.current = false;
    seenRowIdsRef.current = new Set();

    if (highlightCleanupTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(highlightCleanupTimerRef.current);
      highlightCleanupTimerRef.current = null;
    }
  }, [usageScopeKey]);

  useEffect(() => {
    const nextRows = rows.slice(0, HIGHLIGHT_SCAN_LIMIT);
    const nextIds = new Set(nextRows.map((row) => row.id));
    const previousIds = seenRowIdsRef.current;

    if (previousIds.size > 0) {
      const insertedRows = nextRows.filter((row) => !previousIds.has(row.id));

      if (insertedRows.length > 0) {
        const rowIndexById = new Map(nextRows.map((row, index) => [row.id, index]));
        const highlightableRows = insertedRows
          .map((row) => ({
            row,
            index: rowIndexById.get(row.id) ?? Number.MAX_SAFE_INTEGER,
          }))
          .filter(({ index }) => index < RECENT_HIGHLIGHT_INDEX_LIMIT)
          .sort((a, b) => a.index - b.index)
          .slice(0, HIGHLIGHT_BATCH_LIMIT)
          .sort((a, b) => {
            return b.index - a.index;
          });

        if (highlightableRows.length > 0) {
          const now = Date.now();
          setHighlightState((current) => {
            const nextExpiresAtById =
              current.scopeKey === usageScopeKey
                ? new Map(current.expiresAtById)
                : new Map<string, number>();

            highlightableRows.forEach((row, index) => {
              nextExpiresAtById.set(
                row.row.id,
                now + HIGHLIGHT_MS + index * HIGHLIGHT_STAGGER_MS
              );
            });

            return {
              scopeKey: usageScopeKey,
              expiresAtById: nextExpiresAtById,
            };
          });
        }

        const impactedFiles = Array.from(
          new Map(
            insertedRows
              .map((row) => authFileMap.get(row.authIndex))
              .filter((file): file is AuthFileItem => Boolean(file?.name))
              .map((file) => [file.name, file])
          ).values()
        );

        if (impactedFiles.length > 0) {
          void refreshCodexQuotaFiles(impactedFiles, t, { silent: true });
        }
      }
    }

    seenRowIdsRef.current = nextIds;
  }, [authFileMap, rows, t, usageScopeKey]);

  useEffect(
    () => () => {
      if (highlightCleanupTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(highlightCleanupTimerRef.current);
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (highlightCleanupTimerRef.current !== null) {
      window.clearTimeout(highlightCleanupTimerRef.current);
      highlightCleanupTimerRef.current = null;
    }

    if (
      highlightState.scopeKey !== usageScopeKey ||
      highlightState.expiresAtById.size === 0
    ) {
      return;
    }

    const now = Date.now();
    const nextExpiry = Math.min(...Array.from(highlightState.expiresAtById.values()));
    const delayMs = Math.max(0, nextExpiry - now);

    highlightCleanupTimerRef.current = window.setTimeout(() => {
      const currentTime = Date.now();
      setHighlightState((current) => {
        if (current.scopeKey !== usageScopeKey || current.expiresAtById.size === 0) {
          return current;
        }

        const nextExpiresAtById = new Map(current.expiresAtById);
        Array.from(nextExpiresAtById.entries()).forEach(([id, expiresAt]) => {
          if (expiresAt <= currentTime) {
            nextExpiresAtById.delete(id);
          }
        });

        if (nextExpiresAtById.size === current.expiresAtById.size) {
          return current;
        }

        return {
          scopeKey: usageScopeKey,
          expiresAtById: nextExpiresAtById,
        };
      });
      highlightCleanupTimerRef.current = null;
    }, delayMs);

    return () => {
      if (highlightCleanupTimerRef.current !== null) {
        window.clearTimeout(highlightCleanupTimerRef.current);
        highlightCleanupTimerRef.current = null;
      }
    };
  }, [highlightState, usageScopeKey]);

  useEffect(() => {
    if (
      !enabled ||
      connectionStatus !== 'connected' ||
      typeof window === 'undefined' ||
      typeof document === 'undefined'
    ) {
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const clearTimer = () => {
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const scheduleNext = (delayMs = BASE_POLL_MS) => {
      clearTimer();
      if (!cancelled) {
        timer = window.setTimeout(
          () => {
            void pollLogs();
          },
          Math.max(0, delayMs)
        );
      }
    };

    const pollLogs = async () => {
      if (cancelled || document.visibilityState !== 'visible') {
        return;
      }

      let nextDelayMs = BASE_POLL_MS;

      try {
        if (!logSeededRef.current) {
          const seedResult = await logsApi.fetchLogs();
          if (cancelled) {
            return;
          }

          if (typeof seedResult?.['latest-timestamp'] === 'number') {
            lastLogTimestampRef.current = seedResult['latest-timestamp'];
          }
          logSeededRef.current = true;
          idleRoundsRef.current = 0;
        } else {
          const params = lastLogTimestampRef.current ? { after: lastLogTimestampRef.current } : {};
          const logResult = await logsApi.fetchLogs(params);
          if (cancelled) {
            return;
          }

          if (typeof logResult?.['latest-timestamp'] === 'number') {
            lastLogTimestampRef.current = logResult['latest-timestamp'];
          }

          const lines = Array.isArray(logResult?.lines) ? logResult.lines : [];
          const signalCount = countLiveUsageLogSignals(lines);
          if (signalCount > 0) {
            idleRoundsRef.current = 0;
            nextDelayMs = FAST_POLL_MS;

            if (!refreshInFlightRef.current) {
              refreshInFlightRef.current = true;
              await loadUsageStats({ force: true }).catch(() => {});
              refreshInFlightRef.current = false;
            }
          } else {
            idleRoundsRef.current += 1;
            nextDelayMs = idleRoundsRef.current >= 12 ? IDLE_POLL_MS : BASE_POLL_MS;
          }
        }
      } catch {
        nextDelayMs = IDLE_POLL_MS;
      }

      if (!cancelled && document.visibilityState === 'visible') {
        scheduleNext(nextDelayMs);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        idleRoundsRef.current = 0;
        scheduleNext(0);
      } else {
        clearTimer();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    if (document.visibilityState === 'visible') {
      scheduleNext(0);
    }

    return () => {
      cancelled = true;
      clearTimer();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connectionStatus, enabled, loadUsageStats]);

  const highlightedIds =
    highlightState.scopeKey === usageScopeKey
      ? new Set(highlightState.expiresAtById.keys())
      : EMPTY_HIGHLIGHT_IDS;

  return {
    highlightedIds,
  };
}
