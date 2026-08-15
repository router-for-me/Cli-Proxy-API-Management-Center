/**
 * OpenCode Go quota helpers: strict base-URL matching and usage payload parsing.
 * React-free / SCSS-free — safe for bun:test.
 */

import type { AuthFileItem, OpenCodeQuotaWindow, OpenCodeUsagePayload } from '@/types';
import { parseIsoToMs } from './resetInstants';

export const OPENCODE_USAGE_URL = 'https://opencode.ai/zen/go/v1/usage';

export const OPENCODE_REQUEST_HEADERS = {
  Authorization: 'Bearer $TOKEN$',
  Accept: 'application/json',
} as const;

/** Optional provider-name hints only — never sufficient alone. */
export const OPENCODE_NAME_HINTS = new Set(['opencode', 'opencode-go', 'opencode-zen']);

const OPENCODE_WINDOW_SPECS = [
  { key: 'rollingUsage' as const, id: '5h' as const, labelKey: 'opencode_quota.window_5h' },
  { key: 'weeklyUsage' as const, id: 'weekly' as const, labelKey: 'opencode_quota.window_week' },
  {
    key: 'monthlyUsage' as const,
    id: 'monthly' as const,
    labelKey: 'opencode_quota.window_month',
  },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();

/**
 * Normalize a candidate base URL for OpenCode Go matching.
 * Returns null when the value is not a parseable absolute URL.
 */
export function normalizeOpenCodeCandidateUrl(value: unknown): string | null {
  const raw = readString(value);
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    // Drop credentials, query, hash, and default ports; keep lower-case host/path.
    parsed.username = '';
    parsed.password = '';
    parsed.hash = '';
    parsed.search = '';
    parsed.hostname = parsed.hostname.toLowerCase();
    // Collapse trailing slashes on path (keep root as empty → later treated as /).
    let path = parsed.pathname.replace(/\/+$/, '');
    if (!path) path = '';
    parsed.pathname = path;
    return parsed.toString().replace(/\/$/, '') || `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

/**
 * Strict OpenCode Go base-URL matcher.
 *
 * Accepts only host `opencode.ai` with path `/zen/go` or `/zen/go/v1`
 * (with optional trailing slash, already normalized).
 */
export function isOpenCodeGoBaseUrl(value: unknown): boolean {
  const raw = readString(value);
  if (!raw) return false;
  try {
    const parsed = new URL(raw.includes('://') ? raw : `https://${raw}`);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (host !== 'opencode.ai') return false;
    const path = parsed.pathname.replace(/\/+$/, '') || '';
    return path === '/zen/go' || path === '/zen/go/v1';
  } catch {
    return false;
  }
}

/** Read base URL fields commonly attached to auth-file list entries. */
export function extractAuthFileBaseUrl(file: AuthFileItem | Record<string, unknown>): string {
  const record = file as Record<string, unknown>;
  const candidates = [
    record.baseUrl,
    record['base-url'],
    record.base_url,
    record.BaseURL,
  ];
  for (const candidate of candidates) {
    const text = readString(candidate);
    if (text) return text;
  }
  return '';
}

/** Optional name hints (provider / type / label / compat_name). Never decisive alone. */
export function extractOpenCodeNameHint(file: AuthFileItem | Record<string, unknown>): string {
  const record = file as Record<string, unknown>;
  const candidates = [
    record.provider,
    record.type,
    record.label,
    record.compat_name,
    record.compatName,
    record.name,
  ];
  for (const candidate of candidates) {
    const key = readString(candidate).toLowerCase().replace(/_/g, '-');
    if (!key) continue;
    // openai-compatible-opencode-go → opencode-go
    const stripped = key.startsWith('openai-compatible-')
      ? key.slice('openai-compatible-'.length)
      : key;
    if (OPENCODE_NAME_HINTS.has(stripped) || OPENCODE_NAME_HINTS.has(key)) {
      return stripped;
    }
  }
  return '';
}

/**
 * An auth file is OpenCode Go only when its base URL strictly matches.
 * Name hints are ignored without a matching base URL.
 */
export function isOpenCodeGoFile(file: AuthFileItem): boolean {
  const baseUrl = extractAuthFileBaseUrl(file);
  return isOpenCodeGoBaseUrl(baseUrl);
}

export function clampPercent(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, value));
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed));
  }
  return null;
}

