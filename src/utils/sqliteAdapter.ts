/**
 * SQLite UsageRecord[] → UsageData 格式适配器
 * 将 SQLite 持久化的扁平记录转换为 MonitorPage 子组件期望的嵌套格式
 */

import type { UsageRecord } from '@/services/api/usageSqlite';
import type { UsageData, UsageDetail } from '@/pages/MonitorPage';

/**
 * 将 SQLite 使用记录转换为 UsageData 格式
 * UsageRecord[] (扁平) → { apis: { [apiKey]: { models: { [model]: { details: UsageDetail[] } } } } }
 */
export function sqliteRecordsToUsageData(records: UsageRecord[]): UsageData {
  const apis: UsageData['apis'] = {};

  for (const r of records) {
    const apiKey = r.api_key || 'unknown';
    const modelName = r.model || 'unknown';

    if (!apis[apiKey]) {
      apis[apiKey] = { models: {} };
    }
    if (!apis[apiKey].models[modelName]) {
      apis[apiKey].models[modelName] = { details: [] };
    }

    const detail: UsageDetail = {
      timestamp: r.timestamp,
      failed: r.failed,
      source: r.api_key,
      auth_index: r.auth_index,
      latency_ms: r.latency_ms,
      tokens: {
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        reasoning_tokens: r.reasoning_tokens,
        cached_tokens: r.cached_tokens,
        total_tokens: r.total_tokens,
      },
    };

    apis[apiKey].models[modelName].details.push(detail);
  }

  return { apis };
}
