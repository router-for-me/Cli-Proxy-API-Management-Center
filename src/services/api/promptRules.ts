/**
 * Prompt Rules management API.
 *
 * Backed by /v0/management/prompt-rules on the proxy. Rules apply pre-translation
 * to source-format request bodies — the operator scopes them by model glob and
 * source format ("openai", "openai-response", "claude", "gemini", "gemini-cli").
 */

import { apiClient } from './client';

export type PromptRuleTarget = 'system' | 'user';
export type PromptRuleAction = 'inject' | 'strip';
export type PromptRulePosition = 'prepend' | 'append';

export interface PromptRuleModel {
  name: string;
  protocol?: string;
}

export interface PromptRule {
  name: string;
  enabled: boolean;
  models?: PromptRuleModel[];
  target: PromptRuleTarget;
  action: PromptRuleAction;
  // inject:
  content?: string;
  marker?: string;
  position?: PromptRulePosition;
  // strip:
  pattern?: string;
}

export interface PromptRulePatch {
  index?: number;
  match?: string;
  value: PromptRule;
}

const ENDPOINT = '/prompt-rules';

export const promptRulesApi = {
  async list(): Promise<PromptRule[]> {
    const data = await apiClient.get<Record<string, unknown>>(ENDPOINT);
    const rules = data['prompt-rules'];
    return Array.isArray(rules) ? (rules as PromptRule[]) : [];
  },

  replace: (rules: PromptRule[]) => apiClient.put<{ status: string }>(ENDPOINT, rules),

  upsert: (body: PromptRulePatch) => apiClient.patch<{ status: string }>(ENDPOINT, body),

  deleteByName: (name: string) =>
    apiClient.delete<{ status: string }>(`${ENDPOINT}?name=${encodeURIComponent(name)}`),

  deleteByIndex: (index: number) =>
    apiClient.delete<{ status: string }>(`${ENDPOINT}?index=${index}`),
};

/**
 * Source-format identifiers accepted by Models[].protocol. Empty list (or empty
 * protocol on an entry) means "any source format".
 */
export const PROMPT_RULE_SOURCE_FORMATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '', label: '— any —' },
  { value: 'openai', label: 'OpenAI Chat Completions' },
  { value: 'openai-response', label: 'OpenAI Responses' },
  { value: 'claude', label: 'Anthropic Messages' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'gemini-cli', label: 'Gemini CLI' },
] as const;
