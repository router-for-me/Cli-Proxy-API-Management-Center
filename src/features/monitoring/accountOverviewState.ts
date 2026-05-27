import type { AuthFileItem } from '@/types';
import { normalizeRecentRequestAuthIndex, type StatusBarData } from '@/utils/recentRequests';
import type {
  MonitoringAccountRow,
  MonitoringEventRow,
  MonitoringTimeRange,
} from './hooks/useMonitoringData';

export type MonitoringAccountOverviewMode = 'table' | 'card';

export type MonitoringStatusFilter = 'all' | 'success' | 'failed';

export type MonitoringFilters = {
  account: string;
  provider: string;
  model: string;
  channel: string;
  apiKeyHash: string;
  status: MonitoringStatusFilter;
};

export const MONITORING_AUTO_REFRESH_VALUES = [
  '0',
  '5000',
  '10000',
  '30000',
  '60000',
  '300000',
] as const;
export type MonitoringAutoRefreshValue = (typeof MONITORING_AUTO_REFRESH_VALUES)[number];
const MONITORING_AUTO_REFRESH_SET = new Set<string>(MONITORING_AUTO_REFRESH_VALUES);

export const MONITORING_API_KEY_PAGE_SIZE_OPTIONS = [12, 20, 50, 100] as const;
export const MONITORING_REALTIME_PAGE_SIZE_OPTIONS = [10, 50, 100, 150, 300] as const;

export type MonitoringPageSizes = {
  tableAccount: number;
  apiKey: number;
  realtime: number;
};

const MONITORING_TIME_RANGE_VALUES: readonly MonitoringTimeRange[] = [
  'today',
  '7d',
  '14d',
  '30d',
  'all',
  'custom',
];
const MONITORING_TIME_RANGE_SET = new Set<MonitoringTimeRange>(MONITORING_TIME_RANGE_VALUES);

export const DEFAULT_MONITORING_FILTERS: MonitoringFilters = {
  account: 'all',
  provider: 'all',
  model: 'all',
  channel: 'all',
  apiKeyHash: 'all',
  status: 'all',
};

export const DEFAULT_MONITORING_AUTO_REFRESH_MS: MonitoringAutoRefreshValue = '5000';
export const DEFAULT_MONITORING_TIME_RANGE: MonitoringTimeRange = 'today';

export type AccountSortKey =
  | 'totalCalls'
  | 'successCalls'
  | 'failureCalls'
  | 'successRate'
  | 'totalTokens'
  | 'inputTokens'
  | 'outputTokens'
  | 'cachedTokens'
  | 'totalCost'
  | 'lastSeenAt';

export type AccountSortDirection = 'asc' | 'desc';

export type AccountSortState = {
  key: AccountSortKey;
  direction: AccountSortDirection;
};

export const ACCOUNT_OVERVIEW_MODE_STORAGE_KEY = 'monitoring.accountOverviewMode';
export const ACCOUNT_OVERVIEW_UI_STATE_STORAGE_KEY = 'monitoring.accountOverviewUiState';
export const MONITORING_TRANSIENT_STATE_STORAGE_KEY = 'monitoring.transientUiState';
export const ACCOUNT_OVERVIEW_TABLE_PAGE_SIZE_OPTIONS = [12, 20, 50, 100] as const;
export const ACCOUNT_OVERVIEW_CARD_PAGE_SIZE_OPTIONS = [12, 18, 24, 36] as const;

export const DEFAULT_MONITORING_PAGE_SIZES: MonitoringPageSizes = {
  tableAccount: ACCOUNT_OVERVIEW_TABLE_PAGE_SIZE_OPTIONS[0],
  apiKey: MONITORING_API_KEY_PAGE_SIZE_OPTIONS[0],
  realtime: MONITORING_REALTIME_PAGE_SIZE_OPTIONS[0],
};

