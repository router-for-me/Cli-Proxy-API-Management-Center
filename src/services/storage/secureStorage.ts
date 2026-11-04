/**
 * 本地存储混淆服务（可逆）
 * 基于原项目 src/utils/secure-storage.js
 *
 * IMPORTANT: 这不是安全边界，仅用于避免“肉眼直读”的轻度混淆。
 */

import {
  obfuscateData,
  deobfuscateData,
  isObfuscated,
  isCurrentObfuscated,
} from '@/utils/encryption';
import {
  STORAGE_KEY_AUTH,
  STORAGE_KEY_AUTH_LOGIN_PREFIX,
  STORAGE_KEY_AUTH_SCOPE_PREFIX,
  STORAGE_KEY_AUTH_SELECTION_PREFIX,
} from '@/utils/constants';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

interface StorageOptions {
  /**
   * Whether to obfuscate the stored value. This was historically called `encrypt`,
   * but the implementation is reversible obfuscation, not cryptographic security.
   */
  obfuscate?: boolean;
  encrypt?: boolean;
}

class ObfuscatedStorageService {
  /**
   * 存储数据
   */
  setItem(key: string, value: unknown, options: StorageOptions = {}): void {
    const obfuscate = options.obfuscate ?? options.encrypt ?? true;

    if (value === null || value === undefined) {
      this.removeItem(key);
      return;
    }

    const stringValue = JSON.stringify(value);
    const storedValue = obfuscate ? obfuscateData(stringValue) : stringValue;

    localStorage.setItem(key, storedValue);
  }

  /**
   * 获取数据
   */
  getItem<T = unknown>(key: string, options: StorageOptions = {}): T | null {
    const obfuscate = options.obfuscate ?? options.encrypt ?? true;

    const raw = localStorage.getItem(key);
    if (raw === null) return null;

    try {
      const decrypted = obfuscate ? deobfuscateData(raw) : raw;
      return JSON.parse(decrypted) as T;
    } catch {
      // JSON解析失败,尝试兼容旧的纯字符串数据 (非JSON格式)
      try {
        // 如果是加密的,尝试解密后直接返回
        if (obfuscate && isObfuscated(raw)) {
          const decrypted = deobfuscateData(raw);
          // 解密后如果还不是JSON,返回原始字符串
          return decrypted as T;
        }
        // 非加密的纯字符串,直接返回
        return raw as T;
      } catch {
        // 完全失败,静默返回null (避免控制台污染)
        return null;
      }
    }
  }

  /**
   * 删除数据
   */
  removeItem(key: string): void {
    localStorage.removeItem(key);
  }
}

export const obfuscatedStorage = new ObfuscatedStorageService();

