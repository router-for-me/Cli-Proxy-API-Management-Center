/**
 * API Key × Model Heatmap 矩阵构建纯函数
 *
 * 将 UsageDetail[] 聚合为 (source, model) 二维矩阵，
 * 用于 ApiKeyModelHeatmap 组件渲染。
 */

export interface HeatmapCell {
  /** 聚合度量值（如 total_tokens 总和） */
  value: number;
  /** 请求总数 */
  totalRequests: number;
  /** 成功次数 */
  successCount: number;
  /** 失败次数 */
  failureCount: number;
  /** 最近一次请求时间戳 (ms) */
  lastTimestamp: number;
  /** 该 cell 为空（无对应维度组合的数据） */
  isEmpty: boolean;
}

export interface HeatmapRow {
  /** API Key 的标准化 source 标识 */
  source: string;
  /** 显示名称（已脱敏/渠道名） */
  displayName: string;
  /** 按 modelName → cell 的映射 */
  cells: Record<string, HeatmapCell>;
  /** 该行所有 cell 的总请求数 */
  totalRequests: number;
  /** 该行所有 cell 的总 token 数 */
  totalTokens: number;
}

export interface HeatmapMatrix {
  rows: HeatmapRow[];
  models: string[];
}

/**
 * 构建 API Key × Model 热力图矩阵
 *
 * @param details  - collectUsageDetails 的平面化明细
 * @param metric   - 聚合度量: 'tokens' | 'requests'
 * @returns        - 按 totalTokens 降序的行 + 按字母序的模型列名
 */
export function buildHeatmapMatrix(
  details: { source: string; __modelName?: string; tokens: { total_tokens: number }; failed: boolean; __timestampMs?: number; timestamp: string }[],
  metric: 'tokens' | 'requests' = 'tokens'
): HeatmapMatrix {
  // Step 1: 以 (source, modelName) 为复合键分组聚合
  type CellAccum = {
    value: number;
    totalRequests: number;
    successCount: number;
    failureCount: number;
    lastTimestamp: number;
  };
  const cellMap = new Map<string, CellAccum>();
  const modelSet = new Set<string>();
  const sourceSet = new Set<string>();
  const sourceTotalTokens = new Map<string, number>();
  const sourceTotalRequests = new Map<string, number>();

  for (const detail of details) {
    const source = detail.source || 'unknown';
    const modelName = detail.__modelName || 'Unknown';
    const key = `${source}||${modelName}`;

    const existing = cellMap.get(key) || {
      value: 0,
      totalRequests: 0,
      successCount: 0,
      failureCount: 0,
      lastTimestamp: 0,
    };

    const increment = metric === 'tokens'
      ? (typeof detail.tokens.total_tokens === 'number' ? detail.tokens.total_tokens : 0)
      : 1;
    existing.value += increment;
    existing.totalRequests += 1;
    if (detail.failed) {
      existing.failureCount += 1;
    } else {
      existing.successCount += 1;
    }
    const ts = typeof detail.__timestampMs === 'number' ? detail.__timestampMs : 0;
    if (ts > existing.lastTimestamp) {
      existing.lastTimestamp = ts;
    }

    cellMap.set(key, existing);
    modelSet.add(modelName);
    sourceSet.add(source);
    sourceTotalTokens.set(source, (sourceTotalTokens.get(source) || 0) + increment);
    sourceTotalRequests.set(source, (sourceTotalRequests.get(source) || 0) + 1);
  }

  // Step 2: 收集所有 modelName 并按字母序排序
  const models = Array.from(modelSet).sort((a, b) => a.localeCompare(b));

  // Step 3: 按 source 分组产出 HeatmapRow
  const sources = Array.from(sourceSet);
  const rows: HeatmapRow[] = sources.map((source) => {
    const cells: Record<string, HeatmapCell> = {};
    for (const model of models) {
      const key = `${source}||${model}`;
      const acc = cellMap.get(key);
      if (acc) {
        cells[model] = {
          value: acc.value,
          totalRequests: acc.totalRequests,
          successCount: acc.successCount,
          failureCount: acc.failureCount,
          lastTimestamp: acc.lastTimestamp,
          isEmpty: false,
        };
      } else {
        cells[model] = {
          value: 0,
          totalRequests: 0,
          successCount: 0,
          failureCount: 0,
          lastTimestamp: 0,
          isEmpty: true,
        };
      }
    }
    return {
      source,
      displayName: source, // displayName 将由组件层通过 resolveSourceDisplay 覆盖
      cells,
      totalRequests: sourceTotalRequests.get(source) || 0,
      totalTokens: sourceTotalTokens.get(source) || 0,
    };
  });

  // Step 4: 按 totalTokens 降序排列
  rows.sort((a, b) => b.totalTokens - a.totalTokens);

  return { rows, models };
}

/**
 * 计算热力强度等级 (0-5)
 *
 * 使用对数映射避免极端值带来的视觉扁平化。
 */
export function getHeatLevel(value: number, _min: number, max: number): number {
  if (max <= 0 || value <= 0) return 0;
  // 对数映射: log1p(value) / log1p(max)
  const normalized = Math.log1p(value) / Math.log1p(max);
  const level = Math.min(Math.floor(normalized * 5) + 1, 5);
  return level;
}
