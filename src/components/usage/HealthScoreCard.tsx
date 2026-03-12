import { type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconHeart } from '@/components/ui/icons';
import {
  calculateHealthScore,
  getGradeColor,
  getGradeLabel,
  type HealthScore
} from '@/utils/usage/healthScore';
import type { UsageDetail } from '@/utils/usage';
import { formatPercent } from '@/utils/numberFormat';
import styles from '@/pages/UsagePage.module.scss';
import cardStyles from './StatCards.module.scss';

interface HealthScoreCardProps {
  successCount: number;
  failureCount: number;
  details: UsageDetail[];
  loading: boolean;
}

function ScoreRing({ score, color }: { score: number; grade: string; color: string }) {
  const circumference = 2 * Math.PI * 36;
  const strokeDashoffset = circumference - (score / 100) * circumference;
  
  return (
    <div className={cardStyles.scoreRingContainer}>
      <svg className={cardStyles.scoreRingSvg} viewBox="0 0 80 80">
        <circle
          className={cardStyles.scoreRingBg}
          cx="40"
          cy="40"
          r="36"
          fill="none"
          strokeWidth="6"
        />
        <circle
          className={cardStyles.scoreRingProgress}
          cx="40"
          cy="40"
          r="36"
          fill="none"
          strokeWidth="6"
          stroke={color}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <div className={cardStyles.scoreRingText}>
        <span className={cardStyles.scoreValue}>{score}</span>
      </div>
    </div>
  );
}

function MetricRow({
  label,
  value,
  score,
  grade,
  color
}: {
  label: string;
  value: number;
  score: number;
  grade: string;
  color: string;
}) {
  return (
    <div className={cardStyles.metricRow}>
      <div className={cardStyles.metricInfo}>
        <span className={cardStyles.metricLabel}>{label}</span>
        <span className={cardStyles.metricValue}>{formatPercent(value)}</span>
      </div>
      <div className={cardStyles.metricBar}>
        <div
          className={cardStyles.metricBarFill}
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
      <span className={cardStyles.metricGrade} style={{ color }}>
        {grade}
      </span>
    </div>
  );
}

export function HealthScoreCard({ successCount, failureCount, details, loading }: HealthScoreCardProps) {
  const { t } = useTranslation();
  
  const healthScore: HealthScore = loading
    ? {
        overall: 0,
        grade: 'poor',
        metrics: {
          successRate: { value: 0, score: 0, grade: 'poor' },
          stability: { value: 0, score: 0, grade: 'poor' },
          responsiveness: { value: 0, score: 0, grade: 'poor' }
        },
        trend: 'stable',
        consecutiveDays: 0,
        hasData: false
      }
    : calculateHealthScore(successCount, failureCount, details);
  
  const showCard = !loading && healthScore.hasData;
  
  if (!showCard) {
    return null;
  }
  
  const color = getGradeColor(healthScore.grade);
  const gradeLabel = getGradeLabel(healthScore.grade, t);
  
  const trendIcon = healthScore.trend === 'up' ? '↑' : healthScore.trend === 'down' ? '↓' : '→';
  const trendLabel = healthScore.trend === 'up' 
    ? t('health.trend_up') 
    : healthScore.trend === 'down' 
      ? t('health.trend_down') 
      : t('health.trend_stable');
  
  return (
    <div
      className={`${styles.statCard} ${cardStyles.healthScoreCard}`}
      style={
        {
          '--accent': color,
          '--accent-soft': `${color}20`,
          '--accent-border': `${color}50`
        } as CSSProperties
      }
    >
      <div className={styles.statCardHeader}>
        <div className={styles.statLabelGroup}>
          <span className={styles.statLabel}>{t('health.title')}</span>
        </div>
        <span className={styles.statIconBadge}><IconHeart size={16} /></span>
      </div>
      
      <div className={cardStyles.healthScoreContent}>
        <div className={cardStyles.scoreSection}>
          <ScoreRing
            score={healthScore.overall}
            grade={healthScore.grade}
            color={color}
          />
          <div className={cardStyles.scoreInfo}>
            <span className={cardStyles.scoreGrade} style={{ color }}>
              {gradeLabel}
            </span>
            <span className={cardStyles.scoreTrend}>
              {trendIcon} {trendLabel}
            </span>
          </div>
        </div>
        
        <div className={cardStyles.metricsSection}>
          <MetricRow
            label={t('health.success_rate')}
            value={healthScore.metrics.successRate.value}
            score={healthScore.metrics.successRate.score}
            grade={getGradeLabel(healthScore.metrics.successRate.grade, t)}
            color={getGradeColor(healthScore.metrics.successRate.grade)}
          />
          <MetricRow
            label={t('health.stability')}
            value={healthScore.metrics.stability.value}
            score={healthScore.metrics.stability.score}
            grade={getGradeLabel(healthScore.metrics.stability.grade, t)}
            color={getGradeColor(healthScore.metrics.stability.grade)}
          />
          <MetricRow
            label={t('health.responsiveness')}
            value={healthScore.metrics.responsiveness.value}
            score={healthScore.metrics.responsiveness.score}
            grade={getGradeLabel(healthScore.metrics.responsiveness.grade, t)}
            color={getGradeColor(healthScore.metrics.responsiveness.grade)}
          />
        </div>
        
        {healthScore.consecutiveDays > 0 && (
          <div className={cardStyles.healthFooter}>
            <span className={cardStyles.consecutiveDays}>
              {t('health.consecutive_days', { days: healthScore.consecutiveDays })}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
