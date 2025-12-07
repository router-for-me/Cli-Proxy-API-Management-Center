/**
 * 可用模型获取
 */

import axios from 'axios';
import { normalizeModelList } from '@/utils/models';

const buildModelsEndpoint = (baseUrl: string): string => {
  if (!baseUrl) return '';
  const trimmed = String(baseUrl).trim().replace(/\/+$/g, '');
  if (!trimmed) return '';
  if (trimmed.endsWith('/v1')) {
    return `${trimmed}/models`;
  }
  return `${trimmed}/v1/models`;
};

export const modelsApi = {
  async fetchModels(baseUrl: string, apiKey?: string) {
    const endpoint = buildModelsEndpoint(baseUrl);
    if (!endpoint) {
      throw new Error('Invalid base url');
    }

    const response = await axios.get(endpoint, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined
    });
    const payload = response.data?.data ?? response.data?.models ?? response.data;
    return normalizeModelList(payload, { dedupe: true });
  }
};
