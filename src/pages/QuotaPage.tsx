import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore, useQuotaStore, useThemeStore } from '@/stores';
import { apiCallApi, authFilesApi, getApiCallErrorMessage } from '@/services/api';
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaState,
  AuthFileItem,
  CodexQuotaState,
  CodexQuotaWindow,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaState
} from '@/types';
import styles from './QuotaPage.module.scss';

type ThemeColors = { bg: string; text: string; border?: string };
type TypeColorSet = { light: ThemeColors; dark?: ThemeColors };
type ResolvedTheme = 'light' | 'dark';

// Match the legacy file-type badge colors from styles.css.
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

interface GeminiCliQuotaBucket {
  modelId?: string;
  model_id?: string;
  tokenType?: string;
  token_type?: string;
  remainingFraction?: number | string;
  remaining_fraction?: number | string;
  remainingAmount?: number | string;
  remaining_amount?: number | string;
  resetTime?: string;
  reset_time?: string;
}

interface GeminiCliQuotaPayload {
  buckets?: GeminiCliQuotaBucket[];
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
    id: 'gemini-3-pro',
    label: 'Gemini 3 Pro',
    identifiers: ['gemini-3-pro-high', 'gemini-3-pro-low']
  },
  {
    id: 'gemini-2-5-flash',
    label: 'Gemini 2.5 Flash',
    identifiers: ['gemini-2.5-flash', 'gemini-2.5-flash-thinking']
  },
  {
    id: 'gemini-2-5-flash-lite',
    label: 'Gemini 2.5 Flash Lite',
    identifiers: ['gemini-2.5-flash-lite']
  },
  {
    id: 'gemini-2-5-cu',
    label: 'Gemini 2.5 CU',
    identifiers: ['rev19-uic3-1p']
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

const GEMINI_CLI_QUOTA_URL = 'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuota';

const GEMINI_CLI_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json'
};

interface GeminiCliQuotaGroupDefinition {
  id: string;
  label: string;
  modelIds: string[];
}

interface GeminiCliParsedBucket {
  modelId: string;
  tokenType: string | null;
  remainingFraction: number | null;
  remainingAmount: number | null;
  resetTime: string | undefined;
}

const GEMINI_CLI_QUOTA_GROUPS: GeminiCliQuotaGroupDefinition[] = [
  {
    id: 'gemini-2-5-flash-series',
    label: 'Gemini 2.5 Flash Series',
    modelIds: ['gemini-2.5-flash', 'gemini-2.5-flash-lite']
  },
  {
    id: 'gemini-2-5-pro',
    label: 'Gemini 2.5 Pro',
    modelIds: ['gemini-2.5-pro']
  },
  {
    id: 'gemini-3-pro-preview',
    label: 'Gemini 3 Pro Preview',
    modelIds: ['gemini-3-pro-preview']
  },
  {
    id: 'gemini-3-flash-preview',
    label: 'Gemini 3 Flash Preview',
    modelIds: ['gemini-3-flash-preview']
  }
];

const GEMINI_CLI_GROUP_LOOKUP = new Map(
  GEMINI_CLI_QUOTA_GROUPS.flatMap((group) =>
    group.modelIds.map((modelId) => [modelId, group] as const)
  )
);

const GEMINI_CLI_IGNORED_MODEL_PREFIXES = ['gemini-2.0-flash'];

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
  limitReached?: boolean;
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

// Normalize auth_index (align with usage.ts normalizeAuthIndex).
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

function normalizeQuotaFraction(value: unknown): number | null {
  const normalized = normalizeNumberValue(value);
  if (normalized !== null) return normalized;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.endsWith('%')) {
      const parsed = Number(trimmed.slice(0, -1));
      return Number.isFinite(parsed) ? parsed / 100 : null;
    }
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

function extractGeminiCliProjectId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const matches = Array.from(value.matchAll(/\(([^()]+)\)/g));
  if (matches.length === 0) return null;
  const candidate = matches[matches.length - 1]?.[1]?.trim();
  return candidate ? candidate : null;
}

