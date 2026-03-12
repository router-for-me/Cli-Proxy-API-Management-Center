import { useMemo, type CSSProperties, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Line } from 'react-chartjs-2';
import { IconDiamond, IconDollarSign, IconSatellite, IconTimer, IconTrendingUp, IconZap } from '@/components/ui/icons';
import { TokenNumber, CostNumber, RateNumber } from '@/components/ui/SmartNumber';
import {
  formatCompactNumber,
  calculateCost,
  collectUsageDetails,
  extractTotalTokens,
  type ModelPrice,
  type UsageDetail
} from '@/utils/usage';
import { formatPercent } from '@/utils/numberFormat';
import { sparklineOptions } from '@/utils/usage/chartConfig';
import type { UsagePayload } from './hooks/useUsageData';
import type { SparklineBundle } from './hooks/useSparklines';
import { HealthScoreCard } from './HealthScoreCard';
import { SLAMonitorCard } from './SLAMonitorCard';
import type { SubscriptionTier } from '@/utils/usage/slaCalculator';
import styles from '@/pages/UsagePage.module.scss';
import cardStyles from './StatCards.module.scss';

interface StatCardData {
  key: string;
  label: string;
  icon: ReactNode;
  accent: string;
  accentSoft: string;
  accentBorder: string;
  value: string | ReactNode;
  meta?: ReactNode;
  trend: SparklineBundle | null;
  enhanced?: boolean;
}

export interface StatCardsProps {
  usage: UsagePayload | null;
  loading: boolean;
  modelPrices: Record<string, ModelPrice>;
  nowMs: number;
  sparklines: {
    requests: SparklineBundle | null;
    tokens: SparklineBundle | null;
    rpm: SparklineBundle | null;
    tpm: SparklineBundle | null;
    cost: SparklineBundle | null;
  };
  subscriptionTier?: SubscriptionTier;
}

