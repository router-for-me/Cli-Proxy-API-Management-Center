/**
 * API 密钥管理
 */

import { apiClient } from './client';

export const apiKeysApi = {
  async list(): Promise<string[]> {
    const data = await apiClient.get('/api-keys');
    const keys = (data && (data['api-keys'] ?? data.apiKeys)) as unknown;
    return Array.isArray(keys) ? (keys as string[]) : [];
  },

  replace: (keys: string[]) => apiClient.put('/api-keys', keys),

  update: (index: number, value: string) => apiClient.patch('/api-keys', { index, value }),

  delete: (index: number) => apiClient.delete(`/api-keys?index=${index}`)
};

/**
 * API Key Names management - stores display names for API keys
 * Uses backend if available, falls back to localStorage
 */
const API_KEY_NAMES_STORAGE_KEY = 'cli-proxy-api-key-names';

const loadFromLocalStorage = (): Record<string, string> => {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(API_KEY_NAMES_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
};

const saveToLocalStorage = (names: Record<string, string>): void => {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(API_KEY_NAMES_STORAGE_KEY, JSON.stringify(names));
  } catch {
    // Silent fail
  }
};

export const apiKeyNamesApi = {
  async get(): Promise<Record<string, string>> {
    try {
      // Try backend first
      const data = await apiClient.get('/api-key-names');
      const names = data?.['api-key-names'] ?? data?.apiKeyNames ?? data;
      if (typeof names === 'object' && names !== null && Object.keys(names).length > 0) {
        return names;
      }
    } catch {
      // Backend not supported, fall through to localStorage
    }
    // Fallback to localStorage
    return loadFromLocalStorage();
  },

  async update(names: Record<string, string>): Promise<void> {
    // Always save to localStorage as backup
    saveToLocalStorage(names);

    try {
      // Try to save to backend
      await apiClient.put('/api-key-names', names);
    } catch {
      // Backend not supported, localStorage already saved
    }
  }
};
