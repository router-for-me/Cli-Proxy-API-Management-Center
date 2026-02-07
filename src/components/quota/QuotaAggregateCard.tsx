/**
 * Aggregate quota card component - shows averaged quota across all credentials.
 */

import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import type {
  AntigravityQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  AggregatedAntigravityGroup,
  AggregatedCodexWindow,
  AggregatedGeminiCliBucket,
  ResolvedTheme,
} from '@/types';
import { TYPE_COLORS } from '@/utils/quota';
import {
  aggregateAntigravityQuota,
  aggregateCodexQuota,
  aggregateGeminiCliQuota,
} from '@/utils/quota';
import { formatQuotaResetTime } from '@/utils/quota';
import { QuotaProgressBar, type QuotaStatusState } from './QuotaCard';
import type { QuotaConfig } from './quotaConfigs';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaType = 'antigravity' | 'codex' | 'gemini-cli';

interface QuotaAggregateCardProps<TState extends QuotaStatusState, TData = unknown> {
  quotaMap: Record<string, TState>;
  config: QuotaConfig<TState, TData>;
  resolvedTheme: ResolvedTheme;
  loading: boolean;
  fileCount: number;
}

const CARD_CLASS_MAP: Record<QuotaType, string> = {
  antigravity: styles.aggregateCardAntigravity,
  codex: styles.aggregateCardCodex,
  'gemini-cli': styles.aggregateCardGeminiCli,
};

function formatResetRange(
  range: { earliest: string; latest: string } | null,
  formatFn: (time: string | undefined) => string
): string {
  if (!range) return '-';
  const earliest = formatFn(range.earliest);
  const latest = formatFn(range.latest);
  if (earliest === latest) return earliest;
  return `${earliest} – ${latest}`;
}

function renderAntigravityAggregate(
  groups: AggregatedAntigravityGroup[],
  t: TFunction
): React.ReactNode {
  if (groups.length === 0) {
    return <div className={styles.quotaMessage}>{t('quota_management.no_data_for_aggregate')}</div>;
  }

  return groups.map((group) => {
    const percent = Math.round(Math.max(0, Math.min(1, group.averageRemainingFraction)) * 100);
    const resetLabel = formatResetRange(group.resetTimeRange, formatQuotaResetTime);

    return (
      <div key={group.id} className={styles.quotaRow}>
        <div className={styles.quotaRowHeader}>
          <span className={styles.quotaModel} title={group.models.join(', ')}>
            {group.label}
            <span className={styles.credentialCountBadge}>{group.credentialCount}</span>
          </span>
          <div className={styles.quotaMeta}>
            <span className={styles.quotaPercent}>{percent}%</span>
            <span className={styles.quotaReset}>{resetLabel}</span>
          </div>
        </div>
        <QuotaProgressBar percent={percent} highThreshold={60} mediumThreshold={20} />
      </div>
    );
  });
}

function renderCodexAggregate(
  windows: AggregatedCodexWindow[],
  t: TFunction
): React.ReactNode {
  if (windows.length === 0) {
    return <div className={styles.quotaMessage}>{t('quota_management.no_data_for_aggregate')}</div>;
  }

  return windows.map((window) => {
    const remaining = window.averageRemainingPercent;
    const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
    const resetLabel = formatResetRange(window.resetLabelRange, (label) => label || '');
    const windowLabel = window.labelKey ? t(window.labelKey) : window.label;

    return (
      <div key={window.id} className={styles.quotaRow}>
        <div className={styles.quotaRowHeader}>
          <span className={styles.quotaModel}>
            {windowLabel}
            <span className={styles.credentialCountBadge}>{window.credentialCount}</span>
          </span>
          <div className={styles.quotaMeta}>
            <span className={styles.quotaPercent}>{percentLabel}</span>
            <span className={styles.quotaReset}>{resetLabel}</span>
          </div>
        </div>
        <QuotaProgressBar percent={remaining} highThreshold={80} mediumThreshold={50} />
      </div>
    );
  });
}