export const ACCOUNT_OVERVIEW_CARD_METRIC_KEYS = [
  'total-tokens',
  'input-tokens',
  'output-tokens',
  'cached-tokens',
] as const;
const DEFAULT_ACCOUNT_OVERVIEW_CARD_PAGINATION = {
  page: 1,
  pageSize: ACCOUNT_OVERVIEW_CARD_PAGE_SIZE_OPTIONS[0],
} as const;

export const DEFAULT_ACCOUNT_SORT: AccountSortState = {
  key: 'lastSeenAt',
  direction: 'desc',
};

export type MonitoringAccountEnabledState = 'enabled' | 'disabled' | 'mixed' | 'unavailable';
export type MonitoringAccountOverviewCardPaginationState = {
  page: number;
  pageSize: number;
};
export type AccountOverviewPageResetState = {
  customEndInput: string;
  customStartInput: string;
  deferredSearch: string;
  selectedAccount: string;
  selectedApiKeyHash: string;
  selectedChannel: string;
  selectedModel: string;
  selectedProvider: string;
  selectedStatus: string;
  timeRange: MonitoringTimeRange;
};
export type MonitoringAccountOverviewUiState = {
  mode: MonitoringAccountOverviewMode;
  sort: AccountSortState;
  cardPagination: MonitoringAccountOverviewCardPaginationState;
  timeRange: MonitoringTimeRange;
  filters: MonitoringFilters;
  autoRefreshMs: MonitoringAutoRefreshValue;
  pageSizes: MonitoringPageSizes;
};

export type MonitoringTransientUiState = {
  searchInput: string;
  customStartInput: string;
  customEndInput: string;
};

export const DEFAULT_MONITORING_TRANSIENT_STATE: MonitoringTransientUiState = {
  searchInput: '',
  customStartInput: '',
  customEndInput: '',
};

export type MonitoringAccountAuthState = {
  files: AuthFileItem[];
  toggleableFileNames: string[];
  enabledState: MonitoringAccountEnabledState;
};

export type MonitoringStatusRangeBounds = {
  startMs: number;
  endMs: number;
};

const ACCOUNT_SORT_KEYS = [
  'totalCalls',
  'successCalls',
  'failureCalls',
  'successRate',
  'totalTokens',
  'inputTokens',
  'outputTokens',
  'cachedTokens',
  'totalCost',
  'lastSeenAt',
] as const;
const ACCOUNT_SORT_KEY_SET = new Set<AccountSortKey>(ACCOUNT_SORT_KEYS);
const ACCOUNT_SORT_DIRECTION_SET = new Set<AccountSortDirection>(['asc', 'desc']);

export const normalizeAccountOverviewMode = (value: unknown): MonitoringAccountOverviewMode =>
  value === 'card' ? 'card' : 'table';

export const normalizeAccountSortKey = (value: unknown): AccountSortKey | null =>
  typeof value === 'string' && ACCOUNT_SORT_KEY_SET.has(value as AccountSortKey)
    ? (value as AccountSortKey)
    : null;

export const normalizeAccountSortDirection = (value: unknown): AccountSortDirection | null =>
  typeof value === 'string' && ACCOUNT_SORT_DIRECTION_SET.has(value as AccountSortDirection)
    ? (value as AccountSortDirection)
    : null;

export const normalizeAccountSortState = (value: unknown): AccountSortState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return DEFAULT_ACCOUNT_SORT;
  }

  const record = value as Record<string, unknown>;
  const key = normalizeAccountSortKey(record.key);
  const direction = normalizeAccountSortDirection(record.direction);

  if (!key || !direction) {
    return DEFAULT_ACCOUNT_SORT;
  }

  return {
    key,
    direction,
  };
};

export const normalizeAccountOverviewPageSize = (
  value: number,
  mode: MonitoringAccountOverviewMode
) => {
  const options: readonly number[] =
    mode === 'card'
      ? ACCOUNT_OVERVIEW_CARD_PAGE_SIZE_OPTIONS
      : ACCOUNT_OVERVIEW_TABLE_PAGE_SIZE_OPTIONS;
  return options.includes(value) ? value : options[0];
};

