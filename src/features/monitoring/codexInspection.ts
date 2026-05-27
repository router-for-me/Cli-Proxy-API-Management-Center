import type { AxiosRequestConfig } from 'axios';
import { authFilesApi } from '@/services/api/authFiles';
import { getApiCallErrorMessage } from '@/services/api/apiCall';
import { requestCodexUsageRaw } from '@/services/api/codexQuota';
import type { AuthFileItem, Config, CodexRateLimitInfo } from '@/types';
import {
  classifyCodexRateLimitWindows,
  deriveCodexRateLimitUsedPercent,
  isDisabledAuthFile,
  isCodexRateLimitReached,
  getCodexQuotaWindowUsedPercent,
  normalizeNumberValue,
  resolveAuthProvider,
  resolveCodexChatgptAccountId,
} from '@/utils/quota';
import { normalizeAuthIndex } from '@/utils/usage';

export type CodexInspectionLogLevel = 'info' | 'success' | 'warning' | 'error';
export type CodexInspectionAction = 'keep' | 'delete' | 'disable' | 'enable';
export type CodexInspectionExecutionAction = Exclude<CodexInspectionAction, 'keep'>;
export type CodexInspectionProgressStatus = 'idle' | 'running' | 'paused' | 'stopped' | 'completed';
export type CodexInspectionAutoActionMode = 'none' | 'disable' | 'delete';
export type CodexInspectionStoredActionFilter = 'all' | 'delete' | 'disable' | 'enable';

export interface CodexInspectionSettings {
  baseUrl: string;
  token: string;
  targetType: string;
  workers: number;
  deleteWorkers: number;
  timeout: number;
  retries: number;
  userAgent: string;
  usedPercentThreshold: number;
  sampleSize: number;
}

export interface CodexInspectionConfigurableSettings {
  targetType: string;
  workers: number;
  deleteWorkers: number;
  timeout: number;
  retries: number;
  userAgent: string;
  usedPercentThreshold: number;
  sampleSize: number;
  autoActionMode: CodexInspectionAutoActionMode;
}

export interface CodexInspectionAccount {
  key: string;
  fileName: string;
  displayAccount: string;
  authIndex: string | null;
  accountId: string | null;
  provider: string;
  disabled: boolean;
  status: string;
  state: string;
  raw: AuthFileItem;
}

export interface CodexInspectionResultItem extends CodexInspectionAccount {
  action: CodexInspectionAction;
  actionReason: string;
  statusCode: number | null;
  usedPercent: number | null;
  isQuota: boolean;
  error: string;
}

export interface CodexInspectionSummary {
  totalFiles: number;
  probeSetCount: number;
  sampledCount: number;
  disabledCount: number;
  enabledCount: number;
  deleteCount: number;
  disableCount: number;
  enableCount: number;
  keepCount: number;
  usedPercentThreshold: number;
  sampled: boolean;
  plannedActionPreview: string[];
}

export interface CodexInspectionProgressSummary {
  totalFiles: number;
  probeSetCount: number;
  sampledCount: number;
  deleteCount: number;
  disableCount: number;
  enableCount: number;
  keepCount: number;
}

export interface CodexInspectionRunResult {
  settings: CodexInspectionSettings;
  files: AuthFileItem[];
  results: CodexInspectionResultItem[];
  summary: CodexInspectionSummary;
  startedAt: number;
  finishedAt: number;
}

export interface CodexInspectionProgressSnapshot {
  total: number;
  completed: number;
  inFlight: number;
  pending: number;
  percent: number;
  status: CodexInspectionProgressStatus;
  summary: CodexInspectionProgressSummary;
  startedAt: number;
  updatedAt: number;
}

export interface CodexInspectionExecutionOutcome {
  action: CodexInspectionExecutionAction;
  fileName: string;
  displayAccount: string;
  success: boolean;
  error: string;
}

export interface CodexInspectionExecutionResult {
  outcomes: CodexInspectionExecutionOutcome[];
  refreshedFiles: AuthFileItem[];
  refreshError: string;
}

export interface CodexInspectionStoredLogEntry {
  id: string;
  level: CodexInspectionLogLevel;
  message: string;
  timestamp: number;
}

export interface CodexInspectionLastRunState {
  result: CodexInspectionRunResult;
  logs: CodexInspectionStoredLogEntry[];
  logsCollapsed: boolean;
  actionFilter: CodexInspectionStoredActionFilter;
  connectionFingerprint: string | null;
  savedAt: number;
}

type LogHandler = (level: CodexInspectionLogLevel, message: string) => void;
type ProgressHandler = (progress: CodexInspectionProgressSnapshot) => void;
type ResultsChangeHandler = (result: CodexInspectionRunResult) => void;

type InspectCodexAccountsOptions = {
  config: Config | null;
  apiBase: string;
  managementKey: string;
  settings?: Partial<CodexInspectionConfigurableSettings> | null;
  onLog?: LogHandler;
  onProgress?: ProgressHandler;
  onResultsChange?: ResultsChangeHandler;
};

type ExecuteCodexInspectionActionsOptions = {
  settings: CodexInspectionSettings;
  items: CodexInspectionResultItem[];
  previousFiles: AuthFileItem[];
  onLog?: LogHandler;
};

type CreateCodexInspectionSessionOptions = InspectCodexAccountsOptions;

type CodexInspectionSessionPromiseState = {
  promise: Promise<CodexInspectionRunResult>;
  resolve: (value: CodexInspectionRunResult) => void;
  reject: (reason?: unknown) => void;
};

export interface CodexInspectionSession {
  id: string;
  start: () => Promise<CodexInspectionRunResult>;
  resume: () => void;
  pause: () => void;
  stop: () => void;
  getProgress: () => CodexInspectionProgressSnapshot;
}

const QUOTA_BODY_PATTERNS = ['quota exhausted', 'limit reached', 'payment_required'];

export class CodexInspectionStoppedError extends Error {
  constructor(message: string = '巡检已停止') {
    super(message);
    this.name = 'CodexInspectionStoppedError';
  }
}

export const CODEX_INSPECTION_SETTINGS_STORAGE_KEY = 'cli-proxy-codex-inspection-settings-v1';
export const CODEX_INSPECTION_LAST_RUN_STORAGE_KEY = 'cli-proxy-codex-inspection-last-run-v1';

const CODEX_INSPECTION_LAST_RUN_STORAGE_VERSION = 1;
export const CODEX_INSPECTION_AUTO_ACTION_MODES: readonly CodexInspectionAutoActionMode[] = [
  'none',
  'disable',
  'delete',
];