function renderGeminiCliAggregate(
  buckets: AggregatedGeminiCliBucket[],
  t: TFunction
): React.ReactNode {
  if (buckets.length === 0) {
    return <div className={styles.quotaMessage}>{t('quota_management.no_data_for_aggregate')}</div>;
  }

  return buckets.map((bucket) => {
    const fraction = bucket.averageRemainingFraction;
    const percent = fraction === null ? null : Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    const percentLabel = percent === null ? '--' : `${percent}%`;
    const resetLabel = formatResetRange(bucket.resetTimeRange, formatQuotaResetTime);
    const titleBase =
      bucket.modelIds && bucket.modelIds.length > 0 ? bucket.modelIds.join(', ') : bucket.label;
    const title = bucket.tokenType ? `${titleBase} (${bucket.tokenType})` : titleBase;

    return (
      <div key={bucket.id} className={styles.quotaRow}>
        <div className={styles.quotaRowHeader}>
          <span className={styles.quotaModel} title={title}>
            {bucket.label}
            <span className={styles.credentialCountBadge}>{bucket.credentialCount}</span>
          </span>
          <div className={styles.quotaMeta}>
            <span className={styles.quotaPercent}>{percentLabel}</span>
            <span className={styles.quotaReset}>{resetLabel}</span>
          </div>
        </div>
        <QuotaProgressBar percent={percent} highThreshold={60} mediumThreshold={20} />
      </div>
    );
  });
}

export function QuotaAggregateCard<TState extends QuotaStatusState, TData>({
  quotaMap,
  config,
  resolvedTheme,
  loading,
  fileCount,
}: QuotaAggregateCardProps<TState, TData>) {
  const { t } = useTranslation();

  const aggregatedData = useMemo(() => {
    if (config.type === 'antigravity') {
      return aggregateAntigravityQuota(quotaMap as unknown as Record<string, AntigravityQuotaState>);
    } else if (config.type === 'codex') {
      return aggregateCodexQuota(quotaMap as unknown as Record<string, CodexQuotaState>);
    } else if (config.type === 'gemini-cli') {
      return aggregateGeminiCliQuota(quotaMap as unknown as Record<string, GeminiCliQuotaState>);
    }
    return [];
  }, [quotaMap, config.type]);

  // Count credentials by status
  const quotaValues = useMemo(() => Object.values(quotaMap), [quotaMap]);
  const quotaMapSize = quotaValues.length;
  const successCount = useMemo(
    () => quotaValues.filter((q) => q.status === 'success').length,
    [quotaValues]
  );
  const loadingCount = useMemo(
    () => quotaValues.filter((q) => q.status === 'loading').length,
    [quotaValues]
  );

  // Don't show aggregate card if only one credential - averaging one item is pointless
  if (fileCount <= 1) {
    return null;
  }

  // Show aggregate card if:
  // 1. There are files AND quotaMap is empty or all idle (initial state before any refresh)
  // 2. OR there are successful credentials
  // 3. OR currently loading
  const isInitialState = fileCount > 0 && (quotaMapSize === 0 || successCount === 0);
  const hasSuccessData = successCount > 0;
  const isLoading = loading || loadingCount > 0;

  if (!isInitialState && !hasSuccessData && !isLoading) {
    return null;
  }

  const cardClassName = CARD_CLASS_MAP[config.type] || styles.aggregateCard;
  const typeColorSet = TYPE_COLORS[config.type] || TYPE_COLORS.unknown;
  const typeColor = resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const renderContent = () => {
    if (isLoading) {
      return <div className={styles.quotaMessage}>{t('quota_management.loading_aggregate')}</div>;
    }

    if (isInitialState) {
      return <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.idle`)}</div>;
    }

    if (config.type === 'antigravity') {
      return renderAntigravityAggregate(aggregatedData as AggregatedAntigravityGroup[], t);
    } else if (config.type === 'codex') {
      return renderCodexAggregate(aggregatedData as AggregatedCodexWindow[], t);
    } else if (config.type === 'gemini-cli') {
      return renderGeminiCliAggregate(aggregatedData as AggregatedGeminiCliBucket[], t);
    }

    return null;
  };

  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <div className={cardClassName}>
      <div className={styles.cardHeader}>
        <span
          className={styles.typeBadge}
          style={{
            backgroundColor: typeColor.bg,
            color: typeColor.text,
            ...(typeColor.border ? { border: typeColor.border } : {}),
          }}
        >
          {getTypeLabel(config.type)}
        </span>
        <span className={styles.fileName}>{t('quota_management.aggregate_title')}</span>
      </div>

      <div className={styles.quotaSection}>{renderContent()}</div>
    </div>
  );
}