export function StatCards({ usage, loading, modelPrices, nowMs, sparklines, subscriptionTier = 'pro' }: StatCardsProps) {
  const { t } = useTranslation();

  const hasPrices = Object.keys(modelPrices).length > 0;

  const { tokenBreakdown, rateStats, totalCost, tokenEfficiency, details } = useMemo(() => {
    const empty = {
      tokenBreakdown: { cachedTokens: 0, reasoningTokens: 0, inputTokens: 0, outputTokens: 0 },
      rateStats: { rpm: 0, tpm: 0, windowMinutes: 30, requestCount: 0, tokenCount: 0, peakRpm: 0, peakTpm: 0 },
      totalCost: 0,
      tokenEfficiency: { cacheHitRate: 0, outputEfficiency: 0, costEfficiency: 0 },
      details: [] as UsageDetail[]
    };

    if (!usage) return empty;
    const details = collectUsageDetails(usage);
    if (!details.length) return { ...empty, details };

    let cachedTokens = 0;
    let reasoningTokens = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let totalCost = 0;

    const now = nowMs;
    const windowMinutes = 30;
    const windowStart = now - windowMinutes * 60 * 1000;
    let requestCount = 0;
    let tokenCount = 0;
    const hasValidNow = Number.isFinite(now) && now > 0;

    // 用于计算峰值速率
    const minuteBuckets = new Map<number, { requests: number; tokens: number }>();

    details.forEach((detail) => {
      const tokens = detail.tokens;
      const cached = Math.max(
        typeof tokens.cached_tokens === 'number' ? Math.max(tokens.cached_tokens, 0) : 0,
        typeof tokens.cache_tokens === 'number' ? Math.max(tokens.cache_tokens, 0) : 0
      );
      cachedTokens += cached;
      if (typeof tokens.reasoning_tokens === 'number') {
        reasoningTokens += tokens.reasoning_tokens;
      }
      if (typeof tokens.input_tokens === 'number') {
        inputTokens += tokens.input_tokens;
      }
      if (typeof tokens.output_tokens === 'number') {
        outputTokens += tokens.output_tokens;
      }

      const timestamp = detail.__timestampMs ?? 0;
      if (hasValidNow && Number.isFinite(timestamp) && timestamp >= windowStart && timestamp <= now) {
        requestCount += 1;
        tokenCount += extractTotalTokens(detail);

        // 按分钟分桶计算峰值
        const minuteKey = Math.floor(timestamp / 60000);
        const existing = minuteBuckets.get(minuteKey);
        if (existing) {
          existing.requests += 1;
          existing.tokens += extractTotalTokens(detail);
        } else {
          minuteBuckets.set(minuteKey, { requests: 1, tokens: extractTotalTokens(detail) });
        }
      }

      if (hasPrices) {
        totalCost += calculateCost(detail, modelPrices);
      }
    });

    // 计算峰值
    let peakRpm = 0;
    let peakTpm = 0;
    minuteBuckets.forEach((bucket) => {
      peakRpm = Math.max(peakRpm, bucket.requests);
      peakTpm = Math.max(peakTpm, bucket.tokens);
    });

    const denominator = windowMinutes > 0 ? windowMinutes : 1;

    // 计算Token效率指标
    const totalInputTokens = inputTokens + cachedTokens;
    const totalTokens = inputTokens + outputTokens + cachedTokens + reasoningTokens;
    const cacheHitRate = totalInputTokens > 0 ? cachedTokens / totalInputTokens : 0;
    const outputEfficiency = totalTokens > 0 ? outputTokens / totalTokens : 0;
    const costEfficiency = totalCost > 0 ? outputTokens / totalCost : 0;

    return {
      tokenBreakdown: { cachedTokens, reasoningTokens, inputTokens, outputTokens },
      rateStats: {
        rpm: requestCount / denominator,
        tpm: tokenCount / denominator,
        windowMinutes,
        requestCount,
        tokenCount,
        peakRpm,
        peakTpm
      },
      totalCost,
      tokenEfficiency: { cacheHitRate, outputEfficiency, costEfficiency },
      details
    };
  }, [hasPrices, modelPrices, nowMs, usage]);

  const statsCards: StatCardData[] = [
    {
      key: 'requests',
      label: t('usage_stats.total_requests'),
      icon: <IconSatellite size={16} />,
      accent: '#8b8680',
      accentSoft: 'rgba(139, 134, 128, 0.18)',
      accentBorder: 'rgba(139, 134, 128, 0.35)',
      value: loading ? '-' : (usage?.total_requests ?? 0).toLocaleString(),
      meta: (
        <>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#10b981' }} />
            {t('usage_stats.success_requests')}: {loading ? '-' : (usage?.success_count ?? 0)}
          </span>
          <span className={styles.statMetaItem}>
            <span className={styles.statMetaDot} style={{ backgroundColor: '#c65746' }} />
            {t('usage_stats.failed_requests')}: {loading ? '-' : (usage?.failure_count ?? 0)}
          </span>
        </>
      ),
      trend: sparklines.requests
    },
    {
      key: 'tokens',
      label: t('usage_stats.total_tokens'),
      icon: <IconDiamond size={16} />,
      accent: '#8b5cf6',
      accentSoft: 'rgba(139, 92, 246, 0.18)',
      accentBorder: 'rgba(139, 92, 246, 0.35)',
      value: loading ? '-' : <TokenNumber value={usage?.total_tokens ?? 0} />,
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.cached_tokens')}: {loading ? '-' : <TokenNumber value={tokenBreakdown.cachedTokens} />}
          </span>
          <span className={styles.statMetaItem}>
            {t('usage_stats.reasoning_tokens')}: {loading ? '-' : <TokenNumber value={tokenBreakdown.reasoningTokens} />}
          </span>
        </>
      ),
      trend: sparklines.tokens
    },
    {
      key: 'rpm',
      label: t('usage_stats.rpm_30m'),
      icon: <IconTimer size={16} />,
      accent: '#22c55e',
      accentSoft: 'rgba(34, 197, 94, 0.18)',
      accentBorder: 'rgba(34, 197, 94, 0.32)',
      value: loading ? '-' : <RateNumber value={rateStats.rpm} />,
      meta: (
        <div className={cardStyles.enhancedMeta}>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.current')}</span>
            <span className={cardStyles.rateValue}><RateNumber value={rateStats.rpm} /></span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.peak')}</span>
            <span className={cardStyles.rateValue}><RateNumber value={rateStats.peakRpm} /></span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.total_requests')}</span>
            <span className={cardStyles.rateValue}>{rateStats.requestCount.toLocaleString()}</span>
          </div>
        </div>
      ),
      trend: sparklines.rpm,
      enhanced: true
    },
    {
      key: 'tpm',
      label: t('usage_stats.tpm_30m'),
      icon: <IconTrendingUp size={16} />,
      accent: '#f97316',
      accentSoft: 'rgba(249, 115, 22, 0.18)',
      accentBorder: 'rgba(249, 115, 22, 0.32)',
      value: loading ? '-' : <RateNumber value={rateStats.tpm} />,
      meta: (
        <div className={cardStyles.enhancedMeta}>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.current')}</span>
            <span className={cardStyles.rateValue}><RateNumber value={rateStats.tpm} /></span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.peak')}</span>
            <span className={cardStyles.rateValue}><RateNumber value={rateStats.peakTpm} /></span>
          </div>
          <div className={cardStyles.rateRow}>
            <span className={cardStyles.rateLabel}>{t('usage_stats.total_tokens')}</span>
            <span className={cardStyles.rateValue}><TokenNumber value={rateStats.tokenCount} /></span>
          </div>
        </div>
      ),
      trend: sparklines.tpm,
      enhanced: true
    },
    {
      key: 'cost',
      label: t('usage_stats.total_cost'),
      icon: <IconDollarSign size={16} />,
      accent: '#f59e0b',
      accentSoft: 'rgba(245, 158, 11, 0.18)',
      accentBorder: 'rgba(245, 158, 11, 0.32)',
      value: loading ? '-' : hasPrices ? <CostNumber value={totalCost} /> : '--',
      meta: (
        <>
          <span className={styles.statMetaItem}>
            {t('usage_stats.total_tokens')}: {loading ? '-' : <TokenNumber value={usage?.total_tokens ?? 0} />}
          </span>
          {!hasPrices && (
            <span className={`${styles.statMetaItem} ${styles.statSubtle}`}>
              {t('usage_stats.cost_need_price')}
            </span>
          )}
        </>
      ),
      trend: hasPrices ? sparklines.cost : null
    }
  ];

  // Token效率卡片（仅在有数据时显示）
  const showEfficiencyCard = !loading && (tokenBreakdown.cachedTokens > 0 || tokenBreakdown.outputTokens > 0);

  return (
    <div className={styles.statsGrid}>
      {statsCards.map((card) => (
        <div
          key={card.key}
          className={`${styles.statCard} ${card.enhanced ? cardStyles.enhancedCard : ''}`}
          style={
            {
              '--accent': card.accent,
              '--accent-soft': card.accentSoft,
              '--accent-border': card.accentBorder
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{card.label}</span>
            </div>
            <span className={styles.statIconBadge}>{card.icon}</span>
          </div>
          <div className={styles.statValue}>{card.value}</div>
          {card.meta && <div className={styles.statMetaRow}>{card.meta}</div>}
          <div className={styles.statTrend}>
            {card.trend ? (
              <Line className={styles.sparkline} data={card.trend.data} options={sparklineOptions} />
            ) : (
              <div className={styles.statTrendPlaceholder}></div>
            )}
          </div>
        </div>
      ))}

      {/* Token效率卡片 */}
      {showEfficiencyCard && (
        <div
          className={`${styles.statCard} ${cardStyles.efficiencyCard}`}
          style={
            {
              '--accent': '#06b6d4',
              '--accent-soft': 'rgba(6, 182, 212, 0.18)',
              '--accent-border': 'rgba(6, 182, 212, 0.35)'
            } as CSSProperties
          }
        >
          <div className={styles.statCardHeader}>
            <div className={styles.statLabelGroup}>
              <span className={styles.statLabel}>{t('usage_stats.token_efficiency')}</span>
            </div>
            <span className={styles.statIconBadge}><IconZap size={16} /></span>
          </div>
          <div className={cardStyles.efficiencyGrid}>
            <div className={cardStyles.efficiencyItem}>
              <span className={cardStyles.efficiencyLabel}>{t('usage_stats.cache_hit_rate')}</span>
              <span className={cardStyles.efficiencyValue}>{formatPercent(tokenEfficiency.cacheHitRate)}</span>
              <div className={cardStyles.progressBar}>
                <div
                  className={cardStyles.progressFill}
                  style={{
                    width: `${Math.min(tokenEfficiency.cacheHitRate * 100, 100)}%`,
                    backgroundColor: tokenEfficiency.cacheHitRate > 0.5 ? '#22c55e' : '#f59e0b'
                  }}
                />
              </div>
            </div>
            <div className={cardStyles.efficiencyItem}>
              <span className={cardStyles.efficiencyLabel}>{t('usage_stats.output_efficiency')}</span>
              <span className={cardStyles.efficiencyValue}>{formatPercent(tokenEfficiency.outputEfficiency)}</span>
              <div className={cardStyles.progressBar}>
                <div
                  className={cardStyles.progressFill}
                  style={{
                    width: `${Math.min(tokenEfficiency.outputEfficiency * 100, 100)}%`,
                    backgroundColor: tokenEfficiency.outputEfficiency > 0.3 ? '#22c55e' : '#f59e0b'
                  }}
                />
              </div>
            </div>
            {hasPrices && tokenEfficiency.costEfficiency > 0 && (
              <div className={cardStyles.efficiencyItem}>
                <span className={cardStyles.efficiencyLabel}>{t('usage_stats.cost_efficiency')}</span>
                <span className={cardStyles.efficiencyValue}>
                  {formatCompactNumber(tokenEfficiency.costEfficiency)} tokens/$
                </span>
                <div className={cardStyles.progressBar}>
                  <div
                    className={cardStyles.progressFill}
                    style={{
                      width: `${Math.min((tokenEfficiency.costEfficiency / 100000) * 100, 100)}%`,
                      backgroundColor: tokenEfficiency.costEfficiency > 50000 ? '#22c55e' : '#f59e0b'
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <HealthScoreCard
        successCount={usage?.success_count ?? 0}
        failureCount={usage?.failure_count ?? 0}
        details={details}
        loading={loading}
      />

      <SLAMonitorCard
        tier={subscriptionTier}
        successCount={usage?.success_count ?? 0}
        failureCount={usage?.failure_count ?? 0}
        details={details}
        loading={loading}
      />
    </div>
  );
}