const normalizeStoredPage = (value: unknown) => {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return parsed;
    }
  }

  return DEFAULT_ACCOUNT_OVERVIEW_CARD_PAGINATION.page;
};

export const normalizeAccountOverviewCardPaginationState = (
  value: unknown
): MonitoringAccountOverviewCardPaginationState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_ACCOUNT_OVERVIEW_CARD_PAGINATION };
  }

  const record = value as Record<string, unknown>;
  return {
    page: normalizeStoredPage(record.page),
    pageSize: normalizeAccountOverviewPageSize(normalizeStoredPage(record.pageSize), 'card'),
  };
};

const normalizeFilterValue = (value: unknown): string => {
  if (typeof value !== 'string') return 'all';
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : 'all';
};

const normalizeStatusFilter = (value: unknown): MonitoringStatusFilter =>
  value === 'success' || value === 'failed' ? value : 'all';

export const normalizeMonitoringFilters = (value: unknown): MonitoringFilters => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_MONITORING_FILTERS };
  }

  const record = value as Record<string, unknown>;
  return {
    account: normalizeFilterValue(record.account),
    provider: normalizeFilterValue(record.provider),
    model: normalizeFilterValue(record.model),
    channel: normalizeFilterValue(record.channel),
    apiKeyHash: normalizeFilterValue(record.apiKeyHash),
    status: normalizeStatusFilter(record.status),
  };
};

export const normalizeMonitoringTimeRange = (value: unknown): MonitoringTimeRange =>
  typeof value === 'string' && MONITORING_TIME_RANGE_SET.has(value as MonitoringTimeRange)
    ? (value as MonitoringTimeRange)
    : DEFAULT_MONITORING_TIME_RANGE;

export const normalizeMonitoringAutoRefreshMs = (value: unknown): MonitoringAutoRefreshValue => {
  const raw =
    typeof value === 'string'
      ? value
      : typeof value === 'number' && Number.isFinite(value)
        ? String(value)
        : '';
  return MONITORING_AUTO_REFRESH_SET.has(raw)
    ? (raw as MonitoringAutoRefreshValue)
    : DEFAULT_MONITORING_AUTO_REFRESH_MS;
};

const normalizeNumberInOptions = (
  value: unknown,
  options: readonly number[],
  fallback: number
): number => {
  const num =
    typeof value === 'number' && Number.isFinite(value)
      ? value
      : typeof value === 'string'
        ? Number.parseInt(value, 10)
        : NaN;
  return Number.isFinite(num) && options.includes(num) ? num : fallback;
};

export const normalizeMonitoringPageSizes = (value: unknown): MonitoringPageSizes => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_MONITORING_PAGE_SIZES };
  }

  const record = value as Record<string, unknown>;
  return {
    tableAccount: normalizeNumberInOptions(
      record.tableAccount,
      ACCOUNT_OVERVIEW_TABLE_PAGE_SIZE_OPTIONS,
      DEFAULT_MONITORING_PAGE_SIZES.tableAccount
    ),
    apiKey: normalizeNumberInOptions(
      record.apiKey,
      MONITORING_API_KEY_PAGE_SIZE_OPTIONS,
      DEFAULT_MONITORING_PAGE_SIZES.apiKey
    ),
    realtime: normalizeNumberInOptions(
      record.realtime,
      MONITORING_REALTIME_PAGE_SIZE_OPTIONS,
      DEFAULT_MONITORING_PAGE_SIZES.realtime
    ),
  };
};

