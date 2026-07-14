/**
 * 版本相关 API
 */

import { apiClient } from './client';
import type { ServerRuntimeKind } from '@/types';
import { isRecord } from '@/utils/helpers';

const CLI_PROXY_API_REPOSITORY = 'josephcy95/CLIProxyAPI';

export const versionApi = {
  async checkLatest(): Promise<Record<string, unknown>> {
    const response = await fetch(
      `https://api.github.com/repos/${CLI_PROXY_API_REPOSITORY}/releases/latest`,
      { headers: { Accept: 'application/vnd.github+json' } }
    );
    if (!response.ok) {
      throw new Error(`GitHub release check failed (${response.status})`);
    }

    const release: unknown = await response.json();
    const latest = isRecord(release) && typeof release.tag_name === 'string' ? release.tag_name : '';
    return { latest };
  },

  async detectRuntimeKind(): Promise<ServerRuntimeKind> {
    try {
      const data = await apiClient.get('/nodes');
      return isRecord(data) && Array.isArray(data.nodes) ? 'home' : 'unknown';
    } catch (error: unknown) {
      const status = isRecord(error) ? error.status : undefined;
      if (status === 404 || status === 405) {
        return 'cpa';
      }
      return 'unknown';
    }
  },
};