function resolveGeminiCliProjectId(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;

  const candidates = [
    file.account,
    file['account'],
    metadata?.account,
    attributes?.account
  ];

  for (const candidate of candidates) {
    const projectId = extractGeminiCliProjectId(candidate);
    if (projectId) return projectId;
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

function parseGeminiCliQuotaPayload(payload: unknown): GeminiCliQuotaPayload | null {
  if (payload === undefined || payload === null) return null;
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed) as GeminiCliQuotaPayload;
    } catch {
      return null;
    }
  }
  if (typeof payload === 'object') {
    return payload as GeminiCliQuotaPayload;
  }
  return null;
}

function isIgnoredGeminiCliModel(modelId: string): boolean {
  return GEMINI_CLI_IGNORED_MODEL_PREFIXES.some(
    (prefix) => modelId === prefix || modelId.startsWith(`${prefix}-`)
  );
}

function pickEarlierResetTime(current?: string, next?: string): string | undefined {
  if (!current) return next;
  if (!next) return current;
  const currentTime = new Date(current).getTime();
  const nextTime = new Date(next).getTime();
  if (Number.isNaN(currentTime)) return next;
  if (Number.isNaN(nextTime)) return current;
  return currentTime <= nextTime ? current : next;
}

function minNullableNumber(current: number | null, next: number | null): number | null {
  if (current === null) return next;
  if (next === null) return current;
  return Math.min(current, next);
}

