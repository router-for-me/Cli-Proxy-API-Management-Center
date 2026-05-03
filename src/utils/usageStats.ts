import type { UsageModelSnapshot, UsageSnapshot } from '@/types/usage';

export interface UsageTrendPoint {
  label: string;
  value: number;
}

export interface UsageModelRow {
  apiName: string;
  displayApiName: string;
  modelName: string;
  requests: number;
  tokens: number;
  failures: number;
}

export interface UsageApiRow {
  apiName: string;
  displayApiName: string;
  requests: number;
  tokens: number;
  models: UsageModelRow[];
}

const HTTP_ROUTE_RE = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i;
const HASHED_API_KEY_RE = /^api-key:[0-9a-f]{8}$/i;
const SAFE_IDENTIFIER_RE =
  /^(unknown|other|gemini|gemini-cli|aistudio|vertex|claude|codex|openai|openai-compatibility|openai-compatible|antigravity|github-copilot|gitlab|cursor|kiro|kilo|kimi|iflow|codebuddy)$/i;

const numberValue = (value: unknown): number => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
};

const maskSecretSegment = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '***';
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-4)}`;
};

export function maskUsageIdentifier(value: string): string {
  const label = value.trim();
  if (!label) return 'unknown';
  if (HTTP_ROUTE_RE.test(label) || label.startsWith('/')) return label;
  if (HASHED_API_KEY_RE.test(label)) return label;
  if (SAFE_IDENTIFIER_RE.test(label)) return label;

  if (label.includes('|')) {
    const parts = label.split('|');
    const secret = parts.pop() ?? '';
    return `${parts.join('|')}|${maskSecretSegment(secret)}`;
  }

  return maskSecretSegment(label);
}

const modelFailureCount = (model: UsageModelSnapshot | undefined): number => {
  if (model?.failure_count !== undefined) {
    return numberValue(model.failure_count);
  }
  return Array.isArray(model?.details) ? model.details.filter((detail) => detail?.failed).length : 0;
};

export function formatLargeNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 100_000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 100_000 ? 1 : 0,
  }).format(value);
}

export function toTrendPoints(source: Record<string, number> | undefined, limit = 24): UsageTrendPoint[] {
  if (!source) return [];
  return Object.entries(source)
    .map(([label, value]) => ({ label, value: numberValue(value) }))
    .sort((a, b) => a.label.localeCompare(b.label))
    .slice(-limit);
}

export function buildUsageRows(usage: UsageSnapshot | null | undefined): UsageApiRow[] {
  const apis = usage?.apis;
  if (!apis) return [];

  return Object.entries(apis)
    .map(([apiName, api]) => {
      const displayApiName = maskUsageIdentifier(apiName);
      const models = Object.entries(api?.models ?? {})
        .map(([modelName, model]) => ({
          apiName,
          displayApiName,
          modelName,
          requests: numberValue(model?.total_requests),
          tokens: numberValue(model?.total_tokens),
          failures: modelFailureCount(model),
        }))
        .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens);

      return {
        apiName,
        displayApiName,
        requests: numberValue(api?.total_requests),
        tokens: numberValue(api?.total_tokens),
        models,
      };
    })
    .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens);
}

export function buildTopModelRows(apiRows: UsageApiRow[], limit = 12): UsageModelRow[] {
  return apiRows
    .flatMap((row) => row.models)
    .sort((a, b) => b.requests - a.requests || b.tokens - a.tokens)
    .slice(0, limit);
}
