/**
 * Cursor 额度渲染体：套餐 chip 行、包含额度水位条、按模型消费明细。
 */

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CursorQuotaState } from '@/types';
import { buildResetDisplay, formatCursorCents, formatQuotaResetTime } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import {
  CURSOR_AGENT_ROW_ID,
  CURSOR_INCLUDED_ROW_ID,
  collectQuotaRowInstants,
  pickUrgentRowId,
} from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';

/**
 * Cursor's plan-level percentages arrive as fractions of a percent, small
 * enough that rounding to whole numbers erases them entirely. One decimal is
 * kept below 10% so a real number never renders as a flat zero.
 */
const formatPercent = (value: number | null): string => {
  if (value === null) return '--';
  if (value > 0 && value < 10) return `${value.toFixed(1)}%`;
  return `${Math.round(value)}%`;
};

export function CursorQuotaBody({ quota, classes }: QuotaBodyProps<CursorQuotaState>) {
  const { t, i18n } = useTranslation();
  // Ahead of the early return below — hooks cannot be conditional.
  const now = useNow();
  const urgentRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('cursor', quota), now),
    [quota, now]
  );
  const includedSoon = urgentRowId === CURSOR_INCLUDED_ROW_ID;
  const agentSoon = urgentRowId === CURSOR_AGENT_ROW_ID;

  const summary = quota.summary;
  if (!summary) {
    return <div className={classes.quotaMessage}>{t('cursor_quota.empty_data')}</div>;
  }

  const amountLabel =
    summary.limitCents === null
      ? formatCursorCents(summary.remainingCents)
      : `${formatCursorCents(summary.remainingCents ?? (summary.limitCents - (summary.usedCents ?? 0)))} / ${formatCursorCents(summary.limitCents)}`;

  const resetLabel = formatQuotaResetTime(
    summary.cycleEndMs === null ? undefined : new Date(summary.cycleEndMs).toISOString()
  );
  const resetDisplay = buildResetDisplay(
    resetLabel === '-' ? null : t('cursor_quota.reset_at', { time: resetLabel }),
    summary.cycleEndMs,
    now,
    i18n.resolvedLanguage
  );

  const agentResetLabel = formatQuotaResetTime(
    summary.agent?.resetAtMs == null ? undefined : new Date(summary.agent.resetAtMs).toISOString()
  );
  const agentResetDisplay = buildResetDisplay(
    agentResetLabel === '-' ? null : t('cursor_quota.reset_at', { time: agentResetLabel }),
    summary.agent?.resetAtMs ?? null,
    now,
    i18n.resolvedLanguage
  );

  const hasIncluded = summary.limitCents !== null || summary.usedCents !== null;

  return (
    <>
      {summary.planName && (
        <div className={classes.codexPlan}>
          <span className={classes.codexPlanItem}>
            <span className={classes.codexPlanLabel}>{t('cursor_quota.plan_label')}</span>
            <span className={classes.codexPlanValue}>{summary.planName}</span>
          </span>
          {summary.planPrice && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('cursor_quota.price_label')}</span>
              <span className={classes.codexPlanValue}>{summary.planPrice}</span>
            </span>
          )}
        </div>
      )}

      {hasIncluded && (
        <div
          className={classes.quotaRow}
          title={includedSoon ? t('quota_management.soonest_row_hint') : undefined}
        >
          <div className={classes.quotaRowHeader}>
            <span className={classes.quotaModel}>{t('cursor_quota.included_usage')}</span>
            <div className={classes.quotaMeta}>
              <span className={classes.quotaPercent}>{formatPercent(summary.remainingPercent)}</span>
              {resetDisplay && (
                <QuotaResetLabel display={resetDisplay} classes={classes} soon={includedSoon} />
              )}
            </div>
          </div>
          <QuotaMeter percent={summary.remainingPercent} classes={classes} index={0} />
          <div className={classes.quotaAmount}>{amountLabel}</div>
        </div>
      )}

      {summary.agent && (
        <div
          className={classes.quotaRow}
          title={agentSoon ? t('quota_management.soonest_row_hint') : undefined}
        >
          <div className={classes.quotaRowHeader}>
            <span className={classes.quotaModel}>{t('cursor_quota.agent_usage')}</span>
            <div className={classes.quotaMeta}>
              <span className={classes.quotaPercent}>
                {formatPercent(summary.agent.remainingPercent)}
              </span>
              {agentResetDisplay && (
                <QuotaResetLabel display={agentResetDisplay} classes={classes} soon={agentSoon} />
              )}
            </div>
          </div>
          <QuotaMeter percent={summary.agent.remainingPercent} classes={classes} index={1} />
          {summary.agent.exhausted && (
            <div className={classes.quotaMessage}>{t('cursor_quota.agent_exhausted')}</div>
          )}
        </div>
      )}

      {(summary.autoPercentUsed !== null || summary.apiPercentUsed !== null || summary.fastRequestQuota !== null) && (
        <div className={classes.codexPlan}>
          {summary.autoPercentUsed !== null && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('cursor_quota.auto_used')}</span>
              <span className={classes.codexPlanValue}>{formatPercent(summary.autoPercentUsed)}</span>
            </span>
          )}
          {summary.apiPercentUsed !== null && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('cursor_quota.api_used')}</span>
              <span className={classes.codexPlanValue}>{formatPercent(summary.apiPercentUsed)}</span>
            </span>
          )}
          {summary.fastRequestQuota !== null && (
            <span className={classes.codexPlanItem}>
              <span className={classes.codexPlanLabel}>{t('cursor_quota.fast_requests')}</span>
              <span className={classes.codexPlanValue}>
                {summary.fastRequestQuota.toLocaleString()}
              </span>
            </span>
          )}
        </div>
      )}

      {summary.models.length > 0 && (
        <>
          <div className={classes.codexResetCreditsTitle}>
            {t('cursor_quota.by_model', { amount: formatCursorCents(summary.totalSpendCents) })}
          </div>
          {summary.models.map((model) => (
            <div key={model.model} className={classes.codexResetCreditRow}>
              <span className={classes.codexResetCreditLabel}>{model.model}</span>
              <span className={classes.codexResetCreditTime}>{formatCursorCents(model.cents)}</span>
            </div>
          ))}
        </>
      )}
    </>
  );
}
