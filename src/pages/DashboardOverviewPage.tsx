import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CODEX_CONFIG } from '@/components/quota';
import { useUsageData } from '@/components/usage';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi, logsApi } from '@/services/api';
import { parseLogLine } from '@/pages/hooks/logParsing';
import { useAuthStore, useConfigStore } from '@/stores';
import type { AuthFileItem, CodexQuotaWindow, GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { CredentialInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import { parseTimestampMs } from '@/utils/timestamp';
import {
  collectUsageDetails,
  extractLatencyMs,
  extractTotalTokens,
  filterUsageByTimeRange,
  formatCompactNumber,
  formatDurationMs,
  normalizeAuthIndex,
} from '@/utils/usage';
import styles from './DashboardOverviewPage.module.scss';

const OVERVIEW_TIME_RANGE = '24h' as const;
const OVERVIEW_MAX_EVENTS = 10;
const FAST_POLL_MS = 900;
const BASE_POLL_MS = 1800;
const IDLE_POLL_MS = 5000;
const HIGHLIGHT_MS = 4200;
const HIGHLIGHT_STAGGER_MS = 180;
const RECENT_HIGHLIGHT_INDEX_LIMIT = 10;
const TRACEABLE_EXACT_PATHS = new Set(['/v1/chat/completions', '/v1/messages', '/v1/responses']);
const TRACEABLE_PREFIX_PATHS = ['/v1beta/models'];
const EMPTY_HIGHLIGHT_IDS = new Set<string>();

type CodexUsageStats = {
  requests: number;
  success: number;
  failed: number;
  tokens: number;
};

type OverviewQuotaEntry = {
  planType: string | null;
  windows: CodexQuotaWindow[];
};

type OverviewRequestEventRow = {
  id: string;
  timestamp: string;
  timestampLabel: string;
  timestampMs: number;
  model: string;
  sourceKey: string;
  sourceRaw: string;
  source: string;
  sourceType: string;
  authIndex: string;
  failed: boolean;
  latencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  totalTokens: number;
};

type OverviewRequestEventBaseRow = Omit<OverviewRequestEventRow, 'id'> & {
  eventFingerprint: string;
};

type OverviewLiveUsageRow = Pick<OverviewRequestEventRow, 'id' | 'authIndex' | 'timestampMs'>;

type RequestEventIdentitySnapshot = {
  scopeKey: string;
  nextInstanceId: number;
  idsByFingerprint: Map<string, string[]>;
};

interface OverviewRequestEventsCardProps {
  usage: unknown;
  loading: boolean;
  files: AuthFileItem[];
  geminiKeys: GeminiKeyConfig[];
  claudeConfigs: ProviderKeyConfig[];
  codexConfigs: ProviderKeyConfig[];
  vertexConfigs: ProviderKeyConfig[];
  openaiProviders: OpenAIProviderConfig[];
  onUsageRefresh: () => Promise<void>;
  onQuotaRefresh: (files: AuthFileItem[]) => Promise<void>;
}

const formatLocaleNumber = (value: number, locale: string) =>
  new Intl.NumberFormat(locale).format(value);

const formatOverviewUpdatedTime = (value: Date, locale: string) =>
  new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value);

const formatPlanLabel = (
  value: string | null | undefined,
  t: ReturnType<typeof useTranslation>['t']
) => {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

  if (!normalized) {
    return '--';
  }

  switch (normalized) {
    case 'plus':
      return t('codex_quota.plan_plus');
    case 'team':
      return t('codex_quota.plan_team');
    case 'free':
      return t('codex_quota.plan_free');
    case 'pro':
      return t('codex_quota.plan_pro');
    case 'prolite':
      return t('codex_quota.plan_prolite');
    default:
      return value ?? '--';
  }
};

const formatAccountName = (file: AuthFileItem) => {
  const rawName = String(file.name ?? '').trim();
  if (!rawName) {
    return '--';
  }

  return rawName
    .replace(/^codex-/i, '')
    .replace(/-(plus|team|free|pro|prolite|pro-lite)\.json$/i, '')
    .replace(/\.json$/i, '');
};

const formatRequestSummary = (requests: number, success: number, failed: number, locale: string) =>
  `${formatLocaleNumber(requests, locale)}(${formatLocaleNumber(success, locale)} ${formatLocaleNumber(failed, locale)})`;

const formatSuccessRate = (requests: number, success: number, locale: string) => {
  if (requests <= 0) {
    return '--';
  }

  const ratio = Math.max(0, Math.min(100, (success / requests) * 100));
  const formatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: Math.abs(ratio - Math.round(ratio)) < 0.05 ? 0 : 1,
    minimumFractionDigits: Math.abs(ratio - Math.round(ratio)) < 0.05 ? 0 : 1,
  });
  return `${formatter.format(ratio)}%`;
};