export function remainingFromUsedPercent(usedPercent: number | null): number | null {
  if (usedPercent === null) return null;
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

/**
 * Live OpenCode Go `/usage` may return either:
 * 1) flat: { rollingUsage, weeklyUsage, monthlyUsage }
 * 2) nested: { usage: { rolling, weekly, monthly } }
 * Normalize both into the flat shape used by the adapter.
 */
export function parseOpenCodeUsagePayload(input: unknown): OpenCodeUsagePayload | null {
  if (!isRecord(input)) return null;

  const nestedUsage = isRecord(input.usage) ? input.usage : null;
  const rolling =
    input.rollingUsage ??
    input.rolling_usage ??
    nestedUsage?.rollingUsage ??
    nestedUsage?.rolling_usage ??
    nestedUsage?.rolling;
  const weekly =
    input.weeklyUsage ??
    input.weekly_usage ??
    nestedUsage?.weeklyUsage ??
    nestedUsage?.weekly_usage ??
    nestedUsage?.weekly;
  const monthly =
    input.monthlyUsage ??
    input.monthly_usage ??
    nestedUsage?.monthlyUsage ??
    nestedUsage?.monthly_usage ??
    nestedUsage?.monthly;

  if (!isRecord(rolling) && !isRecord(weekly) && !isRecord(monthly)) {
    return null;
  }

  const useBalanceRaw = input.useBalance ?? input.use_balance;
  const normalized: OpenCodeUsagePayload = {
    useBalance: typeof useBalanceRaw === 'boolean' ? useBalanceRaw : null,
    rollingUsage: isRecord(rolling) ? (rolling as OpenCodeUsagePayload['rollingUsage']) : null,
    weeklyUsage: isRecord(weekly) ? (weekly as OpenCodeUsagePayload['weeklyUsage']) : null,
    monthlyUsage: isRecord(monthly) ? (monthly as OpenCodeUsagePayload['monthlyUsage']) : null,
  };
  return normalized;
}

const readUsageWindow = (
  payload: OpenCodeUsagePayload,
  key: 'rollingUsage' | 'weeklyUsage' | 'monthlyUsage'
): { percent: number | null; resetsAt: string | null } => {
  const snake =
    key === 'rollingUsage' ? 'rolling_usage' : key === 'weeklyUsage' ? 'weekly_usage' : 'monthly_usage';
  const short = key === 'rollingUsage' ? 'rolling' : key === 'weeklyUsage' ? 'weekly' : 'monthly';
  const nestedUsage = isRecord((payload as Record<string, unknown>).usage)
    ? ((payload as Record<string, unknown>).usage as Record<string, unknown>)
    : null;
  const raw =
    (payload as Record<string, unknown>)[key] ??
    (payload as Record<string, unknown>)[snake] ??
    nestedUsage?.[key] ??
    nestedUsage?.[snake] ??
    nestedUsage?.[short];
  if (!isRecord(raw)) return { percent: null, resetsAt: null };
  const percent = clampPercent(raw.percent);
  const resetsAt = readString(raw.resetsAt ?? raw.resets_at) || null;
  return { percent, resetsAt };
};

/**
 * Build fixed-order 5H / Week / Month windows from the official usage payload.
 */
export function buildOpenCodeQuotaWindows(payload: OpenCodeUsagePayload): OpenCodeQuotaWindow[] {
  return OPENCODE_WINDOW_SPECS.map((spec) => {
    const window = readUsageWindow(payload, spec.key);
    const usedPercent = window.percent;
    const remainingPercent = remainingFromUsedPercent(usedPercent);
    const resetAtMs = parseIsoToMs(window.resetsAt);
    return {
      id: spec.id,
      labelKey: spec.labelKey,
      usedPercent,
      remainingPercent,
      resetAtMs,
      resetLabel: window.resetsAt ?? '',
    };
  });
}

/**
 * Attach openai-compatibility base URLs onto auth-file entries by auth_index.
 * Required because /auth-files does not expose Attributes.base_url.
 */
type OpenAICompatProviderLike = {
  name?: string;
  baseUrl?: string;
  disabled?: boolean;
  apiKeyEntries?: Array<{ authIndex?: string; apiKey?: string }>;
};

export function attachOpenAICompatBaseUrls(
  files: AuthFileItem[],
  compatProviders: OpenAICompatProviderLike[]
): AuthFileItem[] {
  const byAuthIndex = new Map<string, string>();
  for (const provider of compatProviders) {
    const baseUrl = readString(provider.baseUrl);
    if (!baseUrl) continue;
    for (const entry of provider.apiKeyEntries ?? []) {
      const authIndex = readString(entry.authIndex);
      if (!authIndex) continue;
      byAuthIndex.set(authIndex, baseUrl);
    }
  }

  if (byAuthIndex.size === 0) return files;

  return files.map((file) => {
    const existing = extractAuthFileBaseUrl(file);
    if (existing) return file;
    const authIndex = readString(file.authIndex ?? file['auth_index']);
    if (!authIndex) return file;
    const baseUrl = byAuthIndex.get(authIndex);
    if (!baseUrl) return file;
    return {
      ...file,
      baseUrl,
      'base-url': baseUrl,
    };
  });
}

/**
 * OpenAI-compatibility API-key credentials (e.g. OpenCode Go) may not appear in
 * /auth-files. Synthesize stable virtual auth-file rows for OpenCode Go only so
 * Quota / AuthFile quota cards can load via auth_index + api-call.
 */
export function mergeOpenCodeCompatAuthFiles(
  files: AuthFileItem[],
  compatProviders: OpenAICompatProviderLike[]
): AuthFileItem[] {
  const withBase = attachOpenAICompatBaseUrls(files, compatProviders);
  const existingAuthIndexes = new Set<string>();
  for (const file of withBase) {
    const authIndex = readString(file.authIndex ?? file['auth_index']);
    if (authIndex) existingAuthIndexes.add(authIndex);
  }

  const synthesized: AuthFileItem[] = [];
  for (const provider of compatProviders) {
    const baseUrl = readString(provider.baseUrl);
    if (!isOpenCodeGoBaseUrl(baseUrl)) continue;
    if (provider.disabled === true) continue;
    const providerName = readString(provider.name) || 'OpenCode Go';
    for (const entry of provider.apiKeyEntries ?? []) {
      const authIndex = readString(entry.authIndex);
      if (!authIndex || existingAuthIndexes.has(authIndex)) continue;
      const name = `openai-compat:${providerName}:${authIndex}`;
      synthesized.push({
        name,
        authIndex,
        auth_index: authIndex,
        baseUrl,
        'base-url': baseUrl,
        provider: 'openai-compatible',
        type: 'openai-compatible',
        label: providerName,
        disabled: false,
        source: 'openai-compatibility',
        runtime_only: true,
        runtimeOnly: true,
      } as AuthFileItem);
      existingAuthIndexes.add(authIndex);
    }
  }

  return synthesized.length ? [...withBase, ...synthesized] : withBase;
}
