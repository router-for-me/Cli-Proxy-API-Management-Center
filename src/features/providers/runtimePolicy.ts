import type { GeminiKeyConfig, OpenAIProviderConfig, ProviderKeyConfig } from '@/types/provider';

export interface RuntimePolicyDraft {
  cooling: 'inherit' | 'enabled' | 'disabled';
  retry: string;
  errorsMode: 'inherit' | 'override';
  errorsJson: string;
}

type RuntimePolicy = Pick<
  ProviderKeyConfig,
  'disableCooling' | 'requestRetry' | 'requestScopedErrors' | 'inheritFields'
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export function readRuntimePolicy(
  config?: ProviderKeyConfig | GeminiKeyConfig | OpenAIProviderConfig
): RuntimePolicyDraft {
  const source = config?.source;
  // A key inherits missing/null fields from its group. OpenAI policies live on the group itself.
  const keys = source?.group.keys;
  const raw = source
    ? source.keyIndex === undefined
      ? source.group
      : Array.isArray(keys) && isRecord(keys[source.keyIndex])
        ? keys[source.keyIndex]
        : {}
    : undefined;
  const cooling = raw ? raw['disable-cooling'] : config?.disableCooling;
  const retry = raw ? raw['request-retry'] : config?.requestRetry;
  const errors = raw ? raw['request-scoped-errors'] : config?.requestScopedErrors;

  return {
    cooling: typeof cooling === 'boolean' ? (cooling ? 'disabled' : 'enabled') : 'inherit',
    retry: typeof retry === 'number' ? String(retry) : '',
    errorsMode: errors == null ? 'inherit' : 'override',
    // Use the API-normalized camelCase schema, never raw backend rule field names.
    errorsJson: JSON.stringify(config?.requestScopedErrors ?? [], null, 2),
  };
}

export function validateRuntimePolicy(
  draft: RuntimePolicyDraft,
  supportsErrors = true
): string | null {
  const retry = draft.retry.trim();
  if (retry && (!/^[+-]?\d+$/.test(retry) || !Number.isSafeInteger(Number(retry)))) {
    return 'providersPage.runtimePolicy.invalidRetry';
  }
  if (!supportsErrors || draft.errorsMode === 'inherit') return null;

  let rules: unknown;
  try {
    rules = JSON.parse(draft.errorsJson);
  } catch {
    return 'providersPage.runtimePolicy.invalidJson';
  }
  if (!Array.isArray(rules)) return 'providersPage.runtimePolicy.invalidRules';
  const actions = ['stop', 'stop-and-cooldown', 'continue', 'continue-and-cooldown'];
  for (const rule of rules) {
    if (!isRecord(rule)) return 'providersPage.runtimePolicy.invalidRules';
    if (
      Object.keys(rule).some((key) => !['status', 'match', 'matchRegex', 'action'].includes(key))
    ) {
      return 'providersPage.runtimePolicy.invalidRules';
    }
    // Backend Status is a Go int, not restricted to HTTP 100–599. Nonpositive values are inert.
    if ('status' in rule && !Number.isSafeInteger(rule.status)) {
      return 'providersPage.runtimePolicy.invalidStatus';
    }
    for (const field of ['match', 'matchRegex']) {
      if (
        field in rule &&
        (!Array.isArray(rule[field]) || !rule[field].every((item) => typeof item === 'string'))
      ) {
        return 'providersPage.runtimePolicy.invalidMatches';
      }
    }
    if (
      'action' in rule &&
      (typeof rule.action !== 'string' || !actions.includes(rule.action.trim().toLowerCase()))
    ) {
      return 'providersPage.runtimePolicy.invalidAction';
    }
  }
  // Go regular expressions are intentionally left to the backend, not compiled with JS RegExp.
  return null;
}

/** Call validateRuntimePolicy before saving. Invalid drafts throw rather than silently lose rules. */
export function buildRuntimePolicy(
  draft: RuntimePolicyDraft,
  supportsErrors = true
): RuntimePolicy {
  const error = validateRuntimePolicy(draft, supportsErrors);
  if (error) throw new Error(error);
  const result: RuntimePolicy = {
    inheritFields: [],
    disableCooling: undefined,
    requestRetry: undefined,
    ...(supportsErrors ? { requestScopedErrors: undefined } : {}),
  };
  if (draft.cooling === 'inherit') result.inheritFields!.push('disable-cooling');
  else result.disableCooling = draft.cooling === 'disabled';
  if (!draft.retry.trim()) result.inheritFields!.push('request-retry');
  else result.requestRetry = Number(draft.retry.trim());
  if (supportsErrors) {
    if (draft.errorsMode === 'inherit') result.inheritFields!.push('request-scoped-errors');
    else result.requestScopedErrors = JSON.parse(draft.errorsJson);
  }
  return result;
}