export const DEFAULT_CODEX_INSPECTION_SETTINGS: CodexInspectionConfigurableSettings = {
  targetType: 'codex',
  workers: 4,
  deleteWorkers: 4,
  timeout: 15000,
  retries: 0,
  userAgent: 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal',
  usedPercentThreshold: 100,
  sampleSize: 0,
  autoActionMode: 'none',
};

export const createCodexInspectionConnectionFingerprint = (
  apiBase: string,
  managementKey: string
) => {
  const normalizedApiBase = readString(apiBase).replace(/\/+$/, '');
  const normalizedManagementKey = readString(managementKey);
  if (!normalizedApiBase || !normalizedManagementKey) return null;

  const input = `${normalizedApiBase}\u0000${normalizedManagementKey}`;
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x85ebca6b);
  }

  return `v1:${(hashA >>> 0).toString(36)}${(hashB >>> 0).toString(36)}`;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const createDeferred = (): CodexInspectionSessionPromiseState => {
  let resolve: ((value: CodexInspectionRunResult) => void) | null = null;
  let reject: ((reason?: unknown) => void) | null = null;

  const promise = new Promise<CodexInspectionRunResult>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return {
    promise,
    resolve: (value) => resolve?.(value),
    reject: (reason) => reject?.(reason),
  };
};

const clampPositiveInteger = (value: number | undefined, fallback: number) => {
  if (!Number.isFinite(value) || !value || value <= 0) return fallback;
  return Math.max(1, Math.floor(value));
};

const normalizeThreshold = (value: unknown) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return NaN;
  if (normalized > 0 && normalized <= 1) {
    return normalized * 100;
  }
  return normalized;
};

const readString = (value: unknown) => {
  if (value === undefined || value === null) return '';
  return String(value).trim();
};

const readBoolean = (value: unknown, fallback: boolean) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
    if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
};

const readNullableString = (value: unknown) => {
  const normalized = readString(value);
  return normalized || null;
};

const readNullableNumber = (value: unknown) => {
  const normalized = normalizeNumberValue(value);
  return normalized === null || !Number.isFinite(normalized) ? null : normalized;
};

const readNonNegativeInteger = (value: unknown, fallback: number) => {
  const normalized = normalizeNumberValue(value);
  if (normalized === null || !Number.isFinite(normalized) || normalized < 0) return fallback;
  return Math.floor(normalized);
};

const isAutoActionMode = (value: string): value is CodexInspectionAutoActionMode =>
  CODEX_INSPECTION_AUTO_ACTION_MODES.includes(value as CodexInspectionAutoActionMode);

const normalizeAutoActionMode = (
  value: unknown,
  legacyAutoExecuteActions?: unknown
): CodexInspectionAutoActionMode => {
  const normalized = readString(value).toLowerCase();
  if (isAutoActionMode(normalized)) return normalized;

  if (legacyAutoExecuteActions !== undefined) {
    return readBoolean(legacyAutoExecuteActions, false) ? 'disable' : 'none';
  }

  return DEFAULT_CODEX_INSPECTION_SETTINGS.autoActionMode;
};

const normalizeInspectionAction = (
  value: unknown,
  fallback: CodexInspectionAction = 'keep'
): CodexInspectionAction => {
  const normalized = readString(value).toLowerCase();
  if (['keep', 'delete', 'disable', 'enable'].includes(normalized)) {
    return normalized as CodexInspectionAction;
  }
  return fallback;
};

const normalizeStoredActionFilter = (value: unknown): CodexInspectionStoredActionFilter => {
  const normalized = readString(value).toLowerCase();
  if (['all', 'delete', 'disable', 'enable'].includes(normalized)) {
    return normalized as CodexInspectionStoredActionFilter;
  }
  return 'all';
};

const normalizeLogLevel = (value: unknown): CodexInspectionLogLevel => {
  const normalized = readString(value).toLowerCase();
  if (['info', 'success', 'warning', 'error'].includes(normalized)) {
    return normalized as CodexInspectionLogLevel;
  }
  return 'info';
};

const readAuthFileName = (file: AuthFileItem) => {
  const name = readString(file.name);
  if (name) return name;
  const id = readString(file.id);
  if (id) return id;
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  return authIndex || 'unknown-auth-file';
};

const readDisplayAccount = (file: AuthFileItem) =>
  readString(file.account) ||
  readString(file.email) ||
  readString(file.label) ||
  readString(file.name) ||
  readString(file.id) ||
  normalizeAuthIndex(file['auth_index'] ?? file.authIndex) ||
  '-';

const toInspectionAccount = (file: AuthFileItem): CodexInspectionAccount => ({
  key: `${readAuthFileName(file)}::${normalizeAuthIndex(file['auth_index'] ?? file.authIndex) || '-'}`,
  fileName: readAuthFileName(file),
  displayAccount: readDisplayAccount(file),
  authIndex: normalizeAuthIndex(file['auth_index'] ?? file.authIndex),
  accountId: resolveCodexChatgptAccountId(file),
  provider: resolveAuthProvider(file),
  disabled: isDisabledAuthFile(file),
  status: readString(file.status),
  state: readString(file.state),
  raw: file,
});

const readConfigurableSettingsFromConfig = (
  config?: Config | null
): Partial<CodexInspectionConfigurableSettings> => {
  const clean = config?.clean ?? null;
  const cleanRecord = isRecord(clean) ? clean : {};
  return {
    targetType: readString(clean?.targetType),
    workers: normalizeNumberValue(clean?.workers) ?? undefined,
    deleteWorkers: normalizeNumberValue(clean?.deleteWorkers) ?? undefined,
    timeout: normalizeNumberValue(clean?.timeout) ?? undefined,
    retries: normalizeNumberValue(clean?.retries) ?? undefined,
    userAgent: readString(clean?.userAgent),
    usedPercentThreshold: normalizeNumberValue(clean?.usedPercentThreshold) ?? undefined,
    sampleSize: normalizeNumberValue(clean?.sampleSize) ?? undefined,
    autoActionMode:
      cleanRecord.autoActionMode === undefined
        ? undefined
        : normalizeAutoActionMode(cleanRecord.autoActionMode),
  };
};

type CodexInspectionConfigurableSettingsInput = {
  targetType?: unknown;
  workers?: unknown;
  deleteWorkers?: unknown;
  timeout?: unknown;
  retries?: unknown;
  userAgent?: unknown;
  usedPercentThreshold?: unknown;
  sampleSize?: unknown;
  autoExecuteActions?: unknown;
  autoActionMode?: unknown;
};