function buildGeminiCliQuotaBuckets(
  buckets: GeminiCliParsedBucket[]
): GeminiCliQuotaBucketState[] {
  if (buckets.length === 0) return [];

  const grouped = new Map<string, GeminiCliQuotaBucketState & { modelIds: string[] }>();

  buckets.forEach((bucket) => {
    if (isIgnoredGeminiCliModel(bucket.modelId)) return;
    const group = GEMINI_CLI_GROUP_LOOKUP.get(bucket.modelId);
    const groupId = group?.id ?? bucket.modelId;
    const label = group?.label ?? bucket.modelId;
    const tokenKey = bucket.tokenType ?? '';
    const mapKey = `${groupId}::${tokenKey}`;
    const existing = grouped.get(mapKey);

    if (!existing) {
      grouped.set(mapKey, {
        id: `${groupId}${tokenKey ? `-${tokenKey}` : ''}`,
        label,
        remainingFraction: bucket.remainingFraction,
        remainingAmount: bucket.remainingAmount,
        resetTime: bucket.resetTime,
        tokenType: bucket.tokenType,
        modelIds: [bucket.modelId]
      });
      return;
    }

    existing.remainingFraction = minNullableNumber(
      existing.remainingFraction,
      bucket.remainingFraction
    );
    existing.remainingAmount = minNullableNumber(existing.remainingAmount, bucket.remainingAmount);
    existing.resetTime = pickEarlierResetTime(existing.resetTime, bucket.resetTime);
    existing.modelIds.push(bucket.modelId);
  });

  return Array.from(grouped.values()).map((bucket) => {
    const uniqueModelIds = Array.from(new Set(bucket.modelIds));
    return {
      id: bucket.id,
      label: bucket.label,
      remainingFraction: bucket.remainingFraction,
      remainingAmount: bucket.remainingAmount,
      resetTime: bucket.resetTime,
      tokenType: bucket.tokenType,
      modelIds: uniqueModelIds
    };
  });
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
  const remainingFraction = normalizeQuotaFraction(remainingValue);
  const resetValue = quotaInfo.resetTime ?? quotaInfo.reset_time;
  const resetTime = typeof resetValue === 'string' ? resetValue : undefined;
  const displayName = typeof entry.displayName === 'string' ? entry.displayName : undefined;

  return {
    remainingFraction,
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
  let geminiProResetTime: string | undefined;
  const [
    claudeDef,
    geminiProDef,
    flashDef,
    flashLiteDef,
    cuDef,
    geminiFlashDef,
    imageDef
  ] = ANTIGRAVITY_QUOTA_GROUPS;

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
        const remainingFraction =
          info.remainingFraction ?? (info.resetTime ? 0 : null);
        if (remainingFraction === null) return null;
        return {
          id,
          remainingFraction,
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

  const geminiProGroup = buildGroup(geminiProDef);
  if (geminiProGroup) {
    geminiProResetTime = geminiProGroup.resetTime;
    groups.push(geminiProGroup);
  }

  const flashGroup = buildGroup(flashDef);
  if (flashGroup) {
    groups.push(flashGroup);
  }

  const flashLiteGroup = buildGroup(flashLiteDef);
  if (flashLiteGroup) {
    groups.push(flashLiteGroup);
  }

  const cuGroup = buildGroup(cuDef);
  if (cuGroup) {
    groups.push(cuGroup);
  }

  const geminiFlashGroup = buildGroup(geminiFlashDef);
  if (geminiFlashGroup) {
    groups.push(geminiFlashGroup);
  }

  const imageGroup = buildGroup(imageDef, geminiProResetTime);
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

function isGeminiCliFile(file: AuthFileItem): boolean {
  return resolveAuthProvider(file) === 'gemini-cli';
}

function isRuntimeOnlyAuthFile(file: AuthFileItem): boolean {
  const raw = file['runtime_only'] ?? file.runtimeOnly;
  if (typeof raw === 'boolean') return raw;
  if (typeof raw === 'string') return raw.trim().toLowerCase() === 'true';
  return false;
}

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [antigravityPage, setAntigravityPage] = useState(1);
  const [antigravityPageSize, setAntigravityPageSize] = useState(6);
  const [codexPage, setCodexPage] = useState(1);
  const [codexPageSize, setCodexPageSize] = useState(6);
  const [geminiCliPage, setGeminiCliPage] = useState(1);
  const [geminiCliPageSize, setGeminiCliPageSize] = useState(6);
  const [antigravityLoading, setAntigravityLoading] = useState(false);
  const [antigravityLoadingScope, setAntigravityLoadingScope] = useState<
    'page' | 'all' | null
  >(null);
  const [codexLoading, setCodexLoading] = useState(false);
  const [codexLoadingScope, setCodexLoadingScope] = useState<'page' | 'all' | null>(null);
  const [geminiCliLoading, setGeminiCliLoading] = useState(false);
  const [geminiCliLoadingScope, setGeminiCliLoadingScope] = useState<
    'page' | 'all' | null
  >(null);

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const setAntigravityQuota = useQuotaStore((state) => state.setAntigravityQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const setCodexQuota = useQuotaStore((state) => state.setCodexQuota);
  const geminiCliQuota = useQuotaStore((state) => state.geminiCliQuota);
  const setGeminiCliQuota = useQuotaStore((state) => state.setGeminiCliQuota);

  const antigravityLoadingRef = useRef(false);
  const antigravityRequestIdRef = useRef(0);
  const codexLoadingRef = useRef(false);
  const codexRequestIdRef = useRef(0);
  const geminiCliLoadingRef = useRef(false);
  const geminiCliRequestIdRef = useRef(0);

  const disableControls = connectionStatus !== 'connected';

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

  const geminiCliFiles = useMemo(
    () => files.filter((file) => isGeminiCliFile(file) && !isRuntimeOnlyAuthFile(file)),
    [files]
  );
  const geminiCliTotalPages = Math.max(1, Math.ceil(geminiCliFiles.length / geminiCliPageSize));
  const geminiCliCurrentPage = Math.min(geminiCliPage, geminiCliTotalPages);
  const geminiCliStart = (geminiCliCurrentPage - 1) * geminiCliPageSize;
  const geminiCliPageItems = geminiCliFiles.slice(
    geminiCliStart,
    geminiCliStart + geminiCliPageSize
  );

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
    [fetchAntigravityQuota, setAntigravityQuota, t]
  );

  const buildCodexQuotaWindows = useCallback(
    (payload: CodexUsagePayload): CodexQuotaWindow[] => {
      const rateLimit = payload.rate_limit ?? payload.rateLimit ?? undefined;
      const codeReviewLimit =
        payload.code_review_rate_limit ?? payload.codeReviewRateLimit ?? undefined;
      const windows: CodexQuotaWindow[] = [];
      const addWindow = (
        id: string,
        label: string,
        window?: CodexUsageWindow | null,
        limitReached?: boolean,
        allowed?: boolean
      ) => {
        if (!window) return;
        const resetLabel = formatCodexResetLabel(window);
        const usedPercentRaw = normalizeNumberValue(window.used_percent ?? window.usedPercent);
        const isLimitReached = Boolean(limitReached) || allowed === false;
        const usedPercent =
          usedPercentRaw ?? (isLimitReached && resetLabel !== '-' ? 100 : null);
        windows.push({
          id,
          label,
          usedPercent,
          resetLabel
        });
      };

      addWindow(
        'primary',
        t('codex_quota.primary_window'),
        rateLimit?.primary_window ?? rateLimit?.primaryWindow,
        rateLimit?.limit_reached ?? rateLimit?.limitReached,
        rateLimit?.allowed
      );
      addWindow(
        'secondary',
        t('codex_quota.secondary_window'),
        rateLimit?.secondary_window ?? rateLimit?.secondaryWindow,
        rateLimit?.limit_reached ?? rateLimit?.limitReached,
        rateLimit?.allowed
      );
      addWindow(
        'code-review',
        t('codex_quota.code_review_window'),
        codeReviewLimit?.primary_window ?? codeReviewLimit?.primaryWindow,
        codeReviewLimit?.limit_reached ?? codeReviewLimit?.limitReached,
        codeReviewLimit?.allowed
      );

      return windows;
    },
    [t]
  );

  const fetchCodexQuota = useCallback(
    async (
      file: AuthFileItem
    ): Promise<{ planType: string | null; windows: CodexQuotaWindow[] }> => {
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
    [fetchCodexQuota, setCodexQuota, t]
  );

  const fetchGeminiCliQuota = useCallback(
    async (file: AuthFileItem): Promise<GeminiCliQuotaBucketState[]> => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndex = normalizeAuthIndexValue(rawAuthIndex);
      if (!authIndex) {
        throw new Error(t('gemini_cli_quota.missing_auth_index'));
      }

      const projectId = resolveGeminiCliProjectId(file);
      if (!projectId) {
        throw new Error(t('gemini_cli_quota.missing_project_id'));
      }

      const result = await apiCallApi.request({
        authIndex,
        method: 'POST',
        url: GEMINI_CLI_QUOTA_URL,
        header: { ...GEMINI_CLI_REQUEST_HEADERS },
        data: JSON.stringify({ project: projectId })
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw createStatusError(getApiCallErrorMessage(result), result.statusCode);
      }

      const payload = parseGeminiCliQuotaPayload(result.body ?? result.bodyText);
      const buckets = Array.isArray(payload?.buckets) ? payload?.buckets : [];
      if (buckets.length === 0) return [];

      const parsedBuckets = buckets
        .map((bucket) => {
          const modelId = normalizeStringValue(bucket.modelId ?? bucket.model_id);
          if (!modelId) return null;
          const tokenType = normalizeStringValue(bucket.tokenType ?? bucket.token_type);
          const remainingFractionRaw = normalizeQuotaFraction(
            bucket.remainingFraction ?? bucket.remaining_fraction
          );
          const remainingAmount = normalizeNumberValue(
            bucket.remainingAmount ?? bucket.remaining_amount
          );
          const resetTime = normalizeStringValue(bucket.resetTime ?? bucket.reset_time) ?? undefined;
          let fallbackFraction: number | null = null;
          if (remainingAmount !== null) {
            fallbackFraction = remainingAmount <= 0 ? 0 : null;
          } else if (resetTime) {
            fallbackFraction = 0;
          }
          const remainingFraction = remainingFractionRaw ?? fallbackFraction;
          return {
            modelId,
            tokenType,
            remainingFraction,
            remainingAmount,
            resetTime
          };
        })
        .filter((bucket): bucket is GeminiCliParsedBucket => bucket !== null);

      return buildGeminiCliQuotaBuckets(parsedBuckets);
    },
    [t]
  );

  const loadGeminiCliQuota = useCallback(
    async (targets: AuthFileItem[], scope: 'page' | 'all') => {
      if (geminiCliLoadingRef.current) return;
      geminiCliLoadingRef.current = true;
      const requestId = ++geminiCliRequestIdRef.current;
      setGeminiCliLoading(true);
      setGeminiCliLoadingScope(scope);

      try {
        if (targets.length === 0) return;

        setGeminiCliQuota((prev) => {
          const nextState = { ...prev };
          targets.forEach((file) => {
            nextState[file.name] = { status: 'loading', buckets: [] };
          });
          return nextState;
        });

        const results = await Promise.all(
          targets.map(async (file) => {
            try {
              const buckets = await fetchGeminiCliQuota(file);
              return { name: file.name, status: 'success' as const, buckets };
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : t('common.unknown_error');
              const errorStatus = getStatusFromError(err);
              return { name: file.name, status: 'error' as const, error: message, errorStatus };
            }
          })
        );

        if (requestId !== geminiCliRequestIdRef.current) return;

        setGeminiCliQuota((prev) => {
          const nextState = { ...prev };
          results.forEach((result) => {
            if (result.status === 'success') {
              nextState[result.name] = {
                status: 'success',
                buckets: result.buckets
              };
            } else {
              nextState[result.name] = {
                status: 'error',
                buckets: [],
                error: result.error,
                errorStatus: result.errorStatus
              };
            }
          });
          return nextState;
        });
      } finally {
        if (requestId === geminiCliRequestIdRef.current) {
          setGeminiCliLoading(false);
          setGeminiCliLoadingScope(null);
          geminiCliLoadingRef.current = false;
        }
      }
    },
    [fetchGeminiCliQuota, setGeminiCliQuota, t]
  );

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  useEffect(() => {
    if (loading) return;
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
  }, [antigravityFiles, loading, setAntigravityQuota]);

  useEffect(() => {
    if (loading) return;
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
  }, [codexFiles, loading, setCodexQuota]);

  useEffect(() => {
    if (loading) return;
    if (geminiCliFiles.length === 0) {
      setGeminiCliQuota({});
      return;
    }
    setGeminiCliQuota((prev) => {
      const nextState: Record<string, GeminiCliQuotaState> = {};
      geminiCliFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [geminiCliFiles, loading, setGeminiCliQuota]);

  // Resolve type label text for badges.
  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (type.toLowerCase() === 'iflow') return 'iFlow';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // Resolve type colors for badges.
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

  const renderGeminiCliCard = (item: AuthFileItem) => {
    const displayType = item.type || item.provider || 'gemini-cli';
    const typeColor = getTypeColor(displayType);
    const quotaState = geminiCliQuota[item.name];
    const quotaStatus = quotaState?.status ?? 'idle';
    const buckets = quotaState?.buckets ?? [];
    const quotaErrorMessage = getQuotaErrorMessage(
      quotaState?.errorStatus,
      quotaState?.error || t('common.unknown_error')
    );

    return (
      <div key={item.name} className={`${styles.fileCard} ${styles.geminiCliCard}`}>
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
            <div className={styles.quotaMessage}>{t('gemini_cli_quota.loading')}</div>
          ) : quotaStatus === 'idle' ? (
            <div className={styles.quotaMessage}>{t('gemini_cli_quota.idle')}</div>
          ) : quotaStatus === 'error' ? (
            <div className={styles.quotaError}>
              {t('gemini_cli_quota.load_failed', {
                message: quotaErrorMessage
              })}
            </div>
          ) : buckets.length === 0 ? (
            <div className={styles.quotaMessage}>{t('gemini_cli_quota.empty_buckets')}</div>
          ) : (
            buckets.map((bucket) => {
              const fraction = bucket.remainingFraction;
              const clamped = fraction === null ? null : Math.max(0, Math.min(1, fraction));
              const percent = clamped === null ? null : Math.round(clamped * 100);
              const percentLabel = percent === null ? '--' : `${percent}%`;
              const resetLabel = formatQuotaResetTime(bucket.resetTime);
              const remainingAmountLabel =
                bucket.remainingAmount === null || bucket.remainingAmount === undefined
                  ? null
                  : t('gemini_cli_quota.remaining_amount', {
                      count: bucket.remainingAmount
                    });
              const titleBase =
                bucket.modelIds && bucket.modelIds.length > 0
                  ? bucket.modelIds.join(', ')
                  : bucket.label;
              const quotaBarClass =
                percent === null
                  ? styles.quotaBarFillMedium
                  : percent >= 60
                    ? styles.quotaBarFillHigh
                    : percent >= 20
                      ? styles.quotaBarFillMedium
                      : styles.quotaBarFillLow;

              return (
                <div key={bucket.id} className={styles.quotaRow}>
                  <div className={styles.quotaRowHeader}>
                    <span
                      className={styles.quotaModel}
                      title={
                        bucket.tokenType ? `${titleBase} (${bucket.tokenType})` : titleBase
                      }
                    >
                      {bucket.label}
                    </span>
                    <div className={styles.quotaMeta}>
                      <span className={styles.quotaPercent}>{percentLabel}</span>
                      {remainingAmountLabel && (
                        <span className={styles.quotaAmount}>{remainingAmountLabel}</span>
                      )}
                      <span className={styles.quotaReset}>{resetLabel}</span>
                    </div>
                  </div>
                  <div className={styles.quotaBar}>
                    <div
                      className={`${styles.quotaBarFill} ${quotaBarClass}`}
                      style={{ width: `${percent ?? 0}%` }}
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

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
        <div className={styles.headerActions}>
          <Button variant="secondary" size="sm" onClick={loadFiles} disabled={loading}>
            {t('quota_management.refresh_files')}
          </Button>
        </div>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

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

      <Card
        title={t('gemini_cli_quota.title')}
        extra={
          <div className={styles.headerActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadGeminiCliQuota(geminiCliPageItems, 'page')}
              disabled={disableControls || geminiCliLoading || geminiCliPageItems.length === 0}
              loading={geminiCliLoading && geminiCliLoadingScope === 'page'}
            >
              {t('gemini_cli_quota.refresh_button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => loadGeminiCliQuota(geminiCliFiles, 'all')}
              disabled={disableControls || geminiCliLoading || geminiCliFiles.length === 0}
              loading={geminiCliLoading && geminiCliLoadingScope === 'all'}
            >
              {t('gemini_cli_quota.fetch_all')}
            </Button>
          </div>
        }
      >
        {geminiCliFiles.length === 0 ? (
          <EmptyState
            title={t('gemini_cli_quota.empty_title')}
            description={t('gemini_cli_quota.empty_desc')}
          />
        ) : (
          <>
            <div className={styles.geminiCliControls}>
              <div className={styles.geminiCliControl}>
                <label>{t('auth_files.page_size_label')}</label>
                <select
                  className={styles.pageSizeSelect}
                  value={geminiCliPageSize}
                  onChange={(e) => {
                    setGeminiCliPageSize(Number(e.target.value) || 6);
                    setGeminiCliPage(1);
                  }}
                >
                  <option value={6}>6</option>
                  <option value={9}>9</option>
                  <option value={12}>12</option>
                  <option value={18}>18</option>
                  <option value={24}>24</option>
                </select>
              </div>
              <div className={styles.geminiCliControl}>
                <label>{t('common.info')}</label>
                <div className={styles.statsInfo}>
                  {geminiCliFiles.length} {t('auth_files.files_count')}
                </div>
              </div>
            </div>
            <div className={styles.geminiCliGrid}>{geminiCliPageItems.map(renderGeminiCliCard)}</div>
            {geminiCliFiles.length > geminiCliPageSize && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setGeminiCliPage(Math.max(1, geminiCliCurrentPage - 1))}
                  disabled={geminiCliCurrentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: geminiCliCurrentPage,
                    total: geminiCliTotalPages,
                    count: geminiCliFiles.length
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setGeminiCliPage(Math.min(geminiCliTotalPages, geminiCliCurrentPage + 1))
                  }
                  disabled={geminiCliCurrentPage >= geminiCliTotalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </>
        )}
      </Card>
    </div>
  );
}
