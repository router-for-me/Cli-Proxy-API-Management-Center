import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useInterval } from '@/hooks/useInterval';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconBot, IconDownload, IconInfo, IconTrash2 } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import { apiCallApi, authFilesApi, getApiCallErrorMessage, usageApi } from '@/services/api';
import { apiClient } from '@/services/api/client';
import type { AuthFileItem } from '@/types';
import type { KeyStats, KeyStatBucket, UsageDetail } from '@/utils/usage';
import { collectUsageDetails, calculateStatusBarData } from '@/utils/usage';
import { formatFileSize } from '@/utils/format';
import styles from './AuthFilesPage.module.scss';

type ThemeColors = { bg: string; text: string; border?: string };
type TypeColorSet = { light: ThemeColors; dark?: ThemeColors };
type ResolvedTheme = 'light' | 'dark';

// 标签类型颜色配置（对齐重构前 styles.css 的 file-type-badge 颜色）
const TYPE_COLORS: Record<string, TypeColorSet> = {
  qwen: {
    light: { bg: '#e8f5e9', text: '#2e7d32' },
    dark: { bg: '#1b5e20', text: '#81c784' }
  },
  gemini: {
    light: { bg: '#e3f2fd', text: '#1565c0' },
    dark: { bg: '#0d47a1', text: '#64b5f6' }
  },
  'gemini-cli': {
    light: { bg: '#e7efff', text: '#1e4fa3' },
    dark: { bg: '#1c3f73', text: '#a8c7ff' }
  },
  aistudio: {
    light: { bg: '#f0f2f5', text: '#2f343c' },
    dark: { bg: '#373c42', text: '#cfd3db' }
  },
  claude: {
    light: { bg: '#fce4ec', text: '#c2185b' },
    dark: { bg: '#880e4f', text: '#f48fb1' }
  },
  codex: {
    light: { bg: '#fff3e0', text: '#ef6c00' },
    dark: { bg: '#e65100', text: '#ffb74d' }
  },
  antigravity: {
    light: { bg: '#e0f7fa', text: '#006064' },
    dark: { bg: '#004d40', text: '#80deea' }
  },
  iflow: {
    light: { bg: '#f3e5f5', text: '#7b1fa2' },
    dark: { bg: '#4a148c', text: '#ce93d8' }
  },
  empty: {
    light: { bg: '#f5f5f5', text: '#616161' },
    dark: { bg: '#424242', text: '#bdbdbd' }
  },
  unknown: {
    light: { bg: '#f0f0f0', text: '#666666', border: '1px dashed #999999' },
    dark: { bg: '#3a3a3a', text: '#aaaaaa', border: '1px dashed #666666' }
  }
};

const OAUTH_PROVIDER_PRESETS = [
  'gemini',
  'gemini-cli',
  'vertex',
  'aistudio',
  'antigravity',
  'claude',
  'codex',
  'qwen',
  'iflow'
];

const OAUTH_PROVIDER_EXCLUDES = new Set(['all', 'unknown', 'empty']);

interface ExcludedFormState {
  provider: string;
  modelsText: string;
}

interface AntigravityQuotaGroup {
  id: string;
  label: string;
  models: string[];
  remainingFraction: number;
  resetTime?: string;
}

interface AntigravityQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  groups: AntigravityQuotaGroup[];
  error?: string;
  errorStatus?: number;
}

interface AntigravityQuotaInfo {
  displayName?: string;
  quotaInfo?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
  quota_info?: {
    remainingFraction?: number | string;
    remaining_fraction?: number | string;
    remaining?: number | string;
    resetTime?: string;
    reset_time?: string;
  };
}

type AntigravityModelsPayload = Record<string, AntigravityQuotaInfo>;

interface AntigravityQuotaGroupDefinition {
  id: string;
  label: string;
  identifiers: string[];
  labelFromModel?: boolean;
}

const ANTIGRAVITY_QUOTA_URLS = [
  'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
  'https://daily-cloudcode-pa.sandbox.googleapis.com/v1internal:fetchAvailableModels',
  'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels'
];

const ANTIGRAVITY_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'antigravity/1.11.5 windows/amd64'
};

const ANTIGRAVITY_QUOTA_GROUPS: AntigravityQuotaGroupDefinition[] = [
  {
    id: 'claude-gpt',
    label: 'Claude/GPT',
    identifiers: [
      'claude-sonnet-4-5-thinking',
      'claude-opus-4-5-thinking',
      'claude-sonnet-4-5',
      'gpt-oss-120b-medium'
    ]
  },
  {
    id: 'gemini',
    label: 'Gemini',
    identifiers: [
      'gemini-3-pro-high',
      'gemini-3-pro-low',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'rev19-uic3-1p'
    ]
  },
  {
    id: 'gemini-3-flash',
    label: 'Gemini 3 Flash',
    identifiers: ['gemini-3-flash']
  },
  {
    id: 'gemini-image',
    label: 'gemini-3-pro-image',
    identifiers: ['gemini-3-pro-image'],
    labelFromModel: true
  }
];

interface CodexUsageWindow {
  used_percent?: number | string;
  usedPercent?: number | string;
  limit_window_seconds?: number | string;
  limitWindowSeconds?: number | string;
  reset_after_seconds?: number | string;
  resetAfterSeconds?: number | string;
  reset_at?: number | string;
  resetAt?: number | string;
}

interface CodexRateLimitInfo {
  allowed?: boolean;
  limit_reached?: boolean;
  primary_window?: CodexUsageWindow | null;
  primaryWindow?: CodexUsageWindow | null;
  secondary_window?: CodexUsageWindow | null;
  secondaryWindow?: CodexUsageWindow | null;
}

interface CodexUsagePayload {
  plan_type?: string;
  planType?: string;
  rate_limit?: CodexRateLimitInfo | null;
  rateLimit?: CodexRateLimitInfo | null;
  code_review_rate_limit?: CodexRateLimitInfo | null;
  codeReviewRateLimit?: CodexRateLimitInfo | null;
}

interface CodexQuotaWindow {
  id: string;
  label: string;
  usedPercent: number | null;
  resetLabel: string;
}

interface CodexQuotaState {
  status: 'idle' | 'loading' | 'success' | 'error';
  windows: CodexQuotaWindow[];
  planType?: string | null;
  error?: string;
  errorStatus?: number;
}

const CODEX_USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

const CODEX_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'User-Agent': 'codex_cli_rs/0.76.0 (Debian 13.0.0; x86_64) WindowsTerminal'
};

const createStatusError = (message: string, status?: number) => {
  const error = new Error(message) as Error & { status?: number };
  if (status !== undefined) {
    error.status = status;
  }
  return error;
};

const getStatusFromError = (err: unknown): number | undefined => {
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const rawStatus = (err as { status?: unknown }).status;
    if (typeof rawStatus === 'number' && Number.isFinite(rawStatus)) {
      return rawStatus;
    }
    const asNumber = Number(rawStatus);
    if (Number.isFinite(asNumber) && asNumber > 0) {
      return asNumber;
    }
  }
  return undefined;
};



// 标准化 auth_index 值（与 usage.ts 中的 normalizeAuthIndex 保持一致）
function normalizeAuthIndexValue(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
}

function normalizeStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
}

function normalizeNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizePlanType(value: unknown): string | null {
  const normalized = normalizeStringValue(value);
  return normalized ? normalized.toLowerCase() : null;
}

function decodeBase64UrlPayload(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(padded);
    }
    if (typeof atob === 'function') {
      return atob(padded);
    }
  } catch {
    return null;
  }
  return null;
}

function parseIdTokenPayload(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object') {
    return Array.isArray(value) ? null : (value as Record<string, unknown>);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
  }
  const segments = trimmed.split('.');
  if (segments.length < 2) return null;
  const decoded = decodeBase64UrlPayload(segments[1]);
  if (!decoded) return null;
  try {
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    if (parsed && typeof parsed === 'object') return parsed;
  } catch {
    return null;
  }
  return null;
}

