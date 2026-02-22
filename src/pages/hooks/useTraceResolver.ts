import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api/authFiles';
import { USAGE_STATS_STALE_TIME_MS, useUsageStatsStore } from '@/stores';
import type { AuthFileItem, Config } from '@/types';
import type { CredentialInfo, SourceInfo } from '@/types/sourceInfo';
import { buildSourceInfoMap, resolveSourceDisplay } from '@/utils/sourceResolver';
import {
  collectUsageDetailsWithEndpoint,
  normalizeAuthIndex,
  type UsageDetailWithEndpoint
} from '@/utils/usage';
import type { ParsedLogLine } from './logTypes';

type TraceConfidence = 'high' | 'medium' | 'low';

export type TraceCandidate = {
  detail: UsageDetailWithEndpoint;
  score: number;
  confidence: TraceConfidence;
  timeDeltaMs: number | null;
};

const TRACE_AUTH_CACHE_MS = 60 * 1000;
const TRACE_MATCH_STRONG_WINDOW_MS = 3 * 1000;
const TRACE_MATCH_WINDOW_MS = 10 * 1000;
const TRACE_MATCH_MAX_WINDOW_MS = 30 * 1000;

const TRACEABLE_EXACT_PATHS = new Set(['/v1/chat/completions', '/v1/messages', '/v1/responses']);
const TRACEABLE_PREFIX_PATHS = ['/v1beta/models'];

const normalizeTracePath = (value?: string) =>
  String(value ?? '')
    .replace(/^"+|"+$/g, '')
    .split('?')[0]
    .trim();

const normalizeTraceablePath = (value?: string): string => {
  const normalized = normalizeTracePath(value);
  if (!normalized || normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
};

export const isTraceableRequestPath = (value?: string): boolean => {
  const normalizedPath = normalizeTraceablePath(value);
  if (!normalizedPath) return false;
  if (TRACEABLE_EXACT_PATHS.has(normalizedPath)) return true;
  return TRACEABLE_PREFIX_PATHS.some((prefix) => normalizedPath.startsWith(prefix));
};

const scoreTraceCandidate = (
  line: ParsedLogLine,
  detail: UsageDetailWithEndpoint
): TraceCandidate | null => {
  let score = 0;
  let timeDeltaMs: number | null = null;

  const logTimestampMs = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;
  const detailTimestampMs = detail.__timestampMs;
  if (!Number.isNaN(logTimestampMs) && detailTimestampMs > 0) {
    timeDeltaMs = Math.abs(logTimestampMs - detailTimestampMs);
    if (timeDeltaMs <= TRACE_MATCH_STRONG_WINDOW_MS) {
      score += 42;
    } else if (timeDeltaMs <= TRACE_MATCH_WINDOW_MS) {
      score += 30;
    } else if (timeDeltaMs <= TRACE_MATCH_MAX_WINDOW_MS) {
      score += 12;
    } else {
      score -= 12;
    }
  }

  let methodMatched = false;
  if (line.method && detail.__endpointMethod) {
    if (line.method.toUpperCase() === detail.__endpointMethod.toUpperCase()) {
      score += 18;
      methodMatched = true;
    } else {
      score -= 8;
    }
  }

  const logPath = normalizeTracePath(line.path);
  const detailPath = normalizeTracePath(detail.__endpointPath);
  let pathMatched = false;
  if (logPath && detailPath) {
    if (logPath === detailPath) {
      score += 24;
      pathMatched = true;
    } else if (logPath.startsWith(detailPath) || detailPath.startsWith(logPath)) {
      score += 12;
      pathMatched = true;
    } else {
      score -= 8;
    }
  }

  if (typeof line.statusCode === 'number') {
    const logFailed = line.statusCode >= 400;
    score += logFailed === detail.failed ? 10 : -6;
  }

  if (
    timeDeltaMs !== null &&
    timeDeltaMs > TRACE_MATCH_MAX_WINDOW_MS &&
    !methodMatched &&
    !pathMatched
  ) {
    return null;
  }

  if (score <= 0) return null;
  const confidence: TraceConfidence = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { detail, score, confidence, timeDeltaMs };
};

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err !== 'object' || err === null) return '';
  if (!('message' in err)) return '';

  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
};

interface UseTraceResolverOptions {
  traceScopeKey: string;
  connectionStatus: string;
  config: Config | null;
  requestLogDownloading: boolean;
}

interface UseTraceResolverReturn {
  traceLogLine: ParsedLogLine | null;
  traceLoading: boolean;
  traceError: string;
  traceCandidates: TraceCandidate[];
  resolveTraceSourceInfo: (sourceRaw: string, authIndex: unknown) => SourceInfo;
  loadTraceUsageDetails: () => Promise<void>;
  refreshTraceUsageDetails: () => Promise<void>;
  openTraceModal: (line: ParsedLogLine) => void;
  closeTraceModal: () => void;
}

