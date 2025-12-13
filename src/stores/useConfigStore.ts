/**
 * 配置状态管理
 * 从原项目 src/core/config-service.js 迁移
 */

import { create } from 'zustand';
import type { Config } from '@/types';
import type { RawConfigSection } from '@/types/config';
import { configApi } from '@/services/api/config';
import { CACHE_EXPIRY_MS } from '@/utils/constants';

interface ConfigCache {
  data: any;
  timestamp: number;
}

interface ConfigState {
  config: Config | null;
  cache: Map<string, ConfigCache>;
  loading: boolean;
  error: string | null;

  // 操作
  fetchConfig: (section?: RawConfigSection, forceRefresh?: boolean) => Promise<Config | any>;
  updateConfigValue: (section: RawConfigSection, value: any) => void;
  clearCache: (section?: RawConfigSection) => void;
  isCacheValid: (section?: RawConfigSection) => boolean;
}

const SECTION_KEYS: RawConfigSection[] = [
  'debug',
  'proxy-url',
  'request-retry',
  'quota-exceeded',
  'usage-statistics-enabled',
  'request-log',
  'logging-to-file',
  'ws-auth',
  'api-keys',
  'ampcode',
  'gemini-api-key',
  'codex-api-key',
  'claude-api-key',
  'openai-compatibility',
  'oauth-excluded-models'
];

const extractSectionValue = (config: Config | null, section?: RawConfigSection) => {
  if (!config) return undefined;
  switch (section) {
    case 'debug':
      return config.debug;
    case 'proxy-url':
      return config.proxyUrl;
    case 'request-retry':
      return config.requestRetry;
    case 'quota-exceeded':
      return config.quotaExceeded;
    case 'usage-statistics-enabled':
      return config.usageStatisticsEnabled;
    case 'request-log':
      return config.requestLog;
    case 'logging-to-file':
      return config.loggingToFile;
    case 'ws-auth':
      return config.wsAuth;
    case 'api-keys':
      return config.apiKeys;
    case 'ampcode':
      return config.ampcode;
    case 'gemini-api-key':
      return config.geminiApiKeys;
    case 'codex-api-key':
      return config.codexApiKeys;
    case 'claude-api-key':
      return config.claudeApiKeys;
    case 'openai-compatibility':
      return config.openaiCompatibility;
    case 'oauth-excluded-models':
      return config.oauthExcludedModels;
    default:
      if (!section) return undefined;
      return config.raw?.[section];
  }
};

export const useConfigStore = create<ConfigState>((set, get) => ({
  config: null,
  cache: new Map(),
  loading: false,
  error: null,

  fetchConfig: async (section, forceRefresh = false) => {
    const { cache, isCacheValid } = get();

    // 检查缓存
    const cacheKey = section || '__full__';
    if (!forceRefresh && isCacheValid(section)) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return cached.data;
      }
    }

    // 获取新数据
    set({ loading: true, error: null });

    try {
      const data = await configApi.getConfig();
      const now = Date.now();

      // 更新缓存
      const newCache = new Map(cache);
      newCache.set('__full__', { data, timestamp: now });
      SECTION_KEYS.forEach((key) => {
        const value = extractSectionValue(data, key);
        if (value !== undefined) {
          newCache.set(key, { data: value, timestamp: now });
        }
      });

      set({
        config: data,
        cache: newCache,
        loading: false
      });

      return section ? extractSectionValue(data, section) : data;
    } catch (error: any) {
      set({
        error: error.message || 'Failed to fetch config',
        loading: false
      });
      throw error;
    }
  },

  updateConfigValue: (section, value) => {
    set((state) => {
      const raw = { ...(state.config?.raw || {}) };
      raw[section] = value;
      const nextConfig: Config = { ...(state.config || {}), raw };

      switch (section) {
        case 'debug':
          nextConfig.debug = value;
          break;
        case 'proxy-url':
          nextConfig.proxyUrl = value;
          break;
        case 'request-retry':
          nextConfig.requestRetry = value;
          break;
        case 'quota-exceeded':
          nextConfig.quotaExceeded = value;
          break;
        case 'usage-statistics-enabled':
          nextConfig.usageStatisticsEnabled = value;
          break;
        case 'request-log':
          nextConfig.requestLog = value;
          break;
        case 'logging-to-file':
          nextConfig.loggingToFile = value;
          break;
        case 'ws-auth':
          nextConfig.wsAuth = value;
          break;
        case 'api-keys':
          nextConfig.apiKeys = value;
          break;
        case 'ampcode':
          nextConfig.ampcode = value;
          break;
        case 'gemini-api-key':
          nextConfig.geminiApiKeys = value;
          break;
        case 'codex-api-key':
          nextConfig.codexApiKeys = value;
          break;
        case 'claude-api-key':
          nextConfig.claudeApiKeys = value;
          break;
        case 'openai-compatibility':
          nextConfig.openaiCompatibility = value;
          break;
        case 'oauth-excluded-models':
          nextConfig.oauthExcludedModels = value;
          break;
        default:
          break;
      }

      return { config: nextConfig };
    });

    // 清除该 section 的缓存
    get().clearCache(section);
  },

  clearCache: (section) => {
    const { cache } = get();
    const newCache = new Map(cache);

    if (section) {
      newCache.delete(section);
      // 同时清除完整配置缓存
      newCache.delete('__full__');
    } else {
      newCache.clear();
    }

    set({ cache: newCache });
  },

  isCacheValid: (section) => {
    const { cache } = get();
    const cacheKey = section || '__full__';
    const cached = cache.get(cacheKey);

    if (!cached) return false;

    return Date.now() - cached.timestamp < CACHE_EXPIRY_MS;
  }
}));
