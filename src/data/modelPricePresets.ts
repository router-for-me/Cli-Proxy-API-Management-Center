import type { ModelPrice } from '@/utils/usage';

/**
 * 主流模型预设定价表（$/1M tokens）
 * 这些价格作为默认值，用户可在 UsagePage→价格配置 中覆盖。
 * 仅 localStorage 中存在的模型条目会被用户值覆盖，其余保持预设。
 */
export const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  // OpenAI GPT
  'gpt-4o': { prompt: 2.5, completion: 10.0, cache: 1.25 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6, cache: 0.075 },
  'gpt-4.1': { prompt: 2.0, completion: 8.0, cache: 0.5 },
  'gpt-4.1-mini': { prompt: 0.4, completion: 1.6, cache: 0.1 },
  'gpt-4.1-nano': { prompt: 0.1, completion: 0.4, cache: 0.025 },
  'gpt-4.5-preview': { prompt: 75.0, completion: 150.0, cache: 37.5 },
  'o3-mini': { prompt: 1.1, completion: 4.4, cache: 0.55 },
  'o1': { prompt: 15.0, completion: 60.0, cache: 7.5 },
  'o1-mini': { prompt: 1.1, completion: 4.4, cache: 0.55 },
  'o3': { prompt: 10.0, completion: 40.0, cache: 2.5 },
  'o4-mini': { prompt: 1.1, completion: 4.4, cache: 0.55 },

  // Anthropic Claude
  'claude-sonnet-4-20250514': { prompt: 3.0, completion: 15.0, cache: 0.3 },
  'claude-opus-4-20250514': { prompt: 15.0, completion: 75.0, cache: 1.5 },
  'claude-haiku-4-5-20251001': { prompt: 0.8, completion: 4.0, cache: 0.08 },
  'claude-3-5-sonnet-20241022': { prompt: 3.0, completion: 15.0, cache: 0.3 },
  'claude-3-5-haiku-20241022': { prompt: 0.8, completion: 4.0, cache: 0.08 },
  'claude-3-opus-20240229': { prompt: 15.0, completion: 75.0, cache: 1.5 },
  'claude-3-sonnet-20240229': { prompt: 3.0, completion: 15.0, cache: 0.3 },
  'claude-3-haiku-20240307': { prompt: 0.25, completion: 1.25, cache: 0.025 },

  // Google Gemini
  'gemini-2.5-pro': { prompt: 1.25, completion: 10.0, cache: 1.25 },
  'gemini-2.5-flash': { prompt: 0.15, completion: 0.6, cache: 0.15 },
  'gemini-2.0-flash': { prompt: 0.1, completion: 0.4, cache: 0.1 },
  'gemini-2.0-flash-lite': { prompt: 0.075, completion: 0.3, cache: 0.075 },
  'gemini-1.5-pro': { prompt: 1.25, completion: 5.0, cache: 0.625 },
  'gemini-1.5-flash': { prompt: 0.075, completion: 0.3, cache: 0.0375 },

  // DeepSeek
  'deepseek-chat': { prompt: 0.14, completion: 0.28, cache: 0.014 },
  'deepseek-reasoner': { prompt: 0.55, completion: 2.19, cache: 0.14 },
};
