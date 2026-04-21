import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { DeferredRender } from '@/components/common/DeferredRender';
import styles from '@/pages/UsagePage.module.scss';
import { DeferredUsageCard } from './DeferredUsageCard';
import { CostTrendChart } from './CostTrendChart';
import { LatencyTrendChart } from './LatencyTrendChart';
import { TokenBreakdownChart } from './TokenBreakdownChart';
import { UsageSectionIntro } from './UsageSectionIntro';
import type { UsagePayload } from './hooks/useUsageData';
import type { ModelPrice } from '@/utils/usage';

export interface UsageAnalysisSectionProps {
  usage: UsagePayload | null;
  loading: boolean;
  isDark: boolean;
  isMobile: boolean;
  hourWindowHours?: number;
  modelPrices: Record<string, ModelPrice>;
}

export const UsageAnalysisSection = memo(function UsageAnalysisSection({
  usage,
  loading,
  isDark,
  isMobile,
  hourWindowHours,
  modelPrices,
}: UsageAnalysisSectionProps) {
  const { t } = useTranslation();
  const deferredChartCaption = t('usage_stats.render_on_demand');

  return (
    <section className={styles.section}>
      <UsageSectionIntro
        title={t('usage_stats.analysis_title')}
        description={t('usage_stats.analysis_desc')}
      />
      <div className={styles.analysisGrid}>
        <DeferredRender
          className={styles.deferredBlock}
          minHeight={380}
          placeholder={
            <DeferredUsageCard
              title={t('usage_stats.latency_trend')}
              caption={deferredChartCaption}
            />
          }
        >
          <LatencyTrendChart
            usage={usage}
            loading={loading}
            isDark={isDark}
            isMobile={isMobile}
            hourWindowHours={hourWindowHours}
          />
        </DeferredRender>

        <DeferredRender
          className={styles.deferredBlock}
          minHeight={380}
          placeholder={
            <DeferredUsageCard title={t('usage_stats.cost_trend')} caption={deferredChartCaption} />
          }
        >
          <CostTrendChart
            usage={usage}
            loading={loading}
            isDark={isDark}
            isMobile={isMobile}
            modelPrices={modelPrices}
            hourWindowHours={hourWindowHours}
          />
        </DeferredRender>

        <DeferredRender
          className={styles.deferredBlock}
          minHeight={380}
          placeholder={
            <DeferredUsageCard
              title={t('usage_stats.token_breakdown')}
              caption={deferredChartCaption}
            />
          }
        >
          <TokenBreakdownChart
            usage={usage}
            loading={loading}
            isDark={isDark}
            isMobile={isMobile}
            hourWindowHours={hourWindowHours}
          />
        </DeferredRender>
      </div>
    </section>
  );
});

UsageAnalysisSection.displayName = 'UsageAnalysisSection';