const normalizeConfigurableSettings = (
  input?: CodexInspectionConfigurableSettingsInput | null
): CodexInspectionConfigurableSettings => {
  const merged = {
    ...DEFAULT_CODEX_INSPECTION_SETTINGS,
    ...(input ?? {}),
  };

  const threshold = normalizeThreshold(merged.usedPercentThreshold);
  const retriesValue = normalizeNumberValue(merged.retries);
  const sampleSizeValue = normalizeNumberValue(merged.sampleSize);

  return {
    targetType:
      readString(merged.targetType).toLowerCase() || DEFAULT_CODEX_INSPECTION_SETTINGS.targetType,
    workers: clampPositiveInteger(
      normalizeNumberValue(merged.workers) ?? undefined,
      DEFAULT_CODEX_INSPECTION_SETTINGS.workers
    ),
    deleteWorkers: clampPositiveInteger(
      normalizeNumberValue(merged.deleteWorkers) ?? undefined,
      clampPositiveInteger(
        normalizeNumberValue(merged.workers) ?? undefined,
        DEFAULT_CODEX_INSPECTION_SETTINGS.workers
      )
    ),
    timeout: clampPositiveInteger(
      normalizeNumberValue(merged.timeout) ?? undefined,
      DEFAULT_CODEX_INSPECTION_SETTINGS.timeout
    ),
    retries:
      retriesValue === null
        ? DEFAULT_CODEX_INSPECTION_SETTINGS.retries
        : Math.max(0, Math.floor(retriesValue)),
    userAgent: readString(merged.userAgent) || DEFAULT_CODEX_INSPECTION_SETTINGS.userAgent,
    usedPercentThreshold: Number.isFinite(threshold)
      ? Math.max(0, Math.min(100, threshold))
      : DEFAULT_CODEX_INSPECTION_SETTINGS.usedPercentThreshold,
    sampleSize:
      sampleSizeValue === null
        ? DEFAULT_CODEX_INSPECTION_SETTINGS.sampleSize
        : Math.max(0, Math.floor(sampleSizeValue)),
    autoActionMode: normalizeAutoActionMode(merged.autoActionMode, merged.autoExecuteActions),
  };
};

export const loadCodexInspectionConfigurableSettings = (
  config?: Config | null
): CodexInspectionConfigurableSettings => {
  const configSettings = readConfigurableSettingsFromConfig(config);

  try {
    if (typeof localStorage === 'undefined') {
      return normalizeConfigurableSettings(configSettings);
    }
    const raw = localStorage.getItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return normalizeConfigurableSettings(configSettings);
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return normalizeConfigurableSettings(configSettings);
    }
    return normalizeConfigurableSettings({
      ...configSettings,
      ...parsed,
    });
  } catch {
    return normalizeConfigurableSettings(configSettings);
  }
};

export const saveCodexInspectionConfigurableSettings = (
  settings: Partial<CodexInspectionConfigurableSettings>
): CodexInspectionConfigurableSettings => {
  const normalized = normalizeConfigurableSettings(settings);

  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch {
    console.warn('保存 Codex 巡检配置失败');
  }

  return normalized;
};

export const clearCodexInspectionConfigurableSettings = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CODEX_INSPECTION_SETTINGS_STORAGE_KEY);
    }
  } catch {
    console.warn('清除 Codex 巡检配置失败');
  }
};

const sanitizeInspectionSettingsForStorage = (
  settings: CodexInspectionSettings
): CodexInspectionSettings => ({
  baseUrl: '',
  token: '',
  targetType: readString(settings.targetType) || DEFAULT_CODEX_INSPECTION_SETTINGS.targetType,
  workers: clampPositiveInteger(settings.workers, DEFAULT_CODEX_INSPECTION_SETTINGS.workers),
  deleteWorkers: clampPositiveInteger(
    settings.deleteWorkers,
    DEFAULT_CODEX_INSPECTION_SETTINGS.deleteWorkers
  ),
  timeout: clampPositiveInteger(settings.timeout, DEFAULT_CODEX_INSPECTION_SETTINGS.timeout),
  retries: Math.max(0, Math.floor(normalizeNumberValue(settings.retries) ?? 0)),
  userAgent: readString(settings.userAgent) || DEFAULT_CODEX_INSPECTION_SETTINGS.userAgent,
  usedPercentThreshold:
    normalizeNumberValue(settings.usedPercentThreshold) ??
    DEFAULT_CODEX_INSPECTION_SETTINGS.usedPercentThreshold,
  sampleSize: Math.max(0, Math.floor(normalizeNumberValue(settings.sampleSize) ?? 0)),
});

const normalizeStoredSettings = (value: unknown): CodexInspectionSettings => {
  const input = isRecord(value) ? value : {};
  const configurable = normalizeConfigurableSettings({
    targetType: input.targetType,
    workers: input.workers,
    deleteWorkers: input.deleteWorkers,
    timeout: input.timeout,
    retries: input.retries,
    userAgent: input.userAgent,
    usedPercentThreshold: input.usedPercentThreshold,
    sampleSize: input.sampleSize,
  });

  return {
    baseUrl: '',
    token: '',
    targetType: configurable.targetType,
    workers: configurable.workers,
    deleteWorkers: configurable.deleteWorkers,
    timeout: configurable.timeout,
    retries: configurable.retries,
    userAgent: configurable.userAgent,
    usedPercentThreshold: configurable.usedPercentThreshold,
    sampleSize: configurable.sampleSize,
  };
};

type StoredCodexInspectionResultItem = Omit<CodexInspectionResultItem, 'raw'>;

const serializeResultItemForStorage = (
  item: CodexInspectionResultItem
): StoredCodexInspectionResultItem => ({
  key: item.key,
  fileName: item.fileName,
  displayAccount: item.displayAccount,
  authIndex: item.authIndex,
  accountId: null,
  provider: item.provider,
  disabled: item.disabled,
  status: item.status,
  state: item.state,
  action: item.action,
  actionReason: item.actionReason,
  statusCode: item.statusCode,
  usedPercent: item.usedPercent,
  isQuota: item.isQuota,
  error: item.error,
});

