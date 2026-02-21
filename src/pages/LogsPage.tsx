import { useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconDownload,
  IconCode,
  IconEyeOff,
  IconRefreshCw,
  IconSearch,
  IconTimer,
  IconTrash2,
  IconX,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { authFilesApi } from '@/services/api/authFiles';
import { logsApi } from '@/services/api/logs';
import { usageApi } from '@/services/api/usage';
import type { AuthFileItem } from '@/types';
import { copyToClipboard } from '@/utils/clipboard';
import { MANAGEMENT_API_PREFIX } from '@/utils/constants';
import { formatUnixTimestamp } from '@/utils/format';
import {
  buildCandidateUsageSourceIds,
  collectUsageDetailsWithEndpoint,
  type UsageDetailWithEndpoint
} from '@/utils/usage';
import styles from './LogsPage.module.scss';

interface ErrorLogItem {
  name: string;
  size?: number;
  modified?: number;
}

type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

type LogState = {
  buffer: string[];
  visibleFrom: number;
};

// 初始只渲染最近 100 行，滚动到顶部再逐步加载更多（避免一次性渲染过多导致卡顿）
const INITIAL_DISPLAY_LINES = 100;
const LOAD_MORE_LINES = 200;
const MAX_BUFFER_LINES = 10000;
const LOAD_MORE_THRESHOLD_PX = 72;
const LONG_PRESS_MS = 650;
const LONG_PRESS_MOVE_THRESHOLD = 10;

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];
const HTTP_METHOD_REGEX = new RegExp(`\\b(${HTTP_METHODS.join('|')})\\b`);
const STATUS_GROUPS = ['2xx', '3xx', '4xx', '5xx'] as const;
type StatusGroup = (typeof STATUS_GROUPS)[number];
const PATH_FILTER_LIMIT = 12;

const LOG_TIMESTAMP_REGEX = /^\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\]?/;
const LOG_LEVEL_REGEX = /^\[?(trace|debug|info|warn|warning|error|fatal)\s*\]?(?=\s|\[|$)\s*/i;
const LOG_SOURCE_REGEX = /^\[([^\]]+)\]/;
const LOG_LATENCY_REGEX =
  /\b(?:\d+(?:\.\d+)?\s*(?:µs|us|ms|s|m))(?:\s*\d+(?:\.\d+)?\s*(?:µs|us|ms|s|m))*\b/i;
const LOG_IPV4_REGEX = /\b(?:\d{1,3}\.){3}\d{1,3}\b/;
const LOG_IPV6_REGEX = /\b(?:[a-f0-9]{0,4}:){2,7}[a-f0-9]{0,4}\b/i;
const LOG_REQUEST_ID_REGEX = /^([a-f0-9]{8}|--------)$/i;
const LOG_TIME_OF_DAY_REGEX = /^\d{1,2}:\d{2}:\d{2}(?:\.\d{1,3})?$/;
const GIN_TIMESTAMP_SEGMENT_REGEX =
  /^\[GIN\]\s+(\d{4})\/(\d{2})\/(\d{2})\s*-\s*(\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?)\s*$/;

const HTTP_STATUS_PATTERNS: RegExp[] = [
  /\|\s*([1-5]\d{2})\s*\|/,
  /\b([1-5]\d{2})\s*-/,
  new RegExp(`\\b(?:${HTTP_METHODS.join('|')})\\s+\\S+\\s+([1-5]\\d{2})\\b`),
  /\b(?:status|code|http)[:\s]+([1-5]\d{2})\b/i,
  /\b([1-5]\d{2})\s+(?:OK|Created|Accepted|No Content|Moved|Found|Bad Request|Unauthorized|Forbidden|Not Found|Method Not Allowed|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)\b/i,
];

const detectHttpStatusCode = (text: string): number | undefined => {
  for (const pattern of HTTP_STATUS_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const code = Number.parseInt(match[1], 10);
    if (!Number.isFinite(code)) continue;
    if (code >= 100 && code <= 599) return code;
  }
  return undefined;
};

const resolveStatusGroup = (statusCode?: number): StatusGroup | undefined => {
  if (typeof statusCode !== 'number') return undefined;
  if (statusCode >= 200 && statusCode < 300) return '2xx';
  if (statusCode >= 300 && statusCode < 400) return '3xx';
  if (statusCode >= 400 && statusCode < 500) return '4xx';
  if (statusCode >= 500 && statusCode < 600) return '5xx';
  return undefined;
};

const extractIp = (text: string): string | undefined => {
  const ipv4Match = text.match(LOG_IPV4_REGEX);
  if (ipv4Match) return ipv4Match[0];

  const ipv6Match = text.match(LOG_IPV6_REGEX);
  if (!ipv6Match) return undefined;

  const candidate = ipv6Match[0];

  // Avoid treating time strings like "12:34:56" as IPv6 addresses.
  if (LOG_TIME_OF_DAY_REGEX.test(candidate)) return undefined;

  // If no compression marker is present, a valid IPv6 address must contain 8 hextets.
  if (!candidate.includes('::') && candidate.split(':').length !== 8) return undefined;

  return candidate;
};

const normalizeTimestampToSeconds = (value: string): string => {
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})/);
  if (!match) return trimmed;
  return `${match[1]} ${match[2]}`;
};

const extractLatency = (text: string): string | undefined => {
  const match = text.match(LOG_LATENCY_REGEX);
  if (!match) return undefined;
  return match[0].replace(/\s+/g, '');
};

type ParsedLogLine = {
  raw: string;
  timestamp?: string;
  level?: LogLevel;
  source?: string;
  requestId?: string;
  statusCode?: number;
  latency?: string;
  ip?: string;
  method?: HttpMethod;
  path?: string;
  message: string;
};

type TraceConfidence = 'high' | 'medium' | 'low';

type TraceCandidate = {
  detail: UsageDetailWithEndpoint;
  score: number;
  confidence: TraceConfidence;
  timeDeltaMs: number | null;
};

type TraceCredentialInfo = {
  name: string;
  type: string;
};

type TraceSourceInfo = {
  displayName: string;
  type: string;
};

const TRACE_USAGE_CACHE_MS = 60 * 1000;
const TRACE_MATCH_STRONG_WINDOW_MS = 3 * 1000;
const TRACE_MATCH_WINDOW_MS = 10 * 1000;
const TRACE_MATCH_MAX_WINDOW_MS = 30 * 1000;

const normalizeTraceAuthIndex = (value: unknown): string | null => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || null;
  }
  return null;
};

const normalizeTracePath = (value?: string) =>
  String(value ?? '')
    .replace(/^"+|"+$/g, '')
    .split('?')[0]
    .trim();