const getSuccessTone = (requests: number, success: number) => {
  if (requests <= 0) {
    return {
      valueColor:
        'color-mix(in srgb, var(--text-secondary, #64748b) 88%, var(--text-primary, #0f172a))',
    };
  }

  const ratio = Math.max(0, Math.min(100, (success / requests) * 100));
  if (ratio >= 99) {
    return {
      valueColor: 'color-mix(in srgb, #15803d 88%, var(--text-primary, #0f172a))',
    };
  }
  if (ratio >= 95) {
    return {
      valueColor: 'color-mix(in srgb, #0f766e 86%, var(--text-primary, #0f172a))',
    };
  }
  if (ratio >= 85) {
    return {
      valueColor: 'color-mix(in srgb, #b45309 84%, var(--text-primary, #0f172a))',
    };
  }

  return {
    valueColor: 'color-mix(in srgb, #b91c1c 84%, var(--text-primary, #0f172a))',
  };
};

const getQuotaChipLabel = (windowItem: CodexQuotaWindow) => {
  const labelKey = String(windowItem.labelKey ?? '');
  if (labelKey.includes('primary_window')) {
    return '5H';
  }
  if (labelKey.includes('secondary_window')) {
    return '7D';
  }

  const fallback = String(windowItem.label ?? '').trim();
  return fallback ? fallback.slice(0, 6).toUpperCase() : 'QUOTA';
};

const getQuotaFillClassName = (percent: number | null) => {
  if (percent === null) {
    return styles.quotaFillEmpty;
  }
  if (percent >= 70) {
    return styles.quotaFillGood;
  }
  if (percent >= 35) {
    return styles.quotaFillWarn;
  }
  return styles.quotaFillLow;
};

const toNumber = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return parsed;
};

const buildRequestEventFingerprint = (parts: Array<string | number | boolean | null>) =>
  JSON.stringify(parts);

const createRequestEventIdentitySnapshot = (scopeKey: string): RequestEventIdentitySnapshot => ({
  scopeKey,
  nextInstanceId: 0,
  idsByFingerprint: new Map<string, string[]>(),
});
const overviewRequestEventIdentitySnapshotCache = new Map<string, RequestEventIdentitySnapshot>();

const buildStableRequestEventRows = (
  baseRows: OverviewRequestEventBaseRow[],
  snapshot: RequestEventIdentitySnapshot,
  scopeKey: string
) => {
  const activeSnapshot =
    snapshot.scopeKey === scopeKey ? snapshot : createRequestEventIdentitySnapshot(scopeKey);
  const previousQueues = new Map(
    Array.from(activeSnapshot.idsByFingerprint.entries(), ([fingerprint, ids]) => [
      fingerprint,
      [...ids],
    ])
  );
  const previousCounts = new Map(
    Array.from(activeSnapshot.idsByFingerprint.entries(), ([fingerprint, ids]) => [
      fingerprint,
      ids.length,
    ])
  );
  const nextCounts = new Map<string, number>();

  baseRows.forEach((row) => {
    nextCounts.set(row.eventFingerprint, (nextCounts.get(row.eventFingerprint) ?? 0) + 1);
  });

  let nextInstanceId = activeSnapshot.nextInstanceId;
  const assignedCounts = new Map<string, number>();
  const nextIdsByFingerprint = new Map<string, string[]>();

  const rows: OverviewRequestEventRow[] = baseRows.map(({ eventFingerprint, ...row }) => {
    const assignedCount = assignedCounts.get(eventFingerprint) ?? 0;
    const previousCount = previousCounts.get(eventFingerprint) ?? 0;
    const nextCount = nextCounts.get(eventFingerprint) ?? 0;
    const leadingNewCount = Math.max(0, nextCount - previousCount);

    let id: string | undefined;
    if (assignedCount < leadingNewCount) {
      id = `overview-event:${nextInstanceId}`;
      nextInstanceId += 1;
    } else {
      id = previousQueues.get(eventFingerprint)?.shift();
    }

    if (!id) {
      id = `overview-event:${nextInstanceId}`;
      nextInstanceId += 1;
    }

    assignedCounts.set(eventFingerprint, assignedCount + 1);

    const ids = nextIdsByFingerprint.get(eventFingerprint) ?? [];
    ids.push(id);
    nextIdsByFingerprint.set(eventFingerprint, ids);

    return {
      ...row,
      id,
    };
  });

  return {
    rows,
    snapshot: {
      scopeKey,
      nextInstanceId,
      idsByFingerprint: nextIdsByFingerprint,
    },
  };
};

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

const countOverviewUsageLogSignals = (lines: string[]) =>
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

