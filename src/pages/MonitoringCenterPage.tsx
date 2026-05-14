import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/DropdownMenu';
import {
  IconChevronDown,
  IconChevronRight,
  IconChevronUp,
  IconChartLine,
  IconCrosshair,
  IconDownload,
  IconExternalLink,
  IconFileText,
  IconInfo,
  IconInbox,
  IconMoreVertical,
  IconRefreshCw,
  IconSearch,
  IconSettings,
  IconSlidersHorizontal,
  IconTimer,
  IconTrendingUp,
} from '@/components/ui/icons';
import {
  buildAccountRows,
  buildMonitoringSummary,
  buildRealtimeMonitorRows,
  getRangeBounds,
  type MonitoringAccountRow,
  type MonitoringCustomTimeRange,
  type MonitoringEventRow,
  type MonitoringStatusTone,
  type MonitoringTimeRange,
  useMonitoringData,
} from '@/features/monitoring/hooks/useMonitoringData';
import {
  ACCOUNT_OVERVIEW_CARD_PAGE_SIZE_OPTIONS,
  ACCOUNT_OVERVIEW_TABLE_PAGE_SIZE_OPTIONS,
  buildEmptyMonitoringStatusData,
  buildMonitoringAccountAuthStateMap,
  buildMonitoringAccountStatusDataMap,
  normalizeAccountOverviewPageSize,
  resolveMonitoringStatusRangeBounds,
  shouldClampAccountOverviewPage,
  shouldResetAccountOverviewPage,
  sortAccountRows,
  readAccountOverviewUiState,
  writeAccountOverviewUiState,
  type AccountOverviewPageResetState,
  type AccountSortKey,
  type MonitoringAccountAuthState,
  type AccountSortState,
  type MonitoringAccountOverviewMode,
} from '@/features/monitoring/accountOverviewState';
import { sortAccountOverviewCardMetrics } from '@/features/monitoring/accountOverviewCardMetrics';
import {
  buildMonitoringAccountQuotaTargetsByAccount,
  type MonitoringAccountQuotaTarget,
} from '@/features/monitoring/accountOverviewQuotaTargets';
import {
  buildMonitoringStatusBlockAriaLabel,
  getNextMonitoringStatusBlockIndex,
} from '@/features/monitoring/healthStatusAccessibility';
import { MonitoringPanel } from '@/features/monitoring/components/MonitoringPanel';
import { useUsageData } from '@/features/monitoring/hooks/useUsageData';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useInterval } from '@/hooks/useInterval';
import { useRequestMonitoringAvailability } from '@/hooks/useRequestMonitoringAvailability';
import { authFilesApi, requestCodexUsagePayload } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { AuthFileItem, CodexUsagePayload } from '@/types';
import { formatFileSize, maskSensitiveText } from '@/utils/format';
import type { StatusBarData, StatusBlockDetail } from '@/utils/recentRequests';
import { buildCodexQuotaWindowInfos, normalizePlanType } from '@/utils/quota';
import {
  formatCompactNumber,
  formatDurationMs,
  formatUsd,
  normalizeAuthIndex,
  type ModelPrice,
} from '@/utils/usage';
import { downloadBlob } from '@/utils/download';
import { sha256Hex } from '@/utils/apiKeyHash';
import styles from './MonitoringCenterPage.module.scss';

const TIME_RANGE_OPTIONS: Array<{ value: MonitoringTimeRange; labelKey: string }> = [
  { value: 'today', labelKey: 'monitoring.range_today' },
  { value: '7d', labelKey: 'monitoring.range_7d' },
  { value: '14d', labelKey: 'monitoring.range_14d' },
  { value: '30d', labelKey: 'monitoring.range_30d' },
  { value: 'all', labelKey: 'monitoring.range_all' },
  { value: 'custom', labelKey: 'monitoring.range_custom' },
];

const AUTO_REFRESH_OPTIONS = [
  { value: '0', labelKey: 'monitoring.auto_refresh_off' },
  { value: '5000', labelKey: 'monitoring.auto_refresh_5s' },
  { value: '10000', labelKey: 'monitoring.auto_refresh_10s' },
  { value: '30000', labelKey: 'monitoring.auto_refresh_30s' },
  { value: '60000', labelKey: 'monitoring.auto_refresh_60s' },
  { value: '300000', labelKey: 'monitoring.auto_refresh_5m' },
];

const REALTIME_PAGE_SIZE_OPTIONS = [10, 50, 100, 150, 300] as const;
const DEFAULT_ACCOUNT_PAGE_SIZE = ACCOUNT_OVERVIEW_TABLE_PAGE_SIZE_OPTIONS[0];
const DEFAULT_REALTIME_PAGE_SIZE = 10;
const MAX_USAGE_IMPORT_FILE_SIZE = 64 * 1024 * 1024;
const EMPTY_STATUS_BAR_DATA: StatusBarData = {
  blocks: [],
  blockDetails: [],
  successRate: 100,
  totalSuccess: 0,
  totalFailure: 0,
};

const padDateUnit = (value: number) => String(value).padStart(2, '0');

const formatDateTimeLocalValue = (date: Date) =>
  `${date.getFullYear()}-${padDateUnit(date.getMonth() + 1)}-${padDateUnit(date.getDate())}T${padDateUnit(date.getHours())}:${padDateUnit(date.getMinutes())}`;

const getTodayStartInputValue = () => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return formatDateTimeLocalValue(date);
};

const getCurrentInputValue = () => formatDateTimeLocalValue(new Date());

const parseDateTimeLocalValue = (value: string) => {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
};

type StatusFilter = 'all' | 'success' | 'failed';

type SummaryCardProps = {
  label: string;
  value: string;
  meta: string;
  tone?: MonitoringStatusTone;
  variant?: 'primary' | 'secondary';
};

type FocusSnapshot = {
  searchInput: string;
  selectedAccount: string;
  selectedProvider: string;
  selectedModel: string;
  selectedChannel: string;
  selectedApiKeyHash: string;
  selectedStatus: StatusFilter;
};

type PriceDraft = {
  prompt: string;
  completion: string;
  cache: string;
};

type RealtimeLogRow = MonitoringEventRow & {
  requestCount: number;
  successRate: number;
  streamKey: string;
  recentPattern: boolean[];
};

type AccountQuotaWindow = {
  id: string;
  label: string;
  remainingPercent: number | null;
  resetLabel: string;
  usageLabel: string | null;
};

type AccountQuotaEntry = {
  key: string;
  authLabel: string;
  fileName: string;
  planType: string | null;
  windows: AccountQuotaWindow[];
  error?: string;
};

type AccountQuotaState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  targetKey: string;
  entries: AccountQuotaEntry[];
  error?: string;
  lastRefreshedAt?: number;
};

type AccountOverviewColumn = {
  key: string;
  label: string;
  sortKey?: AccountSortKey;
};

type AccountSummaryMetric = {
  key: string;
  label: string;
  value: string;
  valueClassName?: string;
};

type PaginationState<T> = {
  currentPage: number;
  totalPages: number;
  pageItems: T[];
  startItem: number;
  endItem: number;
};

type PaginationControlsProps = {
  count: number;
  currentPage: number;
  totalPages: number;
  startItem: number;
  endItem: number;
  pageSize: number;
  pageSizeOptions: readonly number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  t: TFunction;
};

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

const isUsageImportFile = (file: File) => {
  const normalizedName = file.name.toLowerCase();
  const normalizedType = file.type.toLowerCase();
  return (
    /\.(json|jsonl|ndjson|txt)$/.test(normalizedName) ||
    normalizedType === 'application/json' ||
    normalizedType === 'application/x-ndjson' ||
    normalizedType === 'text/plain'
  );
};

const buildPaginationState = <T,>(
  items: readonly T[],
  page: number,
  pageSize: number
): PaginationState<T> => {
  const safePageSize = Math.max(1, pageSize);
  const totalPages = Math.max(1, Math.ceil(items.length / safePageSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * safePageSize;
  const endIndex = Math.min(startIndex + safePageSize, items.length);

  return {
    currentPage,
    totalPages,
    pageItems: items.slice(startIndex, endIndex),
    startItem: items.length > 0 ? startIndex + 1 : 0,
    endItem: endIndex,
  };
};

const parsePageSize = (value: string, fallback: number) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const joinShort = (values: string[], limit = 2) => {
  if (values.length <= limit) {
    return values.join(', ');
  }
  return `${values.slice(0, limit).join(', ')} +${values.length - limit}`;
};

const createPriceDraft = (price?: ModelPrice): PriceDraft => ({
  prompt: price ? String(price.prompt) : '',
  completion: price ? String(price.completion) : '',
  cache: price ? String(price.cache) : '',
});

const parsePriceValue = (value: string) => {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};

const formatPriceUnit = (value: number) => `$${value.toFixed(4)}/1M`;

const buildRealtimeMetaText = (row: MonitoringEventRow) => {
  const text = `${row.endpointMethod} ${row.endpointPath}`.trim();
  return maskSensitiveText(text || '-');
};

const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'pro-lite', 'pro_lite']);

const getCodexPlanLabel = (planType: string | null | undefined, t: TFunction): string | null => {
  const normalized = normalizePlanType(planType);
  if (!normalized) return null;
  if (normalized === 'pro') return t('codex_quota.plan_pro');
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
    return t('codex_quota.plan_prolite');
  }
  if (normalized === 'plus') return t('codex_quota.plan_plus');
  if (normalized === 'team') return t('codex_quota.plan_team');
  if (normalized === 'free') return t('codex_quota.plan_free');
  return planType || normalized;
};

const buildAccountSecondaryText = (row: MonitoringAccountRow) => {
  const primaryText = row.displayAccount || row.account;
  if (row.account && row.account !== primaryText) {
    return row.account;
  }

  const extraAuthLabels = row.authLabels.filter((label) => label && label !== primaryText);
  if (extraAuthLabels.length > 0) {
    return joinShort(extraAuthLabels, 2);
  }
  const extraChannels = row.channels.filter(
    (label) => label && label !== '-' && label !== primaryText
  );
  if (extraChannels.length > 0) {
    return joinShort(extraChannels, 2);
  }
  return '';
};

const buildAccountOptionLabel = (row: MonitoringAccountRow) => {
  if (!row.displayAccount || row.displayAccount === row.account) {
    return row.account;
  }
  return `${row.displayAccount} / ${row.account}`;
};

const buildAccountSummaryMetrics = (
  row: MonitoringAccountRow,
  hasPrices: boolean,
  locale: string,
  t: TFunction
): AccountSummaryMetric[] => [
  {
    key: 'total-calls',
    label: t('monitoring.total_calls'),
    value: formatCompactNumber(row.totalCalls),
  },
  {
    key: 'success-calls',
    label: t('monitoring.success_calls'),
    value: formatCompactNumber(row.successCalls),
    valueClassName: styles.goodText,
  },
  {
    key: 'failure-calls',
    label: t('monitoring.failure_calls'),
    value: formatCompactNumber(row.failureCalls),
    valueClassName: row.failureCalls > 0 ? styles.badText : undefined,
  },
  {
    key: 'total-tokens',
    label: t('monitoring.total_tokens'),
    value: formatCompactNumber(row.totalTokens),
  },
  {
    key: 'input-tokens',
    label: t('monitoring.input_tokens'),
    value: formatCompactNumber(row.inputTokens),
  },
  {
    key: 'output-tokens',
    label: t('monitoring.output_tokens'),
    value: formatCompactNumber(row.outputTokens),
  },
  {
    key: 'cached-tokens',
    label: t('monitoring.cached_tokens'),
    value: formatCompactNumber(row.cachedTokens),
  },
  {
    key: 'estimated-cost',
    label: t('monitoring.estimated_cost'),
    value: hasPrices ? formatUsd(row.totalCost) : '--',
  },
  {
    key: 'latest-request-time',
    label: t('monitoring.latest_request_time'),
    value: new Date(row.lastSeenAt).toLocaleString(locale),
  },
];

const buildAccountQuotaWindows = (payload: CodexUsagePayload, t: TFunction): AccountQuotaWindow[] =>
  buildCodexQuotaWindowInfos(payload).map((window) => {
    const clampedUsed =
      window.usedPercent === null ? null : Math.max(0, Math.min(100, window.usedPercent));
    const remainingPercent = clampedUsed === null ? null : Math.max(0, 100 - clampedUsed);
    let usageLabel: string | null = null;

    if (
      window.limitWindowSeconds !== null &&
      window.limitWindowSeconds > 0 &&
      clampedUsed !== null
    ) {
      const totalHours = window.limitWindowSeconds / 3600;
      const usedHours = (totalHours * clampedUsed) / 100;
      const formatHours = (value: number) =>
        Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
      usageLabel = t('codex_quota.window_usage', {
        used: formatHours(usedHours),
        total: formatHours(totalHours),
      });
    }

    return {
      id: window.id,
      label: t(window.labelKey, window.labelParams),
      remainingPercent,
      resetLabel: window.resetLabel,
      usageLabel,
    };
  });

const requestAccountQuota = async (
  target: MonitoringAccountQuotaTarget,
  t: TFunction
): Promise<AccountQuotaEntry> => {
  const payload = await requestCodexUsagePayload(
    {
      authIndex: target.authIndex,
      accountId: target.accountId,
    },
    { emptyMessage: t('codex_quota.empty_windows') }
  );

  return {
    key: target.key,
    authLabel: target.authLabel,
    fileName: target.fileName,
    planType: normalizePlanType(payload.plan_type ?? payload.planType) ?? target.planType,
    windows: buildAccountQuotaWindows(payload, t),
  };
};

const buildRealtimeLogRows = (rows: MonitoringEventRow[]): RealtimeLogRow[] => {
  const sortedAsc = [...rows].sort(
    (left, right) => left.timestampMs - right.timestampMs || left.id.localeCompare(right.id)
  );
  const metricsByStream = new Map<string, { total: number; success: number; pattern: boolean[] }>();

  const enriched = sortedAsc.map((row) => {
    const streamKey = [row.account, row.provider, row.model, row.channel].join('::');
    const previous = metricsByStream.get(streamKey) ?? { total: 0, success: 0, pattern: [] };
    const nextPattern = [...previous.pattern, !row.failed].slice(-10);
    const next = {
      total: previous.total + (row.statsIncluded ? 1 : 0),
      success: previous.success + (row.statsIncluded && !row.failed ? 1 : 0),
      pattern: nextPattern,
    };
    metricsByStream.set(streamKey, next);

    return {
      ...row,
      streamKey,
      requestCount: next.total,
      successRate: next.total > 0 ? next.success / next.total : 1,
      recentPattern: nextPattern,
    } satisfies RealtimeLogRow;
  });

  return enriched.sort(
    (left, right) =>
      right.timestampMs - left.timestampMs ||
      right.requestCount - left.requestCount ||
      right.id.localeCompare(left.id)
  );
};