const TRACEABLE_EXACT_PATHS = new Set(['/v1/chat/completions', '/v1/messages', '/v1/responses']);
const TRACEABLE_PREFIX_PATHS = ['/v1beta/models'];

const normalizeTraceablePath = (value?: string): string => {
  const normalized = normalizeTracePath(value);
  if (!normalized || normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
};

const isTraceableRequestPath = (value?: string): boolean => {
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

  if (timeDeltaMs !== null && timeDeltaMs > TRACE_MATCH_MAX_WINDOW_MS && !methodMatched && !pathMatched) {
    return null;
  }

  if (score <= 0) return null;
  const confidence: TraceConfidence = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { detail, score, confidence, timeDeltaMs };
};

const extractLogLevel = (value: string): LogLevel | undefined => {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'warning') return 'warn';
  if (normalized === 'warn') return 'warn';
  if (normalized === 'info') return 'info';
  if (normalized === 'error') return 'error';
  if (normalized === 'fatal') return 'fatal';
  if (normalized === 'debug') return 'debug';
  if (normalized === 'trace') return 'trace';
  return undefined;
};

const inferLogLevel = (line: string): LogLevel | undefined => {
  const lowered = line.toLowerCase();
  if (/\bfatal\b/.test(lowered)) return 'fatal';
  if (/\berror\b/.test(lowered)) return 'error';
  if (/\bwarn(?:ing)?\b/.test(lowered) || line.includes('警告')) return 'warn';
  if (/\binfo\b/.test(lowered)) return 'info';
  if (/\bdebug\b/.test(lowered)) return 'debug';
  if (/\btrace\b/.test(lowered)) return 'trace';
  return undefined;
};

const extractHttpMethodAndPath = (text: string): { method?: HttpMethod; path?: string } => {
  const match = text.match(HTTP_METHOD_REGEX);
  if (!match) return {};

  const method = match[1] as HttpMethod;
  const index = match.index ?? 0;
  const after = text.slice(index + match[0].length).trim();
  const path = after ? after.split(/\s+/)[0] : undefined;
  return { method, path };
};

const parseLogLine = (raw: string): ParsedLogLine => {
  let remaining = raw.trim();

  let timestamp: string | undefined;
  const tsMatch = remaining.match(LOG_TIMESTAMP_REGEX);
  if (tsMatch) {
    timestamp = tsMatch[1];
    remaining = remaining.slice(tsMatch[0].length).trim();
  }

  let requestId: string | undefined;
  const requestIdMatch = remaining.match(/^\[([a-f0-9]{8}|--------)\]\s*/i);
  if (requestIdMatch) {
    const id = requestIdMatch[1];
    if (!/^-+$/.test(id)) {
      requestId = id;
    }
    remaining = remaining.slice(requestIdMatch[0].length).trim();
  }

  let level: LogLevel | undefined;
  const lvlMatch = remaining.match(LOG_LEVEL_REGEX);
  if (lvlMatch) {
    level = extractLogLevel(lvlMatch[1]);
    remaining = remaining.slice(lvlMatch[0].length).trim();
  }

  let source: string | undefined;
  const sourceMatch = remaining.match(LOG_SOURCE_REGEX);
  if (sourceMatch) {
    source = sourceMatch[1];
    remaining = remaining.slice(sourceMatch[0].length).trim();
  }

  let statusCode: number | undefined;
  let latency: string | undefined;
  let ip: string | undefined;
  let method: HttpMethod | undefined;
  let path: string | undefined;
  let message = remaining;

  if (remaining.includes('|')) {
    const segments = remaining
      .split('|')
      .map((segment) => segment.trim())
      .filter(Boolean);
    const consumed = new Set<number>();

    const ginIndex = segments.findIndex((segment) => GIN_TIMESTAMP_SEGMENT_REGEX.test(segment));
    if (ginIndex >= 0) {
      const match = segments[ginIndex].match(GIN_TIMESTAMP_SEGMENT_REGEX);
      if (match) {
        const ginTimestamp = `${match[1]}-${match[2]}-${match[3]} ${match[4]}`;
        const normalizedGin = normalizeTimestampToSeconds(ginTimestamp);
        const normalizedParsed = timestamp ? normalizeTimestampToSeconds(timestamp) : undefined;

        if (!timestamp) {
          timestamp = ginTimestamp;
          consumed.add(ginIndex);
        } else if (normalizedParsed === normalizedGin) {
          consumed.add(ginIndex);
        }
      }
    }

    // request id (8-char hex or dashes)
    const requestIdIndex = segments.findIndex((segment) => LOG_REQUEST_ID_REGEX.test(segment));
    if (requestIdIndex >= 0) {
      const match = segments[requestIdIndex].match(LOG_REQUEST_ID_REGEX);
      if (match) {
        const id = match[1];
        if (!/^-+$/.test(id)) {
          requestId = id;
        }
        consumed.add(requestIdIndex);
      }
    }

    // status code
    const statusIndex = segments.findIndex((segment) => /^\d{3}$/.test(segment));
    if (statusIndex >= 0) {
      const match = segments[statusIndex].match(/^(\d{3})$/);
      if (match) {
        const code = Number.parseInt(match[1], 10);
        if (code >= 100 && code <= 599) {
          statusCode = code;
          consumed.add(statusIndex);
        }
      }
    }

    // latency
    const latencyIndex = segments.findIndex((segment) => LOG_LATENCY_REGEX.test(segment));
    if (latencyIndex >= 0) {
      const extracted = extractLatency(segments[latencyIndex]);
      if (extracted) {
        latency = extracted;
        consumed.add(latencyIndex);
      }
    }

    // ip
    const ipIndex = segments.findIndex((segment) => Boolean(extractIp(segment)));
    if (ipIndex >= 0) {
      const extracted = extractIp(segments[ipIndex]);
      if (extracted) {
        ip = extracted;
        consumed.add(ipIndex);
      }
    }

    // method + path
    const methodIndex = segments.findIndex((segment) => {
      const { method: parsedMethod } = extractHttpMethodAndPath(segment);
      return Boolean(parsedMethod);
    });
    if (methodIndex >= 0) {
      const parsed = extractHttpMethodAndPath(segments[methodIndex]);
      method = parsed.method;
      path = parsed.path;
      consumed.add(methodIndex);
    }

    // source (e.g. [gin_logger.go:94])
    const sourceIndex = segments.findIndex((segment) => LOG_SOURCE_REGEX.test(segment));
    if (sourceIndex >= 0) {
      const match = segments[sourceIndex].match(LOG_SOURCE_REGEX);
      if (match) {
        source = match[1];
        consumed.add(sourceIndex);
      }
    }

    message = segments.filter((_, index) => !consumed.has(index)).join(' | ');
  } else {
    statusCode = detectHttpStatusCode(remaining);

    const extracted = extractLatency(remaining);
    if (extracted) latency = extracted;

    ip = extractIp(remaining);

    const parsed = extractHttpMethodAndPath(remaining);
    method = parsed.method;
    path = parsed.path;
  }

  if (!level) level = inferLogLevel(raw);

  if (message) {
    const match = message.match(GIN_TIMESTAMP_SEGMENT_REGEX);
    if (match) {
      const ginTimestamp = `${match[1]}-${match[2]}-${match[3]} ${match[4]}`;
      if (!timestamp) timestamp = ginTimestamp;
      if (normalizeTimestampToSeconds(timestamp) === normalizeTimestampToSeconds(ginTimestamp)) {
        message = '';
      }
    }
  }

  return {
    raw,
    timestamp,
    level,
    source,
    requestId,
    statusCode,
    latency,
    ip,
    method,
    path,
    message,
  };
};

