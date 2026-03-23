import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { CredentialInfo, SourceInfo } from '@/types/sourceInfo';
import { buildCandidateUsageSourceIds, normalizeAuthIndex } from '@/utils/usage';

export interface SourceInfoMapInput {
  apiKeys?: string[];
  apiKeyNames?: Record<string, string>;
  geminiApiKeys?: GeminiKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
}

export function buildSourceInfoMap(input: SourceInfoMapInput): Map<string, SourceInfo> {
  const map = new Map<string, SourceInfo>();

  const registerSource = (
    sourceId: string,
    displayName: string,
    type: string,
    overwrite: boolean = false
  ) => {
    if (!sourceId || !displayName) return;
    if (!overwrite && map.has(sourceId)) return;
    map.set(sourceId, { displayName, type });
  };

  const registerCandidates = (
    displayName: string,
    type: string,
    candidates: string[],
    overwrite: boolean = false
  ) => {
    candidates.forEach((sourceId) => registerSource(sourceId, displayName, type, overwrite));
  };

  const providers: Array<{
    items: Array<{ apiKey?: string; prefix?: string }>;
    type: string;
    label: string;
  }> = [
    { items: input.geminiApiKeys || [], type: 'gemini', label: 'Gemini' },
    { items: input.claudeApiKeys || [], type: 'claude', label: 'Claude' },
    { items: input.codexApiKeys || [], type: 'codex', label: 'Codex' },
    { items: input.vertexApiKeys || [], type: 'vertex', label: 'Vertex' },
  ];

  providers.forEach(({ items, type, label }) => {
    items.forEach((item, index) => {
      const displayName = item.prefix?.trim() || `${label} #${index + 1}`;
      registerCandidates(
        displayName,
        type,
        buildCandidateUsageSourceIds({ apiKey: item.apiKey, prefix: item.prefix })
      );
    });
  });

  // OpenAI 特殊处理：多 apiKeyEntries
  (input.openaiCompatibility || []).forEach((provider, providerIndex) => {
    const displayName = provider.prefix?.trim() || provider.name || `OpenAI #${providerIndex + 1}`;
    const candidates = new Set<string>();
    buildCandidateUsageSourceIds({ prefix: provider.prefix }).forEach((id) => candidates.add(id));
    (provider.apiKeyEntries || []).forEach((entry) => {
      buildCandidateUsageSourceIds({ apiKey: entry.apiKey }).forEach((id) => candidates.add(id));
    });
    registerCandidates(displayName, 'openai', Array.from(candidates));
  });

  const normalizedApiKeyNames = Object.entries(input.apiKeyNames || {}).reduce<Record<string, string>>(
    (acc, [key, value]) => {
      const normalizedKey = String(key ?? '').trim();
      const normalizedValue = String(value ?? '').trim();
      if (!normalizedKey || !normalizedValue) return acc;
      acc[normalizedKey] = normalizedValue;
      return acc;
    },
    {}
  );

  (input.apiKeys || []).forEach((apiKey, index) => {
    const normalizedKey = String(apiKey ?? '').trim();
    if (!normalizedKey) return;
    const displayName = normalizedApiKeyNames[normalizedKey] || `Key #${index + 1}`;
    registerCandidates(
      displayName,
      'config-api-key',
      buildCandidateUsageSourceIds({ apiKey: normalizedKey }),
      true
    );
  });

  return map;
}

export function resolveSourceDisplay(
  sourceRaw: string,
  authIndex: unknown,
  sourceInfoMap: Map<string, SourceInfo>,
  authFileMap: Map<string, CredentialInfo>
): SourceInfo {
  const source = sourceRaw.trim();
  const matched = sourceInfoMap.get(source);
  if (matched) return matched;

  const authIndexKey = normalizeAuthIndex(authIndex);
  if (authIndexKey) {
    const authInfo = authFileMap.get(authIndexKey);
    if (authInfo) {
      return { displayName: authInfo.name || authIndexKey, type: authInfo.type };
    }
  }

  return {
    displayName: source.startsWith('t:') ? source.slice(2) : source || '-',
    type: '',
  };
}
