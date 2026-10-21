import type { AxiosRequestConfig } from 'axios';
import type { AuthFileItem } from '@/types';
import { apiCallApi, authFilesApi, type ApiCallRequest, type ApiCallResult } from '@/services/api';
import { normalizeAuthIndex } from '@/utils/authIndex';
import { resolveCodexChatgptAccountId } from '@/utils/quota';

type GreetingProvider = 'claude' | 'codex';

export interface GreetingTarget {
  file: AuthFileItem;
  provider: GreetingProvider;
}

export interface GreetingResult {
  name: string;
  success: boolean;
  statusCode?: number;
}

export interface GreetingDependencies {
  getModels: typeof authFilesApi.getModelsForAuthFile;
  request: (payload: ApiCallRequest, config?: AxiosRequestConfig) => Promise<ApiCallResult>;
}

const defaultDependencies: GreetingDependencies = {
  getModels: authFilesApi.getModelsForAuthFile,
  request: apiCallApi.request,
};

const CLAUDE_MODELS = ['claude-haiku-4-5-20251001', 'claude-haiku-5-5'];
const CODEX_MODELS = ['gpt-6-luna', 'gpt-5.6-luna'];

/** OAuth account files have an email; runtime and API-key credentials are excluded. */
export function greetingTargets(files: AuthFileItem[]): GreetingTarget[] {
  return files.flatMap((file) => {
    const provider = String(file.type ?? file.provider ?? '').toLowerCase();
    if (provider !== 'claude' && provider !== 'codex') return [];
    if (file.disabled || file.runtimeOnly || file.useSiwc) return [];
    if (typeof file.email !== 'string' || !file.email.trim()) return [];
    return [{ file, provider }];
  });
}

export function pickGreetingModel(
  provider: GreetingProvider,
  models: { id: string }[]
): string | null {
  const available = new Set(models.map(({ id }) => id));
  const preferred = provider === 'claude' ? CLAUDE_MODELS : CODEX_MODELS;
  const exact = preferred.find((model) => available.has(model));
  if (exact) return exact;
  const fallback = models.find(({ id }) =>
    provider === 'claude' ? /^claude-haiku-[\w-]+$/.test(id) : /^gpt-[\w.-]+-luna$/.test(id)
  );
  return fallback?.id ?? null;
}

function codexCompleted(bodyText: string): boolean {
  return bodyText.split(/\r?\n/).some((line) => {
    if (!line.startsWith('data: ')) return false;
    try {
      const event: unknown = JSON.parse(line.slice(6));
      return (
        typeof event === 'object' &&
        event !== null &&
        'type' in event &&
        event.type === 'response.completed'
      );
    } catch {
      return false;
    }
  });
}

export async function sendGreeting(
  target: GreetingTarget,
  signal?: AbortSignal,
  dependencies: GreetingDependencies = defaultDependencies,
  assertConnection?: () => void
): Promise<GreetingResult> {
  const { file, provider } = target;
  const authIndex = normalizeAuthIndex(file['auth_index'] ?? file.authIndex);
  if (!authIndex) return { name: file.name, success: false };

  const model = pickGreetingModel(provider, await dependencies.getModels(file.name));
  assertConnection?.();
  if (!model) return { name: file.name, success: false };

  let payload: ApiCallRequest;
  if (provider === 'claude') {
    payload = {
      authIndex,
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages?beta=true',
      header: {
        Authorization: 'Bearer $TOKEN$',
        'Anthropic-Version': '2023-06-01',
        'Anthropic-Beta': 'claude-code-20250219,oauth-2025-04-20',
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'claude-code/2.1.302',
      },
      data: JSON.stringify({
        model,
        max_tokens: 32,
        messages: [{ role: 'user', content: 'selam' }],
      }),
    };
  } else {
    const accountId = resolveCodexChatgptAccountId(file);
    if (!accountId) return { name: file.name, success: false };
    payload = {
      authIndex,
      method: 'POST',
      url: 'https://chatgpt.com/backend-api/codex/responses',
      header: {
        Authorization: 'Bearer $TOKEN$',
        'ChatGPT-Account-ID': accountId,
        Originator: 'codex-tui',
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        'User-Agent': 'codex-cli',
      },
      data: JSON.stringify({
        model,
        instructions: 'Reply with only selam.',
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'selam' }] },
        ],
        stream: true,
        store: false,
      }),
    };
  }

  assertConnection?.();
  const result = await dependencies.request(payload, { signal, timeout: 90_000 });
  const successfulStatus = result.statusCode >= 200 && result.statusCode < 300;
  const completed =
    provider === 'claude'
      ? typeof result.body === 'object' &&
        result.body !== null &&
        'type' in result.body &&
        result.body.type === 'message'
      : codexCompleted(result.bodyText);
  return { name: file.name, success: successfulStatus && completed, statusCode: result.statusCode };
}
