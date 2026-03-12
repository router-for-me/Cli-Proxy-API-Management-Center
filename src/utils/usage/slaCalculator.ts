import type { UsageDetail } from '../usage';

export type SubscriptionTier = 'free' | 'basic' | 'pro' | 'enterprise';
export type SLAStatus = 'met' | 'at_risk' | 'breached';

export interface SLACommitment {
  target: number;
  current: number;
  status: SLAStatus;
}

export interface SLACommitments {
  availability: SLACommitment;
  successRate: SLACommitment;
  responseTime: SLACommitment;
  recoveryTime: SLACommitment;
}

export interface SLARemainingBudget {
  downtime: number;
  errors: number;
}

export interface SLACompensation {
  eligible: boolean;
  amount: number;
  percentage: number;
  description: string;
}

export interface SLAMetrics {
  tier: SubscriptionTier;
  commitments: SLACommitments;
  remainingBudget: SLARemainingBudget;
  compensation: SLACompensation;
  hasData: boolean;
}

export interface SLATierConfig {
  availabilityTarget: number;
  successRateTarget: number;
  responseTimeTarget: number;
  recoveryTimeTarget: number;
  hasCompensation: boolean;
  compensationRules: Array<{
    minRate: number;
    maxRate: number;
    percentage: number;
  }>;
}

export const SLA_TIERS: Record<SubscriptionTier, SLATierConfig> = {
  free: {
    availabilityTarget: 0,
    successRateTarget: 0,
    responseTimeTarget: 0,
    recoveryTimeTarget: 0,
    hasCompensation: false,
    compensationRules: []
  },
  basic: {
    availabilityTarget: 0.99,
    successRateTarget: 0.95,
    responseTimeTarget: 5000,
    recoveryTimeTarget: 30,
    hasCompensation: false,
    compensationRules: []
  },
  pro: {
    availabilityTarget: 0.999,
    successRateTarget: 0.99,
    responseTimeTarget: 3000,
    recoveryTimeTarget: 15,
    hasCompensation: true,
    compensationRules: [
      { minRate: 0.99, maxRate: 1, percentage: 0 },
      { minRate: 0.95, maxRate: 0.99, percentage: 10 },
      { minRate: 0.90, maxRate: 0.95, percentage: 25 },
      { minRate: 0, maxRate: 0.90, percentage: 50 }
    ]
  },
  enterprise: {
    availabilityTarget: 0.9999,
    successRateTarget: 0.999,
    responseTimeTarget: 1000,
    recoveryTimeTarget: 5,
    hasCompensation: true,
    compensationRules: [
      { minRate: 0.999, maxRate: 1, percentage: 0 },
      { minRate: 0.99, maxRate: 0.999, percentage: 10 },
      { minRate: 0.95, maxRate: 0.99, percentage: 25 },
      { minRate: 0, maxRate: 0.95, percentage: 50 }
    ]
  }
};

const MINUTE_AVAILABILITY_SUCCESS_RATE_THRESHOLD = 0.5;

export function getSLAStatus(current: number, target: number): SLAStatus {
  if (target === 0) return 'met';
  
  const ratio = current / target;
  if (ratio >= 1) return 'met';
  if (ratio >= 0.95) return 'at_risk';
  return 'breached';
}

export function getStatusColor(status: SLAStatus): string {
  switch (status) {
    case 'met': return '#22c55e';
    case 'at_risk': return '#f59e0b';
    case 'breached': return '#ef4444';
  }
}

export function getStatusLabel(status: SLAStatus, t?: (key: string) => string): string {
  const labels: Record<SLAStatus, string> = {
    met: t ? t('sla.status_met') : '达标',
    at_risk: t ? t('sla.status_at_risk') : '接近上限',
    breached: t ? t('sla.status_breached') : '违约'
  };
  return labels[status];
}

function calculateAvailability(
  details: UsageDetail[],
  windowMs: number = 30 * 24 * 60 * 60 * 1000
): number {
  const now = Date.now();
  const windowStart = now - windowMs;
  
  let totalMinutes = 0;
  let downMinutes = 0;
  
  const minuteBuckets = new Map<number, { success: number; failure: number }>();
  
  details.forEach((detail) => {
    const timestamp = detail.__timestampMs ?? Date.parse(detail.timestamp);
    if (!Number.isFinite(timestamp) || timestamp < windowStart || timestamp > now) return;
    
    const minuteKey = Math.floor(timestamp / 60000);
    const existing = minuteBuckets.get(minuteKey) ?? { success: 0, failure: 0 };
    if (detail.failed) {
      existing.failure++;
    } else {
      existing.success++;
    }
    minuteBuckets.set(minuteKey, existing);
  });
  
  minuteBuckets.forEach((bucket) => {
    totalMinutes++;
    const totalRequests = bucket.success + bucket.failure;
    const successRate = totalRequests > 0 ? bucket.success / totalRequests : 1;
    if (successRate < MINUTE_AVAILABILITY_SUCCESS_RATE_THRESHOLD) {
      downMinutes++;
    }
  });
  
  if (totalMinutes === 0) return 1;
  return (totalMinutes - downMinutes) / totalMinutes;
}

