/**
 * 安全存储服务
 * 基于原项目 src/utils/secure-storage.js
 */

import { encryptData, decryptData, isEncrypted } from '@/utils/encryption';

interface StorageOptions {
  encrypt?: boolean;
}

class SecureStorageService {
  private migrateLegacyValue(key: string, value: unknown): void {
    try {
      this.setItem(key, value);
    } catch {
      // 读取旧值成功时优先保证兼容返回，迁移失败不影响本次恢复流程。
    }
  }

  private decodeStoredValue(
    raw: string,
    encrypt: boolean
  ): { serialized: string; legacyEncrypted: boolean } | null {
    if (!encrypt) {
      return { serialized: raw, legacyEncrypted: false };
    }

    if (raw.startsWith('enc::v2::')) {
      const decrypted = decryptData(raw);
      if (decrypted === raw) return null;
      return { serialized: decrypted, legacyEncrypted: false };
    }

    if (raw.startsWith('enc::v1::')) {
      const decrypted = decryptData(raw);
      if (decrypted === raw) return null;
      return { serialized: decrypted, legacyEncrypted: true };
    }

    return { serialized: raw, legacyEncrypted: false };
  }

  /**
   * 存储数据
   */
  setItem(key: string, value: unknown, options: StorageOptions = {}): void {
    const { encrypt = true } = options;

    if (value === null || value === undefined) {
      this.removeItem(key);
      return;
    }

    const stringValue = JSON.stringify(value);
    const storedValue = encrypt ? encryptData(stringValue) : stringValue;

    localStorage.setItem(key, storedValue);
  }

  /**
   * 获取数据
   */
  getItem<T = unknown>(key: string, options: StorageOptions = {}): T | null {
    const { encrypt = true } = options;

    const raw = localStorage.getItem(key);
    if (raw === null) return null;

    const decoded = this.decodeStoredValue(raw, encrypt);
    if (!decoded) {
      return null;
    }

    try {
      const parsed = JSON.parse(decoded.serialized) as T;

      if (encrypt && decoded.legacyEncrypted) {
        this.migrateLegacyValue(key, parsed);
      }

      return parsed;
    } catch {
      if (encrypt && decoded.legacyEncrypted) {
        this.migrateLegacyValue(key, decoded.serialized);
      }

      return decoded.serialized as T;
    }
  }

  /**
   * 删除数据
   */
  removeItem(key: string): void {
    localStorage.removeItem(key);
  }

  /**
   * 清空所有数据
   */
  clear(): void {
    localStorage.clear();
  }

  /**
   * 迁移旧的明文缓存为加密格式
   */
  migratePlaintextKeys(keys: string[]): void {
    keys.forEach((key) => {
      const raw = localStorage.getItem(key);
      if (!raw) return;

      // 如果已经是加密格式，跳过
      if (isEncrypted(raw)) {
        return;
      }

      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // 原值不是 JSON，直接使用字符串
        parsed = raw;
      }

      try {
        this.setItem(key, parsed);
      } catch (error) {
        console.warn(`Failed to migrate key "${key}":`, error);
      }
    });
  }

  /**
   * 检查键是否存在
   */
  hasItem(key: string): boolean {
    return localStorage.getItem(key) !== null;
  }
}

export const secureStorage = new SecureStorageService();
