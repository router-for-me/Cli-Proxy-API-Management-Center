import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconTarget } from '@/components/ui/icons';
import {
  calculateSLAMetrics,
  getStatusColor,
  getStatusLabel,
  getTierLabel,
  getOverallSLAStatus,
  type SubscriptionTier,
  type SLAMetrics
} from '@/utils/usage/slaCalculator';
import type { UsageDetail } from '@/utils/usage';
import { formatPercent } from '@/utils/numberFormat';
import styles from '@/pages/UsagePage.module.scss';
import cardStyles from './StatCards.module.scss';

interface SLAMonitorCardProps {
  tier: SubscriptionTier;
  successCount: number;
  failureCount: number;
  details: UsageDetail[];
  loading: boolean;
  monthlyFee?: number;
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  const color = getStatusColor(status as 'met' | 'at_risk' | 'breached');
  
  return (
    <span className={cardStyles.statusBadge} style={{ color }}>
      {status === 'met' ? '✅' : status === 'at_risk' ? '⚠️' : '❌'} {label}
    </span>
  );
}

function SLAMetricRow({
  label,
  current,
  target,
  status,
  format = 'percent'
}: {
  label: string;
  current: number;
  target: number;
  status: string;
  format?: 'percent' | 'time' | 'number';
}) {
  const color = getStatusColor(status as 'met' | 'at_risk' | 'breached');
  const statusLabel = getStatusLabel(status as 'met' | 'at_risk' | 'breached');
  
  const formatValue = (val: number, fmt: string): string => {
    if (target === 0) return '--';
    switch (fmt) {
      case 'percent':
        return formatPercent(val);
      case 'time':
        return val < 1000 ? `${val}ms` : `${(val / 1000).toFixed(1)}s`;
      default:
        return val.toLocaleString();
    }
  };
  
  const progress = target > 0 ? Math.min((current / target) * 100, 100) : 100;
  
  return (
    <div className={cardStyles.slaMetricRow}>
      <div className={cardStyles.slaMetricHeader}>
        <span className={cardStyles.slaMetricLabel}>{label}</span>
        <StatusBadge status={status} label={statusLabel} />
      </div>
      <div className={cardStyles.slaMetricValues}>
        <span className={cardStyles.slaMetricCurrent}>
          {formatValue(current, format)}
        </span>
        {target > 0 && (
          <span className={cardStyles.slaMetricTarget}>
            / {formatValue(target, format)}
          </span>
        )}
      </div>
      {target > 0 && (
        <div className={cardStyles.slaProgressBar}>
          <div
            className={cardStyles.slaProgressFill}
            style={{ width: `${progress}%`, backgroundColor: color }}
          />
        </div>
      )}
    </div>
  );
}

export function SLAMonitorCard({
  tier,
  successCount,
  failureCount,
  details,
  loading,
  monthlyFee
}: SLAMonitorCardProps) {
  const { t } = useTranslation();
  
  const slaMetrics: SLAMetrics = loading
    ? {
        tier,
        commitments: {
          availability: { target: 0, current: 1, status: 'met' },
          successRate: { target: 0, current: 1, status: 'met' },
          responseTime: { target: 0, current: 0, status: 'met' },
          recoveryTime: { target: 0, current: 0, status: 'met' }
        },
        remainingBudget: { downtime: 0, errors: 0 },
        compensation: { eligible: false, amount: 0, percentage: 0, description: '' },
        hasData: false
      }
    : calculateSLAMetrics(tier, successCount, failureCount, details, monthlyFee);
  
  const showCard = !loading && slaMetrics.hasData && tier !== 'free';
  
  if (!showCard) {
    return null;
  }
  
  const overallStatus = getOverallSLAStatus(slaMetrics.commitments);
  const overallColor = getStatusColor(overallStatus);
  const tierLabel = getTierLabel(tier, t);
  
  return (
    <div
      className={`${styles.statCard} ${cardStyles.slaMonitorCard}`}
      style={
        {
          '--accent': overallColor,
          '--accent-soft': `${overallColor}20`,
          '--accent-border': `${overallColor}50`
        } as CSSProperties
      }
    >
      <div className={styles.statCardHeader}>
        <div className={styles.statLabelGroup}>
          <span className={styles.statLabel}>{t('sla.title')}</span>
        </div>
        <span className={styles.statIconBadge}><IconTarget size={16} /></span>
      </div>
      
      <div className={cardStyles.slaContent}>
        <div className={cardStyles.tierSection}>
          <span className={cardStyles.tierLabel}>{t('sla.tier')}</span>
          <span className={cardStyles.tierValue}>
            {tierLabel}
            {tier === 'pro' && ' ⭐'}
            {tier === 'enterprise' && ' ⭐⭐'}
          </span>
        </div>
        
        <div className={cardStyles.slaMetricsSection}>
          <SLAMetricRow
            label={t('sla.availability')}
            current={slaMetrics.commitments.availability.current}
            target={slaMetrics.commitments.availability.target}
            status={slaMetrics.commitments.availability.status}
          />
          <SLAMetricRow
            label={t('sla.success_rate')}
            current={slaMetrics.commitments.successRate.current}
            target={slaMetrics.commitments.successRate.target}
            status={slaMetrics.commitments.successRate.status}
          />
          <SLAMetricRow
            label={t('sla.response_time')}
            current={slaMetrics.commitments.responseTime.current}
            target={slaMetrics.commitments.responseTime.target}
            status={slaMetrics.commitments.responseTime.status}
            format="time"
          />
        </div>
        
        <div className={cardStyles.slaFooter}>
          <div className={cardStyles.budgetSection}>
            <span className={cardStyles.budgetLabel}>{t('sla.remaining_budget')}</span>
            <div className={cardStyles.budgetValues}>
              <span className={cardStyles.budgetItem}>
                {t('sla.downtime')}: {slaMetrics.remainingBudget.downtime} {t('sla.minutes')}
              </span>
              <span className={cardStyles.budgetItem}>
                {t('sla.errors')}: {slaMetrics.remainingBudget.errors}
              </span>
            </div>
          </div>
          
          {slaMetrics.compensation.eligible && (
            <div className={cardStyles.compensationSection}>
              <span className={cardStyles.compensationLabel}>
                {t('sla.compensation')}
              </span>
              <span className={cardStyles.compensationValue}>
                ${slaMetrics.compensation.amount.toFixed(2)} ({slaMetrics.compensation.percentage}%)
              </span>
            </div>
          )}
          
          <div className={cardStyles.overallStatus}>
            <span style={{ color: overallColor }}>
              {overallStatus === 'met' ? '🟢' : overallStatus === 'at_risk' ? '🟡' : '🔴'}{' '}
              {t('sla.overall_status')}: {getStatusLabel(overallStatus, t)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
