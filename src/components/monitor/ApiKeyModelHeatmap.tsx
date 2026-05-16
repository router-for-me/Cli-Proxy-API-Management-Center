/**
 * API Key × Model Heatmap 组件
 *
 * 以 CSS Grid 展示 API Key（行）与 Model（列）交叉维度的用量强度。
 * 纯 CSS 方案，不依赖 chart.js。
 */

import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { resolveSourceDisplay } from '@/utils/sourceResolver';
import { formatCompactNumber } from '@/utils/usage';
import { formatDateTime } from '@/utils/format';
import {
  buildHeatmapMatrix,
  getHeatLevel,
  type HeatmapCell,
  type HeatmapRow,
} from '@/utils/heatmap';
import type { UsageDetail } from '@/utils/usage';
import type { SourceInfo } from '@/types/sourceInfo';
import type { CredentialInfo } from '@/types/sourceInfo';
import styles from './ApiKeyModelHeatmap.module.scss';

export interface ApiKeyModelHeatmapProps {
  /** 由 MonitorPage 传入的 CollectUsageDetails 结果 */
  details: UsageDetail[];
  providerMap: Record<string, string>;
  /** sourceInfo 映射 */
  sourceInfoMap: Map<string, SourceInfo>;
  /** 凭证映射 */
  authFileMap?: Map<string, CredentialInfo>;
  /** 聚合度量: 'tokens' | 'requests'（默认 tokens） */
  metric?: 'tokens' | 'requests';
  /** 最大展示的 API Key 行数（超出部分折叠） */
  maxRows?: number;
  /** 最大展示的 Model 列数（超出部分折叠） */
  maxCols?: number;
  /** 加载中状态 */
  loading?: boolean;
  /** cell 点击回调 */
  onCellClick?: (source: string, model: string, cell: HeatmapCell) => void;
}

export function ApiKeyModelHeatmap({
  details,
  providerMap: _providerMap,
  sourceInfoMap,
  authFileMap,
  metric: initialMetric = 'tokens',
  maxRows = 20,
  maxCols = 15,
  loading = false,
  onCellClick,
}: ApiKeyModelHeatmapProps) {
  const { t } = useTranslation();

  // 度量切换
  const [metric, setMetric] = useState<'tokens' | 'requests'>(initialMetric);
  // 折叠展开
  const [showAllRows, setShowAllRows] = useState(false);
  const [showAllCols, setShowAllCols] = useState(false);

  // Step 1: 构建矩阵
  const { rows: rawRows, models: rawModels } = useMemo(
    () => buildHeatmapMatrix(details, metric),
    [details, metric]
  );

  // Step 2: 解析显示名
  const rows = useMemo(() => {
    return rawRows.map((row) => {
      const resolved = resolveSourceDisplay(row.source, undefined, sourceInfoMap, authFileMap || new Map());
      return {
        ...row,
        displayName: resolved.displayName || row.source,
      };
    });
  }, [rawRows, sourceInfoMap, authFileMap]);

  // Step 3: 响应式折叠（maxRows/maxCols 由父组件根据断点控制，CSS 媒体查询兜底）
  const visibleRows = showAllRows ? rows : rows.slice(0, maxRows);
  const visibleModels = showAllCols ? rawModels : rawModels.slice(0, maxCols);

  // Step 4: 计算全局最大值（用于强度色阶映射）
  const globalMax = useMemo(() => {
    if (metric === 'tokens') {
      return rows.reduce((max, row) => Math.max(max, row.totalTokens), 0);
    }
    return rows.reduce((max, row) => Math.max(max, row.totalRequests), 0);
  }, [rows, metric]);

  // Step 5: 计算列汇总
  const colTotals = useMemo(() => {
    const totals: Record<string, { value: number; count: number }> = {};
    for (const model of visibleModels) {
      let value = 0;
      let count = 0;
      for (const row of visibleRows) {
        const cell = row.cells[model];
        if (cell && !cell.isEmpty) {
          value += cell.value;
          count += cell.totalRequests;
        }
      }
      totals[model] = { value, count };
    }
    return totals;
  }, [visibleRows, visibleModels]);

  // 构建 tooltip 文本
  const buildTooltip = useCallback(
    (cell: HeatmapCell, source: string, model: string): string => {
      const modelLine = `Model: ${model}`;
      const sourceLine = `Source: ${source}`;
      const metricKey = metric === 'tokens' ? 'Tokens' : 'Requests';
      const metricLine = `${metricKey}: ${cell.value.toLocaleString()}`;
      const reqLine = `Requests: ${cell.totalRequests.toLocaleString()}`;
      const successRate =
        cell.totalRequests > 0
          ? ((cell.successCount / cell.totalRequests) * 100).toFixed(1)
          : '0.0';
      const rateLine = `Success: ${successRate}%`;
      const lastLine = cell.lastTimestamp > 0 ? `Last: ${formatDateTime(new Date(cell.lastTimestamp))}` : '';
      return [modelLine, sourceLine, metricLine, reqLine, rateLine, lastLine].filter(Boolean).join('\n');
    },
    [metric]
  );

  // 处理 cell 点击
  const handleCellClick = useCallback(
    (source: string, model: string, cell: HeatmapCell) => {
      if (!cell.isEmpty && onCellClick) {
        onCellClick(source, model, cell);
      }
    },
    [onCellClick]
  );

  // ---------- Loading 状态 ----------
  if (loading) {
    return (
      <div className={styles.emptyState}>
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  // ---------- 空数据 ----------
  if (!details.length || !rows.length) {
    return (
      <div className={styles.emptyState}>
        <span>{t('monitor.heatmap.empty')}</span>
      </div>
    );
  }

  // ---------- 度量切换 ----------
  const metricToggle = (
    <div className={styles.metricToggle}>
      <button
        className={metric === 'tokens' ? styles.metricBtnActive : styles.metricBtn}
        onClick={() => setMetric('tokens')}
      >
        {t('monitor.heatmap.metric_tokens')}
      </button>
      <button
        className={metric === 'requests' ? styles.metricBtnActive : styles.metricBtn}
        onClick={() => setMetric('requests')}
      >
        {t('monitor.heatmap.metric_requests')}
      </button>
    </div>
  );

  const colCount = visibleModels.length;

  return (
    <div>
      {metricToggle}

      <div
        className={styles.heatmapGrid}
        style={{ '--heatmap-col-count': colCount } as React.CSSProperties}
      >
        {/* 表头行 */}
        <div className={styles.cornerCell} />
        {visibleModels.map((model) => (
          <div
            key={model}
            className={styles.modelHeaderCell}
            data-tooltip={model}
          >
            {model}
          </div>
        ))}
        <div className={styles.totalHeaderCell}>
          {t('monitor.heatmap.col_total')}
        </div>

        {/* 数据行 */}
        {visibleRows.map((row) => (
          <RowContent
            key={row.source}
            row={row}
            models={visibleModels}
            globalMax={globalMax}
            metric={metric}
            buildTooltip={buildTooltip}
            onCellClick={handleCellClick}
          />
        ))}

        {/* 汇总行 */}
        <div className={styles.totalRow}>
          <div className={styles.totalRowLabel}>
            {t('monitor.heatmap.row_total')}
          </div>
          {visibleModels.map((model) => {
            const total = colTotals[model];
            return (
              <div key={model} className={styles.totalCell}>
                {total && total.value > 0
                  ? formatCompactNumber(total.value)
                  : ''}
              </div>
            );
          })}
          <div className={styles.rowTotalCell}>
            {metric === 'tokens'
              ? formatCompactNumber(
                  visibleRows.reduce((s, r) => s + r.totalTokens, 0)
                )
              : formatCompactNumber(
                  visibleRows.reduce((s, r) => s + r.totalRequests, 0)
                )}
          </div>
        </div>
      </div>

      {/* 折叠控制 */}
      {rows.length > maxRows && (
        <div className={styles.expandButton}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAllRows(!showAllRows)}
          >
            {showAllRows
              ? t('monitor.heatmap.show_less_rows')
              : t('monitor.heatmap.show_more_rows', {
                  count: rows.length,
                })}
          </Button>
        </div>
      )}

      {rawModels.length > maxCols && (
        <div className={styles.expandButton}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShowAllCols(!showAllCols)}
          >
            {showAllCols
              ? t('monitor.heatmap.show_less_models')
              : t('monitor.heatmap.show_more_models', {
                  count: rawModels.length,
                })}
          </Button>
        </div>
      )}

      {/* 移动端 fallback */}
      <div className={styles.mobileFallback}>
        {t('monitor.heatmap.mobile_fallback')}
      </div>
    </div>
  );
}