const hydrateStoredResultItem = (
  value: unknown,
  settings: CodexInspectionSettings
): CodexInspectionResultItem | null => {
  if (!isRecord(value)) return null;
  const fileName = readString(value.fileName);
  if (!fileName) return null;

  const authIndex = readNullableString(value.authIndex);
  const provider = readString(value.provider) || settings.targetType;
  const disabled = readBoolean(value.disabled, false);
  const key = readString(value.key) || `${fileName}::${authIndex || '-'}`;

  return {
    key,
    fileName,
    displayAccount: readString(value.displayAccount) || fileName,
    authIndex,
    accountId: readNullableString(value.accountId),
    provider,
    disabled,
    status: readString(value.status),
    state: readString(value.state),
    raw: {
      name: fileName,
      type: provider,
      authIndex,
      disabled,
    },
    action: normalizeInspectionAction(value.action),
    actionReason: readString(value.actionReason),
    statusCode: readNullableNumber(value.statusCode),
    usedPercent: readNullableNumber(value.usedPercent),
    isQuota: readBoolean(value.isQuota, false),
    error: readString(value.error),
  };
};

const buildSummaryFromStoredResult = (
  storedSummary: unknown,
  results: CodexInspectionResultItem[],
  settings: CodexInspectionSettings
): CodexInspectionSummary => {
  const summary = isRecord(storedSummary) ? storedSummary : {};
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount;
  const plannedActionPreview = results
    .filter((item) => item.action !== 'keep')
    .slice(0, 10)
    .map((item) => `${item.displayAccount} -> ${item.action}`);

  return {
    totalFiles: readNonNegativeInteger(summary.totalFiles, results.length),
    probeSetCount: readNonNegativeInteger(summary.probeSetCount, results.length),
    sampledCount: readNonNegativeInteger(summary.sampledCount, results.length),
    disabledCount: results.filter((item) => item.disabled).length,
    enabledCount: results.filter((item) => !item.disabled).length,
    deleteCount,
    disableCount,
    enableCount,
    keepCount,
    usedPercentThreshold:
      readNullableNumber(summary.usedPercentThreshold) ?? settings.usedPercentThreshold,
    sampled: readBoolean(summary.sampled, false),
    plannedActionPreview,
  };
};

const hydrateStoredLogEntry = (value: unknown): CodexInspectionStoredLogEntry | null => {
  if (!isRecord(value)) return null;
  const message = readString(value.message);
  if (!message) return null;
  const timestamp = readNullableNumber(value.timestamp) ?? Date.now();
  const id = readString(value.id) || `${timestamp}-${message.slice(0, 12)}`;

  return {
    id,
    level: normalizeLogLevel(value.level),
    message,
    timestamp,
  };
};

export const serializeCodexInspectionLastRun = ({
  result,
  logs,
  logsCollapsed = true,
  actionFilter = 'all',
  connectionFingerprint = null,
}: {
  result: CodexInspectionRunResult;
  logs?: CodexInspectionStoredLogEntry[];
  logsCollapsed?: boolean;
  actionFilter?: CodexInspectionStoredActionFilter;
  connectionFingerprint?: string | null;
}) => ({
  version: CODEX_INSPECTION_LAST_RUN_STORAGE_VERSION,
  savedAt: Date.now(),
  logsCollapsed,
  actionFilter,
  connectionFingerprint: readNullableString(connectionFingerprint),
  result: {
    settings: sanitizeInspectionSettingsForStorage(result.settings),
    results: result.results.map(serializeResultItemForStorage),
    summary: result.summary,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  },
  logs: (logs ?? []).slice(-500),
});

export const hydrateCodexInspectionLastRun = (
  value: unknown,
  options: { expectedConnectionFingerprint?: string | null } = {}
): CodexInspectionLastRunState | null => {
  if (!isRecord(value)) return null;
  if (value.version !== CODEX_INSPECTION_LAST_RUN_STORAGE_VERSION) return null;
  if (!isRecord(value.result)) return null;

  const connectionFingerprint = readNullableString(value.connectionFingerprint);
  const expectedConnectionFingerprint = readNullableString(options.expectedConnectionFingerprint);
  if (expectedConnectionFingerprint && connectionFingerprint !== expectedConnectionFingerprint) {
    return null;
  }

  const settings = normalizeStoredSettings(value.result.settings);
  const resultItemsRaw = Array.isArray(value.result.results) ? value.result.results : [];
  const results = sortResults(
    resultItemsRaw
      .map((item) => hydrateStoredResultItem(item, settings))
      .filter((item): item is CodexInspectionResultItem => item !== null)
  );

  const startedAt = readNullableNumber(value.result.startedAt) ?? Date.now();
  const finishedAt = readNullableNumber(value.result.finishedAt) ?? startedAt;
  const logsRaw = Array.isArray(value.logs) ? value.logs : [];
  const logs = logsRaw
    .map(hydrateStoredLogEntry)
    .filter((item): item is CodexInspectionStoredLogEntry => item !== null)
    .slice(-500);

  return {
    result: {
      settings,
      files: [],
      results,
      summary: buildSummaryFromStoredResult(value.result.summary, results, settings),
      startedAt,
      finishedAt,
    },
    logs,
    logsCollapsed: readBoolean(value.logsCollapsed, true),
    actionFilter: normalizeStoredActionFilter(value.actionFilter),
    connectionFingerprint,
    savedAt: readNullableNumber(value.savedAt) ?? finishedAt,
  };
};

export const loadCodexInspectionLastRun = (
  expectedConnectionFingerprint?: string | null
): CodexInspectionLastRunState | null => {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);
    if (!raw) return null;
    return hydrateCodexInspectionLastRun(JSON.parse(raw), { expectedConnectionFingerprint });
  } catch {
    return null;
  }
};

export const saveCodexInspectionLastRun = (
  input: Parameters<typeof serializeCodexInspectionLastRun>[0]
) => {
  const payload = serializeCodexInspectionLastRun(input);
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY, JSON.stringify(payload));
    }
  } catch {
    console.warn('保存 Codex 巡检记录失败');
  }
  return hydrateCodexInspectionLastRun(payload);
};

export const clearCodexInspectionLastRun = () => {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(CODEX_INSPECTION_LAST_RUN_STORAGE_KEY);
    }
  } catch {
    console.warn('清除 Codex 巡检记录失败');
  }
};

const pickSample = <T>(items: T[], sampleSize: number): T[] => {
  if (sampleSize <= 0 || sampleSize >= items.length) return [...items];

  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled.slice(0, sampleSize);
};

const withRetry = async <T>(retries: number, task: () => Promise<T>): Promise<T> => {
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
};

const runConcurrently = async <T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>
): Promise<R[]> => {
  if (items.length === 0) return [];

  const size = clampPositiveInteger(limit, 1);
  const results = new Array<R>(items.length);
  let cursor = 0;

  const worker = async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) {
        return;
      }
      results[index] = await task(items[index], index);
    }
  };

  await Promise.all(Array.from({ length: Math.min(size, items.length) }, () => worker()));
  return results;
};