function extractCodexChatgptAccountId(value: unknown): string | null {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;
  return normalizeStringValue(payload.chatgpt_account_id ?? payload.chatgptAccountId);
}

function resolveCodexChatgptAccountId(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;

  const candidates = [file.id_token, metadata?.id_token, attributes?.id_token];

  for (const candidate of candidates) {
    const id = extractCodexChatgptAccountId(candidate);
    if (id) return id;
  }

  return null;
}

function resolveCodexPlanType(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const idToken =
    file && typeof file.id_token === 'object' && file.id_token !== null
      ? (file.id_token as Record<string, unknown>)
      : null;
  const metadataIdToken =
    metadata && typeof metadata.id_token === 'object' && metadata.id_token !== null
      ? (metadata.id_token as Record<string, unknown>)
      : null;
  const candidates = [
    file.plan_type,
    file.planType,
    file['plan_type'],
    file['planType'],
    file.id_token,
    idToken?.plan_type,
    idToken?.planType,
    metadata?.plan_type,
    metadata?.planType,
    metadata?.id_token,
    metadataIdToken?.plan_type,
    metadataIdToken?.planType,
    attributes?.plan_type,
    attributes?.planType,
    attributes?.id_token
  ];

  for (const candidate of candidates) {
    const planType = normalizePlanType(candidate);
    if (planType) return planType;
  }

  return null;
}

function parseAntigravityPayload(payload: unknown): Record<string, unknown> | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as Record<string, unknown>;
  }
  return null;
}

function parseCodexUsagePayload(payload: unknown): CodexUsagePayload | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as CodexUsagePayload;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as CodexUsagePayload;
  }
  return null;
}

function getAntigravityQuotaInfo(entry?: AntigravityQuotaInfo): {
  remainingFraction: number | null;
  resetTime?: string;
  displayName?: string;
} {
  if (!entry) {
    return { remainingFraction: null };
  }
  const quotaInfo = entry.quotaInfo ?? entry.quota_info ?? {};
  const remainingValue =
    quotaInfo.remainingFraction ?? quotaInfo.remaining_fraction ?? quotaInfo.remaining;
  const remainingFraction = Number(remainingValue);
  const resetValue = quotaInfo.resetTime ?? quotaInfo.reset_time;
  const resetTime = typeof resetValue === 'string' ? resetValue : undefined;
  const displayName = typeof entry.displayName === 'string' ? entry.displayName : undefined;

  return {
    remainingFraction: Number.isFinite(remainingFraction) ? remainingFraction : null,
    resetTime,
    displayName
  };
}

function findAntigravityModel(
  models: AntigravityModelsPayload,
  identifier: string
): { id: string; entry: AntigravityQuotaInfo } | null {
  const direct = models[identifier];
  if (direct) {
    return { id: identifier, entry: direct };
  }

  const match = Object.entries(models).find(([, entry]) => {
    const name = typeof entry?.displayName === 'string' ? entry.displayName : '';
    return name.toLowerCase() === identifier.toLowerCase();
  });
  if (match) {
    return { id: match[0], entry: match[1] };
  }

  return null;
}

function buildAntigravityQuotaGroups(models: AntigravityModelsPayload): AntigravityQuotaGroup[] {
  const groups: AntigravityQuotaGroup[] = [];
  let geminiResetTime: string | undefined;
  const [claudeDef, geminiDef, flashDef, imageDef] = ANTIGRAVITY_QUOTA_GROUPS;

  const buildGroup = (
    def: AntigravityQuotaGroupDefinition,
    overrideResetTime?: string
  ): AntigravityQuotaGroup | null => {
    const matches = def.identifiers
      .map((identifier) => findAntigravityModel(models, identifier))
      .filter((entry): entry is { id: string; entry: AntigravityQuotaInfo } => Boolean(entry));

    const quotaEntries = matches
      .map(({ id, entry }) => {
        const info = getAntigravityQuotaInfo(entry);
        if (info.remainingFraction === null) return null;
        return {
          id,
          remainingFraction: info.remainingFraction,
          resetTime: info.resetTime,
          displayName: info.displayName
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

    if (quotaEntries.length === 0) return null;

    const remainingFraction = Math.min(...quotaEntries.map((entry) => entry.remainingFraction));
    const resetTime =
      overrideResetTime ?? quotaEntries.map((entry) => entry.resetTime).find(Boolean);
    const displayName = quotaEntries.map((entry) => entry.displayName).find(Boolean);
    const label = def.labelFromModel && displayName ? displayName : def.label;

    return {
      id: def.id,
      label,
      models: quotaEntries.map((entry) => entry.id),
      remainingFraction,
      resetTime
    };
  };

  const claudeGroup = buildGroup(claudeDef);
  if (claudeGroup) {
    groups.push(claudeGroup);
  }

  const geminiGroup = buildGroup(geminiDef);
  if (geminiGroup) {
    geminiResetTime = geminiGroup.resetTime;
    groups.push(geminiGroup);
  }

  const flashGroup = buildGroup(flashDef);
  if (flashGroup) {
    groups.push(flashGroup);
  }

  const imageGroup = buildGroup(imageDef, geminiResetTime);
  if (imageGroup) {
    groups.push(imageGroup);
  }

  return groups;
}

function formatQuotaResetTime(value?: string): string {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatUnixSeconds(value: number | null): string {
  if (!value) return '-';
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });
}

function formatCodexResetLabel(window?: CodexUsageWindow | null): string {
  if (!window) return '-';
  const resetAt = normalizeNumberValue(window.reset_at ?? window.resetAt);
  if (resetAt !== null && resetAt > 0) {
    return formatUnixSeconds(resetAt);
  }
  const resetAfter = normalizeNumberValue(window.reset_after_seconds ?? window.resetAfterSeconds);
  if (resetAfter !== null && resetAfter > 0) {
    const targetSeconds = Math.floor(Date.now() / 1000 + resetAfter);
    return formatUnixSeconds(targetSeconds);
  }
  return '-';
}

function resolveAuthProvider(file: AuthFileItem): string {
  const raw = file.provider ?? file.type ?? '';
  return String(raw).trim().toLowerCase();
}

function isAntigravityFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'antigravity';
}

function isCodexFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'codex';
}

function isRuntimeOnlyAuthFile(file: AuthFileItem): boolean {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}

// 解析认证文件的统计数据
function resolveAuthFileStats(
  file: AuthFileItem,
  stats: KeyStats
): KeyStatBucket {
  const defaultStats: KeyStatBucket = { success: 0, failure: 0 };
  const rawFileName = file?.name || '';

  // 兼容 auth_index 和 authIndex 两种字段名（API 返回的是 auth_index）
  const rawAuthIndex = file['auth_index'] ?? file.authIndex;
  const authIndexKey = normalizeAuthIndexValue(rawAuthIndex);

  // 尝试根据 authIndex 匹配
  if (authIndexKey && stats.byAuthIndex?.[authIndexKey]) {
    return stats.byAuthIndex[authIndexKey];
  }

  // 尝试根据 source (文件名) 匹配
  if (rawFileName && stats.bySource?.[rawFileName]) {
    const fromName = stats.bySource[rawFileName];
    if (fromName.success > 0 || fromName.failure > 0) {
      return fromName;
    }
  }

  // 尝试去掉扩展名后匹配
  if (rawFileName) {
    const nameWithoutExt = rawFileName.replace(/\.[^/.]+$/, '');
    if (nameWithoutExt && nameWithoutExt !== rawFileName) {
      const fromNameWithoutExt = stats.bySource?.[nameWithoutExt];
      if (fromNameWithoutExt && (fromNameWithoutExt.success > 0 || fromNameWithoutExt.failure > 0)) {
        return fromNameWithoutExt;
      }
    }
  }

  return defaultStats;
}

