/**
 * 可用模型获取
 */

import axios from 'axios';
import { normalizeModelList } from '@/utils/models';

const normalizeBaseUrl = (baseUrl: string): string => {
  let normalized = String(baseUrl || '').trim();
  if (!normalized) return '';
  normalized = normalized.replace(/\/?v0\/management\/?$/i, '');
  normalized = normalized.replace(/\/+$/g, '');
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `http://${normalized}`;
  }
  return normalized;
};

const buildModelsEndpoint = (baseUrl: string): string => {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) return '';
  return normalized.endsWith('/v1') ? `${normalized}/models` : `${normalized}/v1/models`;
};

export const modelsApi = {
  async fetchModels(baseUrl: string, apiKey?: string, headers: Record<string, string> = {}) {
    const endpoint = buildModelsEndpoint(baseUrl);
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
  }
};