const getCodexAuthIndex = (file?: Partial<AuthFileItem> | null) =>
  normalizeAuthIndex(file?.['auth_index'] ?? file?.authIndex);

const isCodexAuthFile = (file?: AuthFileItem | null) => Boolean(file && CODEX_CONFIG.filterFn(file));

const buildCodexUsageByAuthIndex = (usage: unknown): Map<string, CodexUsageStats> => {
  const usageMap = new Map<string, CodexUsageStats>();

  collectUsageDetails(usage).forEach((detail) => {
    const authIndex = normalizeAuthIndex(detail.auth_index);
    if (!authIndex) {
      return;
    }

    const bucket = usageMap.get(authIndex) ?? {
      requests: 0,
      success: 0,
      failed: 0,
      tokens: 0,
    };

    bucket.requests += 1;
    bucket.tokens += Math.max(Number(detail.tokens?.total_tokens) || 0, extractTotalTokens(detail));
    if (detail.failed) {
      bucket.failed += 1;
    } else {
      bucket.success += 1;
    }

    usageMap.set(authIndex, bucket);
  });

  return usageMap;
};

function useOverviewLiveUsageRefresh({
  rows,
  filesByAuthIndex,
  onUsageRefresh,
  onQuotaRefresh,
}: {
  rows: OverviewLiveUsageRow[];
  filesByAuthIndex: Map<string, AuthFileItem>;
  onUsageRefresh: () => Promise<void>;
  onQuotaRefresh: (files: AuthFileItem[]) => Promise<void>;
}) {
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const usageScopeKey = useAuthStore((state) => `${state.apiBase}::${state.managementKey}`);
  const [highlightState, setHighlightState] = useState(() => ({
    scopeKey: usageScopeKey,
    expiresAtById: new Map<string, number>(),
  }));

  const lastLogTimestampRef = useRef(0);
  const logSeededRef = useRef(false);
  const idleRoundsRef = useRef(0);
  const refreshInFlightRef = useRef(false);
  const seenRowIdsRef = useRef<Set<string>>(new Set());
  const highlightCleanupTimerRef = useRef<number | null>(null);

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
    const nextIds = new Set(rows.map((row) => row.id));
    const previousIds = seenRowIdsRef.current;

    if (previousIds.size > 0) {
      const insertedRows = rows.filter((row) => !previousIds.has(row.id));

      if (insertedRows.length > 0) {
        const highlightableRows = insertedRows
          .map((row) => ({
            row,
            index: rows.findIndex((candidate) => candidate.id === row.id),
          }))
          .filter(({ index }) => index >= 0 && index < RECENT_HIGHLIGHT_INDEX_LIMIT)
          .sort((a, b) => a.index - b.index)
          .sort((a, b) => b.index - a.index);

        if (highlightableRows.length > 0) {
          const now = Date.now();
          setHighlightState((current) => {
            const nextExpiresAtById =
              current.scopeKey === usageScopeKey
                ? new Map(current.expiresAtById)
                : new Map<string, number>();

            highlightableRows.forEach((entry, index) => {
              nextExpiresAtById.set(
                entry.row.id,
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
              .map((row) => filesByAuthIndex.get(row.authIndex))
              .filter((file): file is AuthFileItem => Boolean(file?.name))
              .map((file) => [file.name, file])
          ).values()
        );

        if (impactedFiles.length > 0) {
          void onQuotaRefresh(impactedFiles);
        }
      }
    }

    seenRowIdsRef.current = nextIds;
  }, [filesByAuthIndex, onQuotaRefresh, rows, usageScopeKey]);

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

    if (highlightState.scopeKey !== usageScopeKey || highlightState.expiresAtById.size === 0) {
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
          const signalCount = countOverviewUsageLogSignals(lines);
          if (signalCount > 0) {
            idleRoundsRef.current = 0;
            nextDelayMs = FAST_POLL_MS;

            if (!refreshInFlightRef.current) {
              refreshInFlightRef.current = true;
              await onUsageRefresh().catch(() => {});
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
  }, [connectionStatus, onUsageRefresh]);

  const highlightedIds =
    highlightState.scopeKey === usageScopeKey
      ? new Set(highlightState.expiresAtById.keys())
      : EMPTY_HIGHLIGHT_IDS;

  return {
    highlightedIds,
  };
}

function OverviewRequestEventsCard({
  usage,
  loading,
  files,
  geminiKeys,
  claudeConfigs,
  codexConfigs,
  vertexConfigs,
  openaiProviders,
  onUsageRefresh,
  onQuotaRefresh,
}: OverviewRequestEventsCardProps) {
  const { t, i18n } = useTranslation();
  const authScopeKey = useAuthStore((state) => `${state.apiBase}::${state.managementKey}`);
  const requestEventsInstanceId = useId();
  const rowIdentityCacheKey = `${authScopeKey}::${requestEventsInstanceId}`;
  const committedRowIdentitySnapshot =
    overviewRequestEventIdentitySnapshotCache.get(rowIdentityCacheKey) ??
    createRequestEventIdentitySnapshot(authScopeKey);

  const authFileMap = useMemo(() => {
    const nextMap = new Map<string, CredentialInfo>();
    files.forEach((file) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex) {
        return;
      }

      nextMap.set(authIndex, {
        name: file.name || authIndex,
        type: (file.type || file.provider || '').toString(),
      });
    });
    return nextMap;
  }, [files]);
  const filesByAuthIndex = useMemo(() => {
    const nextMap = new Map<string, AuthFileItem>();
    files.forEach((file) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (authIndex) {
        nextMap.set(authIndex, file);
      }
    });
    return nextMap;
  }, [files]);

  const sourceInfoMap = useMemo(
    () =>
      buildSourceInfoMap({
        geminiApiKeys: geminiKeys,
        claudeApiKeys: claudeConfigs,
        codexApiKeys: codexConfigs,
        vertexApiKeys: vertexConfigs,
        openaiCompatibility: openaiProviders,
      }),
    [claudeConfigs, codexConfigs, geminiKeys, openaiProviders, vertexConfigs]
  );

  const baseRows = useMemo<OverviewRequestEventBaseRow[]>(() => {
    const details = collectUsageDetails(usage);

    const mappedRows = details.map((detail) => {
      const timestamp = detail.timestamp;
      const timestampMs =
        typeof detail.__timestampMs === 'number' && detail.__timestampMs > 0
          ? detail.__timestampMs
          : parseTimestampMs(timestamp);
      const date = Number.isNaN(timestampMs) ? null : new Date(timestampMs);
      const sourceRaw = String(detail.source ?? '').trim();
      const authIndexRaw = detail.auth_index as unknown;
      const authIndex =
        authIndexRaw === null || authIndexRaw === undefined || authIndexRaw === ''
          ? '-'
          : String(authIndexRaw);
      const sourceInfo = resolveSourceDisplay(sourceRaw, authIndexRaw, sourceInfoMap, authFileMap);
      const source = sourceInfo.displayName;
      const sourceKey = sourceInfo.identityKey ?? `source:${sourceRaw || source}`;
      const sourceType = sourceInfo.type;
      const model = String(detail.__modelName ?? '').trim() || '-';
      const inputTokens = Math.max(toNumber(detail.tokens?.input_tokens), 0);
      const outputTokens = Math.max(toNumber(detail.tokens?.output_tokens), 0);
      const reasoningTokens = Math.max(toNumber(detail.tokens?.reasoning_tokens), 0);
      const cachedTokens = Math.max(
        Math.max(toNumber(detail.tokens?.cached_tokens), 0),
        Math.max(toNumber(detail.tokens?.cache_tokens), 0)
      );
      const totalTokens = Math.max(toNumber(detail.tokens?.total_tokens), extractTotalTokens(detail));
      const eventFingerprint = buildRequestEventFingerprint([
        Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestamp || '',
        model,
        sourceRaw || '-',
        authIndex,
        detail.failed === true,
        extractLatencyMs(detail) ?? '',
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
      ]);

      return {
        timestamp,
        timestampMs: Number.isNaN(timestampMs) ? 0 : timestampMs,
        timestampLabel: date ? date.toLocaleString(i18n.language) : timestamp || '-',
        model,
        sourceKey,
        sourceRaw: sourceRaw || '-',
        source,
        sourceType,
        authIndex,
        failed: detail.failed === true,
        latencyMs: extractLatencyMs(detail),
        inputTokens,
        outputTokens,
        reasoningTokens,
        cachedTokens,
        totalTokens,
        eventFingerprint,
      };
    });

    const sourceLabelKeyMap = new Map<string, Set<string>>();
    mappedRows.forEach((row) => {
      const keys = sourceLabelKeyMap.get(row.source) ?? new Set<string>();
      keys.add(row.sourceKey);
      sourceLabelKeyMap.set(row.source, keys);
    });

    const disambiguatedRows = mappedRows.map((row) => {
      const labelKeyCount = sourceLabelKeyMap.get(row.source)?.size ?? 0;
      if (labelKeyCount <= 1) {
        return row;
      }

      if (row.authIndex !== '-') {
        return {
          ...row,
          source: `${row.source} / ${row.authIndex}`,
        };
      }

      if (row.sourceRaw !== '-' && row.sourceRaw !== row.source) {
        return {
          ...row,
          source: `${row.source} / ${row.sourceRaw}`,
        };
      }

      if (row.sourceType) {
        return {
          ...row,
          source: `${row.source} / ${row.sourceType}`,
        };
      }

      return {
        ...row,
        source: `${row.source} / ${row.sourceKey}`,
      };
    });

    return disambiguatedRows
      .sort((a, b) => {
        if (b.timestampMs !== a.timestampMs) return b.timestampMs - a.timestampMs;
        if (a.timestamp !== b.timestamp) return b.timestamp.localeCompare(a.timestamp);
        if (a.model !== b.model) return a.model.localeCompare(b.model);
        if (a.sourceRaw !== b.sourceRaw) return a.sourceRaw.localeCompare(b.sourceRaw);
        if (a.authIndex !== b.authIndex) return a.authIndex.localeCompare(b.authIndex);
        if (a.failed !== b.failed) return Number(a.failed) - Number(b.failed);
        if (b.totalTokens !== a.totalTokens) return b.totalTokens - a.totalTokens;
        return a.source.localeCompare(b.source);
      })
      .slice(0, OVERVIEW_MAX_EVENTS);
  }, [authFileMap, i18n.language, sourceInfoMap, usage]);

  const rowIdentityDraft = useMemo(
    () => buildStableRequestEventRows(baseRows, committedRowIdentitySnapshot, authScopeKey),
    [authScopeKey, baseRows, committedRowIdentitySnapshot]
  );

  useEffect(() => {
    overviewRequestEventIdentitySnapshotCache.set(rowIdentityCacheKey, rowIdentityDraft.snapshot);

    return () => {
      overviewRequestEventIdentitySnapshotCache.delete(rowIdentityCacheKey);
    };
  }, [rowIdentityCacheKey, rowIdentityDraft.snapshot]);

  const rows = rowIdentityDraft.rows;
  const liveRefreshRows = useMemo<OverviewLiveUsageRow[]>(
    () =>
      rows.map((row) => ({
        id: row.id,
        authIndex: row.authIndex,
        timestampMs: row.timestampMs,
      })),
    [rows]
  );
  const { highlightedIds } = useOverviewLiveUsageRefresh({
    rows: liveRefreshRows,
    filesByAuthIndex,
    onUsageRefresh,
    onQuotaRefresh,
  });

  const hasLatencyData = useMemo(() => rows.some((row) => row.latencyMs !== null), [rows]);

  return (
    <Card className={styles.eventsCard} title={t('usage_stats.request_events_title')}>
      <div className={styles.eventsCardBody}>
        {loading && rows.length === 0 ? (
          <div className={styles.emptyState}>{t('common.loading')}</div>
        ) : rows.length === 0 ? (
          <EmptyState
            title={t('usage_stats.request_events_empty_title')}
            description={t('usage_stats.request_events_empty_desc')}
          />
        ) : (
          <div className={styles.eventsTableWrapper}>
            <table className={styles.eventsTable}>
              <thead>
                <tr>
                  <th className={styles.eventsTimestampCol}>
                    {t('usage_stats.request_events_timestamp')}
                  </th>
                  <th className={styles.eventsModelCol}>{t('usage_stats.model_name')}</th>
                  <th className={styles.eventsSourceCol}>
                    {t('usage_stats.request_events_source')}
                  </th>
                  <th className={styles.eventsAuthIndexCol}>
                    {t('usage_stats.request_events_auth_index')}
                  </th>
                  <th className={styles.eventsResultCol}>
                    {t('usage_stats.request_events_result')}
                  </th>
                  {hasLatencyData && (
                    <th className={styles.eventsMetricCol}>{t('usage_stats.time')}</th>
                  )}
                  <th className={styles.eventsMetricCol}>{t('usage_stats.input_tokens')}</th>
                  <th className={styles.eventsMetricCol}>{t('usage_stats.output_tokens')}</th>
                  <th className={styles.eventsMetricCol}>{t('usage_stats.reasoning_tokens')}</th>
                  <th className={styles.eventsMetricCol}>{t('usage_stats.cached_tokens')}</th>
                  <th className={styles.eventsMetricCol}>{t('usage_stats.total_tokens')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    className={highlightedIds.has(row.id) ? styles.eventsRowHighlighted : undefined}
                  >
                    <td className={styles.eventsTimestampCell} title={row.timestamp}>
                      {row.timestampLabel}
                    </td>
                    <td className={styles.eventsModelCell}>{row.model}</td>
                    <td className={styles.eventsSourceCell} title={row.source}>
                      <div className={styles.eventsSourceContent}>
                        <span className={styles.eventsSourceText}>{row.source}</span>
                        {row.sourceType && (
                          <span className={styles.eventsSourceType}>{row.sourceType}</span>
                        )}
                      </div>
                    </td>
                    <td className={styles.eventsAuthIndexCell} title={row.authIndex}>
                      {row.authIndex}
                    </td>
                    <td className={styles.eventsResultCell}>
                      <span
                        className={
                          row.failed ? styles.eventsResultFailed : styles.eventsResultSuccess
                        }
                      >
                        {row.failed ? t('stats.failure') : t('stats.success')}
                      </span>
                    </td>
                    {hasLatencyData && (
                      <td className={styles.eventsMetricCell}>
                        {formatDurationMs(row.latencyMs)}
                      </td>
                    )}
                    <td className={styles.eventsMetricCell}>{row.inputTokens.toLocaleString()}</td>
                    <td className={styles.eventsMetricCell}>{row.outputTokens.toLocaleString()}</td>
                    <td className={styles.eventsMetricCell}>
                      {row.reasoningTokens.toLocaleString()}
                    </td>
                    <td className={styles.eventsMetricCell}>
                      {row.cachedTokens.toLocaleString()}
                    </td>
                    <td className={styles.eventsMetricCell}>{row.totalTokens.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}

export function DashboardOverviewPage() {
  const { t, i18n } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const quotaScopeKey = useAuthStore((state) => `${state.apiBase}::${state.managementKey}`);
  const appConfig = useConfigStore((state) => state.config);

  const { usage, loading, error, lastRefreshedAt, loadUsage } = useUsageData();

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [quotaLoading, setQuotaLoading] = useState(false);
  const [codexQuotaByFile, setCodexQuotaByFile] = useState<Record<string, OverviewQuotaEntry>>({});

  const quotaSyncSignatureRef = useRef('');
  const quotaRequestKeyRef = useRef('');

  const loadOverviewFiles = useCallback(async (): Promise<AuthFileItem[]> => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesLoading(false);
      return [];
    }

    setFilesLoading(true);
    try {
      const result = await authFilesApi.list();
      const nextFiles = Array.isArray(result) ? result : result?.files;
      const resolvedFiles = Array.isArray(nextFiles) ? nextFiles : [];
      setFiles(resolvedFiles);
      return resolvedFiles;
    } catch {
      setFiles([]);
      return [];
    } finally {
      setFilesLoading(false);
    }
  }, [connectionStatus]);

  const fetchCodexQuotaEntries = useCallback(
    async (targetFiles: AuthFileItem[]) => {
      const codexFiles = targetFiles.filter((file) => isCodexAuthFile(file));
      return await Promise.all(
        codexFiles.map(async (file) => {
          try {
            const data = await CODEX_CONFIG.fetchQuota(file, t);
            return [
              file.name,
              {
                planType: data.planType ?? null,
                windows: Array.isArray(data.windows) ? data.windows : [],
              },
            ] as const;
          } catch {
            return [
              file.name,
              {
                planType: null,
                windows: [],
              },
            ] as const;
          }
        })
      );
    },
    [t]
  );

  const loadCodexQuota = useCallback(
    async (targetFiles: AuthFileItem[]) => {
      if (connectionStatus !== 'connected') {
        quotaRequestKeyRef.current = '';
        setQuotaLoading(false);
        setCodexQuotaByFile({});
        return;
      }

      const codexFiles = targetFiles.filter((file) => isCodexAuthFile(file));
      if (codexFiles.length === 0) {
        quotaRequestKeyRef.current = '';
        setQuotaLoading(false);
        setCodexQuotaByFile({});
        return;
      }

      const requestKey = `${quotaScopeKey}::${codexFiles
        .map((file) => `${file.name}:${getCodexAuthIndex(file) ?? '-'}`)
        .join('|')}`;

      quotaRequestKeyRef.current = requestKey;
      setQuotaLoading(true);

      const entries = await fetchCodexQuotaEntries(codexFiles);

      if (quotaRequestKeyRef.current !== requestKey) {
        return;
      }

      setCodexQuotaByFile(Object.fromEntries(entries));
      setQuotaLoading(false);
    },
    [connectionStatus, fetchCodexQuotaEntries, quotaScopeKey]
  );

  const refreshCodexQuotaSubset = useCallback(
    async (targetFiles: AuthFileItem[]) => {
      if (connectionStatus !== 'connected') {
        return;
      }

      const entries = await fetchCodexQuotaEntries(targetFiles);
      if (entries.length === 0) {
        return;
      }

      setCodexQuotaByFile((current) => ({
        ...current,
        ...Object.fromEntries(entries),
      }));
    },
    [connectionStatus, fetchCodexQuotaEntries]
  );

  const handleHeaderRefresh = useCallback(async () => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesLoading(false);
      setCodexQuotaByFile({});
      setQuotaLoading(false);
      return;
    }

    const [refreshedFiles] = await Promise.all([loadOverviewFiles(), loadUsage()]);
    quotaSyncSignatureRef.current = '';
    await loadCodexQuota(refreshedFiles);
  }, [connectionStatus, loadCodexQuota, loadOverviewFiles, loadUsage]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesLoading(false);
      setCodexQuotaByFile({});
      setQuotaLoading(false);
      quotaSyncSignatureRef.current = '';
      quotaRequestKeyRef.current = '';
      return;
    }

    void loadOverviewFiles();
  }, [connectionStatus, loadOverviewFiles, quotaScopeKey]);

  const overviewUsage = useMemo(
    () => (usage ? filterUsageByTimeRange(usage, OVERVIEW_TIME_RANGE) : null),
    [usage]
  );

  const codexFiles = useMemo(() => files.filter((file) => isCodexAuthFile(file)), [files]);
  const usageByAuthIndex = useMemo(
    () => buildCodexUsageByAuthIndex(overviewUsage),
    [overviewUsage]
  );
  const codexQuotaSignature = useMemo(
    () =>
      `${quotaScopeKey}::${codexFiles
        .map((file) => `${file.name}:${getCodexAuthIndex(file) ?? '-'}`)
        .join('|')}`,
    [codexFiles, quotaScopeKey]
  );

  useEffect(() => {
    if (connectionStatus !== 'connected') {
      quotaSyncSignatureRef.current = '';
      quotaRequestKeyRef.current = '';
      return;
    }
  }, [connectionStatus]);

  useEffect(() => {
    if (connectionStatus !== 'connected' || filesLoading) {
      return;
    }

    if (!codexQuotaSignature || codexFiles.length === 0) {
      setCodexQuotaByFile({});
      setQuotaLoading(false);
      return;
    }

    if (quotaSyncSignatureRef.current === codexQuotaSignature) {
      return;
    }

    quotaSyncSignatureRef.current = codexQuotaSignature;
    void loadCodexQuota(codexFiles);
  }, [codexFiles, codexQuotaSignature, connectionStatus, filesLoading, loadCodexQuota]);

  const totalRequests = useMemo(
    () => Array.from(usageByAuthIndex.values()).reduce((sum, item) => sum + item.requests, 0),
    [usageByAuthIndex]
  );
  const totalTokens = useMemo(
    () => Array.from(usageByAuthIndex.values()).reduce((sum, item) => sum + item.tokens, 0),
    [usageByAuthIndex]
  );
  const hasUsageSnapshot = overviewUsage !== null;

  const accountCards = useMemo(
    () =>
      codexFiles.map((file) => {
        const authIndex = getCodexAuthIndex(file);
        const usageStats =
          authIndex !== null
            ? (usageByAuthIndex.get(authIndex) ?? {
                requests: 0,
                success: 0,
                failed: 0,
                tokens: 0,
              })
            : {
                requests: 0,
                success: 0,
                failed: 0,
                tokens: 0,
              };
        const quotaEntry = codexQuotaByFile[file.name];
        const quotaWindows = Array.isArray(quotaEntry?.windows) ? quotaEntry.windows : [];
        const fallbackResetLabel = quotaLoading || filesLoading ? t('common.loading') : '--';
        const successTone = getSuccessTone(usageStats.requests, usageStats.success);

        const windows =
          quotaWindows.length > 0
            ? quotaWindows.slice(0, 2).map((windowItem) => ({
                id: windowItem.id,
                label: getQuotaChipLabel(windowItem),
                percent:
                  windowItem.usedPercent === null || windowItem.usedPercent === undefined
                    ? null
                    : Math.max(0, Math.min(100, 100 - Number(windowItem.usedPercent))),
                resetLabel: String(windowItem.resetLabel ?? '').trim() || fallbackResetLabel,
              }))
            : [
                {
                  id: `${file.name}:primary`,
                  label: '5H',
                  percent: null,
                  resetLabel: fallbackResetLabel,
                },
                {
                  id: `${file.name}:secondary`,
                  label: '7D',
                  percent: null,
                  resetLabel: fallbackResetLabel,
                },
              ];

        return {
          file,
          displayName: formatAccountName(file),
          requestCountLabel: formatLocaleNumber(usageStats.requests, i18n.language),
          requestSummaryLabel: formatRequestSummary(
            usageStats.requests,
            usageStats.success,
            usageStats.failed,
            i18n.language
          ),
          requestSuccessLabel: formatLocaleNumber(usageStats.success, i18n.language),
          requestFailureLabel: formatLocaleNumber(usageStats.failed, i18n.language),
          successRateLabel: formatSuccessRate(
            usageStats.requests,
            usageStats.success,
            i18n.language
          ),
          successTone,
          planLabel: formatPlanLabel(quotaEntry?.planType, t),
          windows,
        };
      }),
    [codexFiles, codexQuotaByFile, filesLoading, i18n.language, quotaLoading, t, usageByAuthIndex]
  );

  const lastUpdatedLabel = lastRefreshedAt
    ? formatOverviewUpdatedTime(lastRefreshedAt, i18n.language)
    : hasUsageSnapshot
      ? '--'
      : t('common.loading');

  return (
    <div className={styles.page}>
      {error && <div className={styles.errorBox}>{error}</div>}

      <div className={styles.grid}>
        <Card
          className={styles.accountsCard}
          title={
            <div className={styles.titleGroup}>
              <span className={styles.cardTitle}>{t('dashboard.account_stats')}</span>
              <span className={styles.updatedText}>
                {t('usage_stats.last_updated')}: {lastUpdatedLabel}
              </span>
            </div>
          }
          extra={
            <div className={styles.summaryPills}>
              <span className={`${styles.summaryPill} ${styles.summaryPillRequests}`}>
                <span className={styles.summaryLabel}>{t('usage_stats.total_requests')}</span>
                <span className={styles.summaryValue}>
                  {hasUsageSnapshot ? formatLocaleNumber(totalRequests, i18n.language) : '--'}
                </span>
              </span>
              <span className={`${styles.summaryPill} ${styles.summaryPillTokens}`}>
                <span className={styles.summaryLabel}>{t('usage_stats.total_tokens')}</span>
                <span className={styles.summaryValue}>
                  {hasUsageSnapshot ? formatCompactNumber(totalTokens) : '--'}
                </span>
              </span>
            </div>
          }
        >
          {accountCards.length === 0 ? (
            <div className={styles.emptyState}>
              {!hasUsageSnapshot && filesLoading ? t('common.loading') : t('dashboard.no_codex_accounts')}
            </div>
          ) : (
            <div className={styles.accountGrid}>
              {accountCards.map((account) => (
                <div key={account.file.name} className={styles.accountCard}>
                  <div className={styles.accountHeader}>
                    <div className={styles.accountName} title={account.file.name}>
                      {account.displayName}
                    </div>
                    <span className={styles.planBadge}>{account.planLabel}</span>
                  </div>

                  <div className={styles.accountMetrics}>
                    <div className={styles.accountMetric}>
                      <span className={styles.accountMetricLabel}>
                        {t('usage_stats.requests_count')}
                      </span>
                      <div className={styles.requestSummary} title={account.requestSummaryLabel}>
                        <span className={styles.requestSummaryValue}>
                          {account.requestCountLabel}
                        </span>
                        <span className={styles.requestBreakdown}>
                          <span>(</span>
                          <span className={styles.requestSuccess}>
                            {account.requestSuccessLabel}
                          </span>
                          <span> </span>
                          <span className={styles.requestFailure}>
                            {account.requestFailureLabel}
                          </span>
                          <span>)</span>
                        </span>
                      </div>
                    </div>

                    <div className={styles.accountMetric}>
                      <span className={styles.accountMetricLabel}>
                        {t('usage_stats.success_rate')}
                      </span>
                      <span
                        className={styles.accountMetricValue}
                        style={{ color: account.successTone.valueColor }}
                      >
                        {account.successRateLabel}
                      </span>
                    </div>
                  </div>

                  <div className={styles.quotaGrid}>
                    {account.windows.map((windowItem) => (
                      <div key={windowItem.id} className={styles.quotaChip}>
                        <span className={styles.quotaLabel}>{windowItem.label}</span>
                        <span className={styles.quotaPercent}>
                          {windowItem.percent === null ? '--' : `${Math.round(windowItem.percent)}%`}
                        </span>
                        <div className={styles.quotaBar}>
                          <div
                            className={`${styles.quotaFill} ${getQuotaFillClassName(windowItem.percent)}`}
                            style={{ width: `${windowItem.percent ?? 0}%` }}
                          />
                        </div>
                        <span className={styles.quotaReset}>{windowItem.resetLabel}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <OverviewRequestEventsCard
          usage={overviewUsage}
          loading={loading}
          files={files}
          geminiKeys={appConfig?.geminiApiKeys || []}
          claudeConfigs={appConfig?.claudeApiKeys || []}
          codexConfigs={appConfig?.codexApiKeys || []}
          vertexConfigs={appConfig?.vertexApiKeys || []}
          openaiProviders={appConfig?.openaiCompatibility || []}
          onUsageRefresh={loadUsage}
          onQuotaRefresh={refreshCodexQuotaSubset}
        />
      </div>
    </div>
  );
}