export function AuthFilesPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<'all' | string>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(9);
  const [antigravityPage, setAntigravityPage] = useState(1);
  const [antigravityPageSize, setAntigravityPageSize] = useState(6);
  const [codexPage, setCodexPage] = useState(1);
  const [codexPageSize, setCodexPageSize] = useState(6);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [keyStats, setKeyStats] = useState<KeyStats>({ bySource: {}, byAuthIndex: {} });
  const [usageDetails, setUsageDetails] = useState<UsageDetail[]>([]);
  const [antigravityQuota, setAntigravityQuota] = useState<Record<string, AntigravityQuotaState>>(
    {}
  );
  const [antigravityLoading, setAntigravityLoading] = useState(false);
  const [antigravityLoadingScope, setAntigravityLoadingScope] = useState<
    'page' | 'all' | null
  >(null);
  const [codexQuota, setCodexQuota] = useState<Record<string, CodexQuotaState>>({});
  const [codexLoading, setCodexLoading] = useState(false);
  const [codexLoadingScope, setCodexLoadingScope] = useState<'page' | 'all' | null>(null);

  // 详情弹窗相关
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<AuthFileItem | null>(null);

  // 模型列表弹窗相关
  const [modelsModalOpen, setModelsModalOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsList, setModelsList] = useState<{ id: string; display_name?: string; type?: string }[]>([]);
  const [modelsFileName, setModelsFileName] = useState('');
  const [modelsFileType, setModelsFileType] = useState('');
  const [modelsError, setModelsError] = useState<'unsupported' | null>(null);

  // OAuth 排除模型相关
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [excludedError, setExcludedError] = useState<'unsupported' | null>(null);
  const [excludedModalOpen, setExcludedModalOpen] = useState(false);
  const [excludedForm, setExcludedForm] = useState<ExcludedFormState>({ provider: '', modelsText: '' });
  const [savingExcluded, setSavingExcluded] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const loadingKeyStatsRef = useRef(false);
  const antigravityLoadingRef = useRef(false);
  const antigravityRequestIdRef = useRef(0);
  const codexLoadingRef = useRef(false);
  const codexRequestIdRef = useRef(0);
  const excludedUnsupportedRef = useRef(false);

  const disableControls = connectionStatus !== 'connected';

  // 格式化修改时间
  const formatModified = (item: AuthFileItem): string => {
    const raw = item['modtime'] ?? item.modified;
    if (!raw) return '-';
    const asNumber = Number(raw);
    const date =
      Number.isFinite(asNumber) && !Number.isNaN(asNumber)
        ? new Date(asNumber < 1e12 ? asNumber * 1000 : asNumber)
        : new Date(String(raw));
    return Number.isNaN(date.getTime()) ? '-' : date.toLocaleString();
  };

  // 加载文件列表
  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  // 加载 key 统计和 usage 明细（API 层已有60秒超时）
  const loadKeyStats = useCallback(async () => {
    // 防止重复请求
    if (loadingKeyStatsRef.current) return;
    loadingKeyStatsRef.current = true;
    try {
      const usageResponse = await usageApi.getUsage();
      const usageData = usageResponse?.usage ?? usageResponse;
      const stats = await usageApi.getKeyStats(usageData);
      setKeyStats(stats);
      // 收集 usage 明细用于状态栏
      const details = collectUsageDetails(usageData);
      setUsageDetails(details);
    } catch {
      // 静默失败
    } finally {
      loadingKeyStatsRef.current = false;
    }
  }, []);

  // 加载 OAuth 排除列表
  const loadExcluded = useCallback(async () => {
    try {
      const res = await authFilesApi.getOauthExcludedModels();
      excludedUnsupportedRef.current = false;
      setExcluded(res || {});
      setExcludedError(null);
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setExcluded({});
        setExcludedError('unsupported');
        if (!excludedUnsupportedRef.current) {
          excludedUnsupportedRef.current = true;
          showNotification(t('oauth_excluded.upgrade_required'), 'warning');
        }
        return;
      }
      // 静默失败
    }
  }, [showNotification, t]);

  const antigravityFiles = useMemo(
    () => files.filter((file) => isAntigravityFile(file)),
    [files]
  );

  const antigravityTotalPages = Math.max(
    1,
    Math.ceil(antigravityFiles.length / antigravityPageSize)
  );
  const antigravityCurrentPage = Math.min(antigravityPage, antigravityTotalPages);
  const antigravityStart = (antigravityCurrentPage - 1) * antigravityPageSize;
  const antigravityPageItems = antigravityFiles.slice(
    antigravityStart,
    antigravityStart + antigravityPageSize
  );

  const codexFiles = useMemo(() => files.filter((file) => isCodexFile(file)), [files]);
  const codexTotalPages = Math.max(1, Math.ceil(codexFiles.length / codexPageSize));
  const codexCurrentPage = Math.min(codexPage, codexTotalPages);
  const codexStart = (codexCurrentPage - 1) * codexPageSize;
  const codexPageItems = codexFiles.slice(codexStart, codexStart + codexPageSize);

  const fetchAntigravityQuota = useCallback(
    async (authIndex: string): Promise<AntigravityQuotaGroup[]> => {
      let lastError = '';
      let lastStatus: number | undefined;
      let priorityStatus: number | undefined;
      let hadSuccess = false;

      for (const url of ANTIGRAVITY_QUOTA_URLS) {
        try {
          const result = await apiCallApi.request({
            authIndex,
            method: 'POST',
            url,
            header: { ...ANTIGRAVITY_REQUEST_HEADERS },
            data: '{}'
          });

          if (result.statusCode < 200 || result.statusCode >= 300) {
            lastError = getApiCallErrorMessage(result);
            lastStatus = result.statusCode;
            if (result.statusCode === 403 || result.statusCode === 404) {
              priorityStatus ??= result.statusCode;
            }
            continue;
          }

          hadSuccess = true;
          const payload = parseAntigravityPayload(result.body ?? result.bodyText);
          const models = payload?.models;
          if (!models || typeof models !== 'object' || Array.isArray(models)) {
            lastError = t('antigravity_quota.empty_models');
            continue;
          }

          const groups = buildAntigravityQuotaGroups(models as AntigravityModelsPayload);
          if (groups.length === 0) {
            lastError = t('antigravity_quota.empty_models');
            continue;
          }

          return groups;
        } catch (err: unknown) {
          lastError = err instanceof Error ? err.message : t('common.unknown_error');
          const status = getStatusFromError(err);
          if (status) {
            lastStatus = status;
            if (status === 403 || status === 404) {
              priorityStatus ??= status;
            }
          }
        }
      }

      if (hadSuccess) {
        return [];
      }

      throw createStatusError(lastError || t('common.unknown_error'), priorityStatus ?? lastStatus);
    },
    [t]
  );

  const loadAntigravityQuota = useCallback(
    async (targets: AuthFileItem[], scope: 'page' | 'all') => {
      if (antigravityLoadingRef.current) return;
      antigravityLoadingRef.current = true;
      const requestId = ++antigravityRequestIdRef.current;
      setAntigravityLoading(true);
      setAntigravityLoadingScope(scope);

      try {
        if (targets.length === 0) return;

        setAntigravityQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = { status: 'loading', groups: [] };
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file) => {
            const rawAuthIndex = file['auth_index'] ?? file.authIndex;
            const authIndex = normalizeAuthIndexValue(rawAuthIndex);
            if (!authIndex) {
              return {
                name: file.name,
                status: 'error' as const,
                error: t('antigravity_quota.missing_auth_index')
              };
            }

            try {
              const groups = await fetchAntigravityQuota(authIndex);
              return { name: file.name, status: 'success' as const, groups };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error' as const, error: message, errorStatus };
            }
          })
        );

        if (requestId !== antigravityRequestIdRef.current) return;

        setAntigravityQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = {
                status: 'success',
                groups: result.groups
              };
            } else {
              nextState[result.name] = {
                status: 'error',
                groups: [],
                error: result.error,
                errorStatus: result.errorStatus
              };
            }
          });
          return nextState;
        });
      } finally {
        if (requestId === antigravityRequestIdRef.current) {
          setAntigravityLoading(false);
          setAntigravityLoadingScope(null);
          antigravityLoadingRef.current = false;
        }
      }
    },
    [fetchAntigravityQuota, t]
  );

  const buildCodexQuotaWindows = useCallback(
    (payload: CodexUsagePayload): CodexQuotaWindow[] => {
      const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
      const codeReviewLimit = payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
      const windows: CodexQuotaWindow[] = [];
      const addWindow = (id: string, label: string, window?: CodexUsageWindow | null) => {
        if (!window) return;
        const usedPercent = normalizeNumberValue(window.used_percent ?? window.usedPercent);
        windows.push({
          id,
          label,
          usedPercent,
          resetLabel: formatCodexResetLabel(window)
        });
      };

      addWindow('primary', t('codex_quota.primary_window'), rateLimit?.primary_window ?? rateLimit?.primaryWindow);
      addWindow(
        'secondary',
        t('codex_quota.secondary_window'),
        rateLimit?.secondary_window ?? rateLimit?.secondaryWindow
      );
      addWindow(
        'code-review',
        t('codex_quota.code_review_window'),
        codeReviewLimit?.primary_window ?? codeReviewLimit?.primaryWindow
      );

      return windows;
    },
    [t]
  );

  const fetchCodexQuota = useCallback(
    async (file: AuthFileItem): Promise<{ planType: string | null; windows: CodexQuotaWindow[] }> => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndex = normalizeAuthIndexValue(rawAuthIndex);
      if (!authIndex) {
        throw new Error(t('codex_quota.missing_auth_index'));
      }

      const planTypeFromFile = resolveCodexPlanType(file);
      const accountId = resolveCodexChatgptAccountId(file);
      if (!accountId) {
        throw new Error(t('codex_quota.missing_account_id'));
      }

      const requestUsage = async (requestHeader: Record<string, string>) => {
        const result = await apiCallApi.request({
          authIndex,
          method: 'GET',
          url: CODEX_USAGE_URL,
          header: requestHeader
        });
        if (result.statusCode < 200 || result.statusCode >= 300) {
          throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
        }
        const payload = parseCodexUsagePayload(result.body ?? result.bodyText);
        if (!payload) {
          throw new Error(t('codex_quota.empty_windows'));
        }
        return payload;
      };

      const baseHeader: Record<string, string> = {
        ...CODEX_REQUEST_HEADERS,
        'Chatgpt-Account-Id': accountId
      };

      const payload = await requestUsage(baseHeader);
      const planTypeFromUsage = normalizePlanType(payload.plan_type ?? payload.planType);
      const windows = buildCodexQuotaWindows(payload);
      return { planType: planTypeFromUsage ?? planTypeFromFile, windows };
    },
    [buildCodexQuotaWindows, t]
  );

  const loadCodexQuota = useCallback(
    async (targets: AuthFileItem[], scope: 'page' | 'all') => {
      if (codexLoadingRef.current) return;
      codexLoadingRef.current = true;
      const requestId = ++codexRequestIdRef.current;
      setCodexLoading(true);
      setCodexLoadingScope(scope);

      try {
        if (targets.length === 0) return;

        setCodexQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = { status: 'loading', windows: [] };
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file) => {
            try {
              const { planType, windows } = await fetchCodexQuota(file);
              return { name: file.name, status: 'success' as const, planType, windows };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error' as const, error: message, errorStatus };
            }
          })
        );

        if (requestId !== codexRequestIdRef.current) return;

        setCodexQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = {
                status: 'success',
                windows: result.windows,
                planType: result.planType
              };
            } else {
              nextState[result.name] = {
                status: 'error',
                windows: [],
                error: result.error,
                errorStatus: result.errorStatus
              };
            }
          });
          return nextState;
        });
      } finally {
        if (requestId === codexRequestIdRef.current) {
          setCodexLoading(false);
          setCodexLoadingScope(null);
          codexLoadingRef.current = false;
        }
      }
    },
    [fetchCodexQuota, t]
  );

  useEffect(() => {
    loadFiles();
    loadKeyStats();
    loadExcluded();
  }, [loadFiles, loadKeyStats, loadExcluded]);

  useEffect(() => {
    if (antigravityFiles.length === 0) {
      setAntigravityQuota({});
      return;
    }
    setAntigravityQuota((prev) => {
      const nextState: Record<string, AntigravityQuotaState> = {};
      antigravityFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [antigravityFiles]);

  useEffect(() => {
    if (codexFiles.length === 0) {
      setCodexQuota({});
      return;
    }
    setCodexQuota((prev) => {
      const nextState: Record<string, CodexQuotaState> = {};
      codexFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [codexFiles]);

  // 定时刷新状态数据（每240秒）
  useInterval(loadKeyStats, 240_000);

  // 提取所有存在的类型
  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      if (file.type) {
        types.add(file.type);
      }
    });
    return Array.from(types);
  }, [files]);


  const excludedProviderLookup = useMemo(() => {
    const lookup = new Map<string, string>();
    Object.keys(excluded).forEach((provider) => {
      const key = provider.trim().toLowerCase();
      if (key && !lookup.has(key)) {
        lookup.set(key, provider);
      }
    });
    return lookup;
  }, [excluded]);

  const providerOptions = useMemo(() => {
    const extraProviders = new Set<string>();

    Object.keys(excluded).forEach((provider) => {
      extraProviders.add(provider);
    });
    files.forEach((file) => {
      if (typeof file.type === 'string') {
        extraProviders.add(file.type);
      }
      if (typeof file.provider === 'string') {
        extraProviders.add(file.provider);
      }
    });

    const normalizedExtras = Array.from(extraProviders)
      .map((value) => value.trim())
      .filter((value) => value && !OAUTH_PROVIDER_EXCLUDES.has(value.toLowerCase()));

    const baseSet = new Set(OAUTH_PROVIDER_PRESETS.map((value) => value.toLowerCase()));
    const extraList = normalizedExtras
      .filter((value) => !baseSet.has(value.toLowerCase()))
      .sort((a, b) => a.localeCompare(b));

    return [...OAUTH_PROVIDER_PRESETS, ...extraList];
  }, [excluded, files]);

  // 过滤和搜索
  const filtered = useMemo(() => {
    return files.filter((item) => {
      const matchType = filter === 'all' || item.type === filter;
      const term = search.trim().toLowerCase();
      const matchSearch =
        !term ||
        item.name.toLowerCase().includes(term) ||
        (item.type || '').toString().toLowerCase().includes(term) ||
        (item.provider || '').toString().toLowerCase().includes(term);
      return matchType && matchSearch;
    });
  }, [files, filter, search]);

  // 分页计算
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(start, start + pageSize);

  // 统计信息
  const totalSize = useMemo(() => files.reduce((sum, item) => sum + (item.size || 0), 0), [files]);

  // 点击上传
  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  // 处理文件上传（支持多选）
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = event.target.files;
    if (!fileList || fileList.length === 0) return;

    const filesToUpload = Array.from(fileList);
    const validFiles: File[] = [];
    const invalidFiles: string[] = [];

    filesToUpload.forEach((file) => {
      if (file.name.endsWith('.json')) {
        validFiles.push(file);
      } else {
        invalidFiles.push(file.name);
      }
    });

    if (invalidFiles.length > 0) {
      showNotification(t('auth_files.upload_error_json'), 'error');
    }

    if (validFiles.length === 0) {
      event.target.value = '';
      return;
    }

    setUploading(true);
    let successCount = 0;
    const failed: { name: string; message: string }[] = [];

    for (const file of validFiles) {
      try {
        await authFilesApi.upload(file);
        successCount++;
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        failed.push({ name: file.name, message: errorMessage });
      }
    }

    if (successCount > 0) {
      const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
      showNotification(`${t('auth_files.upload_success')}${suffix}`, failed.length ? 'warning' : 'success');
      await loadFiles();
      await loadKeyStats();
    }

    if (failed.length > 0) {
      const details = failed.map((item) => `${item.name}: ${item.message}`).join('; ');
      showNotification(`${t('notification.upload_failed')}: ${details}`, 'error');
    }

    setUploading(false);
    event.target.value = '';
  };

  // 删除单个文件
  const handleDelete = async (name: string) => {
    if (!window.confirm(`${t('auth_files.delete_confirm')} "${name}" ?`)) return;
    setDeleting(name);
    try {
      await authFilesApi.deleteFile(name);
      showNotification(t('auth_files.delete_success'), 'success');
      setFiles((prev) => prev.filter((item) => item.name !== name));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
    } finally {
      setDeleting(null);
    }
  };

  // 删除全部（根据筛选类型）
  const handleDeleteAll = async () => {
    const isFiltered = filter !== 'all';
    const typeLabel = isFiltered ? getTypeLabel(filter) : t('auth_files.filter_all');
    const confirmMessage = isFiltered
      ? t('auth_files.delete_filtered_confirm', { type: typeLabel })
      : t('auth_files.delete_all_confirm');

    if (!window.confirm(confirmMessage)) return;

    setDeletingAll(true);
    try {
      if (!isFiltered) {
        // 删除全部
        await authFilesApi.deleteAll();
        showNotification(t('auth_files.delete_all_success'), 'success');
        setFiles((prev) => prev.filter((file) => isRuntimeOnlyAuthFile(file)));
      } else {
        // 删除筛选类型的文件
        const filesToDelete = files.filter(
          (f) => f.type === filter && !isRuntimeOnlyAuthFile(f)
        );

        if (filesToDelete.length === 0) {
          showNotification(t('auth_files.delete_filtered_none', { type: typeLabel }), 'info');
          setDeletingAll(false);
          return;
        }

        let success = 0;
        let failed = 0;
        const deletedNames: string[] = [];

        for (const file of filesToDelete) {
          try {
            await authFilesApi.deleteFile(file.name);
            success++;
            deletedNames.push(file.name);
          } catch {
            failed++;
          }
        }

        setFiles((prev) => prev.filter((f) => !deletedNames.includes(f.name)));

        if (failed === 0) {
          showNotification(
            t('auth_files.delete_filtered_success', { count: success, type: typeLabel }),
            'success'
          );
        } else {
          showNotification(
            t('auth_files.delete_filtered_partial', { success, failed, type: typeLabel }),
            'warning'
          );
        }
        setFilter('all');
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
    } finally {
      setDeletingAll(false);
    }
  };

  // 下载文件
  const handleDownload = async (name: string) => {
    try {
      const response = await apiClient.getRaw(`/auth-files/download?name=${encodeURIComponent(name)}`, {
        responseType: 'blob'
      });
      const blob = new Blob([response.data]);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      a.click();
      window.URL.revokeObjectURL(url);
      showNotification(t('auth_files.download_success'), 'success');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
    }
  };

  // 显示详情弹窗
  const showDetails = (file: AuthFileItem) => {
    setSelectedFile(file);
    setDetailModalOpen(true);
  };

  // 显示模型列表
  const showModels = async (item: AuthFileItem) => {
    setModelsFileName(item.name);
    setModelsFileType(item.type || '');
    setModelsList([]);
    setModelsError(null);
    setModelsModalOpen(true);
    setModelsLoading(true);
    try {
      const models = await authFilesApi.getModelsForAuthFile(item.name);
      setModelsList(models);
    } catch (err) {
      // 检测是否是 API 不支持的错误 (404 或特定错误消息)
      const errorMessage = err instanceof Error ? err.message : '';
      if (errorMessage.includes('404') || errorMessage.includes('not found') || errorMessage.includes('Not Found')) {
        setModelsError('unsupported');
      } else {
        showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
      }
    } finally {
      setModelsLoading(false);
    }
  };

  // 检查模型是否被 OAuth 排除
  const isModelExcluded = (modelId: string, providerType: string): boolean => {
    const excludedModels = excluded[providerType] || [];
    return excludedModels.some(pattern => {
      if (pattern.includes('*')) {
        // 支持通配符匹配
        const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
        return regex.test(modelId);
      }
      return pattern.toLowerCase() === modelId.toLowerCase();
    });
  };

  // 获取类型标签显示文本
  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (type.toLowerCase() === 'iflow') return 'iFlow';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // 获取类型颜色
  const getTypeColor = (type: string): ThemeColors => {
    const set = TYPE_COLORS[type] || TYPE_COLORS.unknown;
    return resolvedTheme === 'dark' && set.dark ? set.dark : set.light;
  };

  const getCodexPlanLabel = (planType?: string | null): string | null => {
    const normalized = normalizePlanType(planType);
    if (!normalized) return null;
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return planType || normalized;
  };

  const getQuotaErrorMessage = useCallback(
    (status: number | undefined, fallback: string) => {
      if (status === 404) return t('common.quota_update_required');
      if (status === 403) return t('common.quota_check_credential');
      return fallback;
    },
    [t]
  );

  // OAuth 排除相关方法
  const openExcludedModal = (provider?: string) => {
    const normalizedProvider = (provider || '').trim();
    const fallbackProvider = normalizedProvider || (filter !== 'all' ? String(filter) : '');
    const lookupKey = fallbackProvider
      ? excludedProviderLookup.get(fallbackProvider.toLowerCase())
      : undefined;
    const models = lookupKey ? excluded[lookupKey] : [];
    setExcludedForm({
      provider: lookupKey || fallbackProvider,
      modelsText: Array.isArray(models) ? models.join('\n') : ''
    });
    setExcludedModalOpen(true);
  };

  const saveExcludedModels = async () => {
    const provider = excludedForm.provider.trim();
    if (!provider) {
      showNotification(t('oauth_excluded.provider_required'), 'error');
      return;
    }
    const models = excludedForm.modelsText
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
    setSavingExcluded(true);
    try {
      if (models.length) {
        await authFilesApi.saveOauthExcludedModels(provider, models);
      } else {
        await authFilesApi.deleteOauthExcludedEntry(provider);
      }
      await loadExcluded();
      showNotification(t('oauth_excluded.save_success'), 'success');
      setExcludedModalOpen(false);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_excluded.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSavingExcluded(false);
    }
  };

  const deleteExcluded = async (provider: string) => {
    if (!window.confirm(t('oauth_excluded.delete_confirm', { provider }))) return;
    try {
      await authFilesApi.deleteOauthExcludedEntry(provider);
      await loadExcluded();
      showNotification(t('oauth_excluded.delete_success'), 'success');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_excluded.delete_failed')}: ${errorMessage}`, 'error');
    }
  };

  // 渲染标签筛选器
  const renderFilterTags = () => (
    <div className={styles.filterTags}>
      {existingTypes.map((type) => {
        const isActive = filter === type;
        const color = type === 'all' ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' } : getTypeColor(type);
        const activeTextColor = resolvedTheme === 'dark' ? '#111827' : '#fff';
        return (
          <button
            key={type}
            className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
            style={{
              backgroundColor: isActive ? color.text : color.bg,
              color: isActive ? activeTextColor : color.text,
              borderColor: color.text
            }}
            onClick={() => {
              setFilter(type);
              setPage(1);
            }}
          >
            {getTypeLabel(type)}
          </button>
        );
      })}
    </div>
  );

  // 预计算所有认证文件的状态栏数据（避免每次渲染重复计算）
  const statusBarCache = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof calculateStatusBarData>>();

    files.forEach((file) => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndexKey = normalizeAuthIndexValue(rawAuthIndex);

      if (authIndexKey) {
        // 过滤出属于该认证文件的 usage 明细
        const filteredDetails = usageDetails.filter((detail) => {
          const detailAuthIndex = normalizeAuthIndexValue(detail.auth_index);
          return detailAuthIndex !== null && detailAuthIndex === authIndexKey;
        });
        cache.set(authIndexKey, calculateStatusBarData(filteredDetails));
      }
    });

    return cache;
  }, [usageDetails, files]);

  // 渲染状态监测栏
  const renderStatusBar = (item: AuthFileItem) => {
    // 认证文件使用 authIndex 来匹配 usage 数据
    const rawAuthIndex = item['auth_index'] ?? item.authIndex;
    const authIndexKey = normalizeAuthIndexValue(rawAuthIndex);

    const statusData = (authIndexKey && statusBarCache.get(authIndexKey)) || calculateStatusBarData([]);
    const hasData = statusData.totalSuccess + statusData.totalFailure > 0;
    const rateClass = !hasData
      ? ''
      : statusData.successRate >= 90
        ? styles.statusRateHigh
        : statusData.successRate >= 50
          ? styles.statusRateMedium
          : styles.statusRateLow;

    return (
      <div className={styles.statusBar}>
        <div className={styles.statusBlocks}>
          {statusData.blocks.map((state, idx) => {
            const blockClass =
              state === 'success'
                ? styles.statusBlockSuccess
                : state === 'failure'
                  ? styles.statusBlockFailure
                  : state === 'mixed'
                    ? styles.statusBlockMixed
                    : styles.statusBlockIdle;
            return <div key={idx} className={`${styles.statusBlock} ${blockClass}`} />;
          })}
        </div>
        <span className={`${styles.statusRate} ${rateClass}`}>
          {hasData ? `${statusData.successRate.toFixed(1)}%` : '--'}
        </span>
      </div>
    );
  };

  // 渲染单个认证文件卡片
  const renderFileCard = (item: AuthFileItem) => {
    const fileStats = resolveAuthFileStats(item, keyStats);
    const isRuntimeOnly = isRuntimeOnlyAuthFile(item);
    const typeColor = getTypeColor(item.type || 'unknown');

    return (
      <div key={item.name} className={styles.fileCard}>
        <div className={styles.cardHeader}>
          <span
            className={styles.typeBadge}
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              ...(typeColor.border ? { border: typeColor.border } : {})
            }}
          >
            {getTypeLabel(item.type || 'unknown')}
          </span>
          <span className={styles.fileName}>{item.name}</span>
        </div>

        <div className={styles.cardMeta}>
          <span>{t('auth_files.file_size')}: {item.size ? formatFileSize(item.size) : '-'}</span>
          <span>{t('auth_files.file_modified')}: {formatModified(item)}</span>
        </div>

        <div className={styles.cardStats}>
          <span className={`${styles.statPill} ${styles.statSuccess}`}>
            {t('stats.success')}: {fileStats.success}
          </span>
          <span className={`${styles.statPill} ${styles.statFailure}`}>
            {t('stats.failure')}: {fileStats.failure}
          </span>
        </div>

        {/* 状态监测栏 */}
        {renderStatusBar(item)}

        <div className={styles.cardActions}>
          {isRuntimeOnly ? (
            <div className={styles.virtualBadge}>{t('auth_files.type_virtual') || '虚拟认证文件'}</div>
          ) : (
            <>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => showModels(item)}
                className={styles.iconButton}
                title={t('auth_files.models_button', { defaultValue: '模型' })}
                disabled={disableControls}
              >
                <IconBot className={styles.actionIcon} size={16} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => showDetails(item)}
                className={styles.iconButton}
                title={t('common.info', { defaultValue: '关于' })}
                disabled={disableControls}
              >
                <IconInfo className={styles.actionIcon} size={16} />
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleDownload(item.name)}
                className={styles.iconButton}
                title={t('auth_files.download_button')}
                disabled={disableControls}
              >
                <IconDownload className={styles.actionIcon} size={16} />
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleDelete(item.name)}
                className={styles.iconButton}
                title={t('auth_files.delete_button')}
                disabled={disableControls || deleting === item.name}
              >
                {deleting === item.name ? (
                  <LoadingSpinner size={14} />
                ) : (
                  <IconTrash2 className={styles.actionIcon} size={16} />
                )}
              </Button>
            </>
          )}
        </div>
      </div>
    );
  };

  const renderAntigravityCard = (item: AuthFileItem) => {
    const displayType = item.type || item.provider || 'antigravity';
    const typeColor = getTypeColor(displayType);
    const quotaState = antigravityQuota[item.name];
    const quotaStatus = quotaState?.status ?? 'idle';
    const quotaGroups = quotaState?.groups ?? [];
    const quotaErrorMessage = getQuotaErrorMessage(
      quotaState?.errorStatus,
      quotaState?.error || t('common.unknown_error')
    );

    return (
      <div key={item.name} className={`${styles.fileCard} ${styles.antigravityCard}`}>
        <div className={styles.cardHeader}>
          <span
            className={styles.typeBadge}
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              ...(typeColor.border ? { border: typeColor.border } : {})
            }}
          >
            {getTypeLabel(displayType)}
          </span>
          <span className={styles.fileName}>{item.name}</span>
        </div>

        <div className={styles.quotaSection}>
          {quotaStatus === 'loading' ? (
            <div className={styles.quotaMessage}>{t('antigravity_quota.loading')}</div>
          ) : quotaStatus === 'idle' ? (
            <div className={styles.quotaMessage}>{t('antigravity_quota.idle')}</div>
          ) : quotaStatus === 'error' ? (
            <div className={styles.quotaError}>
              {t('antigravity_quota.load_failed', {
                message: quotaErrorMessage
              })}
            </div>
          ) : quotaGroups.length === 0 ? (
            <div className={styles.quotaMessage}>{t('antigravity_quota.empty_models')}</div>
          ) : (
            quotaGroups.map((group) => {
              const clamped = Math.max(0, Math.min(1, group.remainingFraction));
              const percent = Math.round(clamped * 100);
              const resetLabel = formatQuotaResetTime(group.resetTime);
              const quotaBarClass =
                percent >= 60
                  ? styles.quotaBarFillHigh
                  : percent >= 20
                    ? styles.quotaBarFillMedium
                    : styles.quotaBarFillLow;
              return (
                <div key={group.id} className={styles.quotaRow}>
                  <div className={styles.quotaRowHeader}>
                    <span className={styles.quotaModel} title={group.models.join(', ')}>
                      {group.label}
                    </span>
                    <div className={styles.quotaMeta}>
                      <span className={styles.quotaPercent}>{percent}%</span>
                      <span className={styles.quotaReset}>{resetLabel}</span>
                    </div>
                  </div>
                  <div className={styles.quotaBar}>
                    <div
                      className={`${styles.quotaBarFill} ${quotaBarClass}`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    );
  };

  const renderCodexCard = (item: AuthFileItem) => {
    const displayType = item.type || item.provider || 'codex';
    const typeColor = getTypeColor(displayType);
    const quotaState = codexQuota[item.name];
    const quotaStatus = quotaState?.status ?? 'idle';
    const windows = quotaState?.windows ?? [];
    const planType = quotaState?.planType ?? null;
    const planLabel = getCodexPlanLabel(planType);
    const isFreePlan = normalizePlanType(planType) === 'free';
    const quotaErrorMessage = getQuotaErrorMessage(
      quotaState?.errorStatus,
      quotaState?.error || t('common.unknown_error')
    );

    return (
      <div key={item.name} className={`${styles.fileCard} ${styles.codexCard}`}>
        <div className={styles.cardHeader}>
          <span
            className={styles.typeBadge}
            style={{
              backgroundColor: typeColor.bg,
              color: typeColor.text,
              ...(typeColor.border ? { border: typeColor.border } : {})
            }}
          >
            {getTypeLabel(displayType)}
          </span>
          <span className={styles.fileName}>{item.name}</span>
        </div>

        <div className={styles.quotaSection}>
          {quotaStatus === 'loading' ? (
            <div className={styles.quotaMessage}>{t('codex_quota.loading')}</div>
          ) : quotaStatus === 'idle' ? (
            <div className={styles.quotaMessage}>{t('codex_quota.idle')}</div>
          ) : quotaStatus === 'error' ? (
            <div className={styles.quotaError}>
              {t('codex_quota.load_failed', {
                message: quotaErrorMessage
              })}
            </div>
          ) : (
            <>
              {planLabel && (
                <div className={styles.codexPlan}>
                  <span className={styles.codexPlanLabel}>{t('codex_quota.plan_label')}</span>
                  <span className={styles.codexPlanValue}>{planLabel}</span>
                </div>
              )}
              {isFreePlan ? (
                <div className={styles.quotaWarning}>{t('codex_quota.no_access')}</div>
              ) : windows.length === 0 ? (
                <div className={styles.quotaMessage}>{t('codex_quota.empty_windows')}</div>
              ) : (
                windows.map((window) => {
                  const used = window.usedPercent;
                  const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
                  const remaining =
                    clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
                  const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
                  const quotaBarClass =
                    remaining === null
                      ? styles.quotaBarFillMedium
                      : remaining >= 80
                        ? styles.quotaBarFillHigh
                        : remaining >= 50
                          ? styles.quotaBarFillMedium
                          : styles.quotaBarFillLow;

                  return (
                    <div key={window.id} className={styles.quotaRow}>
                      <div className={styles.quotaRowHeader}>
                        <span className={styles.quotaModel}>{window.label}</span>
                        <div className={styles.quotaMeta}>
                          <span className={styles.quotaPercent}>{percentLabel}</span>
                          <span className={styles.quotaReset}>{window.resetLabel}</span>
                        </div>
                      </div>
                      <div className={styles.quotaBar}>
                        <div
                          className={`${styles.quotaBarFill} ${quotaBarClass}`}
                          style={{ width: `${Math.round(remaining ?? 0)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('auth_files.title')}</h1>
        <p className={styles.description}>{t('auth_files.description')}</p>
      </div>

      <Card
        title={t('auth_files.title_section')}
        extra={
          <div className={styles.headerActions}>
            <Button variant="secondary" size="sm" onClick={() => { loadFiles(); loadKeyStats(); }} disabled={loading}>
              {t('common.refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleDeleteAll}
              disabled={disableControls || loading || deletingAll}
              loading={deletingAll}
            >
              {filter === 'all' ? t('auth_files.delete_all_button') : `${t('common.delete')} ${getTypeLabel(filter)}`}
            </Button>
            <Button size="sm" onClick={handleUploadClick} disabled={disableControls || uploading} loading={uploading}>
              {t('auth_files.upload_button')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        {/* 筛选区域 */}
        <div className={styles.filterSection}>
          {renderFilterTags()}

          <div className={styles.filterControls}>
            <div className={styles.filterItem}>
              <label>{t('auth_files.search_label')}</label>
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={t('auth_files.search_placeholder')}
              />
            </div>
            <div className={styles.filterItem}>
              <label>{t('auth_files.page_size_label')}</label>
              <select
                className={styles.pageSizeSelect}
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value) || 9);
                  setPage(1);
                }}
              >
                <option value={6}>6</option>
                <option value={9}>9</option>
                <option value={12}>12</option>
                <option value={18}>18</option>
                <option value={24}>24</option>
              </select>
            </div>
            <div className={styles.filterItem}>
              <label>{t('common.info')}</label>
              <div className={styles.statsInfo}>
                {files.length} {t('auth_files.files_count')} · {formatFileSize(totalSize)}
              </div>
            </div>
          </div>
        </div>

        {/* 卡片网格 */}
        {loading ? (
          <div className={styles.hint}>{t('common.loading')}</div>
        ) : pageItems.length === 0 ? (
          <EmptyState title={t('auth_files.search_empty_title')} description={t('auth_files.search_empty_desc')} />
        ) : (
          <div className={styles.fileGrid}>
            {pageItems.map(renderFileCard)}
          </div>
        )}

        {/* 分页 */}
        {!loading && filtered.length > pageSize && (
          <div className={styles.pagination}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              {t('auth_files.pagination_prev')}
            </Button>
            <div className={styles.pageInfo}>
              {t('auth_files.pagination_info', {
                current: currentPage,
                total: totalPages,
                count: filtered.length
              })}
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              {t('auth_files.pagination_next')}
            </Button>
          </div>
        )}
      </Card>

      <Card
        title={t('antigravity_quota.title')}
        extra={
          <div className={styles.headerActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadAntigravityQuota(antigravityPageItems, 'page')}
              disabled={disableControls || antigravityLoading || antigravityPageItems.length === 0}
              loading={antigravityLoading && antigravityLoadingScope === 'page'}
            >
              {t('antigravity_quota.refresh_button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadAntigravityQuota(antigravityFiles, 'all')}
              disabled={disableControls || antigravityLoading || antigravityFiles.length === 0}
              loading={antigravityLoading && antigravityLoadingScope === 'all'}
            >
              {t('antigravity_quota.fetch_all')}
            </Button>
          </div>
        }
      >
        {antigravityFiles.length === 0 ? (
          <EmptyState
            title={t('antigravity_quota.empty_title')}
            description={t('antigravity_quota.empty_desc')}
          />
        ) : (
          <>
            <div className={styles.antigravityControls}>
              <div className={styles.antigravityControl}>
                <label>{t('auth_files.page_size_label')}</label>
                <select
                  className={styles.pageSizeSelect}
                  value={antigravityPageSize}
                  onChange={(e) => {
                    setAntigravityPageSize(Number(e.target.value) || 6);
                    setAntigravityPage(1);
                  }}
                >
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                  <option value={18}>18</option>
                  <option value={24}>24</option>
                </select>
              </div>
              <div className={styles.antigravityControl}>
                <label>{t('common.info')}</label>
                <div className={styles.statsInfo}>
                  {antigravityFiles.length} {t('auth_files.files_count')}
                </div>
              </div>
            </div>
            <div className={styles.antigravityGrid}>
              {antigravityPageItems.map(renderAntigravityCard)}
            </div>
            {antigravityFiles.length > antigravityPageSize && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setAntigravityPage(Math.max(1, antigravityCurrentPage - 1))}
                  disabled={antigravityCurrentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: antigravityCurrentPage,
                    total: antigravityTotalPages,
                    count: antigravityFiles.length
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setAntigravityPage(Math.min(antigravityTotalPages, antigravityCurrentPage + 1))
                  }
                  disabled={antigravityCurrentPage >= antigravityTotalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      <Card
        title={t('codex_quota.title')}
        extra={
          <div className={styles.headerActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadCodexQuota(codexPageItems, 'page')}
              disabled={disableControls || codexLoading || codexPageItems.length === 0}
              loading={codexLoading && codexLoadingScope === 'page'}
            >
              {t('codex_quota.refresh_button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadCodexQuota(codexFiles, 'all')}
              disabled={disableControls || codexLoading || codexFiles.length === 0}
              loading={codexLoading && codexLoadingScope === 'all'}
            >
              {t('codex_quota.fetch_all')}
            </Button>
          </div>
        }
      >
        {codexFiles.length === 0 ? (
          <EmptyState title={t('codex_quota.empty_title')} description={t('codex_quota.empty_desc')} />
        ) : (
          <>
            <div className={styles.codexControls}>
              <div className={styles.codexControl}>
                <label>{t('auth_files.page_size_label')}</label>
                <select
                  className={styles.pageSizeSelect}
                  value={codexPageSize}
                  onChange={(e) => {
                    setCodexPageSize(Number(e.target.value) || 6);
                    setCodexPage(1);
                  }}
                >
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                  <option value={18}>18</option>
                  <option value={24}>24</option>
                </select>
              </div>
              <div className={styles.codexControl}>
                <label>{t('common.info')}</label>
                <div className={styles.statsInfo}>
                  {codexFiles.length} {t('auth_files.files_count')}
                </div>
              </div>
            </div>
            <div className={styles.codexGrid}>{codexPageItems.map(renderCodexCard)}</div>
            {codexFiles.length > codexPageSize && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCodexPage(Math.max(1, codexCurrentPage - 1))}
                  disabled={codexCurrentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: codexCurrentPage,
                    total: codexTotalPages,
                    count: codexFiles.length
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setCodexPage(Math.min(codexTotalPages, codexCurrentPage + 1))}
                  disabled={codexCurrentPage >= codexTotalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>

      {/* OAuth 排除列表卡片 */}
      <Card
        title={t('oauth_excluded.title')}
        extra={
          <Button
            size="sm"
            onClick={() => openExcludedModal()}
            disabled={disableControls || excludedError === 'unsupported'}
          >
            {t('oauth_excluded.add')}
          </Button>
        }
      >
        {excludedError === 'unsupported' ? (
          <EmptyState
            title={t('oauth_excluded.upgrade_required_title')}
            description={t('oauth_excluded.upgrade_required_desc')}
          />
        ) : Object.keys(excluded).length === 0 ? (
          <EmptyState title={t('oauth_excluded.list_empty_all')} />
        ) : (
          <div className={styles.excludedList}>
            {Object.entries(excluded).map(([provider, models]) => (
              <div key={provider} className={styles.excludedItem}>
                <div className={styles.excludedInfo}>
                  <div className={styles.excludedProvider}>{provider}</div>
                  <div className={styles.excludedModels}>
                    {models?.length
                      ? t('oauth_excluded.model_count', { count: models.length })
                      : t('oauth_excluded.no_models')}
                  </div>
                </div>
                <div className={styles.excludedActions}>
                  <Button variant="secondary" size="sm" onClick={() => openExcludedModal(provider)}>
                    {t('common.edit')}
                  </Button>
                  <Button variant="danger" size="sm" onClick={() => deleteExcluded(provider)}>
                    {t('oauth_excluded.delete')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* 详情弹窗 */}
      <Modal
        open={detailModalOpen}
        onClose={() => setDetailModalOpen(false)}
        title={selectedFile?.name || t('auth_files.title_section')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDetailModalOpen(false)}>
              {t('common.close')}
            </Button>
            <Button
              onClick={() => {
                if (selectedFile) {
                  const text = JSON.stringify(selectedFile, null, 2);
                  navigator.clipboard.writeText(text).then(() => {
                    showNotification(t('notification.link_copied'), 'success');
                  });
                }
              }}
            >
              {t('common.copy')}
            </Button>
          </>
        }
      >
        {selectedFile && (
          <div className={styles.detailContent}>
            <pre className={styles.jsonContent}>{JSON.stringify(selectedFile, null, 2)}</pre>
          </div>
        )}
      </Modal>

      {/* 模型列表弹窗 */}
      <Modal
        open={modelsModalOpen}
        onClose={() => setModelsModalOpen(false)}
        title={t('auth_files.models_title', { defaultValue: '支持的模型' }) + ` - ${modelsFileName}`}
        footer={
          <Button variant="secondary" onClick={() => setModelsModalOpen(false)}>
            {t('common.close')}
          </Button>
        }
      >
        {modelsLoading ? (
          <div className={styles.hint}>{t('auth_files.models_loading', { defaultValue: '正在加载模型列表...' })}</div>
        ) : modelsError === 'unsupported' ? (
          <EmptyState
            title={t('auth_files.models_unsupported', { defaultValue: '当前版本不支持此功能' })}
            description={t('auth_files.models_unsupported_desc', { defaultValue: '请更新 CLI Proxy API 到最新版本后重试' })}
          />
        ) : modelsList.length === 0 ? (
          <EmptyState
            title={t('auth_files.models_empty', { defaultValue: '该凭证暂无可用模型' })}
            description={t('auth_files.models_empty_desc', { defaultValue: '该认证凭证可能尚未被服务器加载或没有绑定任何模型' })}
          />
        ) : (
          <div className={styles.modelsList}>
            {modelsList.map((model) => {
              const isExcluded = isModelExcluded(model.id, modelsFileType);
              return (
                <div
                  key={model.id}
                  className={`${styles.modelItem} ${isExcluded ? styles.modelItemExcluded : ''}`}
                  onClick={() => {
                    navigator.clipboard.writeText(model.id);
                    showNotification(t('notification.link_copied', { defaultValue: '已复制到剪贴板' }), 'success');
                  }}
                  title={isExcluded ? t('auth_files.models_excluded_hint', { defaultValue: '此模型已被 OAuth 排除' }) : t('common.copy', { defaultValue: '点击复制' })}
                >
                  <span className={styles.modelId}>{model.id}</span>
                  {model.display_name && model.display_name !== model.id && (
                    <span className={styles.modelDisplayName}>{model.display_name}</span>
                  )}
                  {model.type && (
                    <span className={styles.modelType}>{model.type}</span>
                  )}
                  {isExcluded && (
                    <span className={styles.modelExcludedBadge}>{t('auth_files.models_excluded_badge', { defaultValue: '已排除' })}</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Modal>

      {/* OAuth 排除弹窗 */}
      <Modal
        open={excludedModalOpen}
        onClose={() => setExcludedModalOpen(false)}
        title={t('oauth_excluded.add_title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setExcludedModalOpen(false)} disabled={savingExcluded}>
              {t('common.cancel')}
            </Button>
            <Button onClick={saveExcludedModels} loading={savingExcluded}>
              {t('oauth_excluded.save')}
            </Button>
          </>
        }
      >
        <div className={styles.providerField}>
          <Input
            id="oauth-excluded-provider"
            list="oauth-excluded-provider-options"
            label={t('oauth_excluded.provider_label')}
            hint={t('oauth_excluded.provider_hint')}
            placeholder={t('oauth_excluded.provider_placeholder')}
            value={excludedForm.provider}
            onChange={(e) => setExcludedForm((prev) => ({ ...prev, provider: e.target.value }))}
          />
          <datalist id="oauth-excluded-provider-options">
            {providerOptions.map((provider) => (
              <option key={provider} value={provider} />
            ))}
          </datalist>
          {providerOptions.length > 0 && (
            <div className={styles.providerTagList}>
              {providerOptions.map((provider) => {
                const isActive =
                  excludedForm.provider.trim().toLowerCase() === provider.toLowerCase();
                return (
                  <button
                    key={provider}
                    type="button"
                    className={`${styles.providerTag} ${isActive ? styles.providerTagActive : ''}`}
                    onClick={() => setExcludedForm((prev) => ({ ...prev, provider }))}
                    disabled={savingExcluded}
                  >
                    {getTypeLabel(provider)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className={styles.formGroup}>
          <label>{t('oauth_excluded.models_label')}</label>
          <textarea
            className={styles.textarea}
            rows={4}
            placeholder={t('oauth_excluded.models_placeholder')}
            value={excludedForm.modelsText}
            onChange={(e) => setExcludedForm((prev) => ({ ...prev, modelsText: e.target.value }))}
          />
          <div className={styles.hint}>{t('oauth_excluded.models_hint')}</div>
        </div>
      </Modal>
    </div>
  );
}