export const normalizeAccountOverviewUiState = (
  value: unknown
): MonitoringAccountOverviewUiState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      mode: 'table',
      sort: DEFAULT_ACCOUNT_SORT,
      cardPagination: { ...DEFAULT_ACCOUNT_OVERVIEW_CARD_PAGINATION },
      timeRange: DEFAULT_MONITORING_TIME_RANGE,
      filters: { ...DEFAULT_MONITORING_FILTERS },
      autoRefreshMs: DEFAULT_MONITORING_AUTO_REFRESH_MS,
      pageSizes: { ...DEFAULT_MONITORING_PAGE_SIZES },
    };
  }

  const record = value as Record<string, unknown>;
  return {
    mode: normalizeAccountOverviewMode(record.mode),
    sort: normalizeAccountSortState(record.sort),
    cardPagination: normalizeAccountOverviewCardPaginationState(record.cardPagination),
    timeRange: normalizeMonitoringTimeRange(record.timeRange),
    filters: normalizeMonitoringFilters(record.filters),
    autoRefreshMs: normalizeMonitoringAutoRefreshMs(record.autoRefreshMs),
    pageSizes: normalizeMonitoringPageSizes(record.pageSizes),
  };
};

export const shouldResetAccountOverviewPage = (
  previous: AccountOverviewPageResetState | null,
  next: AccountOverviewPageResetState
) => {
  if (!previous) {
    return false;
  }

  return (
    previous.customEndInput !== next.customEndInput ||
    previous.customStartInput !== next.customStartInput ||
    previous.deferredSearch !== next.deferredSearch ||
    previous.selectedAccount !== next.selectedAccount ||
    previous.selectedApiKeyHash !== next.selectedApiKeyHash ||
    previous.selectedChannel !== next.selectedChannel ||
    previous.selectedModel !== next.selectedModel ||
    previous.selectedProvider !== next.selectedProvider ||
    previous.selectedStatus !== next.selectedStatus ||
    previous.timeRange !== next.timeRange
  );
};

export const shouldClampAccountOverviewPage = (
  loading: boolean,
  currentPage: number,
  nextPage: number
) => !loading && currentPage !== nextPage;

const getAccountSortValue = (row: MonitoringAccountRow, key: AccountSortKey) => {
  switch (key) {
    case 'totalCalls':
      return row.totalCalls;
    case 'successCalls':
      return row.successCalls;
    case 'failureCalls':
      return row.failureCalls;
    case 'successRate':
      return row.successRate;
    case 'totalTokens':
      return row.totalTokens;
    case 'inputTokens':
      return row.inputTokens;
    case 'outputTokens':
      return row.outputTokens;
    case 'cachedTokens':
      return row.cachedTokens;
    case 'totalCost':
      return row.totalCost;
    case 'lastSeenAt':
    default:
      return row.lastSeenAt;
  }
};

export const compareAccountRowsByDefault = (
  left: MonitoringAccountRow,
  right: MonitoringAccountRow
) =>
  right.lastSeenAt - left.lastSeenAt ||
  right.totalCalls - left.totalCalls ||
  right.totalCost - left.totalCost ||
  left.account.localeCompare(right.account);

export const sortAccountRows = (
  rows: MonitoringAccountRow[],
  sortState: AccountSortState = DEFAULT_ACCOUNT_SORT
) => {
  const directionFactor = sortState.direction === 'desc' ? -1 : 1;

  return [...rows].sort((left, right) => {
    const valueDiff =
      getAccountSortValue(left, sortState.key) - getAccountSortValue(right, sortState.key);
    if (valueDiff !== 0) {
      return valueDiff * directionFactor;
    }

    return compareAccountRowsByDefault(left, right);
  });
};

const readStoredModeValue = () => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(ACCOUNT_OVERVIEW_MODE_STORAGE_KEY);
    if (!raw) return null;

    return JSON.parse(raw);
  } catch {
    try {
      return window.localStorage.getItem(ACCOUNT_OVERVIEW_MODE_STORAGE_KEY);
    } catch {
      return null;
    }
  }
};

export const readAccountOverviewMode = (): MonitoringAccountOverviewMode =>
  normalizeAccountOverviewMode(readStoredModeValue());

