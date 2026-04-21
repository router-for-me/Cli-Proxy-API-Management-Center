/**
 * Chart.js configuration utilities for usage statistics
 * Extracted from UsagePage.tsx for reusability
 */

import type { ChartOptions } from 'chart.js';

/**
 * Static sparkline chart options (no dependencies on theme/mobile)
 */
export const sparklineOptions: ChartOptions<'line'> = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false }, tooltip: { enabled: false } },
  scales: { x: { display: false }, y: { display: false } },
  elements: { line: { tension: 0.45 }, point: { radius: 0 } },
};

export interface ChartConfigOptions {
  period: 'hour' | 'day';
  labels: string[];
  isDark: boolean;
  isMobile: boolean;
}

/**
 * Build chart options with theme and responsive awareness
 */
export function buildChartOptions({
  period,
  labels,
  isDark,
  isMobile,
}: ChartConfigOptions): ChartOptions<'line'> {
  const isDenseSeries = labels.length > (isMobile ? 36 : 72);
  const pointRadius = isDenseSeries ? 0 : isMobile ? 0 : period === 'hour' ? 2 : 2.5;
  const tickFontSize = isMobile ? 10 : 11;
  const maxTickLabelCount = isMobile ? (period === 'hour' ? 7 : 5) : period === 'hour' ? 10 : 8;
  const shouldDecimate = labels.length > (isMobile ? 80 : 120);
  const yGridColor = isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(17, 24, 39, 0.08)';
  const xGridColor = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(17, 24, 39, 0.04)';
  const tickColor = isDark ? 'rgba(255, 255, 255, 0.7)' : 'rgba(17, 24, 39, 0.7)';
  const tooltipBg = isDark ? 'rgba(17, 24, 39, 0.92)' : 'rgba(255, 255, 255, 0.98)';
  const tooltipTitle = isDark ? '#ffffff' : '#111827';
  const tooltipBody = isDark ? 'rgba(255, 255, 255, 0.86)' : '#374151';
  const tooltipBorder = isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(17, 24, 39, 0.10)';

  return {
    responsive: true,
    maintainAspectRatio: false,
    normalized: true,
    animation: isDenseSeries
      ? false
      : {
          duration: 220,
          easing: 'easeOutQuart',
        },
    interaction: {
      mode: 'index',
      intersect: false,
    },
    layout: {
      padding: {
        top: 8,
        right: 10,
        bottom: 0,
        left: 4,
      },
    },
    plugins: {
      legend: { display: false },
      decimation: {
        enabled: shouldDecimate,
        algorithm: 'min-max',
        threshold: isMobile ? 80 : 120,
      },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        borderColor: tooltipBorder,
        borderWidth: 1,
        cornerRadius: 14,
        padding: 12,
        caretPadding: 10,
        boxPadding: 4,
        displayColors: true,
        usePointStyle: true,
      },
    },
    scales: {
      x: {
        grid: {
          color: xGridColor,
          drawTicks: false,
          tickLength: 0,
        },
        border: { display: false },
        ticks: {
          color: tickColor,
          font: { size: tickFontSize, weight: 600 },
          padding: 8,
          sampleSize: Math.max(maxTickLabelCount, 4),
          maxRotation: 0,
          minRotation: 0,
          autoSkip: true,
          maxTicksLimit: maxTickLabelCount,
          callback: (value) => {
            const index = typeof value === 'number' ? value : Number(value);
            const raw =
              Number.isFinite(index) && labels[index]
                ? labels[index]
                : typeof value === 'string'
                  ? value
                  : '';

            if (period === 'hour') {
              const [md, time] = raw.split(' ');
              if (!time) return raw;
              if (time.startsWith('00:')) {
                return md ? [md, time] : time;
              }
              return time;
            }

            if (isMobile) {
              const parts = raw.split('-');
              if (parts.length === 3) {
                return `${parts[1]}-${parts[2]}`;
              }
            }
            return raw;
          },
        },
      },
      y: {
        beginAtZero: true,
        grace: '6%',
        grid: {
          color: yGridColor,
          drawTicks: false,
          tickLength: 0,
        },
        border: { display: false },
        ticks: {
          color: tickColor,
          font: { size: tickFontSize, weight: 600 },
          padding: 10,
        },
      },
    },
    elements: {
      line: {
        tension: 0.35,
        borderWidth: isMobile ? 2 : 2.4,
        borderCapStyle: 'round',
        borderJoinStyle: 'round',
        cubicInterpolationMode: 'monotone',
      },
      point: {
        borderWidth: 2,
        radius: pointRadius,
        hoverRadius: isDenseSeries ? 4 : 5,
        hoverBorderWidth: 2.5,
        hitRadius: isDenseSeries ? 10 : 16,
      },
    },
  };
}

/**
 * Calculate minimum chart width for hourly data on mobile devices
 */
export function getHourChartMinWidth(labelCount: number, isMobile: boolean): string | undefined {
  if (!isMobile || labelCount <= 0) return undefined;
  const perPoint = 56;
  const minWidth = Math.min(labelCount * perPoint, 3000);
  return `${minWidth}px`;
}
