/**
 * 格式化工具函数
 * 从原项目 src/utils/string.js 迁移
 */

/**
 * 隐藏 API Key 中间部分
 */
export function maskApiKey(key: string, visibleChars: number = 4): string {
  if (!key || key.length <= visibleChars * 2) {
    return key;
  }

  const start = key.slice(0, visibleChars);
  const end = key.slice(-visibleChars);
  const maskedLength = Math.min(key.length - visibleChars * 2, 20);
  const masked = '*'.repeat(maskedLength);

  return `${start}${masked}${end}`;
}

/**
 * 格式化文件大小
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const units = ['B', 'KB', 'MB', 'GB'];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${units[i]}`;
}

/**
 * 格式化日期时间
 */
export function formatDateTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date;

  if (isNaN(d.getTime())) {
    return 'Invalid Date';
  }

  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

/**
 * 格式化数字（添加千位分隔符）
 */
export function formatNumber(num: number): string {
  return num.toLocaleString('zh-CN');
}

/**
 * 截断长文本
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '...';
}