export function useTraceResolver(options: UseTraceResolverOptions): UseTraceResolverReturn {
  const { traceScopeKey, connectionStatus, config, requestLogDownloading } = options;
  const { t } = useTranslation();
  const usageSnapshot = useUsageStatsStore((state) => state.usage);
  const usageScopeKey = useUsageStatsStore((state) => state.scopeKey);
  const loadUsageStats = useUsageStatsStore((state) => state.loadUsageStats);

  const [traceLogLine, setTraceLogLine] = useState<ParsedLogLine | null>(null);
  const [traceAuthFileMap, setTraceAuthFileMap] = useState<Map<string, CredentialInfo>>(new Map());
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');

  const traceAuthLoadedAtRef = useRef(0);
  const traceScopeKeyRef = useRef('');

  const scopedUsageSnapshot = usageScopeKey === traceScopeKey ? usageSnapshot : null;
  const traceUsageDetails = useMemo<UsageDetailWithEndpoint[]>(
    () => collectUsageDetailsWithEndpoint(scopedUsageSnapshot),
    [scopedUsageSnapshot]
  );

  const traceSourceInfoMap = useMemo(() => buildSourceInfoMap(config ?? {}), [config]);

  const loadTraceUsageDetailsInternal = useCallback(async (forceUsage: boolean) => {
    if (traceScopeKeyRef.current !== traceScopeKey) {
      traceScopeKeyRef.current = traceScopeKey;
      traceAuthLoadedAtRef.current = 0;
      setTraceAuthFileMap(new Map());
      setTraceError('');
    }

    if (traceLoading) return;

    const now = Date.now();
    const authFresh =
      traceAuthLoadedAtRef.current > 0 && now - traceAuthLoadedAtRef.current < TRACE_AUTH_CACHE_MS;

    setTraceLoading(true);
    setTraceError('');
    try {
      const [, authFilesResponse] = await Promise.all([
        loadUsageStats({
          force: forceUsage,
          staleTimeMs: USAGE_STATS_STALE_TIME_MS
        }),
        authFresh ? Promise.resolve(null) : authFilesApi.list().catch(() => null)
      ]);

      if (authFilesResponse !== null) {
        const files = Array.isArray(authFilesResponse)
          ? authFilesResponse
          : (authFilesResponse as { files?: AuthFileItem[] })?.files;
        if (Array.isArray(files)) {
          const map = new Map<string, CredentialInfo>();
          files.forEach((file) => {
            const key = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
            if (!key) return;
            map.set(key, {
              name: file.name || key,
              type: (file.type || file.provider || '').toString()
            });
          });
          setTraceAuthFileMap(map);
          traceAuthLoadedAtRef.current = Date.now();
        }
      }
    } catch (err: unknown) {
      setTraceError(getErrorMessage(err) || t('logs.trace_usage_load_error'));
    } finally {
      setTraceLoading(false);
    }
  }, [loadUsageStats, t, traceLoading, traceScopeKey]);

  const loadTraceUsageDetails = useCallback(async () => {
    await loadTraceUsageDetailsInternal(false);
  }, [loadTraceUsageDetailsInternal]);

  const refreshTraceUsageDetails = useCallback(async () => {
    await loadTraceUsageDetailsInternal(true);
  }, [loadTraceUsageDetailsInternal]);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      traceScopeKeyRef.current = traceScopeKey;
      traceAuthLoadedAtRef.current = 0;
      setTraceAuthFileMap(new Map());
      setTraceLoading(false);
      setTraceError('');
    }
  }, [connectionStatus, traceScopeKey]);

  const traceCandidates = useMemo(() => {
    if (!traceLogLine) return [];
    const scored = traceUsageDetails
      .map((detail) => scoreTraceCandidate(traceLogLine, detail))
      .filter((item): item is TraceCandidate => item !== null)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        const aDelta = a.timeDeltaMs ?? Number.MAX_SAFE_INTEGER;
        const bDelta = b.timeDeltaMs ?? Number.MAX_SAFE_INTEGER;
        return aDelta - bDelta;
      });
    return scored.slice(0, 8);
  }, [traceLogLine, traceUsageDetails]);

  const resolveTraceSourceInfo = useCallback(
    (sourceRaw: string, authIndex: unknown): SourceInfo =>
      resolveSourceDisplay(sourceRaw, authIndex, traceSourceInfoMap, traceAuthFileMap),
    [traceAuthFileMap, traceSourceInfoMap]
  );

  const openTraceModal = useCallback(
    (line: ParsedLogLine) => {
      if (!isTraceableRequestPath(line.path)) return;
      setTraceError('');
      setTraceLogLine(line);
      void loadTraceUsageDetails();
    },
    [loadTraceUsageDetails]
  );

  const closeTraceModal = useCallback(() => {
    if (requestLogDownloading) return;
    setTraceLogLine(null);
  }, [requestLogDownloading]);

  return {
    traceLogLine,
    traceLoading,
    traceError,
    traceCandidates,
    resolveTraceSourceInfo,
    loadTraceUsageDetails,
    refreshTraceUsageDetails,
    openTraceModal,
    closeTraceModal
  };
}
