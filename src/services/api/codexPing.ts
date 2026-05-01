import { apiClient } from './client';

export interface CodexPingUsage {
  input_tokens: number;
  cached_input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  total_tokens: number;
}

export interface CodexPingResponse {
  message: string;
  usage: CodexPingUsage;
}

const readNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

const normalizeUsage = (value: unknown): CodexPingUsage => {
  const record =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return {
    input_tokens: readNumber(record.input_tokens),
    cached_input_tokens: readNumber(record.cached_input_tokens),
    output_tokens: readNumber(record.output_tokens),
    reasoning_tokens: readNumber(record.reasoning_tokens),
    total_tokens: readNumber(record.total_tokens),
  };
};

export const codexPingApi = {
  ping: async (authIndex: string): Promise<CodexPingResponse> => {
    const response = await apiClient.post<Record<string, unknown>>('/codex/ping', {
      auth_index: authIndex,
    });
    const message =
      typeof response.message === 'string' && response.message.trim()
        ? response.message.trim()
        : 'Pong';
    return {
      message,
      usage: normalizeUsage(response.usage),
    };
  },
};