type CodexInspectionDecision = Pick<
  CodexInspectionResultItem,
  'action' | 'actionReason' | 'usedPercent' | 'isQuota'
>;

const resolveLegacyProbeAction = (
  account: CodexInspectionAccount,
  statusCode: number,
  usedPercent: number | null,
  isQuota: boolean,
  threshold: number
): CodexInspectionDecision => {
  const overThreshold = usedPercent !== null && usedPercent >= threshold;
  if (statusCode === 401) {
    return {
      action: 'delete',
      actionReason: '接口返回 401，建议删除失效账号',
      usedPercent,
      isQuota: false,
    };
  }
  if (isQuota || overThreshold) {
    if (account.disabled) {
      return {
        action: 'keep',
        actionReason: overThreshold ? '额度超阈值，但账号已禁用' : '额度已耗尽，但账号已禁用',
        usedPercent,
        isQuota,
      };
    }
    return {
      action: 'disable',
      actionReason: overThreshold ? '额度超阈值，建议禁用账号' : '额度已耗尽，建议禁用账号',
      usedPercent,
      isQuota,
    };
  }
  if (statusCode === 200 && account.disabled) {
    return {
      action: 'enable',
      actionReason: '账号恢复健康，建议重新启用',
      usedPercent,
      isQuota: false,
    };
  }
  return {
    action: 'keep',
    actionReason: '无需处理',
    usedPercent,
    isQuota: false,
  };
};

const resolveWindowAwareProbeAction = (
  account: CodexInspectionAccount,
  statusCode: number,
  rateLimit: CodexRateLimitInfo | null,
  threshold: number
): CodexInspectionDecision | null => {
  if (!rateLimit) return null;

  const { fiveHourWindow, weeklyWindow } = classifyCodexRateLimitWindows(rateLimit);
  const weeklyUsedPercent = getCodexQuotaWindowUsedPercent(weeklyWindow);
  if (!weeklyWindow || weeklyUsedPercent === null) return null;

  const fiveHourUsedPercent = getCodexQuotaWindowUsedPercent(fiveHourWindow);
  const weeklyOverThreshold = weeklyUsedPercent >= threshold;
  const fiveHourOverThreshold = fiveHourUsedPercent !== null && fiveHourUsedPercent >= threshold;

  if (statusCode === 401) {
    return {
      action: 'delete',
      actionReason: '接口返回 401，建议删除失效账号',
      usedPercent: weeklyUsedPercent,
      isQuota: false,
    };
  }

  if (weeklyOverThreshold) {
    if (account.disabled) {
      return {
        action: 'keep',
        actionReason: '周额度达到阈值，但账号已禁用',
        usedPercent: weeklyUsedPercent,
        isQuota: true,
      };
    }
    return {
      action: 'disable',
      actionReason: '周额度达到阈值，建议禁用账号',
      usedPercent: weeklyUsedPercent,
      isQuota: true,
    };
  }

  if (account.disabled) {
    return {
      action: 'enable',
      actionReason: fiveHourOverThreshold
        ? '5 小时额度达到阈值，但周额度仍可用，建议立即启用账号'
        : '周额度仍可用，建议立即启用账号',
      usedPercent: weeklyUsedPercent,
      isQuota: false,
    };
  }

  if (fiveHourOverThreshold) {
    return {
      action: 'keep',
      actionReason: '5 小时额度达到阈值，但周额度仍可用，暂不禁用账号',
      usedPercent: weeklyUsedPercent,
      isQuota: false,
    };
  }

  return {
    action: 'keep',
    actionReason: '周额度仍可用，无需处理',
    usedPercent: weeklyUsedPercent,
    isQuota: false,
  };
};

const resolveProbeAction = (
  account: CodexInspectionAccount,
  statusCode: number,
  rateLimit: CodexRateLimitInfo | null,
  usedPercent: number | null,
  isQuota: boolean,
  threshold: number
): CodexInspectionDecision => {
  const windowAwareDecision = resolveWindowAwareProbeAction(
    account,
    statusCode,
    rateLimit,
    threshold
  );
  if (windowAwareDecision) return windowAwareDecision;
  return resolveLegacyProbeAction(account, statusCode, usedPercent, isQuota, threshold);
};

const inspectSingleAccount = async (
  account: CodexInspectionAccount,
  settings: CodexInspectionSettings,
  onLog?: LogHandler
): Promise<CodexInspectionResultItem> => {
  if (!account.authIndex) {
    onLog?.('warning', `${account.displayAccount} 缺少 auth_index，跳过探测`);
    return {
      ...account,
      action: 'keep',
      actionReason: '缺少 auth_index，保留账号',
      statusCode: null,
      usedPercent: null,
      isQuota: false,
      error: '缺少 auth_index',
    };
  }

  const authIndex = account.authIndex;
  const requestConfig: AxiosRequestConfig =
    settings.timeout > 0 ? { timeout: settings.timeout } : {};

  try {
    const { result, payload } = await withRetry(settings.retries, () =>
      requestCodexUsageRaw({
        authIndex,
        accountId: account.accountId,
        userAgent: settings.userAgent,
        requestConfig,
      })
    );

    if (!result.hasStatusCode) {
      onLog?.('warning', `${account.displayAccount} 探测未返回 status_code，保留账号`);
      return {
        ...account,
        action: 'keep',
        actionReason: '探测响应缺少 status_code，保留账号',
        statusCode: null,
        usedPercent: null,
        isQuota: false,
        error: '响应缺少 status_code',
      };
    }

    const rateLimit = payload?.rate_limit ?? payload?.rateLimit ?? null;
    const usedPercent = deriveCodexRateLimitUsedPercent(rateLimit);
    const bodyText = result.bodyText.toLowerCase();
    const isQuota =
      result.statusCode === 402 ||
      QUOTA_BODY_PATTERNS.some((pattern) => bodyText.includes(pattern)) ||
      isCodexRateLimitReached(rateLimit) ||
      (usedPercent !== null && usedPercent >= settings.usedPercentThreshold);
    const decision = resolveProbeAction(
      account,
      result.statusCode,
      rateLimit,
      usedPercent,
      isQuota,
      settings.usedPercentThreshold
    );

    const successLevel =
      decision.action === 'delete'
        ? 'error'
        : decision.action === 'disable'
          ? 'warning'
          : decision.action === 'enable'
            ? 'success'
            : 'info';
    const percentText =
      decision.usedPercent === null ? '--' : `${decision.usedPercent.toFixed(1)}%`;
    onLog?.(
      successLevel,
      `${account.displayAccount} -> ${decision.action} (HTTP ${result.statusCode} · 已用 ${percentText})`
    );

    return {
      ...account,
      action: decision.action,
      actionReason: decision.actionReason,
      statusCode: result.statusCode,
      usedPercent: decision.usedPercent,
      isQuota: decision.isQuota,
      error: '',
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error || '探测失败');
    onLog?.('warning', `${account.displayAccount} 探测异常，保留账号：${errorMessage}`);
    return {
      ...account,
      action: 'keep',
      actionReason: '探测异常，保留账号',
      statusCode: null,
      usedPercent: null,
      isQuota: false,
      error: errorMessage,
    };
  }
};