const getErrorMessage = (err: unknown): string => {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (typeof err !== 'object' || err === null) return '';
  if (!('message' in err)) return '';

  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
};

type TabType = 'logs' | 'errors';

export function LogsPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const config = useConfigStore((state) => state.config);
  const requestLogEnabled = config?.requestLog ?? false;

  const [activeTab, setActiveTab] = useState<TabType>('logs');
  const [logState, setLogState] = useState<LogState>({ buffer: [], visibleFrom: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const [hideManagementLogs, setHideManagementLogs] = useState(true);
  const [showRawLogs, setShowRawLogs] = useState(false);
  const [methodFilters, setMethodFilters] = useState<HttpMethod[]>([]);
  const [statusFilters, setStatusFilters] = useState<StatusGroup[]>([]);
  const [pathFilters, setPathFilters] = useState<string[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  const [loadingErrors, setLoadingErrors] = useState(false);
  const [errorLogsError, setErrorLogsError] = useState('');
  const [requestLogId, setRequestLogId] = useState<string | null>(null);
  const [requestLogDownloading, setRequestLogDownloading] = useState(false);
  const [traceLogLine, setTraceLogLine] = useState<ParsedLogLine | null>(null);
  const [traceUsageDetails, setTraceUsageDetails] = useState<UsageDetailWithEndpoint[]>([]);
  const [traceAuthFileMap, setTraceAuthFileMap] = useState<Map<string, TraceCredentialInfo>>(new Map());
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');

  const logViewerRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToBottomRef = useRef(false);
  const pendingPrependScrollRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
  const longPressRef = useRef<{
    timer: number | null;
    startX: number;
    startY: number;
    fired: boolean;
  } | null>(null);
  const logRequestInFlightRef = useRef(false);
  const pendingFullReloadRef = useRef(false);
  const traceUsageLoadedAtRef = useRef(0);
  const traceAuthLoadedAtRef = useRef(0);

  // 保存最新时间戳用于增量获取
  const latestTimestampRef = useRef<number>(0);

  const disableControls = connectionStatus !== 'connected';
  const traceSourceInfoMap = useMemo(() => {
    const map = new Map<string, TraceSourceInfo>();

    const registerSource = (sourceId: string, displayName: string, type: string) => {
      if (!sourceId || !displayName || map.has(sourceId)) return;
      map.set(sourceId, { displayName, type });
    };

    const registerCandidates = (displayName: string, type: string, candidates: string[]) => {
      candidates.forEach((sourceId) => registerSource(sourceId, displayName, type));
    };

    (config?.geminiApiKeys || []).forEach((item, index) => {
      const displayName = item.prefix?.trim() || `Gemini #${index + 1}`;
      registerCandidates(
        displayName,
        'gemini',
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
    });

    (config?.claudeApiKeys || []).forEach((item, index) => {
      const displayName = item.prefix?.trim() || `Claude #${index + 1}`;
      registerCandidates(
        displayName,
        'claude',
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
    });

    (config?.codexApiKeys || []).forEach((item, index) => {
      const displayName = item.prefix?.trim() || `Codex #${index + 1}`;
      registerCandidates(
        displayName,
        'codex',
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
    });

    (config?.vertexApiKeys || []).forEach((item, index) => {
      const displayName = item.prefix?.trim() || `Vertex #${index + 1}`;
      registerCandidates(
        displayName,
        'vertex',
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
    });

    (config?.openaiCompatibility || []).forEach((provider, providerIndex) => {
      const displayName = provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`;
      const candidates = new Set<string>();
      buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((sourceId) =>
        candidates.add(sourceId)
      );
      (provider.apiKeyEntries || []).forEach((entry) => {
        buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((sourceId) =>
          candidates.add(sourceId)
        );
      });
      registerCandidates(displayName, 'openai', Array.from(candidates));
    });

    return map;
  }, [config]);

  const isNearBottom = (node: HTMLDivElement | null) => {
    if (!node) return true;
    const threshold = 24;
    return node.scrollHeight - node.scrollTop - node.clientHeight <= threshold;
  };

  const scrollToBottom = () => {
    const node = logViewerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  };

  const loadLogs = async (incremental = false) => {
    if (connectionStatus !== 'connected') {
      setLoading(false);
      return;
    }

    if (logRequestInFlightRef.current) {
      if (!incremental) {
        pendingFullReloadRef.current = true;
      }
      return;
    }

    logRequestInFlightRef.current = true;

    if (!incremental) {
      setLoading(true);
    }
    setError('');

    try {
      pendingScrollToBottomRef.current = !incremental || isNearBottom(logViewerRef.current);

      const params =
        incremental && latestTimestampRef.current > 0 ? { after: latestTimestampRef.current } : {};
      const data = await logsApi.fetchLogs(params);

      // 更新时间戳
      if (data['latest-timestamp']) {
        latestTimestampRef.current = data['latest-timestamp'];
      }

      const newLines = Array.isArray(data.lines) ? data.lines : [];

      if (incremental && newLines.length > 0) {
        // 增量更新：追加新日志并限制缓冲区大小（避免内存与渲染膨胀）
        setLogState((prev) => {
          const prevRenderedCount = prev.buffer.length - prev.visibleFrom;
          const combined = [...prev.buffer, ...newLines];
          const dropCount = Math.max(combined.length - MAX_BUFFER_LINES, 0);
          const buffer = dropCount > 0 ? combined.slice(dropCount) : combined;
          let visibleFrom = Math.max(prev.visibleFrom - dropCount, 0);

          // 若用户停留在底部（跟随最新日志），则保持“渲染窗口”大小不变，避免无限增长
          if (pendingScrollToBottomRef.current) {
            visibleFrom = Math.max(buffer.length - prevRenderedCount, 0);
          }

          return { buffer, visibleFrom };
        });
      } else if (!incremental) {
        // 全量加载：默认只渲染最后 100 行，向上滚动再展开更多
        const buffer = newLines.slice(-MAX_BUFFER_LINES);
        const visibleFrom = Math.max(buffer.length - INITIAL_DISPLAY_LINES, 0);
        setLogState({ buffer, visibleFrom });
      }
    } catch (err: unknown) {
      console.error('Failed to load logs:', err);
      if (!incremental) {
        setError(getErrorMessage(err) || t('logs.load_error'));
      }
    } finally {
      if (!incremental) {
        setLoading(false);
      }
      logRequestInFlightRef.current = false;
      if (pendingFullReloadRef.current) {
        pendingFullReloadRef.current = false;
        void loadLogs(false);
      }
    }
  };

  useHeaderRefresh(() => loadLogs(false));

  const clearLogs = async () => {
    showConfirmation({
      title: t('logs.clear_confirm_title', { defaultValue: 'Clear Logs' }),
      message: t('logs.clear_confirm'),
      variant: 'danger',
      confirmText: t('common.confirm'),
      onConfirm: async () => {
        try {
          await logsApi.clearLogs();
          setLogState({ buffer: [], visibleFrom: 0 });
          latestTimestampRef.current = 0;
          showNotification(t('logs.clear_success'), 'success');
        } catch (err: unknown) {
          const message = getErrorMessage(err);
          showNotification(
            `${t('notification.delete_failed')}${message ? `: ${message}` : ''}`,
            'error'
          );
        }
      },
    });
  };

  const downloadLogs = () => {
    const text = logState.buffer.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'logs.txt';
    a.click();
    window.URL.revokeObjectURL(url);
    showNotification(t('logs.download_success'), 'success');
  };

  const loadErrorLogs = async () => {
    if (connectionStatus !== 'connected') {
      setLoadingErrors(false);
      return;
    }

    setLoadingErrors(true);
    setErrorLogsError('');
    try {
      const res = await logsApi.fetchErrorLogs();
      // API 返回 { files: [...] }
      setErrorLogs(Array.isArray(res.files) ? res.files : []);
    } catch (err: unknown) {
      console.error('Failed to load error logs:', err);
      setErrorLogs([]);
      const message = getErrorMessage(err);
      setErrorLogsError(
        message ? `${t('logs.error_logs_load_error')}: ${message}` : t('logs.error_logs_load_error')
      );
    } finally {
      setLoadingErrors(false);
    }
  };

  const downloadErrorLog = async (name: string) => {
    try {
      const response = await logsApi.downloadErrorLog(name);
      const blob = new Blob([response.data], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('logs.error_log_download_success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    }
  };

  const loadTraceUsageDetails = useCallback(async () => {
    if (traceLoading) return;

    const now = Date.now();
    const usageFresh =
      traceUsageLoadedAtRef.current > 0 && now - traceUsageLoadedAtRef.current < TRACE_USAGE_CACHE_MS;
    const authFresh =
      traceAuthLoadedAtRef.current > 0 && now - traceAuthLoadedAtRef.current < TRACE_USAGE_CACHE_MS;
    if (usageFresh && authFresh) return;

    setTraceLoading(true);
    setTraceError('');
    try {
      const [usageResponse, authFilesResponse] = await Promise.all([
        usageFresh ? Promise.resolve(null) : usageApi.getUsage(),
        authFresh ? Promise.resolve(null) : authFilesApi.list().catch(() => null)
      ]);

      if (usageResponse !== null) {
        const usageData = usageResponse?.usage ?? usageResponse;
        const details = collectUsageDetailsWithEndpoint(usageData);
        setTraceUsageDetails(details);
        traceUsageLoadedAtRef.current = now;
      }

      if (authFilesResponse !== null) {
        const files = Array.isArray(authFilesResponse)
          ? authFilesResponse
          : (authFilesResponse as { files?: AuthFileItem[] })?.files;
        if (Array.isArray(files)) {
          const map = new Map<string, TraceCredentialInfo>();
          files.forEach((file) => {
            const key = normalizeTraceAuthIndex(file['auth_index'] ?? file.authIndex);
            if (!key) return;
            map.set(key, {
              name: file.name || key,
              type: (file.type || file.provider || '').toString()
            });
          });
          setTraceAuthFileMap(map);
          traceAuthLoadedAtRef.current = now;
        }
      }
    } catch (err: unknown) {
      setTraceError(getErrorMessage(err) || t('logs.trace_usage_load_error'));
    } finally {
      setTraceLoading(false);
    }
  }, [t, traceLoading]);

  useEffect(() => {
    if (connectionStatus === 'connected') {
      latestTimestampRef.current = 0;
      loadLogs(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionStatus]);

  useEffect(() => {
    if (activeTab !== 'errors') return;
    if (connectionStatus !== 'connected') return;
    void loadErrorLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, connectionStatus, requestLogEnabled]);

  useEffect(() => {
    if (!autoRefresh || connectionStatus !== 'connected') {
      return;
    }
    const id = window.setInterval(() => {
      loadLogs(true);
    }, 8000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, connectionStatus]);

  useEffect(() => {
    if (!pendingScrollToBottomRef.current) return;
    if (loading) return;
    if (!logViewerRef.current) return;

    scrollToBottom();
    pendingScrollToBottomRef.current = false;
  }, [loading, logState.buffer, logState.visibleFrom]);

  const visibleLines = useMemo(
    () => logState.buffer.slice(logState.visibleFrom),
    [logState.buffer, logState.visibleFrom]
  );

  const trimmedSearchQuery = deferredSearchQuery.trim();
  const isSearching = trimmedSearchQuery.length > 0;
  const baseLines = isSearching ? logState.buffer : visibleLines;

  const methodFilterSet = useMemo(() => new Set(methodFilters), [methodFilters]);
  const statusFilterSet = useMemo(() => new Set(statusFilters), [statusFilters]);
  const pathFilterSet = useMemo(() => new Set(pathFilters), [pathFilters]);
  const hasStructuredFilters = methodFilters.length > 0 || statusFilters.length > 0 || pathFilters.length > 0;

  const {
    parsedSearchLines,
    filteredParsedLines,
    filteredLines,
    removedCount,
  } = useMemo(() => {
    let working = baseLines;

    if (hideManagementLogs) {
      working = working.filter((line) => !line.includes(MANAGEMENT_API_PREFIX));
    }

    if (trimmedSearchQuery) {
      const queryLowered = trimmedSearchQuery.toLowerCase();
      working = working.filter((line) => line.toLowerCase().includes(queryLowered));
    }

    const parsed = working.map((line) => parseLogLine(line));
    const filteredParsed = parsed.filter((line) => {
      if (methodFilterSet.size > 0 && (!line.method || !methodFilterSet.has(line.method))) {
        return false;
      }

      const statusGroup = resolveStatusGroup(line.statusCode);
      if (statusFilterSet.size > 0 && (!statusGroup || !statusFilterSet.has(statusGroup))) {
        return false;
      }

      if (pathFilterSet.size > 0 && (!line.path || !pathFilterSet.has(line.path))) {
        return false;
      }

      return true;
    });

    return {
      parsedSearchLines: parsed,
      filteredParsedLines: filteredParsed,
      filteredLines: filteredParsed.map((line) => line.raw),
      removedCount: Math.max(baseLines.length - filteredParsed.length, 0)
    };
  }, [
    baseLines,
    hideManagementLogs,
    methodFilterSet,
    pathFilterSet,
    statusFilterSet,
    trimmedSearchQuery
  ]);

  const parsedVisibleLines = useMemo(
    () => (showRawLogs ? [] : filteredParsedLines),
    [filteredParsedLines, showRawLogs]
  );

  const rawVisibleText = useMemo(() => filteredLines.join('\n'), [filteredLines]);
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
    (sourceRaw: string, authIndex: unknown): TraceSourceInfo => {
      const source = sourceRaw.trim();
      const matchedSource = traceSourceInfoMap.get(source);
      if (matchedSource) {
        return matchedSource;
      }

      const authIndexKey = normalizeTraceAuthIndex(authIndex);
      if (authIndexKey) {
        const authInfo = traceAuthFileMap.get(authIndexKey);
        if (authInfo) {
          return {
            displayName: authInfo.name || authIndexKey,
            type: authInfo.type
          };
        }
      }

      return {
        displayName: source.startsWith('t:') ? source.slice(2) : source || '-',
        type: ''
      };
    },
    [traceAuthFileMap, traceSourceInfoMap]
  );

  const canLoadMore = !isSearching && logState.visibleFrom > 0;

  const methodCounts = useMemo(() => {
    const counts: Partial<Record<HttpMethod, number>> = {};
    parsedSearchLines.forEach((line) => {
      if (!line.method) return;
      counts[line.method] = (counts[line.method] ?? 0) + 1;
    });
    return counts;
  }, [parsedSearchLines]);

  const statusCounts = useMemo(() => {
    const counts: Partial<Record<StatusGroup, number>> = {};
    parsedSearchLines.forEach((line) => {
      const statusGroup = resolveStatusGroup(line.statusCode);
      if (!statusGroup) return;
      counts[statusGroup] = (counts[statusGroup] ?? 0) + 1;
    });
    return counts;
  }, [parsedSearchLines]);

  const pathOptions = useMemo(() => {
    const counts = new Map<string, number>();
    parsedSearchLines.forEach((line) => {
      if (!line.path) return;
      counts.set(line.path, (counts.get(line.path) ?? 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, PATH_FILTER_LIMIT)
      .map(([path, count]) => ({ path, count }));
  }, [parsedSearchLines]);

  useEffect(() => {
    if (pathFilters.length === 0) return;
    const validPathSet = new Set(pathOptions.map((item) => item.path));
    setPathFilters((prev) => {
      const next = prev.filter((path) => validPathSet.has(path));
      return next.length === prev.length ? prev : next;
    });
  }, [pathFilters, pathOptions]);

  const toggleMethodFilter = (method: HttpMethod) => {
    setMethodFilters((prev) =>
      prev.includes(method) ? prev.filter((item) => item !== method) : [...prev, method]
    );
  };

  const toggleStatusFilter = (statusGroup: StatusGroup) => {
    setStatusFilters((prev) =>
      prev.includes(statusGroup) ? prev.filter((item) => item !== statusGroup) : [...prev, statusGroup]
    );
  };

  const togglePathFilter = (path: string) => {
    setPathFilters((prev) =>
      prev.includes(path) ? prev.filter((item) => item !== path) : [...prev, path]
    );
  };

  const clearStructuredFilters = () => {
    setMethodFilters([]);
    setStatusFilters([]);
    setPathFilters([]);
  };

  const prependVisibleLines = useCallback(() => {
    const node = logViewerRef.current;
    if (!node) return;
    if (pendingPrependScrollRef.current) return;
    if (isSearching) return;

    setLogState((prev) => {
      if (prev.visibleFrom <= 0) {
        return prev;
      }

      pendingPrependScrollRef.current = {
        scrollHeight: node.scrollHeight,
        scrollTop: node.scrollTop,
      };

      return {
        ...prev,
        visibleFrom: Math.max(prev.visibleFrom - LOAD_MORE_LINES, 0),
      };
    });
  }, [isSearching]);

  const handleLogScroll = () => {
    const node = logViewerRef.current;
    if (!node) return;
    if (isSearching) return;
    if (!canLoadMore) return;
    if (pendingPrependScrollRef.current) return;
    if (node.scrollTop > LOAD_MORE_THRESHOLD_PX) return;

    prependVisibleLines();
  };

  useLayoutEffect(() => {
    const node = logViewerRef.current;
    const pending = pendingPrependScrollRef.current;
    if (!node || !pending) return;

    const delta = node.scrollHeight - pending.scrollHeight;
    node.scrollTop = pending.scrollTop + delta;
    pendingPrependScrollRef.current = null;
  }, [logState.visibleFrom]);

  const tryAutoLoadMoreUntilScrollable = useCallback(() => {
    const node = logViewerRef.current;
    if (!node) return;
    if (!canLoadMore) return;
    if (isSearching) return;
    if (pendingPrependScrollRef.current) return;

    const hasVerticalOverflow = node.scrollHeight > node.clientHeight + 1;
    if (hasVerticalOverflow) return;

    prependVisibleLines();
  }, [canLoadMore, isSearching, prependVisibleLines]);

  useEffect(() => {
    if (loading) return;
    if (activeTab !== 'logs') return;

    const raf = window.requestAnimationFrame(() => {
      tryAutoLoadMoreUntilScrollable();
    });
    return () => {
      window.cancelAnimationFrame(raf);
    };
  }, [
    activeTab,
    loading,
    tryAutoLoadMoreUntilScrollable,
    filteredLines.length,
    showRawLogs,
    logState.visibleFrom,
  ]);

  useEffect(() => {
    if (activeTab !== 'logs') return;

    const onResize = () => {
      window.requestAnimationFrame(() => {
        tryAutoLoadMoreUntilScrollable();
      });
    };

    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
    };
  }, [activeTab, tryAutoLoadMoreUntilScrollable]);

  const copyLogLine = async (raw: string) => {
    const ok = await copyToClipboard(raw);
    if (ok) {
      showNotification(t('logs.copy_success', { defaultValue: 'Copied to clipboard' }), 'success');
    } else {
      showNotification(t('logs.copy_failed', { defaultValue: 'Copy failed' }), 'error');
    }
  };

  const clearLongPressTimer = () => {
    if (longPressRef.current?.timer) {
      window.clearTimeout(longPressRef.current.timer);
      longPressRef.current.timer = null;
    }
  };

  const startLongPress = (event: ReactPointerEvent<HTMLDivElement>, id?: string) => {
    if (!requestLogEnabled) return;
    if (!id) return;
    if (requestLogId) return;
    clearLongPressTimer();
    longPressRef.current = {
      timer: window.setTimeout(() => {
        setRequestLogId(id);
        if (longPressRef.current) {
          longPressRef.current.fired = true;
          longPressRef.current.timer = null;
        }
      }, LONG_PRESS_MS),
      startX: event.clientX,
      startY: event.clientY,
      fired: false,
    };
  };

  const cancelLongPress = () => {
    clearLongPressTimer();
    longPressRef.current = null;
  };

  const handleLongPressMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const current = longPressRef.current;
    if (!current || current.timer === null || current.fired) return;
    const deltaX = Math.abs(event.clientX - current.startX);
    const deltaY = Math.abs(event.clientY - current.startY);
    if (deltaX > LONG_PRESS_MOVE_THRESHOLD || deltaY > LONG_PRESS_MOVE_THRESHOLD) {
      cancelLongPress();
    }
  };

  const openTraceModal = (line: ParsedLogLine) => {
    if (!isTraceableRequestPath(line.path)) return;
    cancelLongPress();
    setTraceLogLine(line);
    void loadTraceUsageDetails();
  };

  const closeTraceModal = () => {
    if (requestLogDownloading) return;
    setTraceLogLine(null);
  };

  const closeRequestLogModal = () => {
    if (requestLogDownloading) return;
    setRequestLogId(null);
  };

  const downloadRequestLog = async (id: string) => {
    setRequestLogDownloading(true);
    try {
      const response = await logsApi.downloadRequestLogById(id);
      const blob = new Blob([response.data], { type: 'text/plain' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `request-${id}.log`;
      a.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('logs.request_log_download_success'), 'success');
      setRequestLogId(null);
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setRequestLogDownloading(false);
    }
  };

  useEffect(() => {
    return () => {
      if (longPressRef.current?.timer) {
        window.clearTimeout(longPressRef.current.timer);
        longPressRef.current.timer = null;
      }
    };
  }, []);

  return (
    <div className={styles.container}>
      <h1 className={styles.pageTitle}>{t('logs.title')}</h1>

      <div className={styles.tabBar}>
        <button
          type="button"
          className={`${styles.tabItem} ${activeTab === 'logs' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('logs')}
        >
          {t('logs.log_content')}
        </button>
        <button
          type="button"
          className={`${styles.tabItem} ${activeTab === 'errors' ? styles.tabActive : ''}`}
          onClick={() => setActiveTab('errors')}
        >
          {t('logs.error_logs_modal_title')}
        </button>
      </div>

      <div className={styles.content}>
        {activeTab === 'logs' && (
          <Card className={styles.logCard}>
            {error && <div className="error-box">{error}</div>}

            <div className={styles.filters}>
              <div className={styles.searchWrapper}>
                <Input
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t('logs.search_placeholder')}
                  className={styles.searchInput}
                  rightElement={
                    searchQuery ? (
                      <button
                        type="button"
                        className={styles.searchClear}
                        onClick={() => setSearchQuery('')}
                        title="Clear"
                        aria-label="Clear"
                      >
                        <IconX size={16} />
                      </button>
                    ) : (
                      <IconSearch size={16} className={styles.searchIcon} />
                    )
                  }
                />
              </div>

              <div className={styles.structuredFilters}>
                <div className={styles.filterChipGroup}>
                  <span className={styles.filterChipLabel}>{t('logs.filter_method')}</span>
                  <div className={styles.filterChipList}>
                    {HTTP_METHODS.map((method) => {
                      const active = methodFilters.includes(method);
                      const count = methodCounts[method] ?? 0;
                      return (
                        <button
                          key={method}
                          type="button"
                          className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                          onClick={() => toggleMethodFilter(method)}
                          disabled={count === 0 && !active}
                          aria-pressed={active}
                        >
                          {method} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.filterChipGroup}>
                  <span className={styles.filterChipLabel}>{t('logs.filter_status')}</span>
                  <div className={styles.filterChipList}>
                    {STATUS_GROUPS.map((statusGroup) => {
                      const active = statusFilters.includes(statusGroup);
                      const count = statusCounts[statusGroup] ?? 0;
                      return (
                        <button
                          key={statusGroup}
                          type="button"
                          className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                          onClick={() => toggleStatusFilter(statusGroup)}
                          disabled={count === 0 && !active}
                          aria-pressed={active}
                        >
                          {t(`logs.filter_status_${statusGroup}`)} ({count})
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className={styles.filterChipGroup}>
                  <span className={styles.filterChipLabel}>{t('logs.filter_path')}</span>
                  <div className={styles.filterChipList}>
                    {pathOptions.length === 0 ? (
                      <span className={styles.filterChipHint}>{t('logs.filter_path_empty')}</span>
                    ) : (
                      pathOptions.map(({ path, count }) => {
                        const active = pathFilters.includes(path);
                        return (
                          <button
                            key={path}
                            type="button"
                            className={`${styles.filterChip} ${active ? styles.filterChipActive : ''}`}
                            onClick={() => togglePathFilter(path)}
                            aria-pressed={active}
                            title={path}
                          >
                            {path} ({count})
                          </button>
                        );
                      })
                    )}
                  </div>
                </div>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearStructuredFilters}
                  disabled={!hasStructuredFilters}
                >
                  {t('logs.clear_filters')}
                </Button>
              </div>

              <ToggleSwitch
                checked={hideManagementLogs}
                onChange={setHideManagementLogs}
                label={
                  <span className={styles.switchLabel}>
                    <IconEyeOff size={16} />
                    {t('logs.hide_management_logs', { prefix: MANAGEMENT_API_PREFIX })}
                  </span>
                }
              />

              <ToggleSwitch
                checked={showRawLogs}
                onChange={setShowRawLogs}
                label={
                  <span
                    className={styles.switchLabel}
                    title={t('logs.show_raw_logs_hint', {
                      defaultValue: 'Show original log text for easier multi-line copy',
                    })}
                  >
                    <IconCode size={16} />
                    {t('logs.show_raw_logs', { defaultValue: 'Show raw logs' })}
                  </span>
                }
              />

              <div className={styles.toolbar}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => loadLogs(false)}
                  disabled={disableControls || loading}
                  className={styles.actionButton}
                >
                  <span className={styles.buttonContent}>
                    <IconRefreshCw size={16} />
                    {t('logs.refresh_button')}
                  </span>
                </Button>
                <ToggleSwitch
                  checked={autoRefresh}
                  onChange={(value) => setAutoRefresh(value)}
                  disabled={disableControls}
                  label={
                    <span className={styles.switchLabel}>
                      <IconTimer size={16} />
                      {t('logs.auto_refresh')}
                    </span>
                  }
                />
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={downloadLogs}
                  disabled={logState.buffer.length === 0}
                  className={styles.actionButton}
                >
                  <span className={styles.buttonContent}>
                    <IconDownload size={16} />
                    {t('logs.download_button')}
                  </span>
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={clearLogs}
                  disabled={disableControls}
                  className={styles.actionButton}
                >
                  <span className={styles.buttonContent}>
                    <IconTrash2 size={16} />
                    {t('logs.clear_button')}
                  </span>
                </Button>
              </div>
            </div>

            {loading ? (
              <div className="hint">{t('logs.loading')}</div>
            ) : logState.buffer.length > 0 && filteredLines.length > 0 ? (
              <div ref={logViewerRef} className={styles.logPanel} onScroll={handleLogScroll}>
                {canLoadMore && (
                  <div className={styles.loadMoreBanner}>
                    <span>{t('logs.load_more_hint')}</span>
                    <div className={styles.loadMoreStats}>
                      <span>
                        {t('logs.loaded_lines', { count: filteredLines.length })}
                      </span>
                      {removedCount > 0 && (
                        <span className={styles.loadMoreCount}>
                          {t('logs.filtered_lines', { count: removedCount })}
                        </span>
                      )}
                      <span className={styles.loadMoreCount}>
                        {t('logs.hidden_lines', { count: logState.visibleFrom })}
                      </span>
                    </div>
                  </div>
                )}
                {showRawLogs ? (
                  <pre className={styles.rawLog} spellCheck={false}>
                    {rawVisibleText}
                  </pre>
                ) : (
                  <div className={styles.logList}>
                    {parsedVisibleLines.map((line, index) => {
                      const canTraceRequest = isTraceableRequestPath(line.path);
                      const rowClassNames = [styles.logRow];
                      if (line.level === 'warn') rowClassNames.push(styles.rowWarn);
                      if (line.level === 'error' || line.level === 'fatal')
                        rowClassNames.push(styles.rowError);
                      return (
                        <div
                          key={`${logState.visibleFrom + index}-${line.raw}`}
                          className={rowClassNames.join(' ')}
                          onDoubleClick={() => {
                            void copyLogLine(line.raw);
                          }}
                          onPointerDown={(event) => startLongPress(event, line.requestId)}
                          onPointerUp={cancelLongPress}
                          onPointerLeave={cancelLongPress}
                          onPointerCancel={cancelLongPress}
                          onPointerMove={handleLongPressMove}
                          title={t('logs.double_click_copy_hint', {
                            defaultValue: 'Double-click to copy',
                          })}
                        >
                          <div className={styles.timestamp}>{line.timestamp || ''}</div>
                          <div className={styles.rowMain}>
                            {line.level && (
                              <span
                                className={[
                                  styles.badge,
                                  line.level === 'info' ? styles.levelInfo : '',
                                  line.level === 'warn' ? styles.levelWarn : '',
                                  line.level === 'error' || line.level === 'fatal'
                                    ? styles.levelError
                                    : '',
                                  line.level === 'debug' ? styles.levelDebug : '',
                                  line.level === 'trace' ? styles.levelTrace : '',
                                ]
                                  .filter(Boolean)
                                  .join(' ')}
                              >
                                {line.level.toUpperCase()}
                              </span>
                            )}

                            {line.source && (
                              <span className={styles.source} title={line.source}>
                                {line.source}
                              </span>
                            )}

                            {line.requestId && (
                              <span
                                className={[styles.badge, styles.requestIdBadge].join(' ')}
                                title={line.requestId}
                              >
                                {line.requestId}
                              </span>
                            )}

                            {typeof line.statusCode === 'number' && (
                              <span
                                className={[
                                  styles.badge,
                                  styles.statusBadge,
                                  line.statusCode >= 200 && line.statusCode < 300
                                    ? styles.statusSuccess
                                    : line.statusCode >= 300 && line.statusCode < 400
                                      ? styles.statusInfo
                                      : line.statusCode >= 400 && line.statusCode < 500
                                        ? styles.statusWarn
                                        : styles.statusError,
                                ].join(' ')}
                              >
                                {line.statusCode}
                              </span>
                            )}

                            {line.latency && <span className={styles.pill}>{line.latency}</span>}
                            {line.ip && <span className={styles.pill}>{line.ip}</span>}

                            {line.method && (
                              <span className={[styles.badge, styles.methodBadge].join(' ')}>
                                {line.method}
                              </span>
                            )}

                            {line.path && (
                              <span className={styles.path} title={line.path}>
                                {line.path}
                              </span>
                            )}

                            {line.message && <span className={styles.message}>{line.message}</span>}

                            {canTraceRequest && (
                              <button
                                type="button"
                                className={styles.traceButton}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  openTraceModal(line);
                                }}
                                title={t('logs.trace_button')}
                              >
                                {t('logs.trace_button')}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : logState.buffer.length > 0 ? (
              <EmptyState
                title={t('logs.search_empty_title')}
                description={t('logs.search_empty_desc')}
              />
            ) : (
              <EmptyState title={t('logs.empty_title')} description={t('logs.empty_desc')} />
            )}
          </Card>
        )}

        {activeTab === 'errors' && (
          <Card
            extra={
              <Button
                variant="secondary"
                size="sm"
                onClick={loadErrorLogs}
                loading={loadingErrors}
                disabled={disableControls}
              >
                {t('common.refresh')}
              </Button>
            }
          >
            <div className="stack">
              <div className="hint">{t('logs.error_logs_description')}</div>

              {requestLogEnabled && (
                <div>
                  <div className="status-badge warning">{t('logs.error_logs_request_log_enabled')}</div>
                </div>
              )}

              {errorLogsError && <div className="error-box">{errorLogsError}</div>}

              <div className={styles.errorPanel}>
                {loadingErrors ? (
                  <div className="hint">{t('common.loading')}</div>
                ) : errorLogs.length === 0 ? (
                  <div className="hint">{t('logs.error_logs_empty')}</div>
                ) : (
                  <div className="item-list">
                    {errorLogs.map((item) => (
                      <div key={item.name} className="item-row">
                        <div className="item-meta">
                          <div className="item-title">{item.name}</div>
                          <div className="item-subtitle">
                            {item.size ? `${(item.size / 1024).toFixed(1)} KB` : ''}{' '}
                            {item.modified ? formatUnixTimestamp(item.modified) : ''}
                          </div>
                        </div>
                        <div className="item-actions">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => downloadErrorLog(item.name)}
                            disabled={disableControls}
                          >
                            {t('logs.error_logs_download')}
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      <Modal
        open={Boolean(traceLogLine)}
        onClose={closeTraceModal}
        title={t('logs.trace_title')}
        footer={
          <>
            {traceLogLine?.requestId && (
              <Button
                variant="secondary"
                onClick={() => {
                  if (traceLogLine.requestId) {
                    void downloadRequestLog(traceLogLine.requestId);
                  }
                }}
                loading={requestLogDownloading}
              >
                {t('logs.trace_download_request_log')}
              </Button>
            )}
            <Button variant="secondary" onClick={closeTraceModal} disabled={requestLogDownloading}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        {traceLogLine && (
          <div className={styles.tracePanel}>
            <div className={styles.traceNotice}>{t('logs.trace_notice')}</div>

            <h3 className={styles.traceSectionTitle}>{t('logs.trace_log_info')}</h3>
            <div className={styles.traceInfoGrid}>
              <div className={styles.traceInfoItem}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_request_id')}</span>
                <span className={styles.traceInfoValue}>{traceLogLine.requestId || '-'}</span>
              </div>
              <div className={styles.traceInfoItem}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_method')}</span>
                <span className={styles.traceInfoValue}>{traceLogLine.method || '-'}</span>
              </div>
              <div className={styles.traceInfoItem}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_path')}</span>
                <span className={styles.traceInfoValue}>{traceLogLine.path || '-'}</span>
              </div>
              <div className={styles.traceInfoItem}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_status_code')}</span>
                <span className={styles.traceInfoValue}>
                  {typeof traceLogLine.statusCode === 'number' ? traceLogLine.statusCode : '-'}
                </span>
              </div>
              <div className={styles.traceInfoItem}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_latency')}</span>
                <span className={styles.traceInfoValue}>{traceLogLine.latency || '-'}</span>
              </div>
              <div className={styles.traceInfoItem}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_ip')}</span>
                <span className={styles.traceInfoValue}>{traceLogLine.ip || '-'}</span>
              </div>
              <div className={styles.traceInfoItem}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_timestamp')}</span>
                <span className={styles.traceInfoValue}>{traceLogLine.timestamp || '-'}</span>
              </div>
              <div className={`${styles.traceInfoItem} ${styles.traceInfoItemWide}`}>
                <span className={styles.traceInfoLabel}>{t('logs.trace_message')}</span>
                <span className={styles.traceInfoValue}>{traceLogLine.message || '-'}</span>
              </div>
            </div>

            <h3 className={styles.traceSectionTitle}>{t('logs.trace_candidates_title')}</h3>
            {traceLoading ? (
              <div className="hint">{t('logs.trace_loading')}</div>
            ) : traceError ? (
              <div className="error-box">{traceError}</div>
            ) : traceCandidates.length === 0 ? (
              <div className="hint">{t('logs.trace_no_match')}</div>
            ) : (
              <div className={styles.traceCandidates}>
                {traceCandidates.map((candidate) => {
                  const confidenceClass =
                    candidate.confidence === 'high'
                      ? styles.traceConfidenceHigh
                      : candidate.confidence === 'medium'
                        ? styles.traceConfidenceMedium
                        : styles.traceConfidenceLow;
                  const sourceInfo = resolveTraceSourceInfo(
                    String(candidate.detail.source ?? ''),
                    candidate.detail.auth_index
                  );
                  return (
                    <div
                      key={`${candidate.detail.__endpoint}-${candidate.detail.__modelName}-${candidate.detail.timestamp}-${candidate.detail.source}`}
                      className={styles.traceCandidate}
                    >
                      <div className={styles.traceCandidateHeader}>
                        <span className={`${styles.traceConfidenceBadge} ${confidenceClass}`}>
                          {t(`logs.trace_confidence_${candidate.confidence}`)}
                        </span>
                        <span className={styles.traceScore}>
                          {t('logs.trace_score', { score: candidate.score })}
                        </span>
                        {candidate.timeDeltaMs !== null && (
                          <span className={styles.traceDelta}>
                            {t('logs.trace_delta_seconds', {
                              seconds: (candidate.timeDeltaMs / 1000).toFixed(2)
                            })}
                          </span>
                        )}
                      </div>
                      <div className={styles.traceCandidateGrid}>
                        <div className={styles.traceInfoItem}>
                          <span className={styles.traceInfoLabel}>{t('logs.trace_endpoint')}</span>
                          <span className={styles.traceInfoValue}>{candidate.detail.__endpoint}</span>
                        </div>
                        <div className={styles.traceInfoItem}>
                          <span className={styles.traceInfoLabel}>{t('logs.trace_model')}</span>
                          <span className={styles.traceInfoValue}>{candidate.detail.__modelName || '-'}</span>
                        </div>
                        <div className={styles.traceInfoItem}>
                          <span className={styles.traceInfoLabel}>{t('logs.trace_source')}</span>
                          <span
                            className={styles.traceInfoValue}
                            title={String(candidate.detail.source || '-')}
                          >
                            <span>{sourceInfo.displayName}</span>
                            {sourceInfo.type && (
                              <span className={styles.traceSourceType}>{sourceInfo.type}</span>
                            )}
                          </span>
                        </div>
                        <div className={styles.traceInfoItem}>
                          <span className={styles.traceInfoLabel}>{t('logs.trace_auth_index')}</span>
                          <span className={styles.traceInfoValue}>
                            {candidate.detail.auth_index ?? '-'}
                          </span>
                        </div>
                        <div className={styles.traceInfoItem}>
                          <span className={styles.traceInfoLabel}>{t('logs.trace_timestamp')}</span>
                          <span className={styles.traceInfoValue}>
                            {candidate.detail.timestamp || '-'}
                          </span>
                        </div>
                        <div className={styles.traceInfoItem}>
                          <span className={styles.traceInfoLabel}>{t('logs.trace_result')}</span>
                          <span className={styles.traceInfoValue}>
                            {candidate.detail.failed ? t('stats.failure') : t('stats.success')}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(requestLogId)}
        onClose={closeRequestLogModal}
        title={t('logs.request_log_download_title')}
        footer={
          <>
            <Button variant="secondary" onClick={closeRequestLogModal} disabled={requestLogDownloading}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                if (requestLogId) {
                  void downloadRequestLog(requestLogId);
                }
              }}
              loading={requestLogDownloading}
              disabled={!requestLogId}
            >
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        {requestLogId ? t('logs.request_log_download_confirm', { id: requestLogId }) : null}
      </Modal>
    </div>
  );
}