// ---------- 子组件：单行渲染 ----------
interface RowContentProps {
  row: HeatmapRow;
  models: string[];
  globalMax: number;
  metric: 'tokens' | 'requests';
  buildTooltip: (cell: HeatmapCell, source: string, model: string) => string;
  onCellClick: (source: string, model: string, cell: HeatmapCell) => void;
}

function RowContent({
  row,
  models,
  globalMax,
  metric,
  buildTooltip,
  onCellClick,
}: RowContentProps) {
  const hasAnyData = models.some(
    (model) => row.cells[model] && !row.cells[model].isEmpty
  );

  return (
    <>
      {/* 行标题 */}
      <div
        className={hasAnyData ? styles.rowHeader : styles.rowHeaderEmpty}
        title={row.displayName}
      >
        <span className={styles.rowHeaderText}>{row.displayName}</span>
        {hasAnyData && (
          <span className={styles.rowHeaderBadge}>
            {row.totalRequests}
          </span>
        )}
      </div>

      {/* 数据 cell */}
      {models.map((model) => {
        const cell = row.cells[model];
        if (!cell || cell.isEmpty) {
          return (
            <div
              key={model}
              className={styles.cellEmpty}
              data-tooltip=""
            />
          );
        }

        const level = getHeatLevel(
          cell.value,
          0,
          globalMax
        );
        const bgVar = `var(--heatmap-level-${level})`;

        return (
          <div
            key={model}
            className={styles.cell}
            style={{ background: bgVar }}
            data-tooltip={buildTooltip(cell, row.source, model)}
            onClick={() => onCellClick(row.source, model, cell)}
          />
        );
      })}

      {/* 行汇总 */}
      <div className={styles.rowTotalCell}>
        {hasAnyData
          ? formatCompactNumber(
              metric === 'tokens' ? row.totalTokens : row.totalRequests
            )
          : ''}
      </div>
    </>
  );
}

// 显式导出类型，方便 index.ts 统一导出
export type { HeatmapCell, HeatmapRow } from '@/utils/heatmap';
