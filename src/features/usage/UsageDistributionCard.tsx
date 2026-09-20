import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { aggregateBreakdownRows, cleanAccountName, formatTokenCount } from './logic';
import type { BreakdownRow } from './types';
import styles from './UsagePage.module.scss';

interface UsageDistributionCardProps {
  title: string;
  dimension?: 'model' | 'account' | 'endpoint' | string;
  rows: BreakdownRow[];
  error?: string;
  onSelectKey?: (key: string) => void;
  selectedKey?: string;
}

const PALETTE = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#8b5cf6', // purple
  '#f59e0b', // amber
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#f97316', // orange
  '#6366f1', // indigo
];
const OTHER_COLOR = '#9ca3af';

const RADIUS = 38;
const STROKE_WIDTH = 14;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function UsageDistributionCard({
  title,
  dimension,
  rows,
  error = '',
  onSelectKey,
  selectedKey,
}: UsageDistributionCardProps) {
  const { t } = useTranslation();
  const [metric, setMetric] = useState<'tokens' | 'requests'>('tokens');
  const [showAll, setShowAll] = useState(false);

  const aggregated = useMemo(() => aggregateBreakdownRows(rows, 5, metric), [rows, metric]);
  const { displayed, totalTokens, totalRecords } = aggregated;

  const totalPrimary = metric === 'tokens' ? totalTokens : totalRecords;

  const itemsToRender = useMemo(() => {
    if (!showAll) return displayed;
    const sorted = [...rows].sort((a, b) => {
      if (metric === 'requests') {
        return b.records - a.records || b.total_tokens - a.total_tokens;
      }
      return b.total_tokens - a.total_tokens || b.records - a.records;
    });
    return sorted.map((r) => ({
      ...r,
      share:
        totalPrimary > 0
          ? (metric === 'tokens' ? r.total_tokens : r.records) / totalPrimary
          : 0,
      isOther: false,
    }));
  }, [displayed, rows, showAll, metric, totalPrimary]);

  const slices = useMemo(() => {
    return displayed.map((item, index) => {
      const share = Math.max(0, Math.min(1, item.share));
      const strokeDash = share * CIRCUMFERENCE;
      const strokeGap = CIRCUMFERENCE - strokeDash;
      const priorShare = displayed
        .slice(0, index)
        .reduce((sum, prev) => sum + Math.max(0, Math.min(1, prev.share)), 0);
      const strokeOffset = -(priorShare * CIRCUMFERENCE);
      const color = item.isOther ? OTHER_COLOR : PALETTE[index % PALETTE.length];
      return {
        ...item,
        color,
        strokeDasharray: `${strokeDash} ${strokeGap}`,
        strokeDashoffset: strokeOffset,
      };
    });
  }, [displayed]);

  const getLabel = (key: string, isOther?: boolean) => {
    if (isOther) return t('usage.distribution_other');
    if (!key || key.trim() === '') return t('usage.distribution_unknown');
    return cleanAccountName(key);
  };

  const getDimensionHeader = () => {
    if (dimension === 'model') return t('usage.model');
    if (dimension === 'account') return t('usage.account');
    if (dimension === 'endpoint') return t('usage.endpoint');
    return t('usage.distribution_name');
  };

  const extra = (
    <div className={styles.cardHeaderExtra}>
      <div className={styles.segmentedMini} role="group" aria-label={t('usage.metric_label')}>
        <button
          type="button"
          className={metric === 'tokens' ? styles.segmentMiniActive : styles.segmentMini}
          onClick={() => setMetric('tokens')}
        >
          {t('usage.distribution_by_tokens')}
        </button>
        <button
          type="button"
          className={metric === 'requests' ? styles.segmentMiniActive : styles.segmentMini}
          onClick={() => setMetric('requests')}
        >
          {t('usage.distribution_by_requests')}
        </button>
      </div>
    </div>
  );

  return (
    <Card title={title} extra={extra}>
      {error ? (
        <div className={styles.errorBanner}>{error}</div>
      ) : rows.length === 0 ? (
        <div className={styles.emptyChart}>{t('usage.no_data')}</div>
      ) : (
        <div className={styles.distributionWrap}>
          <div
            className={styles.donutContainer}
            role="img"
            aria-label={`${title} (${
              metric === 'tokens'
                ? `${formatTokenCount(totalTokens)} ${t('usage.tokens')}`
                : `${totalRecords.toLocaleString()} ${t('usage.requests')}`
            })`}
          >
            <svg
              viewBox="0 0 100 100"
              preserveAspectRatio="xMidYMid meet"
              className={styles.donutSvg}
              aria-hidden="true"
            >
              {/* Background circle */}
              <circle
                cx="50"
                cy="50"
                r={RADIUS}
                fill="none"
                stroke="var(--border-color)"
                strokeWidth={STROKE_WIDTH}
                opacity={0.3}
              />
              {totalPrimary > 0 ? (
                <g transform="rotate(-90 50 50)">
                  {slices.map((slice, i) => (
                    <circle
                      key={`${slice.key}-${i}`}
                      cx="50"
                      cy="50"
                      r={RADIUS}
                      fill="none"
                      stroke={slice.color}
                      strokeWidth={STROKE_WIDTH}
                      strokeDasharray={slice.strokeDasharray}
                      strokeDashoffset={slice.strokeDashoffset}
                      strokeLinecap="butt"
                    />
                  ))}
                </g>
              ) : null}
            </svg>
            <div className={styles.donutCenter}>
              {totalPrimary > 0 ? (
                <>
                  <span
                    className={styles.donutCenterValue}
                    title={
                      metric === 'tokens'
                        ? `${totalTokens.toLocaleString()} tokens`
                        : `${totalRecords.toLocaleString()} requests`
                    }
                  >
                    {metric === 'tokens'
                      ? formatTokenCount(totalTokens)
                      : totalRecords.toLocaleString()}
                  </span>
                  <span className={styles.donutCenterLabel}>
                    {metric === 'tokens' ? t('usage.tokens') : t('usage.requests')}
                  </span>
                </>
              ) : (
                <span className={styles.donutCenterLabel}>{t('usage.distribution_no_tokens')}</span>
              )}
            </div>
          </div>

          <div className={styles.distributionTableWrap}>
            <table className={styles.distributionTable}>
              <thead>
                <tr>
                  <th className={styles.thName}>{getDimensionHeader()}</th>
                  <th className={styles.thRecords}>{t('usage.requests')}</th>
                  <th className={styles.thTokens}>{t('usage.tokens')}</th>
                  <th className={styles.thShare}>{t('usage.distribution_share')}</th>
                </tr>
              </thead>
              <tbody>
                {itemsToRender.map((item, index) => {
                  const color = item.isOther
                    ? OTHER_COLOR
                    : PALETTE[index % PALETTE.length];
                  const label = getLabel(item.key, item.isOther);
                  const percent = (item.share * 100).toFixed(1);
                  const isSelected = selectedKey && selectedKey === label;
                  const isClickable = Boolean(onSelectKey && !item.isOther && item.key);
                  return (
                    <tr
                      key={`${item.key}-${index}`}
                      className={`${styles.distTableRow} ${
                        isSelected ? styles.distRowSelected : ''
                      } ${isClickable ? styles.distRowClickable : ''}`}
                      onClick={() => {
                        if (isClickable && onSelectKey) {
                          onSelectKey(label);
                        }
                      }}
                      role={isClickable ? 'button' : undefined}
                      tabIndex={isClickable ? 0 : undefined}
                      onKeyDown={(e) => {
                        if (isClickable && onSelectKey && (e.key === 'Enter' || e.key === ' ')) {
                          e.preventDefault();
                          onSelectKey(label);
                        }
                      }}
                      title={`${label}: ${item.records.toLocaleString()} ${t(
                        'usage.requests'
                      )}, ${item.total_tokens.toLocaleString()} tokens (${percent}%)`}
                    >
                      <td className={styles.tdName}>
                        <span className={styles.legendDot} style={{ backgroundColor: color }} />
                        <span className={styles.keyText} title={label}>
                          {label}
                        </span>
                      </td>
                      <td className={styles.tdRecords}>
                        {item.records.toLocaleString()}
                      </td>
                      <td
                        className={styles.tdTokens}
                        title={`${item.total_tokens.toLocaleString()} tokens`}
                      >
                        {formatTokenCount(item.total_tokens)}
                      </td>
                      <td className={styles.tdShare}>{percent}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {rows.length > 5 && (
              <button
                type="button"
                className={styles.legendToggle}
                onClick={() => setShowAll((prev) => !prev)}
              >
                {showAll ? t('usage.show_less') : t('usage.show_all')} ({rows.length})
              </button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
