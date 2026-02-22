import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types';
import type { SourceInfo } from '@/types/sourceInfo';
import { buildCandidateUsageSourceIds } from '@/utils/usage';

export interface SourceInfoMapInput {
  geminiApiKeys?: GeminiKeyConfig[];
  claudeApiKeys?: ProviderKeyConfig[];
  codexApiKeys?: ProviderKeyConfig[];
  vertexApiKeys?: ProviderKeyConfig[];
  openaiCompatibility?: OpenAIProviderConfig[];
}

export function buildSourceInfoMap(input: SourceInfoMapInput): Map<string, SourceInfo> {
  const map = new Map<string, SourceInfo>();

  const registerSource = (sourceId: string, displayName: string, type: string) => {
    if (!sourceId || !displayName || map.has(sourceId)) return;
    map.set(sourceId, { displayName, type });
  };

  const registerCandidates = (displayName: string, type: string, candidates: string[]) => {
    candidates.forEach((sourceId) => registerSource(sourceId, displayName, type));
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

  return map;
}
