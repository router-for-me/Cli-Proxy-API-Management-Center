import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Chart } from 'react-chartjs-2';
import type { UsageData } from '@/pages/MonitorPage';
import styles from '@/pages/MonitorPage.module.scss';

interface HourlyTokenChartProps {
  data: UsageData | null;
  loading: boolean;
  isDark: boolean;
}

type HourRange = 6 | 12 | 24;

export function HourlyTokenChart({ data, loading, isDark }: HourlyTokenChartProps) {
  const { t } = useTranslation();
  const [hourRange, setHourRange] = useState<HourRange>(12);

  // 按小时聚合 Token 数据
  const hourlyData = useMemo(() => {
    if (!data?.apis) return { hours: [], totalTokens: [], inputTokens: [], outputTokens: [], reasoningTokens: [], cachedTokens: [] };

    const now = new Date();
    let cutoffTime: Date;
    let hoursCount: number;

    cutoffTime = new Date(now.getTime() - hourRange * 60 * 60 * 1000);
    cutoffTime.setMinutes(0, 0, 0);
    hoursCount = hourRange + 1;

    // 生成所有小时的时间点
    const allHours: string[] = [];
    for (let i = 0; i < hoursCount; i++) {
      const hourTime = new Date(cutoffTime.getTime() + i * 60 * 60 * 1000);
      const hourKey = hourTime.toISOString().slice(0, 13); // YYYY-MM-DDTHH
      allHours.push(hourKey);
    }

    // 初始化所有小时的数据为0
    const hourlyStats: Record<string, {
      total: number;
      input: number;
      output: number;
      reasoning: number;
      cached: number;
    }> = {};
    allHours.forEach((hour) => {
      hourlyStats[hour] = { total: 0, input: 0, output: 0, reasoning: 0, cached: 0 };
    });

    // 收集每小时的 Token 数据（只统计成功请求）
    Object.values(data.apis).forEach((apiData) => {
      Object.values(apiData.models).forEach((modelData) => {
        modelData.details.forEach((detail) => {
          // 跳过失败请求，失败请求的 Token 数据不准确
          if (detail.failed) return;

          const timestamp = new Date(detail.timestamp);
          if (timestamp < cutoffTime) return;

          const hourKey = timestamp.toISOString().slice(0, 13); // YYYY-MM-DDTHH
          if (!hourlyStats[hourKey]) {
            hourlyStats[hourKey] = { total: 0, input: 0, output: 0, reasoning: 0, cached: 0 };
          }
          hourlyStats[hourKey].total += detail.tokens.total_tokens || 0;
          hourlyStats[hourKey].input += detail.tokens.input_tokens || 0;
          hourlyStats[hourKey].output += detail.tokens.output_tokens || 0;
          hourlyStats[hourKey].reasoning += detail.tokens.reasoning_tokens || 0;
          hourlyStats[hourKey].cached += detail.tokens.cached_tokens || 0;
        });
      });
    });

    // 获取排序后的小时列表
    const hours = allHours.sort();

    return {
      hours,
      totalTokens: hours.map((h) => (hourlyStats[h]?.total || 0) / 1000),
      inputTokens: hours.map((h) => (hourlyStats[h]?.input || 0) / 1000),
      outputTokens: hours.map((h) => (hourlyStats[h]?.output || 0) / 1000),
      reasoningTokens: hours.map((h) => (hourlyStats[h]?.reasoning || 0) / 1000),
      cachedTokens: hours.map((h) => (hourlyStats[h]?.cached || 0) / 1000),
    };
  }, [data, hourRange]);

  // 获取时间范围标签
  const hourRangeLabel = useMemo(() => {
    if (hourRange === 6) return t('monitor.hourly.last_6h');
    if (hourRange === 12) return t('monitor.hourly.last_12h');
    return t('monitor.hourly.last_24h');
  }, [hourRange, t]);

  // 图表数据
  const chartData = useMemo(() => {
    const labels = hourlyData.hours.map((hour) => {
      const date = new Date(hour + ':00:00Z'); // 添加 Z 表示 UTC 时间，确保正确转换为本地时间显示
      return `${date.getHours()}:00`;
    });

    return {
      labels,
      datasets: [
        {
          type: 'line' as const,
          label: t('monitor.hourly_token.input'),
          data: hourlyData.inputTokens,
          borderColor: '#22c55e',
          backgroundColor: '#22c55e',
          borderWidth: 2,
          tension: 0.4,
          yAxisID: 'y',
          order: 0,
          pointRadius: 3,
          pointBackgroundColor: '#22c55e',
        },
        {
          type: 'line' as const,
          label: t('monitor.hourly_token.output'),
          data: hourlyData.outputTokens,
          borderColor: '#f97316',
          backgroundColor: '#f97316',
          borderWidth: 2,
          tension: 0.4,
          yAxisID: 'y',
          order: 0,
          pointRadius: 3,
          pointBackgroundColor: '#f97316',
        },
        {
          type: 'bar' as const,
          label: t('monitor.hourly_token.total'),
          data: hourlyData.totalTokens,
          backgroundColor: 'rgba(59, 130, 246, 0.6)',
          borderColor: 'rgba(59, 130, 246, 0.6)',
          borderWidth: 1,
          borderRadius: 4,
          yAxisID: 'y',
          order: 1,
        },
      ],
    };
  }, [hourlyData, t]);

  // 图表配置
  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
    plugins: {
      legend: {
        display: true,
        position: 'bottom' as const,
        labels: {
          color: isDark ? '#9ca3af' : '#6b7280',
          usePointStyle: true,
          padding: 12,
          font: {
            size: 11,
          },
          generateLabels: (chart: any) => {
            return chart.data.datasets.map((dataset: any, i: number) => {
              const isLine = dataset.type === 'line';
              return {
                text: dataset.label,
                fillStyle: dataset.backgroundColor,
                strokeStyle: dataset.borderColor,
                lineWidth: 0,
                hidden: !chart.isDatasetVisible(i),
                datasetIndex: i,
                pointStyle: isLine ? 'circle' : 'rect',
              };
            });
          },
        },
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
            const label = context.dataset.label || '';
            const value = context.raw;
            return `${label}: ${value.toFixed(1)}K`;
          },
        },
      },
    },
    scales: {
      x: {
        grid: {
          color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
        },
        ticks: {
          color: isDark ? '#9ca3af' : '#6b7280',
          font: {
            size: 11,
          },
        },
      },
      y: {
        position: 'left' as const,
        grid: {
          color: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.06)',
        },
        ticks: {
          color: isDark ? '#9ca3af' : '#6b7280',
          font: {
            size: 11,
          },
          callback: (value: string | number) => `${value}K`,
        },
        title: {
          display: true,
          text: 'Tokens (K)',
          color: isDark ? '#9ca3af' : '#6b7280',
          font: {
            size: 11,
          },
        },
      },
    },
  }), [isDark]);

  return (
    <div className={styles.chartCard}>
      <div className={styles.chartHeader}>
        <div>
          <h3 className={styles.chartTitle}>{t('monitor.hourly_token.title')}</h3>
          <p className={styles.chartSubtitle}>
            {hourRangeLabel}
          </p>
        </div>
        <div className={styles.chartControls}>
          <button
            className={`${styles.chartControlBtn} ${hourRange === 6 ? styles.active : ''}`}
            onClick={() => setHourRange(6)}
          >
            {t('monitor.hourly.last_6h')}
          </button>
          <button
            className={`${styles.chartControlBtn} ${hourRange === 12 ? styles.active : ''}`}
            onClick={() => setHourRange(12)}
          >
            {t('monitor.hourly.last_12h')}
          </button>
          <button
            className={`${styles.chartControlBtn} ${hourRange === 24 ? styles.active : ''}`}
            onClick={() => setHourRange(24)}
          >
            {t('monitor.hourly.last_24h')}
          </button>
        </div>
      </div>

      <div className={styles.chartContent}>
        {loading || hourlyData.hours.length === 0 ? (
          <div className={styles.chartEmpty}>
            {loading ? t('common.loading') : t('monitor.no_data')}
          </div>
        ) : (
          <Chart type="bar" data={chartData} options={chartOptions} />
        )}
      </div>
    </div>
  );
}