interface PersistedAuthEnvelope {
  state?: {
    apiBase?: unknown;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const normalizedStorageScope = (apiBase: string) =>
  encodeURIComponent(normalizeApiBase(apiBase));

export const getScopedAuthStorageKey = (panelBase: string, apiBase: string): string =>
  `${STORAGE_KEY_AUTH_SCOPE_PREFIX}${normalizedStorageScope(panelBase)}:${normalizedStorageScope(apiBase)}`;

export const getAuthSelectionStorageKey = (panelBase: string): string =>
  `${STORAGE_KEY_AUTH_SELECTION_PREFIX}${normalizedStorageScope(panelBase)}`;

export const getAuthLoginStateStorageKey = (panelBase: string): string =>
  `${STORAGE_KEY_AUTH_LOGIN_PREFIX}${normalizedStorageScope(panelBase)}`;

export const resolveLegacyAuthApiBase = (
  legacyApiBase: string,
  detectedApiBase: string
): string | null => {
  const legacy = normalizeApiBase(legacyApiBase);
  const detected = normalizeApiBase(detectedApiBase);
  if (!legacy || !detected) return null;
  // Origin equality is insufficient: reverse-proxy paths may identify entirely
  // different services. Only an exact normalized base can safely reuse a key.
  return legacy === detected ? detected : null;
};

const readEnvelopeApiBase = (value: unknown): string => {
  if (!value || typeof value !== 'object') return '';
  const apiBase = (value as PersistedAuthEnvelope).state?.apiBase;
  return typeof apiBase === 'string' ? normalizeApiBase(apiBase) : '';
};

const migrateLegacyAuthEnvelope = (
  legacy: PersistedAuthEnvelope,
  detectedBase: string
): PersistedAuthEnvelope | null => {
  const migratedBase = resolveLegacyAuthApiBase(readEnvelopeApiBase(legacy), detectedBase);
  if (!migratedBase || !legacy.state) return null;
  return { ...legacy, state: { ...legacy.state, apiBase: migratedBase } };
};

/**
 * Zustand storage adapter that isolates remembered credentials by both the
 * panel mount and the selected normalized API base.
 */
export const createScopedAuthStorage = (
  detectPanelBase: () => string = detectApiBaseFromLocation
) => ({
  getItem: (name: string): string | null => {
    // Retire pre-v2 credentials without decoding them, while retaining panel isolation.
    localStorage.removeItem('managementKey');
    const panelBase = normalizeApiBase(detectPanelBase());
    const selectionKey = getAuthSelectionStorageKey(panelBase);
    const selectedBase = obfuscatedStorage.getItem<string>(selectionKey);
    const selectedKey = selectedBase ? getScopedAuthStorageKey(panelBase, selectedBase) : null;
    const selectedRaw = selectedKey ? localStorage.getItem(selectedKey) : null;
    if (selectedKey && selectedRaw && !isCurrentObfuscated(selectedRaw)) {
      localStorage.removeItem(selectedKey);
      localStorage.removeItem(getAuthLoginStateStorageKey(panelBase));
    }
    const selectedEnvelope =
      selectedKey && selectedRaw && isCurrentObfuscated(selectedRaw)
        ? obfuscatedStorage.getItem<PersistedAuthEnvelope>(selectedKey)
        : null;
    if (selectedEnvelope) return JSON.stringify(selectedEnvelope);

    const legacyRaw = localStorage.getItem(name);
    if (!legacyRaw || !isCurrentObfuscated(legacyRaw)) {
      localStorage.removeItem(name);
      localStorage.removeItem('isLoggedIn');
      return null;
    }
    const legacy = obfuscatedStorage.getItem<PersistedAuthEnvelope>(name);
    const migrated = legacy ? migrateLegacyAuthEnvelope(legacy, panelBase) : null;
    if (!migrated) return null;

    const migratedBase = readEnvelopeApiBase(migrated);
    obfuscatedStorage.setItem(getScopedAuthStorageKey(panelBase, migratedBase), migrated);
    obfuscatedStorage.setItem(selectionKey, migratedBase);
    if (localStorage.getItem('isLoggedIn') === 'true') {
      localStorage.setItem(getAuthLoginStateStorageKey(panelBase), 'true');
      localStorage.removeItem('isLoggedIn');
    }
    obfuscatedStorage.removeItem(name);
    return JSON.stringify(migrated);
  },
  setItem: (_name: string, value: string): void => {
    const panelBase = normalizeApiBase(detectPanelBase());
    const selectionKey = getAuthSelectionStorageKey(panelBase);
    const previousBase = obfuscatedStorage.getItem<string>(selectionKey);
    const envelope = JSON.parse(value) as PersistedAuthEnvelope;
    const apiBase = readEnvelopeApiBase(envelope);

    if (!apiBase) {
      if (previousBase) {
        obfuscatedStorage.removeItem(getScopedAuthStorageKey(panelBase, previousBase));
      }
      obfuscatedStorage.removeItem(selectionKey);
      return;
    }

    obfuscatedStorage.setItem(getScopedAuthStorageKey(panelBase, apiBase), envelope);
    obfuscatedStorage.setItem(selectionKey, apiBase);
  },
  removeItem: (name: string): void => {
    const panelBase = normalizeApiBase(detectPanelBase());
    const selectionKey = getAuthSelectionStorageKey(panelBase);
    const selectedBase = obfuscatedStorage.getItem<string>(selectionKey);
    if (selectedBase) {
      obfuscatedStorage.removeItem(getScopedAuthStorageKey(panelBase, selectedBase));
    }
    obfuscatedStorage.removeItem(selectionKey);
    obfuscatedStorage.removeItem(name || STORAGE_KEY_AUTH);
  },
});

const AUTH_STORAGE_PREFIXES = [
  STORAGE_KEY_AUTH_SCOPE_PREFIX,
  STORAGE_KEY_AUTH_SELECTION_PREFIX,
  STORAGE_KEY_AUTH_LOGIN_PREFIX,
] as const;

const LEGACY_AUTH_STORAGE_KEYS = [
  STORAGE_KEY_AUTH,
  'isLoggedIn',
  'apiBase',
  'apiUrl',
  'managementKey',
] as const;

export const clearAllAuthStorage = (): void => {
  if (typeof localStorage === 'undefined') return;

  const keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index)).filter(
    (key): key is string => Boolean(key)
  );
  for (const key of keys) {
    if (
      LEGACY_AUTH_STORAGE_KEYS.includes(key as (typeof LEGACY_AUTH_STORAGE_KEYS)[number]) ||
      AUTH_STORAGE_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      localStorage.removeItem(key);
    }
  }
};