export const readAccountOverviewUiState = (): MonitoringAccountOverviewUiState => {
  const fallback = (): MonitoringAccountOverviewUiState => ({
    mode: readAccountOverviewMode(),
    sort: DEFAULT_ACCOUNT_SORT,
    cardPagination: { ...DEFAULT_ACCOUNT_OVERVIEW_CARD_PAGINATION },
    timeRange: DEFAULT_MONITORING_TIME_RANGE,
    filters: { ...DEFAULT_MONITORING_FILTERS },
    autoRefreshMs: DEFAULT_MONITORING_AUTO_REFRESH_MS,
    pageSizes: { ...DEFAULT_MONITORING_PAGE_SIZES },
  });

  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return {
      ...fallback(),
      mode: 'table',
    };
  }

  try {
    const raw = window.localStorage.getItem(ACCOUNT_OVERVIEW_UI_STATE_STORAGE_KEY);
    if (raw) {
      return normalizeAccountOverviewUiState(JSON.parse(raw));
    }
  } catch {
    // Ignore storage failures and fall back to legacy mode key.
  }

  return fallback();
};

export const writeAccountOverviewMode = (mode: MonitoringAccountOverviewMode) => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(
      ACCOUNT_OVERVIEW_MODE_STORAGE_KEY,
      JSON.stringify(normalizeAccountOverviewMode(mode))
    );
  } catch {
    // Ignore storage failures and keep the runtime mode in memory only.
  }
};

export const writeAccountOverviewUiState = (state: MonitoringAccountOverviewUiState) => {
  if (typeof window === 'undefined' || typeof window.localStorage === 'undefined') {
    return;
  }

  const normalizedState = normalizeAccountOverviewUiState(state);

  try {
    window.localStorage.setItem(
      ACCOUNT_OVERVIEW_UI_STATE_STORAGE_KEY,
      JSON.stringify(normalizedState)
    );
  } catch {
    // Ignore storage failures and keep the runtime state in memory only.
  }

  writeAccountOverviewMode(normalizedState.mode);
};

const normalizeTransientString = (value: unknown): string =>
  typeof value === 'string' ? value : '';

export const normalizeMonitoringTransientUiState = (
  value: unknown
): MonitoringTransientUiState => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ...DEFAULT_MONITORING_TRANSIENT_STATE };
  }

  const record = value as Record<string, unknown>;
  return {
    searchInput: normalizeTransientString(record.searchInput),
    customStartInput: normalizeTransientString(record.customStartInput),
    customEndInput: normalizeTransientString(record.customEndInput),
  };
};

export const readMonitoringTransientUiState = (): MonitoringTransientUiState => {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return { ...DEFAULT_MONITORING_TRANSIENT_STATE };
  }

  try {
    const raw = window.sessionStorage.getItem(MONITORING_TRANSIENT_STATE_STORAGE_KEY);
    if (raw) {
      return normalizeMonitoringTransientUiState(JSON.parse(raw));
    }
  } catch {
    // Ignore storage failures and fall back to defaults.
  }

  return { ...DEFAULT_MONITORING_TRANSIENT_STATE };
};

export const writeMonitoringTransientUiState = (state: MonitoringTransientUiState) => {
  if (typeof window === 'undefined' || typeof window.sessionStorage === 'undefined') {
    return;
  }

  try {
    window.sessionStorage.setItem(
      MONITORING_TRANSIENT_STATE_STORAGE_KEY,
      JSON.stringify(normalizeMonitoringTransientUiState(state))
    );
  } catch {
    // Ignore storage failures and keep the runtime state in memory only.
  }
};

const isRuntimeOnlyAuthFile = (file: AuthFileItem) => {
  const value = file.runtimeOnly ?? file['runtime_only'];
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.trim().toLowerCase() === 'true';
  return false;
};

const STATUS_BLOCK_COUNT = 20;

