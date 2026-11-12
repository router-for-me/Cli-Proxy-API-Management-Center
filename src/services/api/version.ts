/**
 * 版本相关 API
 */

import { apiClient } from './client';

export const versionApi = {
  checkLatest: (isCurrent?: () => boolean) =>
    (isCurrent ? apiClient.captureConnection(isCurrent) : apiClient).get<Record<string, unknown>>(
      '/server/latest-version'
    ),
};
