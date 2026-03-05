import type { APIKeyEntry } from '@/types/visualConfig';

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function normalizeAllowedModels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  const out: string[] = [];
  for (const item of raw) {
    const model = String(item ?? '').trim();
    if (!model) continue;
    if (!out.includes(model)) out.push(model);
  }
  return out;
}

export function extractApiKeyValue(raw: unknown): string | null {
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    return trimmed ? trimmed : null;
  }

  const record = asRecord(raw);
  if (!record) return null;

  const candidates = [record['api-key'], record.apiKey, record.key, record.Key];
  for (const candidate of candidates) {
    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (trimmed) return trimmed;
    }
  }

  return null;
}

export function normalizeApiKeyEntry(raw: unknown): APIKeyEntry | null {
  const key = extractApiKeyValue(raw);
  if (!key) return null;

  const record = asRecord(raw);
  const allowedRaw = record?.['allowed-models'] ?? record?.allowedModels;

  return {
    key,
    allowedModels: normalizeAllowedModels(allowedRaw),
  };
}

export function normalizeApiKeyEntries(raw: unknown): APIKeyEntry[] {
  if (!Array.isArray(raw)) return [];

  const out: APIKeyEntry[] = [];
  for (const item of raw) {
    const entry = normalizeApiKeyEntry(item);
    if (entry) out.push(entry);
  }
  return out;
}

export function parseApiKeysTextToEntries(text: string): APIKeyEntry[] {
  if (typeof text !== 'string') return [];
  return text
    .split('\n')
    .map((key) => key.trim())
    .filter(Boolean)
    .map((key) => ({ key, allowedModels: [] }));
}

export function apiKeyEntriesToText(entries: APIKeyEntry[]): string {
  return normalizeApiKeyEntries(entries).map((entry) => entry.key).join('\n');
}

export function serializeApiKeysForYaml(
  entries: APIKeyEntry[]
): Array<string | { key: string; 'allowed-models': string[] }> {
  const normalized = normalizeApiKeyEntries(entries);
  const hasRestrictions = normalized.some((entry) => entry.allowedModels.length > 0);

  if (!hasRestrictions) {
    return normalized.map((entry) => entry.key);
  }

  return normalized.map((entry) =>
    entry.allowedModels.length > 0
      ? {
          key: entry.key,
          'allowed-models': entry.allowedModels,
        }
      : entry.key
  );
}