export const resolveMonitoringStatusRangeBounds = (
  rows: Pick<MonitoringEventRow, 'timestampMs'>[],
  bounds: MonitoringStatusRangeBounds | null | undefined
): MonitoringStatusRangeBounds | null => {
  if (!bounds || !Number.isFinite(bounds.endMs)) {
    return null;
  }

  if (Number.isFinite(bounds.startMs)) {
    return bounds;
  }

  const startMs = rows.reduce((earliest, row) => {
    if (row.timestampMs > bounds.endMs) {
      return earliest;
    }

    return Math.min(earliest, row.timestampMs);
  }, Number.POSITIVE_INFINITY);

  return {
    startMs: Number.isFinite(startMs) ? startMs : bounds.endMs,
    endMs: bounds.endMs,
  };
};

export const buildEmptyMonitoringStatusData = (
  bounds: MonitoringStatusRangeBounds
): StatusBarData => {
  const spanMs = Math.max(bounds.endMs - bounds.startMs + 1, STATUS_BLOCK_COUNT);
  const blockDetails = Array.from({ length: STATUS_BLOCK_COUNT }, (_, index) => {
    const blockStartTime = Math.floor(bounds.startMs + (spanMs * index) / STATUS_BLOCK_COUNT);
    const nextBlockStartTime =
      index === STATUS_BLOCK_COUNT - 1
        ? bounds.endMs + 1
        : Math.floor(bounds.startMs + (spanMs * (index + 1)) / STATUS_BLOCK_COUNT);

    return {
      success: 0,
      failure: 0,
      rate: -1,
      startTime: blockStartTime,
      endTime: Math.max(blockStartTime, nextBlockStartTime - 1),
    };
  });

  return {
    blocks: Array.from({ length: STATUS_BLOCK_COUNT }, () => 'idle'),
    blockDetails,
    successRate: 100,
    totalSuccess: 0,
    totalFailure: 0,
  };
};

const clampStatusBucketIndex = (timestampMs: number, bounds: MonitoringStatusRangeBounds) => {
  const spanMs = Math.max(bounds.endMs - bounds.startMs + 1, 1);
  const offset = Math.min(Math.max(timestampMs - bounds.startMs, 0), spanMs - 1);
  return Math.min(STATUS_BLOCK_COUNT - 1, Math.floor((offset * STATUS_BLOCK_COUNT) / spanMs));
};

const buildStatusDataForRows = (
  rows: MonitoringEventRow[],
  bounds: MonitoringStatusRangeBounds
): StatusBarData => {
  const statusData = buildEmptyMonitoringStatusData(bounds);

  rows.forEach((row) => {
    if (row.timestampMs < bounds.startMs || row.timestampMs > bounds.endMs) {
      return;
    }

    const bucketIndex = clampStatusBucketIndex(row.timestampMs, bounds);
    const detail = statusData.blockDetails[bucketIndex];

    if (row.failed) {
      detail.failure += 1;
      statusData.totalFailure += 1;
    } else {
      detail.success += 1;
      statusData.totalSuccess += 1;
    }
  });

  statusData.blocks = statusData.blockDetails.map((detail) => {
    const total = detail.success + detail.failure;
    if (total === 0) {
      detail.rate = -1;
      return 'idle';
    }

    detail.rate = detail.success / total;
    if (detail.failure === 0) return 'success';
    if (detail.success === 0) return 'failure';
    return 'mixed';
  });

  const total = statusData.totalSuccess + statusData.totalFailure;
  statusData.successRate = total > 0 ? (statusData.totalSuccess / total) * 100 : 100;

  return statusData;
};

export const buildMonitoringAccountStatusDataMap = (
  rows: MonitoringEventRow[],
  bounds: MonitoringStatusRangeBounds | null | undefined
) => {
  const resolvedBounds = resolveMonitoringStatusRangeBounds(rows, bounds);
  const grouped = new Map<string, MonitoringEventRow[]>();

  if (!resolvedBounds) {
    return new Map<string, StatusBarData>();
  }

  rows.forEach((row) => {
    if (row.timestampMs < resolvedBounds.startMs || row.timestampMs > resolvedBounds.endMs) {
      return;
    }

    const accountKey = row.account || row.authLabel || row.source;
    const existing = grouped.get(accountKey) ?? [];
    existing.push(row);
    grouped.set(accountKey, existing);
  });

  return new Map(
    Array.from(grouped.entries()).map(([accountKey, accountRows]) => [
      accountKey,
      buildStatusDataForRows(accountRows, resolvedBounds),
    ])
  );
};