function SummaryCard({ label, value, meta, tone, variant = 'primary' }: SummaryCardProps) {
  const cardClassName = [
    styles.summaryCard,
    variant === 'secondary' ? styles.summaryCardSecondary : styles.summaryCardPrimary,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <Card className={cardClassName}>
      <span className={styles.summaryLabel}>{label}</span>
      <strong className={`${styles.summaryValue} ${tone ? styles[`tone${tone}`] : ''}`}>
        {value}
      </strong>
      <span className={styles.summaryMeta}>{meta}</span>
    </Card>
  );
}

function PaginationControls({
  count,
  currentPage,
  totalPages,
  startItem,
  endItem,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
  t,
}: PaginationControlsProps) {
  if (count === 0) return null;

  return (
    <div className={styles.paginationBar}>
      <div className={styles.paginationInfo}>
        {t('monitoring.pagination_info', {
          current: currentPage,
          total: totalPages,
          start: startItem,
          end: endItem,
          count,
        })}
      </div>
      <div className={styles.paginationControls}>
        <div className={styles.pageSizeField}>
          <span>{t('monitoring.page_size_label')}</span>
          <Select
            className={styles.pageSizeSelect}
            triggerClassName={styles.pageSizeSelectTrigger}
            value={String(pageSize)}
            options={pageSizeOptions.map((size) => ({
              value: String(size),
              label: t('monitoring.page_size_option', { count: size }),
            }))}
            onChange={(value) => onPageSizeChange(parsePageSize(value, pageSize))}
            ariaLabel={t('monitoring.page_size_label')}
            fullWidth={false}
          />
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.max(1, currentPage - 1))}
          disabled={currentPage <= 1}
        >
          {t('monitoring.pagination_prev')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
          disabled={currentPage >= totalPages}
        >
          {t('monitoring.pagination_next')}
        </Button>
      </div>
    </div>
  );
}

function StatusBadge({ tone, children }: { tone: MonitoringStatusTone; children: ReactNode }) {
  return <span className={`${styles.statusBadge} ${styles[`tone${tone}`]}`}>{children}</span>;
}

function RecentPattern({
  pattern,
  variant = 'default',
}: {
  pattern: boolean[];
  variant?: 'default' | 'plain';
}) {
  const normalized = pattern.length > 0 ? pattern : Array.from({ length: 10 }, () => true);
  const containerClassName = [
    styles.patternBars,
    variant === 'plain' ? styles.patternBarsPlain : '',
  ]
    .filter(Boolean)
    .join(' ');
  const barClassName = [styles.patternBar, variant === 'plain' ? styles.patternBarPlain : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div className={containerClassName} aria-hidden="true">
      {normalized.map((item, index) => (
        <span
          key={`${index}-${item ? 'success' : 'failed'}`}
          className={`${barClassName} ${item ? styles.patternSuccess : styles.patternFailed}`}
        />
      ))}
    </div>
  );
}

const STATUS_BAR_COLOR_STOPS = [
  { r: 239, g: 68, b: 68 },
  { r: 250, g: 204, b: 21 },
  { r: 34, g: 197, b: 94 },
] as const;

const formatStatusRate = (rate: number) => {
  const rounded = rate.toFixed(1);
  return `${rounded.endsWith('.0') ? rounded.slice(0, -2) : rounded}%`;
};

const formatStatusWindowLabel = (startTime: number, endTime: number, locale: string) => {
  const start = new Date(startTime);
  const end = new Date(endTime);
  const sameDay = start.toDateString() === end.toDateString();
  const dateOptions: Intl.DateTimeFormatOptions = { month: 'numeric', day: 'numeric' };
  const timeOptions: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit' };
  const startDateLabel = start.toLocaleDateString(locale, dateOptions);
  const endDateLabel = end.toLocaleDateString(locale, dateOptions);
  const startTimeLabel = start.toLocaleTimeString(locale, timeOptions);
  const endTimeLabel = end.toLocaleTimeString(locale, timeOptions);

  return sameDay
    ? `${startDateLabel} ${startTimeLabel} - ${endTimeLabel}`
    : `${startDateLabel} ${startTimeLabel} - ${endDateLabel} ${endTimeLabel}`;
};

const formatAccountOverviewScopeText = (
  bounds: { startMs: number; endMs: number } | null,
  locale: string,
  t: TFunction
) => {
  if (!bounds) {
    return t('monitoring.account_overview_scope_current_filters');
  }

  const rangeLabel =
    Number.isFinite(bounds.startMs) && Number.isFinite(bounds.endMs)
      ? formatStatusWindowLabel(bounds.startMs, bounds.endMs, locale)
      : t('monitoring.range_all');

  return t('monitoring.account_overview_scope_range', { range: rangeLabel });
};

const rateToStatusColor = (rate: number) => {
  const t = Math.max(0, Math.min(1, rate));
  const segment = t < 0.5 ? 0 : 1;
  const localT = segment === 0 ? t * 2 : (t - 0.5) * 2;
  const from = STATUS_BAR_COLOR_STOPS[segment];
  const to = STATUS_BAR_COLOR_STOPS[segment + 1];
  const r = Math.round(from.r + (to.r - from.r) * localT);
  const g = Math.round(from.g + (to.g - from.g) * localT);
  const b = Math.round(from.b + (to.b - from.b) * localT);
  return `rgb(${r}, ${g}, ${b})`;
};

