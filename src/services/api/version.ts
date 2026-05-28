/**
 * 版本相关 API
 */

import axios from 'axios';
import { REQUEST_TIMEOUT_MS } from '@/utils/constants';
import { apiClient } from './client';

export interface ManagerLatestRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  published_at?: string;
  [key: string]: unknown;
}

const CPA_MANAGER_LATEST_RELEASE_URL =
  'https://api.github.com/repos/seakee/CPA-Manager/releases/latest';

export const versionApi = {
  checkLatest: () => apiClient.get<Record<string, unknown>>('/latest-version'),

  checkManagerLatest: async () => {
    const response = await axios.get<ManagerLatestRelease>(CPA_MANAGER_LATEST_RELEASE_URL, {
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        Accept: 'application/vnd.github+json'
      }
    });
    return response.data;
  }
};
