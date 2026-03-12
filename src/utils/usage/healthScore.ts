import type { UsageDetail } from '../usage';

export type HealthGrade = 'excellent' | 'good' | 'fair' | 'poor';
export type HealthTrend = 'up' | 'stable' | 'down';

export interface MetricScore {
  value: number;
  score: number;
  grade: HealthGrade;
}

export interface HealthScoreMetrics {
  successRate: MetricScore;
  stability: MetricScore;
  responsiveness: MetricScore;
}

export interface HealthScore {
  overall: number;
  grade: HealthGrade;
  metrics: HealthScoreMetrics;
  trend: HealthTrend;
  consecutiveDays: number;
  hasData: boolean;
}

const GRADE_THRESHOLDS = {
  excellent: { min: 90, color: '#22c55e' },
  good: { min: 70, color: '#84cc16' },
  fair: { min: 50, color: '#f59e0b' },
  poor: { min: 0, color: '#ef4444' }
};

export function getGrade(score: number): HealthGrade {
  if (score >= 90) return 'excellent';
  if (score >= 70) return 'good';
  if (score >= 50) return 'fair';
  return 'poor';
}

export function getGradeColor(grade: HealthGrade): string {
  return GRADE_THRESHOLDS[grade].color;
}

export function getGradeLabel(grade: HealthGrade, t?: (key: string) => string): string {
  const labels: Record<HealthGrade, string> = {
    excellent: t ? t('health.excellent') : '优秀',
    good: t ? t('health.good') : '良好',
    fair: t ? t('health.fair') : '一般',
    poor: t ? t('health.poor') : '较差'
  };
  return labels[grade];
}

function calculateSuccessRateScore(successCount: number, failureCount: number): MetricScore {
  const total = successCount + failureCount;
  const value = total > 0 ? successCount / total : 1;
  const score = Math.round(value * 100);
  return {
    value,
    score,
    grade: getGrade(score)
  };
}

function calculateStabilityScore(
  details: UsageDetail[],
  windowMs: number = 24 * 60 * 60 * 1000
): MetricScore {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  const hourBuckets = new Map<number, { success: number; failure: number }>();
  
  details.forEach((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) return;
    
    const hourKey = Math.floor(timestamp / (60 * 60 * 1000));
    const existing = hourBuckets.get(hourKey) ?? { success: 0, failure: 0 };
    if (detail.failed) {
      existing.failure += 1;
    } else {
      existing.success += 1;
    }
    hourBuckets.set(hourKey, existing);
  });
  
  if (hourBuckets.size < 2) {
    return { value: 1, score: 100, grade: 'excellent' };
  }
  
  const errorRates: number[] = [];
  hourBuckets.forEach((bucket) => {
    const total = bucket.success + bucket.failure;
    if (total > 0) {
      errorRates.push(bucket.failure / total);
    }
  });
  
  if (errorRates.length < 2) {
    return { value: 1, score: 100, grade: 'excellent' };
  }
  
  const mean = errorRates.reduce((a, b) => a + b, 0) / errorRates.length;
  const variance = errorRates.reduce((sum, rate) => sum + Math.pow(rate - mean, 2), 0) / errorRates.length;
  const stdDev = Math.sqrt(variance);
  
  const stabilityValue = mean > 0 ? Math.max(0, 1 - stdDev / mean) : 1;
  const score = Math.round(stabilityValue * 100);
  
  return {
    value: stabilityValue,
    score,
    grade: getGrade(score)
  };
}

function calculateResponsivenessScore(
  details: UsageDetail[],
  windowMs: number = 24 * 60 * 60 * 1000
): MetricScore {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  const hourBuckets = new Map<number, number>();
  
  details.forEach((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) return;
    
    const hourKey = Math.floor(timestamp / (60 * 60 * 1000));
    hourBuckets.set(hourKey, (hourBuckets.get(hourKey) ?? 0) + 1);
  });
  
  if (hourBuckets.size < 2) {
    return { value: 1, score: 100, grade: 'excellent' };
  }
  
  const counts = Array.from(hourBuckets.values());
  const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
  const variance = counts.reduce((sum, c) => sum + Math.pow(c - mean, 2), 0) / counts.length;
  const stdDev = Math.sqrt(variance);
  const cv = mean > 0 ? stdDev / mean : 0;
  
  const responsivenessValue = Math.max(0, 1 - cv);
  const score = Math.round(responsivenessValue * 100);
  
  return {
    value: responsivenessValue,
    score,
    grade: getGrade(score)
  };
}

function calculateTrend(
  details: UsageDetail[],
  windowMs: number = 7 * 24 * 60 * 60 * 1000
): HealthTrend {
  const now = Date.now();
  const midPoint = now - windowMs / 2;
  const windowStart = now - windowMs;
  
  let recentSuccess = 0;
  let recentFailure = 0;
  let earlierSuccess = 0;
  let earlierFailure = 0;
  
  details.forEach((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) return;
    
    if (timestamp >= midPoint) {
      if (detail.failed) recentFailure++;
      else recentSuccess++;
    } else {
      if (detail.failed) earlierFailure++;
      else earlierSuccess++;
    }
  });
  
  const recentTotal = recentSuccess + recentFailure;
  const earlierTotal = earlierSuccess + earlierFailure;
  
  if (recentTotal < 10 || earlierTotal < 10) return 'stable';
  
  const recentRate = recentSuccess / recentTotal;
  const earlierRate = earlierSuccess / earlierTotal;
  const diff = recentRate - earlierRate;
  
  if (diff > 0.02) return 'up';
  if (diff < -0.02) return 'down';
  return 'stable';
}

function calculateConsecutiveDays(details: UsageDetail[]): number {
  if (!details.length) return 0;
  
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const todayStart = now.getTime();
  
  const dayHasFailure = new Map<number, boolean>();
  
  details.forEach((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp);
    if (!Number.isFinite(timestamp)) return;
    
    const dayKey = Math.floor(timestamp / (24 * 60 * 60 * 1000));
    if (detail.failed) {
      dayHasFailure.set(dayKey, true);
    } else if (!dayHasFailure.has(dayKey)) {
      dayHasFailure.set(dayKey, false);
    }
  });
  
  let consecutiveDays = 0;
  for (let i = 0; i < 30; i++) {
    const dayStart = todayStart - i * 24 * 60 * 60 * 1000;
    const dayKey = Math.floor(dayStart / (24 * 60 * 60 * 1000));
    const hasFailure = dayHasFailure.get(dayKey);
    
    if (hasFailure === undefined) break;
    if (hasFailure) break;
    consecutiveDays++;
  }
  
  return consecutiveDays;
}

export function calculateHealthScore(
  successCount: number,
  failureCount: number,
  details: UsageDetail[]
): HealthScore {
  const totalRequests = successCount + failureCount;
  
  if (totalRequests === 0) {
    return {
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
    };
  }
  
  const successRateMetric = calculateSuccessRateScore(successCount, failureCount);
  const stabilityMetric = calculateStabilityScore(details);
  const responsivenessMetric = calculateResponsivenessScore(details);
  
  const overall = Math.round(
    successRateMetric.score * 0.5 +
    stabilityMetric.score * 0.3 +
    responsivenessMetric.score * 0.2
  );
  
  return {
    overall,
    grade: getGrade(overall),
    metrics: {
      successRate: successRateMetric,
      stability: stabilityMetric,
      responsiveness: responsivenessMetric
    },
    trend: calculateTrend(details),
    consecutiveDays: calculateConsecutiveDays(details),
    hasData: true
  };
}