const sortResults = (items: CodexInspectionResultItem[]) =>
  [...items].sort(
    (left, right) =>
      left.fileName.localeCompare(right.fileName) ||
      left.displayAccount.localeCompare(right.displayAccount) ||
      left.key.localeCompare(right.key)
  );

const createEmptyProgressSummary = (): CodexInspectionProgressSummary => ({
  totalFiles: 0,
  probeSetCount: 0,
  sampledCount: 0,
  deleteCount: 0,
  disableCount: 0,
  enableCount: 0,
  keepCount: 0,
});

const buildProgressSummary = (
  files: AuthFileItem[],
  probeSet: CodexInspectionAccount[],
  sampledAccounts: CodexInspectionAccount[],
  results: CodexInspectionResultItem[]
): CodexInspectionProgressSummary => {
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount;

  return {
    totalFiles: files.length,
    probeSetCount: probeSet.length,
    sampledCount: sampledAccounts.length,
    deleteCount,
    disableCount,
    enableCount,
    keepCount,
  };
};

const createProgressSnapshot = (
  total: number,
  completed: number,
  inFlight: number,
  status: CodexInspectionProgressStatus,
  startedAt: number,
  updatedAt: number = Date.now(),
  summary: CodexInspectionProgressSummary = createEmptyProgressSummary()
): CodexInspectionProgressSnapshot => {
  const pending = Math.max(0, total - completed - inFlight);

  return {
    total,
    completed,
    inFlight,
    pending,
    percent: total <= 0 ? 0 : Math.round((Math.min(total, completed) / total) * 100),
    status,
    summary,
    startedAt,
    updatedAt,
  };
};

const buildSummary = (
  files: AuthFileItem[],
  sampledAccounts: CodexInspectionAccount[],
  results: CodexInspectionResultItem[],
  settings: CodexInspectionSettings
): CodexInspectionSummary => {
  const deleteCount = results.filter((item) => item.action === 'delete').length;
  const disableCount = results.filter((item) => item.action === 'disable').length;
  const enableCount = results.filter((item) => item.action === 'enable').length;
  const keepCount = results.length - deleteCount - disableCount - enableCount;
  const preview = results
    .filter((item) => item.action !== 'keep')
    .slice(0, 10)
    .map((item) => `${item.displayAccount} -> ${item.action}`);

  return {
    totalFiles: files.length,
    probeSetCount: sampledAccounts.length,
    sampledCount: results.length,
    disabledCount: sampledAccounts.filter((item) => item.disabled).length,
    enabledCount: sampledAccounts.filter((item) => !item.disabled).length,
    deleteCount,
    disableCount,
    enableCount,
    keepCount,
    usedPercentThreshold: settings.usedPercentThreshold,
    sampled: settings.sampleSize > 0 && settings.sampleSize < sampledAccounts.length,
    plannedActionPreview: preview,
  };
};

export const resolveCodexInspectionSettings = (
  config: Config | null,
  apiBase: string,
  managementKey: string,
  settingsOverride?: Partial<CodexInspectionConfigurableSettings> | null
): CodexInspectionSettings => {
  const clean = config?.clean ?? null;
  const configurable = normalizeConfigurableSettings({
    ...readConfigurableSettingsFromConfig(config),
    ...(settingsOverride ?? {}),
  });

  return {
    baseUrl: readString(apiBase) || readString(clean?.baseUrl),
    token: readString(managementKey) || readString(clean?.token),
    targetType: configurable.targetType,
    workers: configurable.workers,
    deleteWorkers: configurable.deleteWorkers,
    timeout: configurable.timeout,
    retries: configurable.retries,
    userAgent: configurable.userAgent,
    usedPercentThreshold: configurable.usedPercentThreshold,
    sampleSize: configurable.sampleSize,
  };
};

