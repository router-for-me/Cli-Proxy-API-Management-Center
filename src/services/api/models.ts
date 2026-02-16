/**
 * 可用模型获取
 */

import axios from 'axios';
import { normalizeModelList } from '@/utils/models';
import { normalizeApiBase } from '@/utils/connection';
import { apiCallApi, getApiCallErrorMessage } from './apiCall';

const DEFAULT_CLAUDE_BASE_URL = 'https://api.anthropic.com';
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';
const CLAUDE_MODELS_IN_FLIGHT = new Map<string, Promise<ReturnType<typeof normalizeModelList>>>();

const buildRequestSignature = (url: string, headers: Record<string, string>) => {
  const headerSignature = Object.entries(headers)
    .sort(([a], [b]) => a.toLowerCase().localeCompare(b.toLowerCase()))
    .map(([key, value]) => `${key}:${value}`)
    .join('|');
  return `${url}||${headerSignature}`;
};

const buildModelsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeApiBase(baseUrl);
  if (!normalized) return '';
  const trimmed = normalized.replace(/\/+$/g, '');
  if (/\/models$/i.test(trimmed)) return trimmed;
  return `${trimmed}/models`;
};

const buildV1ModelsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeApiBase(baseUrl);
  if (!normalized) return '';
  const trimmed = normalized.replace(/\/+$/g, '');
  if (/\/v1\/models$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/models`;
  return `${trimmed}/v1/models`;
};

const buildClaudeModelsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeApiBase(baseUrl);
  const fallback = normalized || DEFAULT_CLAUDE_BASE_URL;
  let trimmed = fallback.replace(/\/+$/g, '');
  trimmed = trimmed.replace(/\/v1\/models$/i, '');
  trimmed = trimmed.replace(/\/v1(?:\/.*)?$/i, '');
  return `${trimmed}/v1/models`;
};

const hasHeader = (headers: Record<string, string>, name: string) => {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
};

const resolveBearerTokenFromAuthorization = (headers: Record<string, string>): string => {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === 'authorization');
  if (!entry) return '';
  const value = String(entry[1] ?? '').trim();
  if (!value) return '';
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
};

export const modelsApi = {
  /**
   * Fetch available models from /v1/models endpoint (for system info page)
   */
  async fetchModels(baseUrl: string, apiKey?: string, headers: Record<string, string> = {}) {
    const endpoint = buildV1ModelsEndpoint(baseUrl);
    if (!endpoint) {
      throw new Error('Invalid base url');
    }

    const resolvedHeaders = { ...headers };
    if (apiKey) {
      resolvedHeaders.Authorization = `Bearer ${apiKey}`;
    }

    const response = await axios.get(endpoint, {
      headers: Object.keys(resolvedHeaders).length ? resolvedHeaders : undefined
    });
    const payload = response.data?.data ?? response.data?.models ?? response.data;
    return normalizeModelList(payload, { dedupe: true });
  },

  /**
   * Fetch models from /models endpoint via api-call (for OpenAI provider discovery)
   */
  async fetchModelsViaApiCall(
    baseUrl: string,
    apiKey?: string,
    headers: Record<string, string> = {}
  ) {
    const endpoint = buildModelsEndpoint(baseUrl);
    if (!endpoint) {
      throw new Error('Invalid base url');
    }

    const resolvedHeaders = { ...headers };
    const hasAuthHeader = Boolean(resolvedHeaders.Authorization || resolvedHeaders.authorization);
    if (apiKey && !hasAuthHeader) {
      resolvedHeaders.Authorization = `Bearer ${apiKey}`;
    }

    const result = await apiCallApi.request({
      method: 'GET',
      url: endpoint,
      header: Object.keys(resolvedHeaders).length ? resolvedHeaders : undefined
    });

    if (result.statusCode < 200 || result.statusCode >= 300) {
      throw new Error(getApiCallErrorMessage(result));
    }

    const payload = result.body ?? result.bodyText;
    return normalizeModelList(payload, { dedupe: true });
  },

  buildClaudeModelsEndpoint(baseUrl: string) {
    return buildClaudeModelsEndpoint(baseUrl);
  },

  /**
   * Fetch Claude models from /v1/models via api-call.
   * Anthropic requires `x-api-key` and `anthropic-version` headers.
   */
  async fetchClaudeModelsViaApiCall(
    baseUrl: string,
    apiKey?: string,
    headers: Record<string, string> = {}
  ) {
    const endpoint = buildClaudeModelsEndpoint(baseUrl);
    if (!endpoint) {
      throw new Error('Invalid base url');
    }

    const resolvedHeaders = { ...headers };
    let resolvedApiKey = String(apiKey ?? '').trim();
    if (!resolvedApiKey && !hasHeader(resolvedHeaders, 'x-api-key')) {
      resolvedApiKey = resolveBearerTokenFromAuthorization(resolvedHeaders);
    }

    if (resolvedApiKey && !hasHeader(resolvedHeaders, 'x-api-key')) {
      resolvedHeaders['x-api-key'] = resolvedApiKey;
    }
    if (!hasHeader(resolvedHeaders, 'anthropic-version')) {
      resolvedHeaders['anthropic-version'] = DEFAULT_ANTHROPIC_VERSION;
    }

    const signature = buildRequestSignature(endpoint, resolvedHeaders);
    const existing = CLAUDE_MODELS_IN_FLIGHT.get(signature);
    if (existing) return existing;

    const request = (async () => {
      const result = await apiCallApi.request({
        method: 'GET',
        url: endpoint,
        header: Object.keys(resolvedHeaders).length ? resolvedHeaders : undefined
      });

      if (result.statusCode < 200 || result.statusCode >= 300) {
        throw new Error(getApiCallErrorMessage(result));
      }

      const payload = result.body ?? result.bodyText;
      return normalizeModelList(payload, { dedupe: true });
    })();

    CLAUDE_MODELS_IN_FLIGHT.set(signature, request);
    try {
      return await request;
    } finally {
      CLAUDE_MODELS_IN_FLIGHT.delete(signature);
    }
  },
};
