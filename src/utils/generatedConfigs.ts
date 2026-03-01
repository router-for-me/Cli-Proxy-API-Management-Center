import type { ModelInfo } from '@/utils/models';

export type ThinkingSupport = {
  min?: number;
  max?: number;
  zero_allowed?: boolean;
  dynamic_allowed?: boolean;
  levels?: string[];
};

export type ModelDefinitionItem = {
  id: string;
  display_name?: string;
  type?: string;
  owned_by?: string;
  thinking?: ThinkingSupport;
};

type ThinkingMode = 'levels' | 'budget' | 'none';

export type ThinkingPreset = {
  mode: ThinkingMode;
  summary: string;
  options: Record<string, unknown>;
  variants: Record<string, Record<string, unknown>>;
};

const REASONING_LEVEL_ORDER = ['minimal', 'low', 'medium', 'high', 'xhigh'];
const KNOWN_CHANNELS = [
  'codex',
  'openai',
  'claude',
  'gemini',
  'gemini-cli',
  'aistudio',
  'qwen',
  'deepseek',
  'kimi',
  'grok',
  'glm',
  'minimax',
  'vertex',
  'iflow',
  'antigravity'
] as const;

const normalizeModelKey = (value: string): string => {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return '';
  return normalized.replace(/^models\//, '');
};

const clamp = (value: number, min: number, max: number): number => {
  if (value < min) return min;
  if (value > max) return max;
  return value;
};

const unique = <T,>(items: T[]): T[] => {
  return [...new Set(items)];
};

const modelToChannelHints = (modelId: string): string[] => {
  const id = normalizeModelKey(modelId);
  if (!id) return [];
  const hints: string[] = [];

  if (/claude/.test(id)) hints.push('claude');
  if (/gemini|\bgai\b/.test(id)) hints.push('gemini', 'gemini-cli', 'aistudio');
  if (/qwen/.test(id)) hints.push('qwen');
  if (/deepseek/.test(id)) hints.push('deepseek');
  if (/kimi/.test(id)) hints.push('kimi');
  if (/grok/.test(id)) hints.push('grok');
  if (/glm|chatglm/.test(id)) hints.push('glm');
  if (/minimax|abab/.test(id)) hints.push('minimax');
  if (/gpt|\bo\d/.test(id)) hints.push('codex', 'openai');

  return hints;
};

export const inferDefinitionChannels = (models: ModelInfo[]): string[] => {
  const fromModels = models.flatMap((model) => modelToChannelHints(model.name));
  const channels = unique([...fromModels, ...KNOWN_CHANNELS]);
  return channels;
};

export const buildDefinitionsIndex = (
  definitions: Record<string, ModelDefinitionItem[]>
): Map<string, ThinkingSupport> => {
  const index = new Map<string, ThinkingSupport>();

  Object.values(definitions).forEach((items) => {
    items.forEach((item) => {
      const key = normalizeModelKey(item.id);
      if (!key || !item.thinking) return;
      const current = index.get(key);
      if (!current) {
        index.set(key, item.thinking);
        return;
      }

      const currentLevels = current.levels?.length ?? 0;
      const nextLevels = item.thinking.levels?.length ?? 0;
      if (nextLevels > currentLevels) {
        index.set(key, item.thinking);
        return;
      }

      const currentMax = Number(current.max ?? 0);
      const nextMax = Number(item.thinking.max ?? 0);
      if (nextMax > currentMax) {
        index.set(key, item.thinking);
      }
    });
  });

  return index;
};

const inferFromModelName = (modelId: string): ThinkingPreset => {
  const id = normalizeModelKey(modelId);
  if (!id) {
    return {
      mode: 'none',
      summary: 'No explicit thinking metadata',
      options: {},
      variants: {}
    };
  }

  if (/thinking|reason|\br1\b|\bo1\b|\bo3\b|\bo4\b/.test(id)) {
    return {
      mode: 'levels',
      summary: 'Inferred reasoning effort levels: low, medium, high',
      options: { reasoningEffort: 'high' },
      variants: {
        low: { reasoningEffort: 'low' },
        medium: { reasoningEffort: 'medium' },
        high: { reasoningEffort: 'high' }
      }
    };
  }

  return {
    mode: 'none',
    summary: 'No explicit thinking metadata',
    options: {},
    variants: {}
  };
};

export const resolveThinkingPreset = (
  modelId: string,
  definitions: Map<string, ThinkingSupport>
): ThinkingPreset => {
  const key = normalizeModelKey(modelId);
  const thinking = key ? definitions.get(key) : undefined;
  if (!thinking) {
    return inferFromModelName(modelId);
  }

  const rawLevels = Array.isArray(thinking.levels)
    ? thinking.levels
        .map((level) => String(level ?? '').trim().toLowerCase())
        .filter(Boolean)
    : [];

  const levels = unique(rawLevels);
  if (levels.length > 0) {
    const normalizedLevels = REASONING_LEVEL_ORDER.filter((level) => levels.includes(level));
    const fallbackLevels = levels.filter((level) => !['none', 'auto'].includes(level));
    const usableLevels = unique([...normalizedLevels, ...fallbackLevels]);

    const recommended = usableLevels.includes('high')
      ? 'high'
      : usableLevels.includes('medium')
        ? 'medium'
        : usableLevels[0] ?? '';

    const variants = Object.fromEntries(
      usableLevels.map((level) => [level, { reasoningEffort: level }])
    ) as Record<string, Record<string, unknown>>;

    return {
      mode: usableLevels.length ? 'levels' : 'none',
      summary: `Detected reasoning levels: ${levels.join(', ')}`,
      options: recommended ? { reasoningEffort: recommended } : {},
      variants
    };
  }

  const min = Number.isFinite(thinking.min) ? Number(thinking.min) : 1024;
  const max = Number.isFinite(thinking.max) ? Number(thinking.max) : 16000;
  const safeMin = Math.max(1, Math.min(min, max));
  const safeMax = Math.max(safeMin, max);
  const span = safeMax - safeMin;

  const budgetAt = (factor: number) => clamp(Math.round(safeMin + span * factor), safeMin, safeMax);
  const lowBudget = budgetAt(0.15);
  const mediumBudget = budgetAt(0.4);
  const highBudget = budgetAt(0.7);
  const xhighBudget = budgetAt(0.92);

  const variants: Record<string, Record<string, unknown>> = {
    low: { thinking: { type: 'enabled', budgetTokens: lowBudget } },
    medium: { thinking: { type: 'enabled', budgetTokens: mediumBudget } },
    high: { thinking: { type: 'enabled', budgetTokens: highBudget } },
    xhigh: { thinking: { type: 'enabled', budgetTokens: xhighBudget } }
  };

  if (thinking.zero_allowed) {
    variants.none = { thinking: { type: 'enabled', budgetTokens: 0 } };
  }
  if (thinking.dynamic_allowed) {
    variants.auto = { thinking: { type: 'enabled', budgetTokens: -1 } };
  }

  return {
    mode: 'budget',
    summary: `Detected thinking budget range: ${safeMin}-${safeMax}`,
    options: { thinking: { type: 'enabled', budgetTokens: highBudget } },
    variants
  };
};

export const buildOpenCodeConfigSnippet = (
  modelId: string,
  preset: ThinkingPreset
): string => {
  const modelBlock: Record<string, unknown> = {};
  if (Object.keys(preset.options).length) {
    modelBlock.options = preset.options;
  }
  if (Object.keys(preset.variants).length) {
    modelBlock.variants = preset.variants;
  }

  const payload = {
    provider: {
      openai: {
        models: {
          [modelId]: modelBlock
        }
      }
    }
  };

  return JSON.stringify(payload, null, 2);
};

export const buildEnvSnippet = (apiBase: string, modelId: string): string => {
  const base = String(apiBase ?? '').replace(/\/+$/g, '');
  return [
    `OPENAI_BASE_URL=${base}/v1`,
    'OPENAI_API_KEY=<your-proxy-api-key>',
    `OPENAI_MODEL=${modelId}`
  ].join('\n');
};

export const buildCurlSnippet = (apiBase: string, modelId: string): string => {
  const base = String(apiBase ?? '').replace(/\/+$/g, '');
  return `curl "${base}/v1/chat/completions" -H "Authorization: Bearer <your-proxy-api-key>" -H "Content-Type: application/json" -d "{\\"model\\":\\"${modelId}\\",\\"messages\\":[{\\"role\\":\\"user\\",\\"content\\":\\"Hello\\"}]}"`;
};