const normalizeAccountIdentityValue = (value: unknown) =>
  (typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value))
    .trim()
    .toLowerCase();

const collectAccountIdentityCandidates = (values: unknown[]) =>
  Array.from(new Set(values.map((value) => normalizeAccountIdentityValue(value)).filter(Boolean)));

const resolveMonitoringAccountIdentityFromAuthFile = (file: AuthFileItem) => {
  const normalizedAuthIndex = normalizeRecentRequestAuthIndex(file.authIndex ?? file['auth_index']);
  if (!normalizedAuthIndex) return null;

  const identity = [file.account, file.email, file.label, file.name, normalizedAuthIndex]
    .map((value) => normalizeAccountIdentityValue(value))
    .find(Boolean);

  return identity || null;
};

const buildAccountAuthIndicesByIdentity = (authFilesByAuthIndex: Map<string, AuthFileItem>) => {
  const indicesByIdentity = new Map<string, Set<string>>();

  authFilesByAuthIndex.forEach((file) => {
    const normalizedAuthIndex = normalizeRecentRequestAuthIndex(
      file.authIndex ?? file['auth_index']
    );
    if (!normalizedAuthIndex) return;

    const identity = resolveMonitoringAccountIdentityFromAuthFile(file);
    if (!identity) return;

    const existing = indicesByIdentity.get(identity) ?? new Set<string>();
    existing.add(normalizedAuthIndex);
    indicesByIdentity.set(identity, existing);
  });

  return indicesByIdentity;
};

export const buildMonitoringAccountAuthStateMap = (
  rows: MonitoringAccountRow[],
  authFilesByAuthIndex: Map<string, AuthFileItem>
) => {
  const authIndicesByIdentity = buildAccountAuthIndicesByIdentity(authFilesByAuthIndex);

  return new Map(
    rows.map((row) => {
      const resolvedAuthIndices = collectAccountIdentityCandidates([row.account, row.id]).reduce<
        Set<string>
      >((set, candidate) => {
        const authIndices = authIndicesByIdentity.get(candidate);
        authIndices?.forEach((authIndex) => set.add(authIndex));
        return set;
      }, new Set<string>());

      const authIndices =
        resolvedAuthIndices.size > 0 ? Array.from(resolvedAuthIndices).sort() : row.authIndices;

      return [row.id, buildMonitoringAccountAuthState(authIndices, authFilesByAuthIndex)] as const;
    })
  );
};

export const buildMonitoringAccountAuthState = (
  authIndices: string[],
  authFilesByAuthIndex: Map<string, AuthFileItem>
): MonitoringAccountAuthState => {
  const files = Array.from(
    authIndices.reduce<Map<string, AuthFileItem>>((map, authIndex) => {
      const normalizedAuthIndex = normalizeRecentRequestAuthIndex(authIndex);
      if (!normalizedAuthIndex) return map;

      const file = authFilesByAuthIndex.get(normalizedAuthIndex);
      if (!file || map.has(file.name)) return map;

      map.set(file.name, file);
      return map;
    }, new Map())
  )
    .map(([, file]) => file)
    .sort((left, right) => left.name.localeCompare(right.name));

  const toggleableFiles = files.filter((file) => !isRuntimeOnlyAuthFile(file));
  const disabledCount = toggleableFiles.filter((file) => file.disabled === true).length;
  const enabledState: MonitoringAccountEnabledState =
    toggleableFiles.length === 0
      ? 'unavailable'
      : disabledCount === toggleableFiles.length
        ? 'disabled'
        : disabledCount === 0
          ? 'enabled'
          : 'mixed';

  return {
    files,
    toggleableFileNames: toggleableFiles.map((file) => file.name),
    enabledState,
  };
};
