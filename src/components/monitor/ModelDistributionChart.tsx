import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Doughnut } from 'react-chartjs-2';
import type { UsageData } from '@/pages/MonitorPage';
import styles from '@/pages/MonitorPage.module.scss';

interface ModelDistributionChartProps {
  data: UsageData | null;
  loading: boolean;
  isDark: boolean;
  timeRange: number;
}

// 颜色调色板
const COLORS = [
  '#3b82f6', // 蓝色
  '#22c55e', // 绿色
  '#f97316', // 橙色
  '#8b5cf6', // 紫色
  '#ec4899', // 粉色
  '#06b6d4', // 青色
  '#eab308', // 黄色
  '#ef4444', // 红色
  '#14b8a6', // 青绿
  '#6366f1', // 靛蓝
];

type ViewMode = 'request' | 'token';

export function ModelDistributionChart({ data, loading, isDark, timeRange }: ModelDistributionChartProps) {
  const { t } = useTranslation();
  const [viewMode, setViewMode] = useState<ViewMode>('request');

  const timeRangeLabel = timeRange === 1
    ? t('monitor.today')
    : t('monitor.last_n_days', { n: timeRange });

  // 计算模型分布数据
  const distributionData = useMemo(() => {
    if (!data?.apis) return [];

    const modelStats: Record<string, { requests: number; tokens: number }> = {};

    Object.values(data.apis).forEach((apiData) => {
      Object.entries(apiData.models).forEach(([modelName, modelData]) => {
        if (!modelStats[modelName]) {
          modelStats[modelName] = { requests: 0, tokens: 0 };
        }
        modelData.details.forEach((detail) => {
          modelStats[modelName].requests++;
          modelStats[modelName].tokens += detail.tokens.total_tokens || 0;
        });
      });
    });

    // 转换为数组并排序
    const sorted = Object.entries(modelStats)
      .map(([name, stats]) => ({
        name,
        requests: stats.requests,
        tokens: stats.tokens,
      }))
      .sort((a, b) => {
        if (viewMode === 'request') {
          return b.requests - a.requests;
        }
        return b.tokens - a.tokens;
      });

    // 取 Top 10
    return sorted.slice(0, 10);
  }, [data, viewMode]);

  // 计算总数
  const total = useMemo(() => {
    return distributionData.reduce((sum, item) => {
      return sum + (viewMode === 'request' ? item.requests : item.tokens);
    }, 0);
  }, [distributionData, viewMode]);

  // 图表数据
  const chartData = useMemo(() => {
    return {
      labels: distributionData.map((item) => item.name),
      datasets: [
        {
          data: distributionData.map((item) =>
            viewMode === 'request' ? item.requests : item.tokens
          ),
          backgroundColor: COLORS.slice(0, distributionData.length),
          borderColor: isDark ? '#1f2937' : '#ffffff',
          borderWidth: 2,
        },
      ],
    };
  }, [distributionData, viewMode, isDark]);

  // 图表配置
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '65%',
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        backgroundColor: isDark ? '#374151' : '#ffffff',
        titleColor: isDark ? '#f3f4f6' : '#111827',
        bodyColor: isDark ? '#d1d5db' : '#4b5563',
        borderColor: isDark ? '#4b5563' : '#e5e7eb',
        borderWidth: 1,
        padding: 12,
        callbacks: {
          label: (context: any) => {
            const value = context.raw;
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
            if (viewMode === 'request') {
              return `${value.toLocaleString()} ${t('monitor.requests')} (${percentage}%)`;
            }
            return `${value.toLocaleString()} tokens (${percentage}%)`;
          },
        },
      },
    },
  }), [isDark, total, viewMode, t]);

  // 格式化数值
  const formatValue = (value: number) => {
    if (value >= 1000000) {
      return (value / 1000000).toFixed(1) + 'M';
    }
    if (value >= 1000) {
      return (value / 1000).toFixed(1) + 'K';
    }
    return value.toString();
  };

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>{t('monitor.distribution.title')}</h3>
          <p className={styles.chartSubtitle}>
            {timeRangeLabel} · {viewMode === 'request' ? t('monitor.distribution.by_requests') : t('monitor.distribution.by_tokens')}
            {' · Top 10'}
          </p>
        </div>
        <div className={styles.chartControls}>
          <button
            className={`${styles.chartControlBtn} ${viewMode === 'request' ? styles.active : ''}`}
            onClick={() => setViewMode('request')}
          >
            {t('monitor.distribution.requests')}
          </button>
          <button
            className={`${styles.chartControlBtn} ${viewMode === 'token' ? styles.active : ''}`}
            onClick={() => setViewMode('token')}
          >
            {t('monitor.distribution.tokens')}
          </button>
        </div>
      </div>

      {loading || distributionData.length === 0 ? (
        <div className={styles.chartContent}>
          <div className={styles.chartEmpty}>
            {loading ? t('common.loading') : t('monitor.no_data')}
          </div>
        </div>
      ) : (
        <div className={styles.distributionContent}>
          <div className={styles.donutWrapper}>
            <Doughnut data={chartData} options={chartOptions} />
            <div className={styles.donutCenter}>
              <div className={styles.donutLabel}>
                {viewMode === 'request' ? t('monitor.distribution.request_share') : t('monitor.distribution.token_share')}
              </div>
            </div>
          </div>
          <div className={styles.legendList}>
            {distributionData.map((item, index) => {
              const value = viewMode === 'request' ? item.requests : item.tokens;
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
              return (
                <div key={item.name} className={styles.legendItem}>
                  <span
                    className={styles.legendDot}
                    style={{ backgroundColor: COLORS[index] }}
                  />
                  <span className={styles.legendName} title={item.name}>
                    {item.name}
                  </span>
                  <span className={styles.legendValue}>
                    {formatValue(value)} ({percentage}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
