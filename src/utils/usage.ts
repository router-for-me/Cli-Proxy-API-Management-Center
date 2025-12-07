/**
 * 使用统计相关工具
 * 迁移自基线 modules/usage.js 的纯逻辑部分
 */

import { maskApiKey } from './format';

export interface KeyStatBucket {
  success: number;
  failure: number;
}

export interface KeyStats {
  bySource: Record<string, KeyStatBucket>;
  byAuthIndex: Record<string, KeyStatBucket>;
}

const normalizeAuthIndex = (value: any) => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  return null;
};

/**
 * 对使用数据中的敏感字段进行遮罩
 */
export function maskUsageSensitiveValue(value: unknown, masker: (val: string) => string = maskApiKey): string {
  if (value === null || value === undefined) {
    return '';
  }
  const raw = typeof value === 'string' ? value : String(value);
  if (!raw) {
    return '';
  }

  let masked = raw;

  const queryRegex = /([?&])(api[-_]?key|key|token|access_token|authorization)=([^&#\s]+)/gi;
  masked = masked.replace(queryRegex, (_full, prefix, keyName, valuePart) => `${prefix}${keyName}=${masker(valuePart)}`);

  const headerRegex = /(api[-_]?key|key|token|access[-_]?token|authorization)\s*([:=])\s*([A-Za-z0-9._-]+)/gi;
  masked = masked.replace(headerRegex, (_full, keyName, separator, valuePart) => `${keyName}${separator}${masker(valuePart)}`);

  const keyLikeRegex = /(sk-[A-Za-z0-9]{6,}|AI[a-zA-Z0-9_-]{6,}|AIza[0-9A-Za-z-_]{8,}|hf_[A-Za-z0-9]{6,}|pk_[A-Za-z0-9]{6,}|rk_[A-Za-z0-9]{6,})/g;
  masked = masked.replace(keyLikeRegex, (match) => masker(match));

  if (masked === raw) {
    const trimmed = raw.trim();
    if (trimmed && !/\s/.test(trimmed)) {
      const looksLikeKey =
        /^sk-/i.test(trimmed) ||
        /^AI/i.test(trimmed) ||
        /^AIza/i.test(trimmed) ||
        /^hf_/i.test(trimmed) ||
        /^pk_/i.test(trimmed) ||
        /^rk_/i.test(trimmed) ||
        (!/[\\/]/.test(trimmed) && (/\d/.test(trimmed) || trimmed.length >= 10)) ||
        trimmed.length >= 24;
      if (looksLikeKey) {
        return masker(trimmed);
      }
    }
  }

  return masked;
}

/**
 * 依据 usage 数据计算密钥使用统计
 */
export function computeKeyStats(usageData: any, masker: (val: string) => string = maskApiKey): KeyStats {
  if (!usageData) {
    return { bySource: {}, byAuthIndex: {} };
  }

  const sourceStats: Record<string, KeyStatBucket> = {};
  const authIndexStats: Record<string, KeyStatBucket> = {};

  const ensureBucket = (bucket: Record<string, KeyStatBucket>, key: string) => {
    if (!bucket[key]) {
      bucket[key] = { success: 0, failure: 0 };
    }
    return bucket[key];
  };

  const apis = usageData.apis || {};
  Object.values(apis as any).forEach((apiEntry: any) => {
    const models = apiEntry?.models || {};

    Object.values(models as any).forEach((modelEntry: any) => {
      const details = modelEntry?.details || [];

      details.forEach((detail: any) => {
        const source = maskUsageSensitiveValue(detail?.source, masker);
        const authIndexKey = normalizeAuthIndex(detail?.auth_index);
        const isFailed = detail?.failed === true;

        if (source) {
          const bucket = ensureBucket(sourceStats, source);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }

        if (authIndexKey) {
          const bucket = ensureBucket(authIndexStats, authIndexKey);
          if (isFailed) {
            bucket.failure += 1;
          } else {
            bucket.success += 1;
          }
        }
      });
    });
  });

  return {
    bySource: sourceStats,
    byAuthIndex: authIndexStats
  };
}
