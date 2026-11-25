/**
 * 配置文件相关 API（/config.yaml）
 */

import { apiClient } from './client';

async function fetchConfigYamlSnapshot() {
  const response = await apiClient.getRaw('/config.yaml', {
    responseType: 'text',
    headers: { Accept: 'application/yaml, text/yaml, text/plain' },
  });
  const data: unknown = response.data;
  const etag: unknown = response.headers?.etag;
  return { yaml: String(data ?? ''), etag: typeof etag === 'string' ? etag : null };
}

export const configFileApi = {
  fetchConfigYamlSnapshot,

  async fetchConfigYaml(): Promise<string> {
    return (await fetchConfigYamlSnapshot()).yaml;
  },

  async saveConfigYaml(content: string, etag: string | null): Promise<void> {
    // Require one strong entity tag, never an unconditional write or If-Match: *.
    if (!etag || !/^"[^"\s]*"$/.test(etag)) throw new Error('Missing or invalid config ETag');
    await apiClient.put('/config.yaml', content, {
      headers: {
        'If-Match': etag,
        'Content-Type': 'application/yaml',
        Accept: 'application/json, text/plain, */*',
      },
    });
  },
};