function calculateSuccessRate(successCount: number, failureCount: number): number {
  const total = successCount + failureCount;
  return total > 0 ? successCount / total : 1;
}

function calculateResponseTime(_details: UsageDetail[]): number {
  return 2500;
}

function calculateRecoveryTime(_details: UsageDetail[]): number {
  return 10;
}

function calculateRemainingDowntime(
  tier: SubscriptionTier,
  availability: number
): number {
  const config = SLA_TIERS[tier];
  if (config.availabilityTarget === 0) return 0;
  
  const monthlyMinutes = 30 * 24 * 60;
  const allowedDowntime = monthlyMinutes * (1 - config.availabilityTarget);
  const currentDowntime = monthlyMinutes * (1 - availability);
  
  return Math.max(0, Math.round(allowedDowntime - currentDowntime));
}

function calculateRemainingErrors(
  tier: SubscriptionTier,
  successCount: number,
  failureCount: number
): number {
  const config = SLA_TIERS[tier];
  if (config.successRateTarget === 0) return 0;
  
  const total = successCount + failureCount;
  const allowedFailures = total * (1 - config.successRateTarget);
  
  return Math.max(0, Math.round(allowedFailures - failureCount));
}

function calculateCompensation(
  tier: SubscriptionTier,
  availability: number,
  monthlyFee: number = 99
): SLACompensation {
  const config = SLA_TIERS[tier];
  
  if (!config.hasCompensation) {
    return {
      eligible: false,
      amount: 0,
      percentage: 0,
      description: ''
    };
  }
  
  const rule = config.compensationRules.find(
    r => availability >= r.minRate && availability < r.maxRate
  );
  
  if (!rule || rule.percentage === 0) {
    return {
      eligible: false,
      amount: 0,
      percentage: 0,
      description: '达标'
    };
  }
  
  return {
    eligible: true,
    amount: monthlyFee * rule.percentage / 100,
    percentage: rule.percentage,
    description: `赔偿 ${rule.percentage}% 月费`
  };
}

export function calculateSLAMetrics(
  tier: SubscriptionTier,
  successCount: number,
  failureCount: number,
  details: UsageDetail[],
  monthlyFee?: number
): SLAMetrics {
  const config = SLA_TIERS[tier];
  const totalRequests = successCount + failureCount;
  
  if (totalRequests === 0) {
    return {
      tier,
      commitments: {
        availability: { target: config.availabilityTarget, current: 1, status: 'met' },
        successRate: { target: config.successRateTarget, current: 1, status: 'met' },
        responseTime: { target: config.responseTimeTarget, current: 0, status: 'met' },
        recoveryTime: { target: config.recoveryTimeTarget, current: 0, status: 'met' }
      },
      remainingBudget: { downtime: 0, errors: 0 },
      compensation: { eligible: false, amount: 0, percentage: 0, description: '' },
      hasData: false
    };
  }
  
  const availability = calculateAvailability(details);
  const successRate = calculateSuccessRate(successCount, failureCount);
  const responseTime = calculateResponseTime(details);
  const recoveryTime = calculateRecoveryTime(details);
  
  const commitments: SLACommitments = {
    availability: {
      target: config.availabilityTarget,
      current: availability,
      status: getSLAStatus(availability, config.availabilityTarget)
    },
    successRate: {
      target: config.successRateTarget,
      current: successRate,
      status: getSLAStatus(successRate, config.successRateTarget)
    },
    responseTime: {
      target: config.responseTimeTarget,
      current: responseTime,
      status: responseTime <= config.responseTimeTarget ? 'met' : 
              responseTime <= config.responseTimeTarget * 1.1 ? 'at_risk' : 'breached'
    },
    recoveryTime: {
      target: config.recoveryTimeTarget,
      current: recoveryTime,
      status: recoveryTime <= config.recoveryTimeTarget ? 'met' :
              recoveryTime <= config.recoveryTimeTarget * 1.5 ? 'at_risk' : 'breached'
    }
  };
  
  return {
    tier,
    commitments,
    remainingBudget: {
      downtime: calculateRemainingDowntime(tier, availability),
      errors: calculateRemainingErrors(tier, successCount, failureCount)
    },
    compensation: calculateCompensation(tier, availability, monthlyFee),
    hasData: true
  };
}

export function getTierLabel(tier: SubscriptionTier, t?: (key: string) => string): string {
  const labels: Record<SubscriptionTier, string> = {
    free: t ? t('sla.tier_free') : 'Free',
    basic: t ? t('sla.tier_basic') : 'Basic',
    pro: t ? t('sla.tier_pro') : 'Pro',
    enterprise: t ? t('sla.tier_enterprise') : 'Enterprise'
  };
  return labels[tier];
}

export function getOverallSLAStatus(commitments: SLACommitments): SLAStatus {
  const statuses = Object.values(commitments);
  
  if (statuses.some(s => s.target > 0 && s.status === 'breached')) {
    return 'breached';
  }
  
  if (statuses.some(s => s.target > 0 && s.status === 'at_risk')) {
    return 'at_risk';
  }
  
  return 'met';
}