function MonitoringHealthStatusBar({
  statusData,
  locale,
  t,
  showRate = true,
}: {
  statusData: StatusBarData;
  locale: string;
  t: TFunction;
  showRate?: boolean;
}) {
  const [activeTooltip, setActiveTooltip] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState(() => (statusData.blockDetails.length > 0 ? 0 : -1));
  const blocksRef = useRef<HTMLDivElement | null>(null);
  const blockButtonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tooltipIdPrefix = useId();
  const blockCount = statusData.blockDetails.length;
  const resolvedFocusIndex =
    blockCount === 0 ? -1 : focusIndex >= 0 && focusIndex < blockCount ? focusIndex : 0;
  const resolvedActiveTooltip =
    activeTooltip !== null && activeTooltip >= 0 && activeTooltip < blockCount
      ? activeTooltip
      : null;
  const hasData = statusData.totalSuccess + statusData.totalFailure > 0;
  const rateClassName = !hasData
    ? ''
    : statusData.successRate >= 90
      ? styles.monitoringStatusRateHigh
      : statusData.successRate >= 50
        ? styles.monitoringStatusRateMedium
        : styles.monitoringStatusRateLow;

  useEffect(() => {
    if (resolvedActiveTooltip === null) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (blocksRef.current && !blocksRef.current.contains(event.target as Node)) {
        setActiveTooltip(null);
      }
    };

    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, [resolvedActiveTooltip]);

  const handlePointerEnter = useCallback((event: React.PointerEvent, index: number) => {
    if (event.pointerType === 'mouse') {
      setActiveTooltip(index);
    }
  }, []);

  const handlePointerLeave = useCallback((event: React.PointerEvent) => {
    if (
      event.pointerType === 'mouse' &&
      (!blocksRef.current || !blocksRef.current.contains(document.activeElement))
    ) {
      setActiveTooltip(null);
    }
  }, []);

  const handlePointerDown = useCallback((event: React.PointerEvent, index: number) => {
    if (event.pointerType === 'touch') {
      event.preventDefault();
      setFocusIndex(index);
      setActiveTooltip((previous) => (previous === index ? null : index));
    }
  }, []);

  const focusBlock = useCallback((index: number) => {
    blockButtonRefs.current[index]?.focus();
    setFocusIndex(index);
    setActiveTooltip(index);
  }, []);

  const handleFocus = useCallback((index: number) => {
    setFocusIndex(index);
    setActiveTooltip(index);
  }, []);

  const handleBlur = useCallback((event: React.FocusEvent<HTMLButtonElement>) => {
    if (blocksRef.current?.contains(event.relatedTarget as Node | null)) {
      return;
    }
    setActiveTooltip(null);
  }, []);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
      if (event.key === 'Escape') {
        setActiveTooltip(null);
        return;
      }

      const nextIndex = getNextMonitoringStatusBlockIndex(index, event.key, blockCount);

      if (nextIndex === null) {
        return;
      }

      event.preventDefault();
      focusBlock(nextIndex);
    },
    [blockCount, focusBlock]
  );

  const getTooltipPositionClassName = (index: number, total: number) => {
    if (index <= 2) return styles.monitoringStatusTooltipLeft;
    if (index >= total - 3) return styles.monitoringStatusTooltipRight;
    return '';
  };

  const renderTooltip = (detail: StatusBlockDetail, index: number, tooltipId: string) => {
    const total = detail.success + detail.failure;
    const timeRange = formatStatusWindowLabel(detail.startTime, detail.endTime, locale);

    return (
      <div
        id={tooltipId}
        role="tooltip"
        className={[
          styles.monitoringStatusTooltip,
          getTooltipPositionClassName(index, statusData.blockDetails.length),
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <span className={styles.monitoringTooltipTime}>{timeRange}</span>
        {total > 0 ? (
          <span className={styles.monitoringTooltipStats}>
            <span className={styles.monitoringTooltipSuccess}>
              {t('status_bar.success_short')} {detail.success}
            </span>
            <span className={styles.monitoringTooltipFailure}>
              {t('status_bar.failure_short')} {detail.failure}
            </span>
            <span className={styles.monitoringTooltipRate}>
              ({(detail.rate * 100).toFixed(1)}%)
            </span>
          </span>
        ) : (
          <span className={styles.monitoringTooltipStats}>{t('status_bar.no_requests')}</span>
        )}
      </div>
    );
  };

  return (
    <div className={styles.monitoringStatusBar}>
      <div
        className={styles.monitoringStatusBlocks}
        ref={blocksRef}
        role="group"
        aria-label={t('monitoring.account_overview_health_label')}
      >
        {statusData.blockDetails.map((detail, index) => {
          const isIdle = detail.rate === -1;
          const isActive = resolvedActiveTooltip === index;
          const timeRangeLabel = formatStatusWindowLabel(detail.startTime, detail.endTime, locale);
          const tooltipId = `${tooltipIdPrefix}-monitoring-status-tooltip-${index}`;
          const ariaLabel = buildMonitoringStatusBlockAriaLabel({
            detail,
            timeRangeLabel,
            successRateValue: formatStatusRate(Math.max(0, detail.rate * 100)),
            copy: {
              successLabel: t('stats.success'),
              failureLabel: t('stats.failure'),
              noRequestsLabel: t('status_bar.no_requests'),
              successRateLabel: t('monitoring.success_rate'),
            },
          });

          return (
            <div
              key={`${detail.startTime}-${detail.endTime}`}
              className={[
                styles.monitoringStatusBlockWrapper,
                isActive ? styles.monitoringStatusBlockActive : '',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <button
                ref={(node) => {
                  blockButtonRefs.current[index] = node;
                }}
                type="button"
                className={styles.monitoringStatusBlockButton}
                tabIndex={resolvedFocusIndex === index ? 0 : -1}
                aria-label={ariaLabel}
                aria-describedby={isActive ? tooltipId : undefined}
                onFocus={() => handleFocus(index)}
                onBlur={handleBlur}
                onKeyDown={(event) => handleKeyDown(event, index)}
                onPointerEnter={(event) => handlePointerEnter(event, index)}
                onPointerLeave={handlePointerLeave}
                onPointerDown={(event) => handlePointerDown(event, index)}
              >
                <div
                  aria-hidden="true"
                  className={[
                    styles.monitoringStatusBlock,
                    isIdle ? styles.monitoringStatusBlockIdle : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  style={isIdle ? undefined : { backgroundColor: rateToStatusColor(detail.rate) }}
                />
              </button>
              {isActive ? renderTooltip(detail, index, tooltipId) : null}
            </div>
          );
        })}
      </div>
      {showRate ? (
        <span
          className={[
            styles.monitoringStatusRate,
            rateClassName,
            !hasData ? styles.monitoringStatusRatePlaceholder : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          {hasData ? formatStatusRate(statusData.successRate) : '--'}
        </span>
      ) : null}
    </div>
  );
}

const EMPTY_ACCOUNT_AUTH_STATE: MonitoringAccountAuthState = {
  files: [],
  toggleableFileNames: [],
  enabledState: 'unavailable',
};

const getAccountStatusTone = (authState: MonitoringAccountAuthState) => {
  switch (authState.enabledState) {
    case 'enabled':
      return 'enabled';
    case 'disabled':
      return 'disabled';
    case 'mixed':
      return 'mixed';
    case 'unavailable':
    default:
      return 'unavailable';
  }
};

const getAccountStatusLabel = (authState: MonitoringAccountAuthState, t: TFunction) => {
  switch (authState.enabledState) {
    case 'enabled':
      return t('monitoring.account_overview_enabled_state_enabled');
    case 'disabled':
      return t('monitoring.account_overview_enabled_state_disabled');
    case 'mixed':
      return t('monitoring.account_overview_enabled_state_mixed');
    case 'unavailable':
    default:
      return t('monitoring.account_overview_enabled_state_unavailable');
  }
};

const getAccountStatusDotClassName = (tone: string) => {
  switch (tone) {
    case 'enabled':
      return styles.accountStatusDotEnabled;
    case 'disabled':
      return styles.accountStatusDotDisabled;
    case 'mixed':
      return styles.accountStatusDotMixed;
    case 'unavailable':
    default:
      return styles.accountStatusDotUnavailable;
  }
};

const getSuccessRateClassName = (rate: number) =>
  rate >= 0.95 ? styles.goodText : rate >= 0.85 ? styles.warnText : styles.badText;

function AccountStatusBadge({
  authState,
  t,
}: {
  authState: MonitoringAccountAuthState;
  t: TFunction;
}) {
  const tone = getAccountStatusTone(authState);
  const label = getAccountStatusLabel(authState, t);

  return (
    <span
      className={[styles.accountStatusBadge, styles[`accountStatusBadge${tone}`]]
        .filter(Boolean)
        .join(' ')}
      title={label}
    >
      <span
        className={[styles.accountStatusDot, getAccountStatusDotClassName(tone)]
          .filter(Boolean)
          .join(' ')}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}

function AccountSummaryPrimary({
  row,
  expanded,
  onToggle,
  statusTone = 'enabled',
  showSecondary = true,
}: {
  row: MonitoringAccountRow;
  expanded: boolean;
  onToggle: () => void;
  statusTone?: string;
  showSecondary?: boolean;
}) {
  const secondaryText = buildAccountSecondaryText(row);
  const accountLabel = row.displayAccount || row.account;

  return (
    <button
      type="button"
      className={[
        styles.accountButton,
        expanded ? styles.expandedAccountButton : '',
        statusTone === 'disabled' || statusTone === 'unavailable' ? styles.accountButtonMuted : '',
      ]
        .filter(Boolean)
        .join(' ')}
      onClick={onToggle}
      aria-expanded={expanded}
      title={accountLabel}
    >
      <span className={styles.accountExpandGlyph} aria-hidden="true">
        {expanded ? <IconChevronUp size={15} /> : <IconChevronDown size={15} />}
      </span>
      <span className={styles.accountIdentityLine}>
        <span
          className={[styles.accountStatusDot, getAccountStatusDotClassName(statusTone)]
            .filter(Boolean)
            .join(' ')}
          aria-hidden="true"
        />
        <span className={styles.accountButtonLabel}>{accountLabel}</span>
      </span>
      {showSecondary && secondaryText ? <small>{secondaryText}</small> : null}
    </button>
  );
}

function AccountQuotaPanel({
  quotaState,
  locale,
  t,
  onRefreshQuota,
}: {
  quotaState?: AccountQuotaState;
  locale: string;
  t: TFunction;
  onRefreshQuota: () => void;
}) {
  const quotaEntries = quotaState?.entries ?? [];
  const quotaLoading = quotaState?.status === 'loading';
  const lastQuotaSync =
    quotaState?.lastRefreshedAt && Number.isFinite(quotaState.lastRefreshedAt)
      ? new Date(quotaState.lastRefreshedAt).toLocaleString(locale)
      : '';
  const singleQuotaEntry = quotaEntries.length === 1 ? quotaEntries[0] : null;
  const singlePlanLabel = singleQuotaEntry ? getCodexPlanLabel(singleQuotaEntry.planType, t) : null;
  const quotaMetaText = [
    singlePlanLabel ? `${t('codex_quota.plan_label')}: ${singlePlanLabel}` : '',
    lastQuotaSync ? `${t('monitoring.last_sync')}: ${lastQuotaSync}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const renderQuotaWindows = (windows: AccountQuotaWindow[]) => (
    <div className={styles.quotaWindowList}>
      {windows.map((window) => {
        const percentLabel =
          window.remainingPercent === null ? '--' : `${Math.round(window.remainingPercent)}%`;
        const barStyle =
          window.remainingPercent === null
            ? undefined
            : { width: `${Math.max(0, Math.min(100, window.remainingPercent))}%` };

        return (
          <div key={window.id} className={styles.quotaWindowRow}>
            <div className={styles.quotaWindowHeader}>
              <span>{window.label}</span>
              <strong>{percentLabel}</strong>
            </div>
            <div className={styles.quotaProgressTrack}>
              <span className={styles.quotaProgressBar} style={barStyle} />
            </div>
            <div className={styles.quotaWindowMeta}>
              <small>{`${t('monitoring.account_quota_reset_at')}: ${window.resetLabel}`}</small>
              {window.usageLabel ? <small>{window.usageLabel}</small> : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  const renderRefreshButton = () => (
    <button
      type="button"
      className={styles.quotaRefreshButton}
      onClick={onRefreshQuota}
      disabled={quotaLoading}
    >
      <IconRefreshCw
        size={14}
        className={quotaLoading ? styles.refreshIconSpinning : styles.refreshIcon}
      />
      <span>{t('codex_quota.refresh_button')}</span>
    </button>
  );

  const renderStateMessage = (message: ReactNode, hint?: ReactNode, retry = false) => (
    <div className={styles.quotaStateMessage}>
      <span>{message}</span>
      {hint ? <small>{hint}</small> : null}
      {retry ? (
        <button
          type="button"
          className={styles.quotaRetryButton}
          onClick={onRefreshQuota}
          disabled={quotaLoading}
        >
          <IconRefreshCw
            size={14}
            className={quotaLoading ? styles.refreshIconSpinning : styles.refreshIcon}
          />
          <span>{t('codex_quota.retry_button')}</span>
        </button>
      ) : null}
    </div>
  );

  return (
    <section className={styles.quotaSection}>
      <div className={styles.quotaSectionHeader}>
        <div className={styles.quotaSectionTitleGroup}>
          <strong>{t('codex_quota.title')}</strong>
          {quotaMetaText ? <span>{quotaMetaText}</span> : null}
        </div>
        {renderRefreshButton()}
      </div>

      {quotaLoading && quotaEntries.length === 0
        ? renderStateMessage(t('codex_quota.loading'))
        : null}

      {!quotaLoading && quotaState?.status === 'error' && quotaEntries.length === 0
        ? renderStateMessage(
            t('codex_quota.load_failed', {
              message: quotaState.error || t('common.unknown_error'),
            }),
            undefined,
            true
          )
        : null}

      {!quotaLoading && quotaState?.status === 'success' && quotaEntries.length === 0
        ? renderStateMessage(t('codex_quota.empty_windows'), t('codex_quota.idle'))
        : null}

      {!quotaState && quotaEntries.length === 0
        ? renderStateMessage(t('codex_quota.empty_windows'), t('codex_quota.idle'))
        : null}

      {singleQuotaEntry ? (
        singleQuotaEntry.error ? (
          renderStateMessage(
            t('codex_quota.load_failed', { message: singleQuotaEntry.error }),
            undefined,
            true
          )
        ) : singleQuotaEntry.windows.length > 0 ? (
          renderQuotaWindows(singleQuotaEntry.windows)
        ) : (
          renderStateMessage(t('codex_quota.empty_windows'), t('codex_quota.idle'))
        )
      ) : quotaEntries.length > 0 ? (
        <div className={styles.quotaEntryGrid}>
          {quotaEntries.map((entry) => {
            const planLabel = getCodexPlanLabel(entry.planType, t);
            return (
              <div key={entry.key} className={styles.quotaEntryCard}>
                <div className={styles.quotaEntryHeader}>
                  <div className={styles.quotaEntryMain}>
                    <strong>{entry.authLabel}</strong>
                    <small>
                      {planLabel ? `${t('codex_quota.plan_label')}: ${planLabel}` : entry.fileName}
                    </small>
                  </div>
                </div>

                {entry.error
                  ? renderStateMessage(
                      t('codex_quota.load_failed', { message: entry.error }),
                      undefined,
                      true
                    )
                  : entry.windows.length > 0
                    ? renderQuotaWindows(entry.windows)
                    : renderStateMessage(t('codex_quota.empty_windows'), t('codex_quota.idle'))}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function AccountTokenMetricGrid({
  metrics,
  t,
  variant = 'card',
}: {
  metrics: AccountSummaryMetric[];
  t: TFunction;
  variant?: 'card' | 'table';
}) {
  const getTokenMetricIcon = (key: string) => {
    if (key === 'input-tokens') return <IconInbox size={13} />;
    if (key === 'output-tokens') return <IconTrendingUp size={13} />;
    if (key === 'cached-tokens') return <IconTimer size={13} />;
    return <IconChartLine size={13} />;
  };
  const getTokenMetricToneClassName = (key: string) => {
    if (key === 'input-tokens') return styles.accountMetricIconInput;
    if (key === 'output-tokens') return styles.accountMetricIconOutput;
    if (key === 'cached-tokens') return styles.accountMetricIconCached;
    return styles.accountMetricIconTotal;
  };

  if (variant === 'table') {
    const tokenStructureMetrics = metrics.filter((metric) =>
      ['input-tokens', 'output-tokens', 'cached-tokens'].includes(metric.key)
    );
    const getTokenStructureRowToneClassName = (key: string) => {
      if (key === 'input-tokens') return styles.tokenStructureRowInput;
      if (key === 'output-tokens') return styles.tokenStructureRowOutput;
      if (key === 'cached-tokens') return styles.tokenStructureRowCached;
      return '';
    };

    return (
      <section className={styles.accountTokenStructurePanel}>
        <div className={styles.accountSectionHeader}>
          <strong>{t('monitoring.account_overview_token_structure')}</strong>
        </div>
        <div className={styles.tokenStructureRowList}>
          {tokenStructureMetrics.map((metric) => (
            <div
              key={metric.key}
              className={[styles.tokenStructureRow, getTokenStructureRowToneClassName(metric.key)]
                .filter(Boolean)
                .join(' ')}
            >
              <span className={styles.tokenStructureRowLeft}>
                <span className={styles.tokenStructureRowIcon} aria-hidden="true">
                  {getTokenMetricIcon(metric.key)}
                </span>
                <span className={styles.tokenStructureRowLabel}>{metric.label}</span>
              </span>
              <strong
                className={[styles.tokenStructureRowValue, metric.valueClassName]
                  .filter(Boolean)
                  .join(' ')}
              >
                {metric.value}
              </strong>
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section className={styles.accountTokenPanel}>
      <div className={styles.accountSectionHeader}>
        <strong>{t('monitoring.account_overview_tokens_title')}</strong>
      </div>
      <div className={styles.accountOverviewMetricGrid}>
        {metrics.map((metric) => (
          <div key={metric.key} className={styles.accountOverviewMetricCard}>
            <span className={styles.accountOverviewMetricLabel}>
              <span
                className={[styles.accountMetricIcon, getTokenMetricToneClassName(metric.key)]
                  .filter(Boolean)
                  .join(' ')}
                aria-hidden="true"
              >
                {getTokenMetricIcon(metric.key)}
              </span>
              {metric.label}
            </span>
            <strong
              className={[styles.accountOverviewMetricValue, metric.valueClassName]
                .filter(Boolean)
                .join(' ')}
            >
              {metric.value}
            </strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function AccountHealthStatusPanel({
  row,
  hasPrices,
  locale,
  t,
  statusData,
  scopeText,
}: {
  row: MonitoringAccountRow;
  hasPrices: boolean;
  locale: string;
  t: TFunction;
  statusData: StatusBarData;
  scopeText: string;
}) {
  const healthMetrics = [
    {
      key: 'total-calls',
      label: t('monitoring.total_calls'),
      value: formatCompactNumber(row.totalCalls),
    },
    {
      key: 'success-calls',
      label: t('stats.success'),
      value: formatCompactNumber(row.successCalls),
      className: styles.goodText,
    },
    {
      key: 'failure-calls',
      label: t('stats.failure'),
      value: formatCompactNumber(row.failureCalls),
      className: row.failureCalls > 0 ? styles.badText : undefined,
    },
    {
      key: 'estimated-cost',
      label: t('monitoring.estimated_cost'),
      value: hasPrices ? formatUsd(row.totalCost) : '--',
      className: styles.primaryText,
    },
    {
      key: 'success-rate',
      label: t('monitoring.column_success_rate'),
      value: formatPercent(row.successRate),
      className: getSuccessRateClassName(row.successRate),
    },
  ];

  return (
    <section className={styles.accountOverviewStatusSection}>
      <div className={styles.accountSectionHeader}>
        <strong>{t('monitoring.account_overview_health_label')}</strong>
        <span
          className={styles.accountSectionInfo}
          title={t('monitoring.account_overview_health_hint')}
        >
          <IconInfo size={14} />
        </span>
      </div>
      <div className={styles.healthMetricGrid}>
        {healthMetrics.map((metric) => (
          <div key={metric.key} className={styles.healthMetricItem}>
            <span>{metric.label}</span>
            <strong className={metric.className}>{metric.value}</strong>
          </div>
        ))}
      </div>
      <MonitoringHealthStatusBar statusData={statusData} locale={locale} t={t} showRate={false} />
      <div className={styles.accountScopeText}>{scopeText}</div>
    </section>
  );
}

function AccountModelUsageList({
  row,
  hasPrices,
  locale,
  t,
  limit = 2,
}: {
  row: MonitoringAccountRow;
  hasPrices: boolean;
  locale: string;
  t: TFunction;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const [expandedModels, setExpandedModels] = useState<Record<string, boolean>>({});
  const hasExtraModels = row.models.length > limit;
  const visibleModels = showAll ? row.models : row.models.slice(0, limit);
  const toggleModel = (key: string) =>
    setExpandedModels((previous) => ({ ...previous, [key]: !previous[key] }));

  return (
    <section className={styles.accountModelListPanel}>
      <div className={styles.accountSectionHeader}>
        <strong>
          {t('monitoring.account_overview_models_top', {
            count: Math.min(limit, row.models.length || limit),
          })}
        </strong>
        {hasExtraModels ? (
          <button
            type="button"
            className={styles.accountModelViewAllButton}
            onClick={() => setShowAll((previous) => !previous)}
          >
            {showAll
              ? t('monitoring.account_overview_collapse_models')
              : t('monitoring.account_overview_view_all')}
          </button>
        ) : null}
      </div>

      {visibleModels.length > 0 ? (
        <div className={styles.accountModelList}>
          {visibleModels.map((model) => {
            const modelKey = `${row.id}-${model.model}`;
            const isModelExpanded = Boolean(expandedModels[modelKey]);
            return (
              <div key={modelKey} className={styles.accountModelItem}>
                <button
                  type="button"
                  className={styles.accountModelRow}
                  onClick={() => toggleModel(modelKey)}
                  aria-expanded={isModelExpanded}
                >
                  <span className={styles.accountModelName} title={model.model}>
                    {model.model}
                  </span>
                  <span className={styles.accountModelMetaLine}>
                    <span className={styles.accountModelStat}>
                      <small>{t('monitoring.account_overview_model_calls_short')}</small>
                      <strong>{formatCompactNumber(model.totalCalls)}</strong>
                    </span>
                    <span className={styles.accountModelStat}>
                      <small>{t('monitoring.account_overview_model_success_rate_short')}</small>
                      <strong className={getSuccessRateClassName(model.successRate)}>
                        {formatPercent(model.successRate)}
                      </strong>
                    </span>
                    <span className={styles.accountModelStat}>
                      <small>{t('monitoring.account_overview_model_total_tokens_short')}</small>
                      <strong>{formatCompactNumber(model.totalTokens)}</strong>
                    </span>
                    <span className={styles.accountModelStat}>
                      <small>{t('monitoring.account_overview_model_total_cost_short')}</small>
                      <strong>{hasPrices ? formatUsd(model.totalCost) : '--'}</strong>
                    </span>
                    <span className={styles.accountModelChevron} aria-hidden="true">
                      {isModelExpanded ? (
                        <IconChevronDown size={14} />
                      ) : (
                        <IconChevronRight size={14} />
                      )}
                    </span>
                  </span>
                </button>
                {isModelExpanded ? (
                  <div className={styles.accountModelExpanded}>
                    <div className={styles.accountModelExpandedItem}>
                      <small>{t('monitoring.input_tokens')}</small>
                      <strong>{formatCompactNumber(model.inputTokens)}</strong>
                    </div>
                    <div className={styles.accountModelExpandedItem}>
                      <small>{t('monitoring.output_tokens')}</small>
                      <strong>{formatCompactNumber(model.outputTokens)}</strong>
                    </div>
                    <div className={styles.accountModelExpandedItem}>
                      <small>{t('monitoring.cached_tokens')}</small>
                      <strong>{formatCompactNumber(model.cachedTokens)}</strong>
                    </div>
                    <div className={styles.accountModelExpandedItem}>
                      <small>{t('monitoring.latest_request_time')}</small>
                      <strong>{new Date(model.lastSeenAt).toLocaleString(locale)}</strong>
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : (
        <div className={styles.emptyBlockSmall}>{t('monitoring.account_overview_no_models')}</div>
      )}
    </section>
  );
}

function AccountModelUsageTable({
  row,
  hasPrices,
  locale,
  t,
  limit = 2,
}: {
  row: MonitoringAccountRow;
  hasPrices: boolean;
  locale: string;
  t: TFunction;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  const hasExtraModels = row.models.length > limit;
  const visibleModels = showAll ? row.models : row.models.slice(0, limit);
  const modelCountForTitle = Math.min(limit, row.models.length || limit);

  return (
    <section className={styles.accountModelTablePanel}>
      <div className={styles.accountSectionHeader}>
        <strong>
          {t('monitoring.account_overview_models_top', {
            count: modelCountForTitle,
          })}
        </strong>
        <button
          type="button"
          className={styles.accountModelViewAllButton}
          onClick={() => setShowAll((previous) => !previous)}
          disabled={!hasExtraModels}
        >
          {showAll
            ? t('monitoring.account_overview_collapse_models')
            : t('monitoring.account_overview_view_all')}
        </button>
      </div>
      {visibleModels.length > 0 ? (
        <table className={styles.accountModelTable}>
          <thead>
            <tr>
              <th>{t('usage_stats.model_price_model')}</th>
              <th>{t('monitoring.account_overview_model_calls_short')}</th>
              <th>{t('monitoring.account_overview_model_success_rate_short')}</th>
              <th>{t('monitoring.account_overview_model_input_tokens_short')}</th>
              <th>{t('monitoring.account_overview_model_output_tokens_short')}</th>
              <th>{t('monitoring.account_overview_model_cached_tokens_short')}</th>
              <th>{t('monitoring.account_overview_model_total_tokens_short')}</th>
              <th>{t('monitoring.account_overview_model_total_cost_short')}</th>
              <th>{t('monitoring.latest_request_time')}</th>
            </tr>
          </thead>
          <tbody>
            {visibleModels.map((model) => (
              <tr key={`${row.id}-${model.model}`}>
                <td>
                  <span className={styles.accountModelName} title={model.model}>
                    {model.model}
                  </span>
                </td>
                <td>{formatCompactNumber(model.totalCalls)}</td>
                <td className={getSuccessRateClassName(model.successRate)}>
                  {formatPercent(model.successRate)}
                </td>
                <td>{formatCompactNumber(model.inputTokens)}</td>
                <td>{formatCompactNumber(model.outputTokens)}</td>
                <td>{formatCompactNumber(model.cachedTokens)}</td>
                <td>{formatCompactNumber(model.totalTokens)}</td>
                <td>{hasPrices ? formatUsd(model.totalCost) : '--'}</td>
                <td>{new Date(model.lastSeenAt).toLocaleString(locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className={styles.emptyBlockSmall}>{t('monitoring.account_overview_no_models')}</div>
      )}
    </section>
  );
}

export function AccountExpandedDetails({
  row,
  hasPrices,
  locale,
  t,
  summaryMetrics,
  quotaState,
  onRefreshQuota,
  variant,
}: {
  row: MonitoringAccountRow;
  hasPrices: boolean;
  locale: string;
  t: TFunction;
  summaryMetrics: AccountSummaryMetric[];
  quotaState?: AccountQuotaState;
  onRefreshQuota: () => void;
  variant: 'card' | 'table';
}) {
  const tokenMetrics = sortAccountOverviewCardMetrics(summaryMetrics);

  if (variant === 'table') {
    return (
      <div className={styles.expandedAccountDetails}>
        <AccountQuotaPanel
          quotaState={quotaState}
          locale={locale}
          t={t}
          onRefreshQuota={onRefreshQuota}
        />
        <div className={styles.accountStructureModelPanel}>
          <AccountTokenMetricGrid metrics={tokenMetrics} t={t} variant="table" />
          <AccountModelUsageTable row={row} hasPrices={hasPrices} locale={locale} t={t} />
        </div>
      </div>
    );
  }

  return (
    <div className={styles.accountOverviewCardBody}>
      <AccountQuotaPanel
        quotaState={quotaState}
        locale={locale}
        t={t}
        onRefreshQuota={onRefreshQuota}
      />
      <AccountModelUsageList row={row} hasPrices={hasPrices} locale={locale} t={t} />
    </div>
  );
}

export function AccountOverviewCard({
  row,
  authState,
  hasPrices,
  locale,
  t,
  isExpanded,
  isFocused,
  statusData,
  scopeText,
  quotaState,
  statusUpdating,
  onToggle,
  onFocus,
  onToggleEnabled,
  onRefreshQuota,
}: {
  row: MonitoringAccountRow;
  authState: MonitoringAccountAuthState;
  hasPrices: boolean;
  locale: string;
  t: TFunction;
  isExpanded: boolean;
  isFocused: boolean;
  statusData: StatusBarData;
  scopeText: string;
  quotaState?: AccountQuotaState;
  statusUpdating: boolean;
  onToggle: () => void;
  onFocus: () => void;
  onToggleEnabled: (enabled: boolean) => void;
  onRefreshQuota: () => void;
}) {
  const summaryMetrics = buildAccountSummaryMetrics(row, hasPrices, locale, t);
  const cardMetrics = sortAccountOverviewCardMetrics(summaryMetrics);
  const canToggleEnabled = authState.enabledState !== 'unavailable';
  const toggleChecked = authState.enabledState === 'enabled';
  const statusTone = getAccountStatusTone(authState);
  const secondaryText = buildAccountSecondaryText(row);
  const latestRequestText = new Date(row.lastSeenAt).toLocaleString(locale);

  return (
    <Card
      className={[
        styles.accountOverviewCard,
        isExpanded ? styles.accountOverviewCardExpanded : '',
        isFocused ? styles.accountOverviewCardFocused : '',
        authState.enabledState === 'disabled' ? styles.accountOverviewCardDisabled : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.accountOverviewCardHeader}>
        <div className={styles.accountTitleRow}>
          <AccountSummaryPrimary
            row={row}
            expanded={isExpanded}
            onToggle={onToggle}
            statusTone={statusTone}
            showSecondary={false}
          />
          <div className={styles.accountEnabledControl}>
            <span className={styles.accountEnabledLabel}>
              {t('monitoring.account_overview_enabled_label_short')}
            </span>
            {authState.enabledState === 'mixed' ? (
              <div className={styles.accountOverviewToggleActions}>
                <button
                  type="button"
                  className={styles.inlineActionButton}
                  onClick={() => onToggleEnabled(true)}
                  disabled={statusUpdating}
                >
                  {t('monitoring.account_overview_enable_all')}
                </button>
                <button
                  type="button"
                  className={styles.inlineActionButton}
                  onClick={() => onToggleEnabled(false)}
                  disabled={statusUpdating}
                >
                  {t('monitoring.account_overview_disable_all')}
                </button>
              </div>
            ) : (
              <ToggleSwitch
                ariaLabel={t('monitoring.account_overview_enabled_label')}
                checked={toggleChecked}
                disabled={!canToggleEnabled || statusUpdating}
                onChange={onToggleEnabled}
              />
            )}
          </div>
        </div>
        <div className={styles.accountMetaRow}>
          {secondaryText ? (
            <span className={styles.accountOverviewCardTimestamp} title={secondaryText}>
              {secondaryText}
            </span>
          ) : null}
          {secondaryText ? <span className={styles.accountMetaSeparator}>·</span> : null}
          <span className={styles.accountOverviewCardTimestamp}>
            {`${t('monitoring.latest_request_time')}: ${latestRequestText}`}
          </span>
          <button
            type="button"
            className={`${styles.inlineActionButton} ${styles.accountFocusButton}`}
            onClick={onFocus}
          >
            <IconCrosshair size={12} aria-hidden="true" />
            <span>
              {isFocused ? t('monitoring.restore_account_scope') : t('monitoring.focus_account')}
            </span>
          </button>
        </div>
      </div>

      <AccountHealthStatusPanel
        row={row}
        hasPrices={hasPrices}
        locale={locale}
        t={t}
        statusData={statusData}
        scopeText={scopeText}
      />

      <AccountTokenMetricGrid metrics={cardMetrics} t={t} />

      {isExpanded ? (
        <AccountExpandedDetails
          row={row}
          hasPrices={hasPrices}
          locale={locale}
          t={t}
          summaryMetrics={summaryMetrics}
          quotaState={quotaState}
          onRefreshQuota={onRefreshQuota}
          variant="card"
        />
      ) : null}
    </Card>
  );
}

export function MonitoringCenterPage() {
  const { t, i18n } = useTranslation();
  const config = useConfigStore((state) => state.config);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const requestMonitoringAvailability = useRequestMonitoringAvailability();
  const [timeRange, setTimeRange] = useState<MonitoringTimeRange>('today');
  const [customStartInput, setCustomStartInput] = useState(getTodayStartInputValue);
  const [customEndInput, setCustomEndInput] = useState(getCurrentInputValue);
  const [customDraftStartInput, setCustomDraftStartInput] = useState(getTodayStartInputValue);
  const [customDraftEndInput, setCustomDraftEndInput] = useState(getCurrentInputValue);
  const [searchInput, setSearchInput] = useState('');
  const [autoRefreshMs, setAutoRefreshMs] = useState('5000');
  const [selectedAccount, setSelectedAccount] = useState('all');
  const [selectedProvider, setSelectedProvider] = useState('all');
  const [selectedModel, setSelectedModel] = useState('all');
  const [selectedChannel, setSelectedChannel] = useState('all');
  const [selectedApiKeyHash, setSelectedApiKeyHash] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<StatusFilter>('all');
  const [expandedAccounts, setExpandedAccounts] = useState<Record<string, boolean>>({});
  const [focusedAccount, setFocusedAccount] = useState<string | null>(null);
  const [isPriceModalOpen, setIsPriceModalOpen] = useState(false);
  const [isCustomRangeModalOpen, setIsCustomRangeModalOpen] = useState(false);
  const [syncingPrices, setSyncingPrices] = useState(false);
  const [usageExporting, setUsageExporting] = useState(false);
  const [usageImporting, setUsageImporting] = useState(false);
  const [priceModel, setPriceModel] = useState('');
  const [priceDraft, setPriceDraft] = useState<PriceDraft>(() => createPriceDraft());
  const [accountQuotaStates, setAccountQuotaStates] = useState<Record<string, AccountQuotaState>>(
    {}
  );
  const initialAccountOverviewUiState = useRef(readAccountOverviewUiState());
  const [accountOverviewMode, setAccountOverviewMode] = useState<MonitoringAccountOverviewMode>(
    initialAccountOverviewUiState.current.mode
  );
  const [accountSort, setAccountSort] = useState<AccountSortState>(
    initialAccountOverviewUiState.current.sort
  );
  const [accountPageByMode, setAccountPageByMode] = useState(() => ({
    table: 1,
    card: initialAccountOverviewUiState.current.cardPagination.page,
  }));
  const [accountPageSizeByMode, setAccountPageSizeByMode] = useState(() => ({
    table: DEFAULT_ACCOUNT_PAGE_SIZE,
    card: initialAccountOverviewUiState.current.cardPagination.pageSize,
  }));
  const [accountStatusUpdating, setAccountStatusUpdating] = useState<Record<string, boolean>>({});
  const [realtimePage, setRealtimePage] = useState(1);
  const [realtimePageSize, setRealtimePageSize] = useState(DEFAULT_REALTIME_PAGE_SIZE);
  const focusSnapshotRef = useRef<FocusSnapshot | null>(null);
  const previousAccountPageResetStateRef = useRef<AccountOverviewPageResetState | null>(null);
  const accountQuotaStatesRef = useRef<Record<string, AccountQuotaState>>({});
  const accountQuotaRequestIdsRef = useRef<Record<string, number>>({});
  const usageImportInputRef = useRef<HTMLInputElement | null>(null);
  const deferredSearch = useDeferredValue(searchInput);
  const deferredSearchApiKeyHash = useMemo(() => sha256Hex(deferredSearch), [deferredSearch]);
  const accountPage =
    accountOverviewMode === 'card' ? accountPageByMode.card : accountPageByMode.table;
  const accountPageSize =
    accountOverviewMode === 'card' ? accountPageSizeByMode.card : accountPageSizeByMode.table;
  const customStartMs = useMemo(
    () => parseDateTimeLocalValue(customStartInput),
    [customStartInput]
  );
  const customEndMs = useMemo(() => parseDateTimeLocalValue(customEndInput), [customEndInput]);
  const customDraftStartMs = useMemo(
    () => parseDateTimeLocalValue(customDraftStartInput),
    [customDraftStartInput]
  );
  const customDraftEndMs = useMemo(
    () => parseDateTimeLocalValue(customDraftEndInput),
    [customDraftEndInput]
  );
  const customTimeRangeError = useMemo(() => {
    if (timeRange !== 'custom') return '';
    if (customStartMs === null || customEndMs === null) {
      return t('monitoring.custom_range_required');
    }
    if (customStartMs > customEndMs) {
      return t('monitoring.custom_range_invalid');
    }
    return '';
  }, [customEndMs, customStartMs, t, timeRange]);
  const customTimeRange = useMemo<MonitoringCustomTimeRange | null>(() => {
    if (
      timeRange !== 'custom' ||
      customTimeRangeError ||
      customStartMs === null ||
      customEndMs === null
    ) {
      return null;
    }
    return {
      startMs: customStartMs,
      endMs: customEndMs,
    };
  }, [customEndMs, customStartMs, customTimeRangeError, timeRange]);
  const customDraftTimeRangeError = useMemo(() => {
    if (customDraftStartMs === null || customDraftEndMs === null) {
      return t('monitoring.custom_range_required');
    }
    if (customDraftStartMs > customDraftEndMs) {
      return t('monitoring.custom_range_invalid');
    }
    return '';
  }, [customDraftEndMs, customDraftStartMs, t]);

  const {
    usage,
    loading: usageLoading,
    error: usageError,
    lastRefreshedAt,
    modelPrices,
    apiKeyAliases,
    usageServiceAvailable,
    setModelPrices,
    loadApiKeyAliases,
    syncModelPrices,
    exportUsage,
    importUsage,
    loadUsage,
  } = useUsageData();

  const {
    loading: monitoringLoading,
    error: monitoringError,
    authFiles,
    filteredRows,
    refreshMeta,
  } = useMonitoringData({
    usage,
    config,
    modelPrices,
    apiKeyAliases,
    timeRange,
    customTimeRange,
    searchQuery: deferredSearch,
    searchApiKeyHash: deferredSearchApiKeyHash,
  });

  const refreshAll = useCallback(async () => {
    await Promise.all([loadUsage(), loadApiKeyAliases(), refreshMeta(false)]);
  }, [loadApiKeyAliases, loadUsage, refreshMeta]);

  const setCurrentAccountPage = useCallback(
    (page: number) => {
      setAccountPageByMode((previous) => ({
        ...previous,
        [accountOverviewMode]: page,
      }));
    },
    [accountOverviewMode]
  );

  const resetCurrentAccountPage = useCallback(() => {
    setCurrentAccountPage(1);
  }, [setCurrentAccountPage]);

  useHeaderRefresh(refreshAll);
  useInterval(
    () => {
      void refreshAll().catch(() => {});
    },
    connectionStatus === 'connected' && Number(autoRefreshMs) > 0 ? Number(autoRefreshMs) : null
  );

  const monitoringUnavailable =
    !requestMonitoringAvailability.checking && !requestMonitoringAvailability.available;
  const monitoringUnavailableTitle =
    requestMonitoringAvailability.reason === 'monitoring_disabled'
      ? t('monitoring.request_monitoring_disabled_title')
      : t('monitoring.request_monitoring_unavailable_title');
  const monitoringUnavailableBody =
    requestMonitoringAvailability.reason === 'monitoring_disabled'
      ? t('monitoring.request_monitoring_disabled_body')
      : requestMonitoringAvailability.reason === 'service_unavailable'
        ? t('monitoring.request_monitoring_service_unavailable_body')
        : t('monitoring.request_monitoring_not_configured_body');
  const overallLoading =
    usageLoading || monitoringLoading || requestMonitoringAvailability.checking;
  const combinedError = monitoringUnavailable
    ? monitoringError
    : [usageError, monitoringError].filter(Boolean).join('；');
  const hasPrices = Object.keys(modelPrices).length > 0;

  useEffect(() => {
    accountQuotaStatesRef.current = accountQuotaStates;
  }, [accountQuotaStates]);

  useEffect(() => {
    writeAccountOverviewUiState({
      mode: accountOverviewMode,
      sort: accountSort,
      cardPagination: {
        page: accountPageByMode.card,
        pageSize: accountPageSizeByMode.card,
      },
    });
  }, [accountOverviewMode, accountPageByMode.card, accountPageSizeByMode.card, accountSort]);

  const providerOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_providers') },
      ...Array.from(new Set(filteredRows.map((row) => row.provider)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    ],
    [filteredRows, t]
  );

  const accountOptionRows = useMemo(() => buildAccountRows(filteredRows), [filteredRows]);

  const accountOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_accounts') },
      ...Array.from(
        new Map(
          accountOptionRows.map((row) => [row.account, buildAccountOptionLabel(row)])
        ).entries()
      )
        .sort((left, right) => left[1].localeCompare(right[1]))
        .map(([value, label]) => ({ value, label })),
    ],
    [accountOptionRows, t]
  );

  const modelOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_models') },
      ...Array.from(new Set(filteredRows.map((row) => row.model)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    ],
    [filteredRows, t]
  );

  const channelOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_channels') },
      ...Array.from(new Set(filteredRows.map((row) => row.channel)))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right))
        .map((value) => ({ value, label: value })),
    ],
    [filteredRows, t]
  );

  const apiKeyOptions = useMemo(() => {
    const optionMap = new Map<string, string>();
    filteredRows.forEach((row) => {
      if (!row.apiKeyHash || optionMap.has(row.apiKeyHash)) return;
      optionMap.set(row.apiKeyHash, row.apiKeyLabel || row.apiKeyMasked || row.apiKeyHash);
    });

    return [
      { value: 'all', label: t('monitoring.filter_all_api_keys') },
      ...Array.from(optionMap.entries())
        .sort((left, right) => left[1].localeCompare(right[1]))
        .map(([value, label]) => ({ value, label })),
    ];
  }, [filteredRows, t]);

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('monitoring.filter_all_statuses') },
      { value: 'success', label: t('monitoring.filter_status_success') },
      { value: 'failed', label: t('monitoring.filter_status_failed') },
    ],
    [t]
  );

  const syncPriceModels = useMemo(
    () =>
      Array.from(new Set([...filteredRows.map((row) => row.model), ...Object.keys(modelPrices)]))
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right)),
    [filteredRows, modelPrices]
  );

  const priceModelOptions = useMemo(
    () => [
      { value: '', label: t('usage_stats.model_price_select_placeholder') },
      ...syncPriceModels.map((value) => ({ value, label: value })),
    ],
    [syncPriceModels, t]
  );

  const authFilesByAuthIndex = useMemo(() => {
    const map = new Map<string, AuthFileItem>();
    authFiles.forEach((file) => {
      const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
      if (!authIndex || map.has(authIndex)) return;
      map.set(authIndex, file);
    });
    return map;
  }, [authFiles]);

  const scopedRows = useMemo(
    () =>
      filteredRows.filter((row) => {
        if (selectedAccount !== 'all' && row.account !== selectedAccount) {
          return false;
        }
        if (selectedProvider !== 'all' && row.provider !== selectedProvider) {
          return false;
        }
        if (selectedModel !== 'all' && row.model !== selectedModel) {
          return false;
        }
        if (selectedChannel !== 'all' && row.channel !== selectedChannel) {
          return false;
        }
        if (selectedApiKeyHash !== 'all' && row.apiKeyHash !== selectedApiKeyHash) {
          return false;
        }
        if (selectedStatus === 'success' && row.failed) {
          return false;
        }
        if (selectedStatus === 'failed' && !row.failed) {
          return false;
        }
        return true;
      }),
    [
      filteredRows,
      selectedAccount,
      selectedApiKeyHash,
      selectedChannel,
      selectedModel,
      selectedProvider,
      selectedStatus,
    ]
  );
  const scopedStatsRows = useMemo(
    () => scopedRows.filter((row) => row.statsIncluded),
    [scopedRows]
  );
  const accountStatusNowMs = lastRefreshedAt?.getTime() ?? Date.now();
  const accountStatusBounds = useMemo(
    () => getRangeBounds(timeRange, accountStatusNowMs, customTimeRange),
    [accountStatusNowMs, customTimeRange, timeRange]
  );
  const accountOverviewScopeText = useMemo(
    () => formatAccountOverviewScopeText(accountStatusBounds, i18n.language, t),
    [accountStatusBounds, i18n.language, t]
  );

  const scopedSummary = useMemo(() => buildMonitoringSummary(scopedStatsRows), [scopedStatsRows]);
  const accountRows = useMemo(() => buildAccountRows(scopedRows), [scopedRows]);
  const accountStatusDataByRowId = useMemo(
    () => buildMonitoringAccountStatusDataMap(scopedRows, accountStatusBounds),
    [accountStatusBounds, scopedRows]
  );
  const emptyAccountStatusData = useMemo(() => {
    const resolvedBounds = resolveMonitoringStatusRangeBounds(scopedRows, accountStatusBounds);
    return resolvedBounds ? buildEmptyMonitoringStatusData(resolvedBounds) : EMPTY_STATUS_BAR_DATA;
  }, [accountStatusBounds, scopedRows]);
  const accountAuthStateByRowId = useMemo(
    () => buildMonitoringAccountAuthStateMap(accountRows, authFilesByAuthIndex),
    [accountRows, authFilesByAuthIndex]
  );
  const sortedAccountRows = useMemo(
    () => sortAccountRows(accountRows, accountSort),
    [accountRows, accountSort]
  );
  const groupedRealtimeRows = useMemo(
    () => buildRealtimeMonitorRows(scopedStatsRows),
    [scopedStatsRows]
  );
  const realtimeLogRows = useMemo(() => buildRealtimeLogRows(scopedRows), [scopedRows]);
  const accountPagination = useMemo(
    () => buildPaginationState(sortedAccountRows, accountPage, accountPageSize),
    [accountPage, accountPageSize, sortedAccountRows]
  );
  const realtimePagination = useMemo(
    () => buildPaginationState(realtimeLogRows, realtimePage, realtimePageSize),
    [realtimeLogRows, realtimePage, realtimePageSize]
  );
  const accountPageResetState = useMemo<AccountOverviewPageResetState>(
    () => ({
      customEndInput,
      customStartInput,
      deferredSearch,
      selectedAccount,
      selectedChannel,
      selectedModel,
      selectedProvider,
      selectedStatus,
      timeRange,
    }),
    [
      customEndInput,
      customStartInput,
      deferredSearch,
      selectedAccount,
      selectedChannel,
      selectedModel,
      selectedProvider,
      selectedStatus,
      timeRange,
    ]
  );

  useEffect(() => {
    if (
      shouldResetAccountOverviewPage(
        previousAccountPageResetStateRef.current,
        accountPageResetState
      )
    ) {
      resetCurrentAccountPage();
      setRealtimePage(1);
    }

    previousAccountPageResetStateRef.current = accountPageResetState;
  }, [accountPageResetState, resetCurrentAccountPage]);

  useEffect(() => {
    if (
      !shouldClampAccountOverviewPage(overallLoading, accountPage, accountPagination.currentPage)
    ) {
      return;
    }

    setCurrentAccountPage(accountPagination.currentPage);
  }, [accountPage, accountPagination.currentPage, overallLoading, setCurrentAccountPage]);

  const accountQuotaTargetsByAccount = useMemo(
    () => buildMonitoringAccountQuotaTargetsByAccount(accountRows, accountAuthStateByRowId),
    [accountAuthStateByRowId, accountRows]
  );
  const scopedFailureCount = scopedRows.filter((row) => row.failed).length;
  const savedPriceEntries = useMemo(
    () => Object.entries(modelPrices).sort((left, right) => left[0].localeCompare(right[0])),
    [modelPrices]
  );

  const hasSearchFilter = Boolean(deferredSearch.trim());
  const hasScopeFilter =
    selectedAccount !== 'all' ||
    selectedProvider !== 'all' ||
    selectedModel !== 'all' ||
    selectedChannel !== 'all' ||
    selectedApiKeyHash !== 'all' ||
    selectedStatus !== 'all';
  const hasActiveDataFilter = hasSearchFilter || hasScopeFilter;
  const failedGroupCount = groupedRealtimeRows.filter((row) => row.failureCalls > 0).length;
  const failedOnlyActive = selectedStatus === 'failed';
  const connectionTone: MonitoringStatusTone =
    connectionStatus === 'connected' ? 'good' : connectionStatus === 'connecting' ? 'warn' : 'bad';
  const connectionLabel =
    connectionStatus === 'connected'
      ? t('common.connected_status')
      : connectionStatus === 'connecting'
        ? t('common.connecting_status')
        : connectionStatus === 'error'
          ? t('common.error')
          : t('common.disconnected_status');

  const accountOverviewColumns = useMemo<AccountOverviewColumn[]>(
    () => [
      { key: 'account', label: t('monitoring.account_overview_col_account') },
      { key: 'status', label: t('monitoring.column_status') },
      { key: 'total-calls', label: t('monitoring.total_calls'), sortKey: 'totalCalls' },
      {
        key: 'success-calls',
        label: t('monitoring.account_overview_col_success'),
        sortKey: 'successCalls',
      },
      {
        key: 'failure-calls',
        label: t('monitoring.account_overview_col_failure'),
        sortKey: 'failureCalls',
      },
      { key: 'success-rate', label: t('monitoring.column_success_rate'), sortKey: 'successRate' },
      { key: 'total-tokens', label: t('monitoring.total_tokens'), sortKey: 'totalTokens' },
      {
        key: 'estimated-cost',
        label: t('monitoring.account_overview_col_cost'),
        sortKey: 'totalCost',
      },
      {
        key: 'latest-request-time',
        label: t('monitoring.latest_request_time'),
        sortKey: 'lastSeenAt',
      },
      { key: 'action', label: t('common.action') },
    ],
    [t]
  );

  const accountSortOptions = useMemo(() => {
    const prefix = t('monitoring.account_overview_sort_prefix');
    return accountOverviewColumns
      .filter((column): column is AccountOverviewColumn & { sortKey: AccountSortKey } =>
        Boolean(column.sortKey)
      )
      .map((column) => ({
        value: column.sortKey,
        label: `${prefix}${column.label}`,
      }));
  }, [accountOverviewColumns, t]);

  const accountPageSizeOptions =
    accountOverviewMode === 'card'
      ? ACCOUNT_OVERVIEW_CARD_PAGE_SIZE_OPTIONS
      : ACCOUNT_OVERVIEW_TABLE_PAGE_SIZE_OPTIONS;

  const primarySummaryCards: SummaryCardProps[] = [
    {
      label: t('monitoring.total_calls'),
      value: formatCompactNumber(scopedSummary.totalCalls),
      meta: `${accountRows.length} ${t('monitoring.accounts_suffix')}`,
    },
    {
      label: t('monitoring.call_success_rate'),
      value: formatPercent(scopedSummary.successRate),
      meta: formatDurationMs(scopedSummary.averageLatencyMs, { locale: i18n.language }),
      tone:
        scopedSummary.successRate >= 0.95
          ? 'good'
          : scopedSummary.successRate >= 0.85
            ? 'warn'
            : 'bad',
    },
    {
      label: t('monitoring.failure_calls'),
      value: formatCompactNumber(scopedSummary.failureCalls),
      meta: `${failedGroupCount} ${t('monitoring.groups_suffix')}`,
      tone: scopedSummary.failureCalls > 0 ? 'bad' : 'good',
    },
    {
      label: t('monitoring.estimated_cost'),
      value: hasPrices ? formatUsd(scopedSummary.totalCost) : '--',
      meta: hasPrices
        ? t('monitoring.estimated_cost_hint')
        : t('monitoring.estimated_cost_missing'),
      tone: hasPrices ? undefined : 'warn',
    },
  ];

  const secondarySummaryCards: SummaryCardProps[] = [
    {
      label: t('monitoring.total_tokens'),
      value: formatCompactNumber(scopedSummary.totalTokens),
      meta: `${t('monitoring.reasoning_tokens')} ${formatCompactNumber(scopedSummary.reasoningTokens)}`,
      variant: 'secondary',
    },
    {
      label: t('monitoring.input_tokens'),
      value: formatCompactNumber(scopedSummary.inputTokens),
      meta: `${t('monitoring.of_token_mix')} ${formatPercent(scopedSummary.totalTokens > 0 ? scopedSummary.inputTokens / scopedSummary.totalTokens : 0)}`,
      variant: 'secondary',
    },
    {
      label: t('monitoring.output_tokens'),
      value: formatCompactNumber(scopedSummary.outputTokens),
      meta: `${t('monitoring.of_token_mix')} ${formatPercent(scopedSummary.totalTokens > 0 ? scopedSummary.outputTokens / scopedSummary.totalTokens : 0)}`,
      variant: 'secondary',
    },
    {
      label: t('monitoring.cached_tokens'),
      value: formatCompactNumber(scopedSummary.cachedTokens),
      meta: `${t('monitoring.of_input_tokens')} ${formatPercent(scopedSummary.inputTokens > 0 ? scopedSummary.cachedTokens / scopedSummary.inputTokens : 0)}`,
      variant: 'secondary',
    },
  ];

  const restoreFocusSnapshot = useCallback(() => {
    const snapshot = focusSnapshotRef.current;
    focusSnapshotRef.current = null;
    setFocusedAccount(null);

    if (!snapshot) {
      setSelectedAccount('all');
      return;
    }

    setSearchInput(snapshot.searchInput);
    setSelectedAccount(snapshot.selectedAccount);
    setSelectedProvider(snapshot.selectedProvider);
    setSelectedModel(snapshot.selectedModel);
    setSelectedChannel(snapshot.selectedChannel);
    setSelectedApiKeyHash(snapshot.selectedApiKeyHash);
    setSelectedStatus(snapshot.selectedStatus);
  }, []);

  const clearFilters = useCallback(() => {
    focusSnapshotRef.current = null;
    setFocusedAccount(null);
    setSearchInput('');
    setSelectedAccount('all');
    setSelectedProvider('all');
    setSelectedModel('all');
    setSelectedChannel('all');
    setSelectedApiKeyHash('all');
    setSelectedStatus('all');
  }, []);

  const renderMonitoringEmptyState = () => (
    <div className={styles.emptyTable}>
      <strong>
        {hasActiveDataFilter ? t('monitoring.no_filtered_data') : t('monitoring.no_data')}
      </strong>
      {!hasActiveDataFilter ? <span>{t('monitoring.empty_diagnostics_body')}</span> : null}
    </div>
  );

  const openCustomRangeModal = useCallback(() => {
    setCustomDraftStartInput(customStartInput || getTodayStartInputValue());
    setCustomDraftEndInput(customEndInput || getCurrentInputValue());
    setIsCustomRangeModalOpen(true);
  }, [customEndInput, customStartInput]);

  const handleTimeRangeChange = useCallback(
    (range: MonitoringTimeRange) => {
      if (range === 'custom') {
        openCustomRangeModal();
        return;
      }
      setIsCustomRangeModalOpen(false);
      setTimeRange(range);
    },
    [openCustomRangeModal]
  );

  const handleCustomDraftStartChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setCustomDraftStartInput(event.target.value);
  }, []);

  const handleCustomDraftEndChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setCustomDraftEndInput(event.target.value);
  }, []);

  const applyCustomTimeRange = useCallback(() => {
    if (customDraftTimeRangeError) return;
    setCustomStartInput(customDraftStartInput);
    setCustomEndInput(customDraftEndInput);
    setTimeRange('custom');
    setIsCustomRangeModalOpen(false);
  }, [customDraftEndInput, customDraftStartInput, customDraftTimeRangeError]);

  const toggleFailedOnly = useCallback(() => {
    setSelectedStatus((previous) => (previous === 'failed' ? 'all' : 'failed'));
  }, []);

  const loadAccountQuota = useCallback(
    async (account: string, force: boolean = false) => {
      const currentState = accountQuotaStatesRef.current[account];
      const targets = accountQuotaTargetsByAccount.get(account) ?? [];
      const targetKey = targets.map((target) => target.key).join('|');
      if (
        !force &&
        currentState &&
        currentState.status !== 'idle' &&
        currentState.targetKey === targetKey
      ) {
        return;
      }

      const requestId = (accountQuotaRequestIdsRef.current[account] ?? 0) + 1;
      accountQuotaRequestIdsRef.current[account] = requestId;

      setAccountQuotaStates((previous) => ({
        ...previous,
        [account]: {
          status: 'loading',
          targetKey,
          entries:
            previous[account]?.targetKey === targetKey ? (previous[account]?.entries ?? []) : [],
          lastRefreshedAt: previous[account]?.lastRefreshedAt,
        },
      }));

      if (targets.length === 0) {
        if (accountQuotaRequestIdsRef.current[account] !== requestId) return;
        setAccountQuotaStates((previous) => ({
          ...previous,
          [account]: {
            status: 'success',
            targetKey,
            entries: [],
            lastRefreshedAt: Date.now(),
          },
        }));
        return;
      }

      const settled = await Promise.allSettled(
        targets.map((target) => requestAccountQuota(target, t))
      );
      if (accountQuotaRequestIdsRef.current[account] !== requestId) return;

      const entries = settled.map((result, index) => {
        const fallback = targets[index];
        if (result.status === 'fulfilled') {
          return result.value;
        }

        const error =
          result.reason instanceof Error
            ? result.reason.message
            : String(result.reason || t('common.unknown_error'));
        return {
          key: fallback.key,
          authLabel: fallback.authLabel,
          fileName: fallback.fileName,
          planType: fallback.planType,
          windows: [],
          error,
        } satisfies AccountQuotaEntry;
      });

      const hasSuccess = entries.some((entry) => !entry.error);
      setAccountQuotaStates((previous) => ({
        ...previous,
        [account]: {
          status: hasSuccess ? 'success' : 'error',
          targetKey,
          entries,
          error: hasSuccess ? '' : entries[0]?.error || t('common.unknown_error'),
          lastRefreshedAt: Date.now(),
        },
      }));
    },
    [accountQuotaTargetsByAccount, t]
  );

  const toggleAccountExpanded = useCallback(
    (accountId: string, account: string) => {
      if (!expandedAccounts[accountId]) {
        void loadAccountQuota(account);
      }
      setExpandedAccounts((previous) => ({
        ...previous,
        [accountId]: !previous[accountId],
      }));
    },
    [expandedAccounts, loadAccountQuota]
  );

  const focusAccount = useCallback(
    (account: string) => {
      if (focusedAccount === account) {
        restoreFocusSnapshot();
        return;
      }

      if (!focusSnapshotRef.current) {
        focusSnapshotRef.current = {
          searchInput,
          selectedAccount,
          selectedProvider,
          selectedModel,
          selectedChannel,
          selectedApiKeyHash,
          selectedStatus,
        };
      }

      setFocusedAccount(account);
      setSelectedAccount(account);
    },
    [
      focusedAccount,
      restoreFocusSnapshot,
      searchInput,
      selectedAccount,
      selectedApiKeyHash,
      selectedChannel,
      selectedModel,
      selectedProvider,
      selectedStatus,
    ]
  );

  const handleAccountFilterChange = useCallback(
    (value: string) => {
      setSelectedAccount(value);

      if (focusedAccount && value !== focusedAccount) {
        focusSnapshotRef.current = null;
        setFocusedAccount(null);
      }
    },
    [focusedAccount]
  );

  const handleAccountPageSizeChange = useCallback(
    (pageSize: number) => {
      setAccountPageSizeByMode((previous) => ({
        ...previous,
        [accountOverviewMode]: normalizeAccountOverviewPageSize(pageSize, accountOverviewMode),
      }));
      resetCurrentAccountPage();
    },
    [accountOverviewMode, resetCurrentAccountPage]
  );

  const handleAccountStatusToggle = useCallback(
    async (row: MonitoringAccountRow, enabled: boolean) => {
      const authState = accountAuthStateByRowId.get(row.id);
      const fileNames = authState?.toggleableFileNames ?? [];
      if (fileNames.length === 0) return;

      setAccountStatusUpdating((previous) => ({ ...previous, [row.id]: true }));

      const results = await Promise.allSettled(
        fileNames.map((fileName) => authFilesApi.setStatusWithFallback(fileName, !enabled))
      );

      const successCount = results.filter((result) => result.status === 'fulfilled').length;
      const failureCount = results.length - successCount;

      try {
        await refreshMeta(false);
      } finally {
        setAccountStatusUpdating((previous) => {
          const next = { ...previous };
          delete next[row.id];
          return next;
        });
      }

      if (failureCount === 0) {
        showNotification(
          enabled
            ? t('monitoring.account_overview_status_enabled_success', { count: successCount })
            : t('monitoring.account_overview_status_disabled_success', { count: successCount }),
          'success'
        );
        return;
      }

      showNotification(
        t('monitoring.account_overview_status_partial', {
          success: successCount,
          failed: failureCount,
        }),
        successCount > 0 ? 'warning' : 'error'
      );
    },
    [accountAuthStateByRowId, refreshMeta, showNotification, t]
  );

  const handleRealtimePageSizeChange = useCallback((pageSize: number) => {
    setRealtimePageSize(pageSize);
    setRealtimePage(1);
  }, []);

  const handleAccountSortKeyChange = useCallback(
    (key: AccountSortKey) => {
      resetCurrentAccountPage();
      setAccountSort((previous) =>
        previous.key === key
          ? previous
          : {
              key,
              direction: 'desc',
            }
      );
    },
    [resetCurrentAccountPage]
  );

  const handleAccountSort = useCallback(
    (key: AccountSortKey) => {
      resetCurrentAccountPage();
      setAccountSort((previous) =>
        previous.key === key
          ? {
              key,
              direction: previous.direction === 'desc' ? 'asc' : 'desc',
            }
          : {
              key,
              direction: 'desc',
            }
      );
    },
    [resetCurrentAccountPage]
  );

  const handleAccountPageChange = useCallback(
    (page: number) => {
      setCurrentAccountPage(page);
    },
    [setCurrentAccountPage]
  );

  const handlePriceModelChange = useCallback(
    (value: string) => {
      setPriceModel(value);
      setPriceDraft(createPriceDraft(modelPrices[value]));
    },
    [modelPrices]
  );

  const handlePriceDraftChange = useCallback((field: keyof PriceDraft, value: string) => {
    setPriceDraft((previous) => ({ ...previous, [field]: value }));
  }, []);

  const resetPriceEditor = useCallback(() => {
    setPriceModel('');
    setPriceDraft(createPriceDraft());
  }, []);

  const handleSavePrice = useCallback(async () => {
    if (!priceModel) {
      return;
    }

    const prompt = parsePriceValue(priceDraft.prompt);
    const completion = parsePriceValue(priceDraft.completion);
    const cache = priceDraft.cache.trim() === '' ? prompt : parsePriceValue(priceDraft.cache);

    await setModelPrices({
      ...modelPrices,
      [priceModel]: {
        prompt,
        completion,
        cache,
      },
    });
    showNotification(t('usage_stats.model_price_saved'), 'success');
  }, [
    modelPrices,
    priceDraft.cache,
    priceDraft.completion,
    priceDraft.prompt,
    priceModel,
    setModelPrices,
    showNotification,
    t,
  ]);

  const handleDeletePrice = useCallback(
    async (model: string) => {
      const nextPrices = { ...modelPrices };
      delete nextPrices[model];
      await setModelPrices(nextPrices);

      if (priceModel === model) {
        resetPriceEditor();
      }
    },
    [modelPrices, priceModel, resetPriceEditor, setModelPrices]
  );

  const handleSyncModelPrices = useCallback(async () => {
    if (syncPriceModels.length === 0) {
      showNotification(t('usage_stats.model_price_sync_no_models'), 'warning');
      return;
    }
    setSyncingPrices(true);
    try {
      const result = await syncModelPrices(syncPriceModels);
      showNotification(
        t('usage_stats.model_price_sync_success', {
          count: result.imported,
          source: result.source || 'LiteLLM',
        }),
        'success'
      );
    } catch (error: unknown) {
      const rawMessage =
        error instanceof Error ? error.message : String(error || t('common.unknown_error'));
      const message =
        rawMessage === 'model_price_sync_requires_usage_service'
          ? t('usage_stats.model_price_sync_requires_usage_service')
          : rawMessage;
      showNotification(`${t('usage_stats.model_price_sync_failed')}: ${message}`, 'error');
    } finally {
      setSyncingPrices(false);
    }
  }, [showNotification, syncModelPrices, syncPriceModels, t]);

  const resolveUsageTransferError = useCallback(
    (error: unknown) => {
      const rawMessage =
        error instanceof Error ? error.message : String(error || t('common.unknown_error'));
      return rawMessage === 'usage_import_export_requires_usage_service'
        ? t('usage_stats.import_export_requires_usage_service')
        : rawMessage;
    },
    [t]
  );

  const handleUsageExport = useCallback(async () => {
    setUsageExporting(true);
    try {
      const response = await exportUsage();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      downloadBlob({
        filename: response.filename || `usage-events-${timestamp}.jsonl`,
        blob: response.blob,
      });
      showNotification(t('usage_stats.export_success'), 'success');
    } catch (error: unknown) {
      const message = resolveUsageTransferError(error);
      showNotification(
        `${t('notification.download_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setUsageExporting(false);
    }
  }, [exportUsage, resolveUsageTransferError, showNotification, t]);

  const importUsageFile = useCallback(
    async (file: File) => {
      setUsageImporting(true);
      try {
        const result = await importUsage(file);
        const unsupported = result.unsupported ?? 0;
        showNotification(
          `${t('usage_stats.import_success', {
            added: result.added ?? 0,
            skipped: result.skipped ?? 0,
            total: result.total ?? 0,
            failed: result.failed ?? 0,
          })}${unsupported > 0 ? `, ${t('usage_stats.import_unsupported', { count: unsupported })}` : ''}`,
          (result.failed ?? 0) > 0 || unsupported > 0 ? 'warning' : 'success'
        );
        if (result.format?.startsWith('legacy') || (result.warnings ?? []).length > 0) {
          showNotification(t('usage_stats.import_legacy_warning'), 'warning');
        }
        await refreshAll();
      } catch (error: unknown) {
        const message = resolveUsageTransferError(error);
        showNotification(
          `${t('notification.upload_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      } finally {
        setUsageImporting(false);
      }
    },
    [importUsage, refreshAll, resolveUsageTransferError, showNotification, t]
  );

  const handleUsageImportClick = useCallback(() => {
    if (!usageServiceAvailable) {
      showNotification(t('usage_stats.import_export_requires_usage_service'), 'warning');
      return;
    }
    usageImportInputRef.current?.click();
  }, [showNotification, t, usageServiceAvailable]);

  const handleUsageImportChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      if (!isUsageImportFile(file)) {
        showNotification(t('usage_stats.import_invalid'), 'error');
        return;
      }
      if (file.size > MAX_USAGE_IMPORT_FILE_SIZE) {
        showNotification(
          t('usage_stats.import_file_too_large', {
            maxSize: formatFileSize(MAX_USAGE_IMPORT_FILE_SIZE),
          }),
          'error'
        );
        return;
      }

      showConfirmation({
        title: t('usage_stats.import_confirm_title'),
        message: t('usage_stats.import_confirm_body', { name: file.name }),
        confirmText: t('usage_stats.import'),
        variant: 'primary',
        onConfirm: () => importUsageFile(file),
      });
    },
    [importUsageFile, showConfirmation, showNotification, t]
  );

  return (
    <div className={styles.page}>
      {overallLoading && !usage ? (
        <div className={styles.loadingOverlay} aria-busy="true">
          <div className={styles.loadingOverlayContent}>
            <LoadingSpinner size={28} />
            <span>{t('common.loading')}</span>
          </div>
        </div>
      ) : null}

      <div className={styles.headerShell}>
        <div className={styles.pageHeader}>
          <h1 className={styles.pageTitle}>{t('monitoring.title')}</h1>
          <p className={styles.description}>{t('monitoring.console_subtitle')}</p>
        </div>

        <div className={styles.statusBar}>
          <span className={`${styles.statusBadge} ${styles[`tone${connectionTone}`]}`}>
            <span className={styles.statusDot} aria-hidden="true" />
            {connectionLabel}
          </span>
          <div className={styles.statusMeta}>
            <span>
              {t('monitoring.last_sync')}:{' '}
              {lastRefreshedAt ? lastRefreshedAt.toLocaleTimeString(i18n.language) : '--'}
            </span>
            <span className={scopedFailureCount > 0 ? styles.statusMetaWarn : undefined}>
              {`${t('monitoring.recent_failures')}: ${scopedFailureCount}`}
            </span>
            <span>{`${t('monitoring.total_calls')}: ${formatCompactNumber(scopedSummary.totalCalls)}`}</span>
          </div>
        </div>
      </div>

      {monitoringUnavailable ? (
        <div className={styles.callout}>
          <strong>{monitoringUnavailableTitle}</strong>
          <span>{monitoringUnavailableBody}</span>
          <Link
            to="/config"
            className={styles.configLink}
            onClick={() => localStorage.setItem('config-management:tab', 'manager')}
          >
            {t('monitoring.open_manager_config')}
          </Link>
        </div>
      ) : null}

      <section className={styles.actionBar} aria-label={t('common.action')}>
        <div className={styles.actionGroup}>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={() => void handleUsageExport()}
            disabled={!usageServiceAvailable || usageExporting || usageImporting}
            title={
              usageServiceAvailable
                ? t('usage_stats.export')
                : t('usage_stats.import_export_requires_usage_service')
            }
          >
            <IconDownload size={16} />
            <span>{usageExporting ? t('common.loading') : t('usage_stats.export')}</span>
          </button>
          <button
            type="button"
            className={`${styles.actionButton} ${styles.actionButtonPrimary}`}
            onClick={handleUsageImportClick}
            disabled={!usageServiceAvailable || usageExporting || usageImporting}
            title={
              usageServiceAvailable
                ? t('usage_stats.import')
                : t('usage_stats.import_export_requires_usage_service')
            }
          >
            <IconFileText size={16} />
            <span>{usageImporting ? t('common.loading') : t('usage_stats.import')}</span>
          </button>
          <button
            type="button"
            className={styles.actionButton}
            onClick={() => setIsPriceModalOpen(true)}
          >
            <IconSettings size={16} />
            <span>{t('usage_stats.model_price_settings')}</span>
          </button>
          <input
            ref={usageImportInputRef}
            type="file"
            accept=".json,.jsonl,.ndjson,.txt,application/json,application/x-ndjson,text/plain"
            style={{ display: 'none' }}
            onChange={handleUsageImportChange}
          />
        </div>

        <div className={`${styles.actionGroup} ${styles.actionGroupNav}`}>
          <Link
            to="/monitoring/codex-inspection"
            className={`${styles.actionButton} ${styles.quickNavLink}`}
          >
            <IconChartLine size={16} />
            <span>{t('monitoring.codex_inspection_entry')}</span>
            <IconExternalLink size={14} />
          </Link>
          {config?.loggingToFile ? (
            <Link to="/logs" className={`${styles.actionButton} ${styles.quickNavLink}`}>
              <IconFileText size={16} />
              <span>{t('monitoring.open_logs')}</span>
              <IconExternalLink size={14} />
            </Link>
          ) : null}
        </div>
      </section>

      <MonitoringPanel className={styles.toolbarPanel}>
        <div className={styles.controlBar}>
          <div className={styles.segmentedControl}>
            {TIME_RANGE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`${styles.segmentButton} ${timeRange === option.value ? styles.segmentButtonActive : ''}`}
                onClick={() => handleTimeRangeChange(option.value)}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>

          <div className={styles.refreshControls}>
            <div className={styles.autoRefreshField}>
              <span className={styles.autoRefreshLabel}>
                <IconTimer size={16} />
                {t('monitoring.auto_refresh')}
              </span>
              <Select
                className={styles.autoRefreshSelect}
                triggerClassName={styles.autoRefreshSelectTrigger}
                value={autoRefreshMs}
                options={AUTO_REFRESH_OPTIONS.map((option) => ({
                  value: option.value,
                  label: t(option.labelKey),
                }))}
                onChange={setAutoRefreshMs}
                ariaLabel={t('monitoring.auto_refresh')}
                fullWidth={false}
              />
            </div>

            <button
              type="button"
              className={styles.refreshButton}
              onClick={() => void refreshAll()}
              disabled={overallLoading}
            >
              <IconRefreshCw
                size={16}
                className={overallLoading ? styles.refreshIconSpinning : styles.refreshIcon}
              />
              <span className={styles.refreshButtonLabel}>{t('usage_stats.refresh')}</span>
            </button>
          </div>
        </div>

        <div className={styles.filterBar}>
          <div className={styles.filterGrid}>
            <div className={styles.filterAccountStack}>
              <Select
                value={selectedAccount}
                options={accountOptions}
                onChange={handleAccountFilterChange}
                ariaLabel={t('monitoring.filter_account')}
              />
            </div>
            <Select
              value={selectedProvider}
              options={providerOptions}
              onChange={setSelectedProvider}
              ariaLabel={t('monitoring.filter_provider')}
            />
            <Select
              value={selectedModel}
              options={modelOptions}
              onChange={setSelectedModel}
              ariaLabel={t('monitoring.filter_model')}
            />
            <Select
              value={selectedChannel}
              options={channelOptions}
              onChange={setSelectedChannel}
              ariaLabel={t('monitoring.filter_channel')}
            />
            <Select
              value={selectedApiKeyHash}
              options={apiKeyOptions}
              onChange={setSelectedApiKeyHash}
              ariaLabel={t('monitoring.filter_api_key')}
            />
            <Select
              value={selectedStatus}
              options={statusOptions}
              onChange={(value) => setSelectedStatus(value as StatusFilter)}
              ariaLabel={t('monitoring.filter_status')}
            />
          </div>

          <div className={styles.filterSearchRow}>
            <div className={styles.filterSearchInputWrap}>
              <Input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder={t('monitoring.search_placeholder')}
                className={styles.filterSearchInput}
                rightElement={<IconSearch size={16} />}
                aria-label={t('monitoring.search_placeholder')}
              />
            </div>
            <div className={styles.filterSearchAction}>
              <button type="button" className={styles.clearButton} onClick={clearFilters}>
                <IconSlidersHorizontal size={16} />
                <span>{t('monitoring.clear_filters')}</span>
              </button>
            </div>
          </div>
        </div>

        {combinedError ? <div className={styles.errorBox}>{combinedError}</div> : null}
        {!config?.usageStatisticsEnabled ? (
          <div className={styles.callout}>
            <strong>{t('monitoring.usage_disabled_title')}</strong>
            <span>{t('monitoring.usage_disabled_body')}</span>
          </div>
        ) : null}
      </MonitoringPanel>

      <section className={styles.summarySection}>
        <div className={styles.summaryHero}>
          {primarySummaryCards.map((card) => (
            <SummaryCard key={card.label} {...card} />
          ))}
        </div>
        <div className={styles.summarySub}>
          {secondarySummaryCards.map((card) => (
            <SummaryCard key={card.label} {...card} />
          ))}
        </div>
      </section>

      <MonitoringPanel
        title={
          <span className={styles.panelTitleWithHint}>
            {t('monitoring.account_overview_title')}
            <span title={t('monitoring.account_overview_description')}>
              <IconInfo
                size={14}
                className={styles.panelTitleHintIcon}
                aria-label={t('monitoring.account_overview_description')}
              />
            </span>
          </span>
        }
        className={styles.accountPanel}
        extra={
          <div className={styles.accountOverviewHeaderActions}>
            <div className={styles.accountOverviewToolbarRow}>
              <div className={styles.accountOverviewSearchWrap}>
                <Input
                  value={searchInput}
                  onChange={(event) => setSearchInput(event.target.value)}
                  placeholder={t('monitoring.account_overview_search_placeholder')}
                  className={styles.accountOverviewSearchInput}
                  rightElement={<IconSearch size={16} />}
                  aria-label={t('monitoring.account_overview_search_placeholder')}
                />
              </div>
              <button
                type="button"
                className={styles.accountOverviewToolButton}
                onClick={() => void refreshAll()}
                disabled={overallLoading}
              >
                <IconRefreshCw
                  size={15}
                  className={overallLoading ? styles.refreshIconSpinning : styles.refreshIcon}
                />
                <span>{t('common.refresh')}</span>
              </button>
              <div className={styles.accountOverviewSortBar}>
                <Select
                  className={styles.accountOverviewSortSelect}
                  triggerClassName={styles.accountOverviewSortSelectTrigger}
                  value={accountSort.key}
                  options={accountSortOptions}
                  onChange={(value) => handleAccountSortKeyChange(value as AccountSortKey)}
                  ariaLabel={t('monitoring.account_overview_sort_label')}
                  fullWidth={false}
                />
              </div>

              <div className={`${styles.segmentedControl} ${styles.accountOverviewModeToggle}`}>
                <button
                  type="button"
                  className={`${styles.segmentButton} ${accountOverviewMode === 'table' ? styles.segmentButtonActive : ''}`}
                  onClick={() => setAccountOverviewMode('table')}
                >
                  {t('monitoring.account_overview_view_mode_table')}
                </button>
                <button
                  type="button"
                  className={`${styles.segmentButton} ${accountOverviewMode === 'card' ? styles.segmentButtonActive : ''}`}
                  onClick={() => setAccountOverviewMode('card')}
                >
                  {t('monitoring.account_overview_view_mode_card')}
                </button>
              </div>
            </div>
          </div>
        }
      >
        {accountOverviewMode === 'table' ? (
          <div className={`${styles.tableWrapper} ${styles.accountOverviewTableWrapper}`}>
            <table className={`${styles.table} ${styles.accountOverviewTable}`}>
              <colgroup>
                {accountOverviewColumns.map((column) => (
                  <col key={column.key} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  {accountOverviewColumns.map((column) => {
                    const sortKey = column.sortKey;

                    if (!sortKey) {
                      return <th key={column.key}>{column.label}</th>;
                    }

                    const isActive = accountSort.key === sortKey;
                    const SortIcon = isActive
                      ? accountSort.direction === 'desc'
                        ? IconChevronDown
                        : IconChevronUp
                      : null;

                    return (
                      <th
                        key={column.key}
                        aria-sort={
                          isActive
                            ? accountSort.direction === 'desc'
                              ? 'descending'
                              : 'ascending'
                            : 'none'
                        }
                      >
                        <button
                          type="button"
                          className={[
                            styles.sortableHeaderButton,
                            isActive ? styles.sortableHeaderButtonActive : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => handleAccountSort(sortKey)}
                        >
                          <span>{column.label}</span>
                          <span className={styles.sortIndicator} aria-hidden="true">
                            {SortIcon ? <SortIcon size={14} /> : null}
                          </span>
                        </button>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {accountPagination.pageItems.map((row) => {
                  const isExpanded = Boolean(expandedAccounts[row.id]);
                  const isFocused = focusedAccount === row.account;
                  const authState = accountAuthStateByRowId.get(row.id) ?? EMPTY_ACCOUNT_AUTH_STATE;
                  const statusTone = getAccountStatusTone(authState);
                  const summaryMetrics = buildAccountSummaryMetrics(
                    row,
                    hasPrices,
                    i18n.language,
                    t
                  );
                  const metricByKey = new Map(summaryMetrics.map((metric) => [metric.key, metric]));
                  const rowClassName = [
                    styles.accountSummaryRow,
                    isFocused ? styles.focusedRow : '',
                    isExpanded ? styles.accountOverviewRowExpanded : '',
                    authState.enabledState === 'disabled' ? styles.accountOverviewRowDisabled : '',
                  ]
                    .filter(Boolean)
                    .join(' ');
                  const accountMenuItems: DropdownMenuItem[] = [];
                  if (authState.enabledState === 'enabled') {
                    accountMenuItems.push({
                      key: 'disable',
                      label: t('monitoring.account_overview_row_menu_disable'),
                      onClick: () => void handleAccountStatusToggle(row, false),
                      disabled: accountStatusUpdating[row.id] === true,
                      tone: 'danger',
                    });
                  } else if (authState.enabledState === 'disabled') {
                    accountMenuItems.push({
                      key: 'enable',
                      label: t('monitoring.account_overview_row_menu_enable'),
                      onClick: () => void handleAccountStatusToggle(row, true),
                      disabled: accountStatusUpdating[row.id] === true,
                    });
                  } else if (authState.enabledState === 'mixed') {
                    accountMenuItems.push(
                      {
                        key: 'enable-all',
                        label: t('monitoring.account_overview_row_menu_enable_all'),
                        onClick: () => void handleAccountStatusToggle(row, true),
                        disabled: accountStatusUpdating[row.id] === true,
                      },
                      {
                        key: 'disable-all',
                        label: t('monitoring.account_overview_row_menu_disable_all'),
                        onClick: () => void handleAccountStatusToggle(row, false),
                        disabled: accountStatusUpdating[row.id] === true,
                        tone: 'danger',
                      }
                    );
                  }
                  accountMenuItems.push({
                    key: 'refresh-quota',
                    label: t('monitoring.account_overview_row_menu_refresh_quota'),
                    onClick: () => void loadAccountQuota(row.account, true),
                  });

                  return (
                    <Fragment key={row.id}>
                      <tr className={rowClassName || undefined}>
                        <td>
                          <AccountSummaryPrimary
                            row={row}
                            expanded={isExpanded}
                            onToggle={() => toggleAccountExpanded(row.id, row.account)}
                            statusTone={statusTone}
                          />
                        </td>
                        <td>
                          <AccountStatusBadge authState={authState} t={t} />
                        </td>
                        <td>{metricByKey.get('total-calls')?.value ?? '--'}</td>
                        <td className={metricByKey.get('success-calls')?.valueClassName}>
                          {metricByKey.get('success-calls')?.value ?? '--'}
                        </td>
                        <td className={metricByKey.get('failure-calls')?.valueClassName}>
                          {metricByKey.get('failure-calls')?.value ?? '--'}
                        </td>
                        <td className={getSuccessRateClassName(row.successRate)}>
                          {formatPercent(row.successRate)}
                        </td>
                        <td>{metricByKey.get('total-tokens')?.value ?? '--'}</td>
                        <td>{metricByKey.get('estimated-cost')?.value ?? '--'}</td>
                        <td>{metricByKey.get('latest-request-time')?.value ?? '--'}</td>
                        <td>
                          <div className={styles.accountActionGroup}>
                            <button
                              type="button"
                              className={styles.inlineActionButton}
                              onClick={() => focusAccount(row.account)}
                            >
                              <IconCrosshair size={13} aria-hidden="true" />
                              <span>
                                {isFocused
                                  ? t('monitoring.restore_account_scope')
                                  : t('monitoring.focus_account')}
                              </span>
                            </button>
                            <DropdownMenu
                              ariaLabel={t('monitoring.account_overview_row_menu_label')}
                              triggerClassName={styles.accountRowMenuButton}
                              triggerIcon={<IconMoreVertical size={15} aria-hidden="true" />}
                              items={accountMenuItems}
                            />
                          </div>
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr className={styles.accountDetailRow}>
                          <td colSpan={accountOverviewColumns.length}>
                            <AccountExpandedDetails
                              row={row}
                              hasPrices={hasPrices}
                              locale={i18n.language}
                              t={t}
                              summaryMetrics={summaryMetrics}
                              quotaState={accountQuotaStates[row.account]}
                              onRefreshQuota={() => void loadAccountQuota(row.account, true)}
                              variant="table"
                            />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {sortedAccountRows.length === 0 ? (
                  <tr>
                    <td colSpan={accountOverviewColumns.length}>{renderMonitoringEmptyState()}</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : sortedAccountRows.length > 0 ? (
          <div className={styles.accountOverviewCardGrid}>
            {accountPagination.pageItems.map((row) => {
              const authState = accountAuthStateByRowId.get(row.id) ?? EMPTY_ACCOUNT_AUTH_STATE;

              return (
                <AccountOverviewCard
                  key={row.id}
                  row={row}
                  authState={authState}
                  hasPrices={hasPrices}
                  locale={i18n.language}
                  t={t}
                  isExpanded={Boolean(expandedAccounts[row.id])}
                  isFocused={focusedAccount === row.account}
                  statusData={accountStatusDataByRowId.get(row.id) ?? emptyAccountStatusData}
                  scopeText={accountOverviewScopeText}
                  quotaState={accountQuotaStates[row.account]}
                  statusUpdating={accountStatusUpdating[row.id] === true}
                  onToggle={() => toggleAccountExpanded(row.id, row.account)}
                  onFocus={() => focusAccount(row.account)}
                  onToggleEnabled={(enabled) => void handleAccountStatusToggle(row, enabled)}
                  onRefreshQuota={() => void loadAccountQuota(row.account, true)}
                />
              );
            })}
          </div>
        ) : (
          renderMonitoringEmptyState()
        )}
        <PaginationControls
          count={sortedAccountRows.length}
          currentPage={accountPagination.currentPage}
          totalPages={accountPagination.totalPages}
          startItem={accountPagination.startItem}
          endItem={accountPagination.endItem}
          pageSize={accountPageSize}
          pageSizeOptions={accountPageSizeOptions}
          onPageChange={handleAccountPageChange}
          onPageSizeChange={handleAccountPageSizeChange}
          t={t}
        />
      </MonitoringPanel>

      <MonitoringPanel
        title={t('monitoring.realtime_table_title')}
        subtitle={t('monitoring.realtime_table_desc')}
        className={styles.realtimePanel}
        extra={
          <div className={`${styles.inlineMetrics} ${styles.realtimeHeaderActions}`}>
            <span>{`${t('monitoring.log_rows')}: ${realtimeLogRows.length}`}</span>
            <span>{`${t('monitoring.recent_failures')}: ${scopedFailureCount}`}</span>
            <button
              type="button"
              className={[
                styles.filterToggleChip,
                failedOnlyActive ? styles.filterToggleChipActive : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={toggleFailedOnly}
            >
              {t('monitoring.filter_status_failed')}
            </button>
          </div>
        }
      >
        <div className={styles.tableWrapper}>
          <table className={`${styles.table} ${styles.realtimeTable}`}>
            <thead>
              <tr>
                <th>{t('monitoring.column_type')}</th>
                <th>{t('monitoring.column_model')}</th>
                <th>{t('monitoring.recent_status')}</th>
                <th>{t('monitoring.request_status')}</th>
                <th>{t('monitoring.column_success_rate')}</th>
                <th>{t('monitoring.total_calls')}</th>
                <th>{t('monitoring.column_latency')}</th>
                <th>{t('monitoring.column_time')}</th>
                <th>{t('monitoring.this_call_usage')}</th>
                <th>{t('monitoring.this_call_cost')}</th>
              </tr>
            </thead>
            <tbody>
              {realtimePagination.pageItems.map((row) => (
                <tr key={row.id} className={row.failed ? styles.logRowFailed : undefined}>
                  <td>
                    <div className={styles.logTypeCell}>
                      <span
                        className={[
                          styles.logTypeIcon,
                          row.failed ? styles.logTypeIconFailed : styles.logTypeIconSuccess,
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        aria-hidden="true"
                      />
                      <div className={styles.primaryCell}>
                        <span>{row.provider}</span>
                        <small>{row.account || row.authLabel || row.accountMasked || '-'}</small>
                      </div>
                    </div>
                  </td>
                  <td>
                    <div className={styles.primaryCell}>
                      <span className={styles.monoCell}>{row.model}</span>
                      <small className={styles.monoCell}>{buildRealtimeMetaText(row)}</small>
                    </div>
                  </td>
                  <td>
                    <div className={styles.recentStatusCell}>
                      <RecentPattern pattern={row.recentPattern} variant="plain" />
                    </div>
                  </td>
                  <td>
                    <StatusBadge tone={row.failed ? 'bad' : 'good'}>
                      {row.failed ? t('monitoring.result_failed') : t('monitoring.result_success')}
                    </StatusBadge>
                  </td>
                  <td
                    className={
                      row.successRate >= 0.95
                        ? styles.goodText
                        : row.successRate >= 0.85
                          ? styles.warnText
                          : styles.badText
                    }
                  >
                    {formatPercent(row.successRate)}
                  </td>
                  <td>{formatCompactNumber(row.requestCount)}</td>
                  <td>
                    <span
                      className={
                        row.latencyMs !== null && row.latencyMs >= 30000
                          ? styles.badText
                          : row.latencyMs !== null && row.latencyMs >= 15000
                            ? styles.warnText
                            : undefined
                      }
                    >
                      {formatDurationMs(row.latencyMs, { locale: i18n.language })}
                    </span>
                  </td>
                  <td>{new Date(row.timestampMs).toLocaleString(i18n.language)}</td>
                  <td>
                    <div className={styles.primaryCell}>
                      <span>{formatCompactNumber(row.totalTokens)}</span>
                      <small>{`I ${formatCompactNumber(row.inputTokens)} · O ${formatCompactNumber(row.outputTokens)} · C ${formatCompactNumber(row.cachedTokens)}`}</small>
                    </div>
                  </td>
                  <td>{hasPrices ? formatUsd(row.totalCost) : '--'}</td>
                </tr>
              ))}
              {realtimeLogRows.length === 0 ? (
                <tr>
                  <td colSpan={10}>{renderMonitoringEmptyState()}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <PaginationControls
          count={realtimeLogRows.length}
          currentPage={realtimePagination.currentPage}
          totalPages={realtimePagination.totalPages}
          startItem={realtimePagination.startItem}
          endItem={realtimePagination.endItem}
          pageSize={realtimePageSize}
          pageSizeOptions={REALTIME_PAGE_SIZE_OPTIONS}
          onPageChange={setRealtimePage}
          onPageSizeChange={handleRealtimePageSizeChange}
          t={t}
        />
      </MonitoringPanel>

      <Modal
        open={isCustomRangeModalOpen}
        onClose={() => setIsCustomRangeModalOpen(false)}
        title={t('monitoring.range_custom')}
        width={560}
        className={styles.monitorModal}
        footer={
          <div className={styles.customRangeModalFooter}>
            <Button variant="secondary" size="sm" onClick={() => setIsCustomRangeModalOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={applyCustomTimeRange}
              disabled={Boolean(customDraftTimeRangeError)}
            >
              {t('common.confirm')}
            </Button>
          </div>
        }
      >
        <div className={styles.customRangeModalBody}>
          <div className={styles.customRangeModalGrid}>
            <Input
              type="datetime-local"
              label={t('monitoring.custom_range_start')}
              value={customDraftStartInput}
              onChange={handleCustomDraftStartChange}
              className={styles.customRangeInput}
              aria-invalid={Boolean(customDraftTimeRangeError)}
            />
            <Input
              type="datetime-local"
              label={t('monitoring.custom_range_end')}
              value={customDraftEndInput}
              onChange={handleCustomDraftEndChange}
              className={styles.customRangeInput}
              aria-invalid={Boolean(customDraftTimeRangeError)}
            />
          </div>
          {customDraftTimeRangeError ? (
            <div className={styles.customRangeError} role="alert">
              {customDraftTimeRangeError}
            </div>
          ) : null}
        </div>
      </Modal>

      <Modal
        open={isPriceModalOpen}
        onClose={() => setIsPriceModalOpen(false)}
        title={t('usage_stats.model_price_settings')}
        width={860}
        className={styles.monitorModal}
      >
        <div className={styles.priceEditor}>
          <div className={styles.priceGrid}>
            <div className={`${styles.priceField} ${styles.priceFieldModel}`}>
              <label>{t('usage_stats.model_name')}</label>
              <Select
                value={priceModel}
                options={priceModelOptions}
                onChange={handlePriceModelChange}
                ariaLabel={t('usage_stats.model_name')}
              />
            </div>
            <div className={`${styles.priceField} ${styles.priceFieldPrompt}`}>
              <label>{`${t('usage_stats.model_price_prompt')} ($/1M)`}</label>
              <Input
                type="number"
                value={priceDraft.prompt}
                onChange={(event) => handlePriceDraftChange('prompt', event.target.value)}
                placeholder="0.0000"
                step="0.0001"
              />
            </div>
            <div className={`${styles.priceField} ${styles.priceFieldCompletion}`}>
              <label>{`${t('usage_stats.model_price_completion')} ($/1M)`}</label>
              <Input
                type="number"
                value={priceDraft.completion}
                onChange={(event) => handlePriceDraftChange('completion', event.target.value)}
                placeholder="0.0000"
                step="0.0001"
              />
            </div>
            <div className={`${styles.priceField} ${styles.priceFieldCache}`}>
              <label>{`${t('usage_stats.model_price_cache')} ($/1M)`}</label>
              <Input
                type="number"
                value={priceDraft.cache}
                onChange={(event) => handlePriceDraftChange('cache', event.target.value)}
                placeholder="0.0000"
                step="0.0001"
              />
            </div>
          </div>

          <div className={styles.priceActionsBar}>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSyncModelPrices}
              loading={syncingPrices}
            >
              {t('usage_stats.model_price_sync')}
            </Button>
            <Button variant="secondary" size="sm" onClick={resetPriceEditor}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleSavePrice} disabled={!priceModel}>
              {t('common.save')}
            </Button>
          </div>
        </div>

        <div className={styles.savedPricesList}>
          <div className={styles.savedPricesHeader}>{t('usage_stats.saved_prices')}</div>
          {savedPriceEntries.length > 0 ? (
            <div className={styles.savedPricesTableWrap}>
              <table className={styles.savedPricesTable}>
                <thead>
                  <tr>
                    <th>{t('usage_stats.model_name')}</th>
                    <th>{t('usage_stats.model_price_prompt')}</th>
                    <th>{t('usage_stats.model_price_completion')}</th>
                    <th>{t('usage_stats.model_price_cache')}</th>
                    <th>{t('common.action')}</th>
                  </tr>
                </thead>
                <tbody>
                  {savedPriceEntries.map(([model, price]) => (
                    <tr key={model}>
                      <td className={`${styles.monoCell} ${styles.savedPricesModelCell}`}>
                        {model}
                      </td>
                      <td>{formatPriceUnit(price.prompt)}</td>
                      <td>{formatPriceUnit(price.completion)}</td>
                      <td>{formatPriceUnit(price.cache)}</td>
                      <td className={styles.savedPricesActionsCell}>
                        <div className={styles.savedPricesActions}>
                          <button
                            type="button"
                            className={styles.inlineActionButton}
                            onClick={() => handlePriceModelChange(model)}
                          >
                            {t('common.edit')}
                          </button>
                          <button
                            type="button"
                            className={styles.inlineActionButton}
                            onClick={() => handleDeletePrice(model)}
                          >
                            {t('common.delete')}
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={styles.emptyBlockSmall}>{t('usage_stats.model_price_empty')}</div>
          )}
        </div>
      </Modal>
    </div>
  );
}