export const createCodexInspectionSession = ({
  config,
  apiBase,
  managementKey,
  settings,
  onLog,
  onProgress,
  onResultsChange,
}: CreateCodexInspectionSessionOptions): CodexInspectionSession => {
  const resolvedSettings = resolveCodexInspectionSettings(config, apiBase, managementKey, settings);
  const sessionId = `codex-inspection-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  let status: CodexInspectionProgressStatus = 'idle';
  let startedAt = 0;
  let finishedAt = 0;
  let files: AuthFileItem[] = [];
  let probeSet: CodexInspectionAccount[] = [];
  let sampledAccounts: CodexInspectionAccount[] = [];
  let cursor = 0;
  let inFlight = 0;
  let finalResult: CodexInspectionRunResult | null = null;
  let deferred: CodexInspectionSessionPromiseState | null = null;
  const resultMap = new Map<string, CodexInspectionResultItem>();

  const emitProgress = () => {
    const baseTime = startedAt || Date.now();
    const summary = buildProgressSummary(
      files,
      probeSet,
      sampledAccounts,
      Array.from(resultMap.values())
    );
    onProgress?.(
      createProgressSnapshot(
        sampledAccounts.length,
        resultMap.size,
        inFlight,
        status,
        baseTime,
        Date.now(),
        summary
      )
    );
  };

  const buildRunResult = (finishedTime: number): CodexInspectionRunResult => {
    const results = sortResults(Array.from(resultMap.values()));
    const summary = buildSummary(files, probeSet, results, resolvedSettings);
    return {
      settings: resolvedSettings,
      files,
      results,
      summary,
      startedAt,
      finishedAt: finishedTime,
    };
  };

  const emitResultsChange = (latestResult: CodexInspectionResultItem) => {
    if (latestResult.action === 'keep') return;
    onResultsChange?.(buildRunResult(0));
  };

  const settleStopped = () => {
    if (!deferred) return;
    const currentDeferred = deferred;
    deferred = null;
    currentDeferred.reject(new CodexInspectionStoppedError());
  };

  const settleCompleted = () => {
    if (!deferred) return;
    const currentDeferred = deferred;
    deferred = null;
    finishedAt = Date.now();
    finalResult = buildRunResult(finishedAt);
    status = 'completed';
    emitProgress();
    onLog?.(
      'success',
      `巡检完成：删除 ${finalResult.summary.deleteCount}、禁用 ${finalResult.summary.disableCount}、启用 ${finalResult.summary.enableCount}、保留 ${finalResult.summary.keepCount}`
    );
    currentDeferred.resolve(finalResult);
  };

  const maybeSettle = () => {
    if (status === 'stopped') {
      if (inFlight === 0) {
        settleStopped();
      }
      return;
    }

    if (cursor >= sampledAccounts.length && inFlight === 0) {
      settleCompleted();
    }
  };

  const pump = () => {
    if (status !== 'running') {
      maybeSettle();
      return;
    }

    while (
      status === 'running' &&
      inFlight < resolvedSettings.workers &&
      cursor < sampledAccounts.length
    ) {
      const account = sampledAccounts[cursor];
      cursor += 1;
      inFlight += 1;
      emitProgress();

      void inspectSingleAccount(account, resolvedSettings, onLog)
        .then((inspectionResult) => {
          resultMap.set(inspectionResult.key, inspectionResult);
          emitResultsChange(inspectionResult);
        })
        .catch((error) => {
          const fallbackResult: CodexInspectionResultItem = {
            ...account,
            action: 'keep',
            actionReason: '探测异常，保留账号',
            statusCode: null,
            usedPercent: null,
            isQuota: false,
            error: error instanceof Error ? error.message : String(error || '探测失败'),
          };
          resultMap.set(account.key, fallbackResult);
          emitResultsChange(fallbackResult);
        })
        .finally(() => {
          inFlight = Math.max(0, inFlight - 1);
          emitProgress();
          pump();
        });
    }

    maybeSettle();
  };

  const ensureStarted = () => {
    if (startedAt <= 0) {
      startedAt = Date.now();
    }
    if (!deferred) {
      deferred = createDeferred();
    }
    return deferred;
  };

  const initialize = async () => {
    onLog?.('info', `加载认证文件列表，目标类型：${resolvedSettings.targetType}`);

    const authFilesResponse = await authFilesApi.list();
    files = Array.isArray(authFilesResponse.files) ? authFilesResponse.files : [];
    const accounts = files.map(toInspectionAccount);
    probeSet = accounts.filter((item) => item.provider === resolvedSettings.targetType);
    sampledAccounts =
      resolvedSettings.sampleSize > 0
        ? pickSample(probeSet, Math.min(resolvedSettings.sampleSize, probeSet.length))
        : probeSet;

    onLog?.(
      'info',
      `巡检集合 ${probeSet.length} 个账号，本次探测 ${sampledAccounts.length} 个账号`
    );
    emitProgress();
  };

  const start = () => {
    if (finalResult) {
      return Promise.resolve(finalResult);
    }

    if (status === 'completed') {
      return Promise.reject(new Error('巡检已结束，请重新开始'));
    }

    if (status === 'running') {
      return ensureStarted().promise;
    }

    if (status === 'paused') {
      status = 'running';
      onLog?.('info', '继续巡检');
      emitProgress();
      pump();
      return ensureStarted().promise;
    }

    if (status === 'stopped') {
      return Promise.reject(new CodexInspectionStoppedError('巡检已停止，请重新开始'));
    }

    const currentDeferred = ensureStarted();
    status = 'running';
    emitProgress();

    void initialize()
      .then(() => {
        pump();
      })
      .catch((error) => {
        status = 'completed';
        emitProgress();
        const activeDeferred = deferred;
        deferred = null;
        activeDeferred?.reject(error);
      });

    return currentDeferred.promise;
  };

  const resume = () => {
    if (status !== 'paused') return;
    status = 'running';
    onLog?.('info', '继续巡检');
    emitProgress();
    pump();
  };

  const pause = () => {
    if (status !== 'running') return;
    status = 'paused';
    onLog?.(
      'info',
      inFlight > 0 ? `巡检已暂停，等待 ${inFlight} 个进行中的探测完成` : '巡检已暂停'
    );
    emitProgress();
    maybeSettle();
  };

  const stop = () => {
    if (status === 'completed' || status === 'stopped' || status === 'idle') return;
    status = 'stopped';
    onLog?.(
      'warning',
      inFlight > 0 ? `巡检已停止，等待 ${inFlight} 个进行中的探测完成` : '巡检已停止'
    );
    emitProgress();
    maybeSettle();
  };

  return {
    id: sessionId,
    start,
    resume,
    pause,
    stop,
    getProgress: () =>
      createProgressSnapshot(
        sampledAccounts.length,
        resultMap.size,
        inFlight,
        status,
        startedAt || Date.now(),
        Date.now(),
        buildProgressSummary(files, probeSet, sampledAccounts, Array.from(resultMap.values()))
      ),
  };
};

export const inspectCodexAccounts = async ({
  config,
  apiBase,
  managementKey,
  settings,
  onLog,
  onProgress,
  onResultsChange,
}: InspectCodexAccountsOptions): Promise<CodexInspectionRunResult> => {
  const session = createCodexInspectionSession({
    config,
    apiBase,
    managementKey,
    settings,
    onLog,
    onProgress,
    onResultsChange,
  });

  return session.start();
};

const dedupeExecutionItems = (items: CodexInspectionResultItem[]) => {
  const map = new Map<string, CodexInspectionResultItem>();
  items.forEach((item) => {
    if (item.action === 'keep') return;
    if (!item.fileName) return;
    if (!map.has(item.fileName)) {
      map.set(item.fileName, item);
    }
  });
  return Array.from(map.values()).sort((left, right) =>
    left.fileName.localeCompare(right.fileName)
  );
};

const executeDelete = async (
  item: CodexInspectionResultItem
): Promise<CodexInspectionExecutionOutcome> => {
  try {
    const result = await authFilesApi.deleteFileByName(item.fileName);
    const failed = result.failed[0];
    if (failed) {
      return {
        action: 'delete',
        fileName: item.fileName,
        displayAccount: item.displayAccount,
        success: false,
        error: failed.error || '删除失败',
      };
    }
    return {
      action: 'delete',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      success: true,
      error: '',
    };
  } catch (error) {
    return {
      action: 'delete',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      success: false,
      error: error instanceof Error ? error.message : String(error || '删除失败'),
    };
  }
};

const executeStatusChange = async (
  item: CodexInspectionResultItem,
  disabled: boolean
): Promise<CodexInspectionExecutionOutcome> => {
  try {
    await authFilesApi.setStatusWithFallback(item.fileName, disabled);
    return {
      action: disabled ? 'disable' : 'enable',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      success: true,
      error: '',
    };
  } catch (error) {
    return {
      action: disabled ? 'disable' : 'enable',
      fileName: item.fileName,
      displayAccount: item.displayAccount,
      success: false,
      error: error instanceof Error ? error.message : String(error || '状态更新失败'),
    };
  }
};

export const executeCodexInspectionActions = async ({
  settings,
  items,
  previousFiles,
  onLog,
}: ExecuteCodexInspectionActionsOptions): Promise<CodexInspectionExecutionResult> => {
  const dedupedItems = dedupeExecutionItems(items);
  const deleteItems = dedupedItems.filter((item) => item.action === 'delete');
  const disableItems = dedupedItems.filter((item) => item.action === 'disable');
  const enableItems = dedupedItems.filter((item) => item.action === 'enable');
  const outcomes: CodexInspectionExecutionOutcome[] = [];

  if (deleteItems.length > 0) {
    onLog?.('info', `开始删除 ${deleteItems.length} 个账号`);
    const deleteOutcomes = await runConcurrently(
      deleteItems,
      settings.deleteWorkers,
      executeDelete
    );
    deleteOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        `${outcome.displayAccount} 删除${outcome.success ? '成功' : `失败：${outcome.error}`}`
      );
    });
    outcomes.push(...deleteOutcomes);
  }

  if (disableItems.length > 0) {
    onLog?.('info', `开始禁用 ${disableItems.length} 个账号`);
    const disableOutcomes = await runConcurrently(disableItems, settings.deleteWorkers, (item) =>
      executeStatusChange(item, true)
    );
    disableOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        `${outcome.displayAccount} 禁用${outcome.success ? '成功' : `失败：${outcome.error}`}`
      );
    });
    outcomes.push(...disableOutcomes);
  }

  if (enableItems.length > 0) {
    onLog?.('info', `开始启用 ${enableItems.length} 个账号`);
    const enableOutcomes = await runConcurrently(enableItems, settings.deleteWorkers, (item) =>
      executeStatusChange(item, false)
    );
    enableOutcomes.forEach((outcome) => {
      onLog?.(
        outcome.success ? 'success' : 'error',
        `${outcome.displayAccount} 启用${outcome.success ? '成功' : `失败：${outcome.error}`}`
      );
    });
    outcomes.push(...enableOutcomes);
  }

  let refreshedFiles = previousFiles;
  let refreshError = '';
  try {
    const response = await authFilesApi.list();
    refreshedFiles = Array.isArray(response.files) ? response.files : previousFiles;
  } catch (error) {
    refreshError = error instanceof Error ? error.message : String(error || '刷新账号列表失败');
    onLog?.('warning', `执行后刷新账号列表失败，已回退旧快照：${refreshError}`);
  }

  return {
    outcomes,
    refreshedFiles,
    refreshError,
  };
};

export const buildCodexInspectionError = (message: string) => message;

export const buildExecutionFailureMessage = (outcome: CodexInspectionExecutionOutcome) =>
  `${outcome.displayAccount}：${outcome.error || '执行失败'}`;

export const isSuggestedAction = (item: CodexInspectionResultItem) => item.action !== 'keep';

export const resolveCodexInspectionAutoActionItems = (
  mode: CodexInspectionAutoActionMode,
  items: CodexInspectionResultItem[]
): CodexInspectionResultItem[] => {
  const normalizedMode = normalizeAutoActionMode(mode);
  if (normalizedMode === 'none') return [];

  if (normalizedMode === 'disable') {
    return items
      .filter((item) => item.action === 'delete' || item.action === 'disable')
      .map((item) =>
        item.action === 'delete'
          ? {
              ...item,
              action: 'disable',
              actionReason: item.actionReason
                ? `${item.actionReason}；自动禁用策略改为禁用账号`
                : '自动禁用策略改为禁用账号',
            }
          : item
      );
  }

  return items.filter((item) => item.action === 'delete' || item.action === 'disable');
};

export const isCodexInspectionStoppedError = (
  error: unknown
): error is CodexInspectionStoppedError => error instanceof CodexInspectionStoppedError;

export const applyCodexInspectionExecutionResult = (
  previousResult: CodexInspectionRunResult,
  execution: CodexInspectionExecutionResult
): CodexInspectionRunResult => {
  const successfulOutcomes = new Map(
    execution.outcomes.filter((item) => item.success).map((item) => [item.fileName, item] as const)
  );
  const refreshedAccounts = new Map(
    execution.refreshedFiles.map((file) => {
      const account = toInspectionAccount(file);
      return [account.fileName, account] as const;
    })
  );

  const nextResults = sortResults(
    previousResult.results.map((item) => {
      const refreshedAccount = refreshedAccounts.get(item.fileName);
      const baseItem: CodexInspectionResultItem = refreshedAccount
        ? {
            ...item,
            ...refreshedAccount,
            raw: refreshedAccount.raw,
          }
        : item;
      const outcome = successfulOutcomes.get(item.fileName);

      if (!outcome) {
        return baseItem;
      }

      return {
        ...baseItem,
        disabled:
          outcome.action === 'disable'
            ? true
            : outcome.action === 'enable'
              ? false
              : baseItem.disabled,
        action: 'keep',
        actionReason: '无需处理',
        error: '',
      };
    })
  );

  const deleteCount = nextResults.filter((item) => item.action === 'delete').length;
  const disableCount = nextResults.filter((item) => item.action === 'disable').length;
  const enableCount = nextResults.filter((item) => item.action === 'enable').length;
  const keepCount = nextResults.length - deleteCount - disableCount - enableCount;
  const plannedActionPreview = nextResults
    .filter((item) => item.action !== 'keep')
    .slice(0, 10)
    .map((item) => `${item.displayAccount} -> ${item.action}`);

  return {
    ...previousResult,
    files: execution.refreshedFiles,
    results: nextResults,
    summary: {
      ...previousResult.summary,
      totalFiles: execution.refreshedFiles.length,
      disabledCount: nextResults.filter((item) => item.disabled).length,
      enabledCount: nextResults.filter((item) => !item.disabled).length,
      deleteCount,
      disableCount,
      enableCount,
      keepCount,
      plannedActionPreview,
    },
    finishedAt: Date.now(),
  };
};

export const buildSuggestedActionCountLabel = (summary: CodexInspectionSummary) =>
  summary.deleteCount + summary.disableCount + summary.enableCount;

export const getProbeFailureMessage = (result: CodexInspectionResultItem) =>
  result.error ||
  getApiCallErrorMessage({
    statusCode: result.statusCode || 0,
    hasStatusCode: true,
    header: {},
    bodyText: '',
    body: null,
  });
