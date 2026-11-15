/**
 * Claude plan windows, extra usage, and separate read-only dollar balances.
 */

import { formatClaudeMoney, claudeExtraUsageNotes } from './presentation';

import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { ClaudeQuotaState } from '@/types';
import { buildResetDisplay, formatQuotaResetTime, resolveResetMs } from '@/utils/quota';
import { useNow } from '@/hooks/useNow';
import { NoFiveHourRow } from '../../components/NoFiveHourRow';
import { QuotaMeter } from '../../components/QuotaMeter';
import { QuotaResetLabel } from '../../components/QuotaResetLabel';
import { collectQuotaRowInstants, pickUrgentRowId } from '../../resetSchedule';
import type { QuotaBodyProps } from '../../types';
import { claudeQuotaRowSlots } from '@/domain/quotaWindows/claude';

export function ClaudeQuotaBody({
  quota,
  classes,
  planItems,
  afterPlan,
  factsInPanel = false,
  fixedSlots = false,
}: QuotaBodyProps<ClaudeQuotaState>) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const soonestRowId = useMemo(
    () => pickUrgentRowId(collectQuotaRowInstants('claude', quota), now),
    [quota, now]
  );
  const windows = quota.windows ?? [];
  // The server says the account has no 5-hour limit: that row says so instead of showing "–".
  const noFiveHour = quota.noFiveHourLimit === true;
  const extraUsage = quota.extraUsage ?? null;
  const planType = quota.planType ?? null;
  const language = i18n.resolvedLanguage;

  const extraUsageNotes = claudeExtraUsageNotes(extraUsage, t);
  // The notice under the rows in a fixed-slot host: above them it would push every row down.
  const staleNotice = quota.stale && (
    <div role="status" className={classes.codexResetCreditsError}>
      {t('claude_quota.stale_snapshot', {
        time: quota.observedAt ? new Date(quota.observedAt).toLocaleString(language) : '--',
      })}
    </div>
  );

  const windowRow = (
    window: ClaudeQuotaState['windows'][number],
    index: number,
    slotId?: string
  ) => {
    const used = window.usedPercent;
    const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
    const remaining = clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
    const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
    const windowLabel = window.labelKey ? t(window.labelKey) : window.label;
    const resetDisplay = buildResetDisplay(
      window.resetLabel,
      window.resetAtMs,
      now,
      i18n.resolvedLanguage
    );

    const soon = window.id === soonestRowId;

    return (
      <div
        key={window.id}
        className={classes.quotaRow}
        title={soon ? t('quota_management.soonest_row_hint') : undefined}
        {...(slotId ? { 'data-slot': slotId, 'data-slot-filled': '' } : {})}
      >
        <div className={classes.quotaRowHeader}>
          <span className={classes.quotaModel}>{windowLabel}</span>
          <div className={classes.quotaMeta}>
            <span className={classes.quotaPercent}>{percentLabel}</span>
            {resetDisplay && (
              <QuotaResetLabel display={resetDisplay} classes={classes} soon={soon} />
            )}
          </div>
        </div>
        <QuotaMeter percent={remaining} classes={classes} index={index} />
      </div>
    );
  };

  // A fixed-slot host renders every row kind in its canonical place: what the account does not
  // report is a placeholder of the same size, so rows stay level with its neighbours' rows.
  const slotRows = () => {
    const slots = claudeQuotaRowSlots();
    const known = new Set(slots.map((slot) => slot.id));
    return [
      ...slots.map((slot, index) => {
        const window = windows.find((candidate) => candidate.id === slot.id);
        if (slot.id === 'five-hour' && noFiveHour && window?.usedPercent == null)
          return (
            <NoFiveHourRow
              key={slot.id}
              labelKey={slot.labelKey}
              classes={classes}
              slotId={slot.id}
            />
          );
        if (window) return windowRow(window, index, slot.id);
        return (
          <div
            key={slot.id}
            className={classes.quotaRow}
            data-slot={slot.id}
            {...(slot.always ? {} : { 'data-slot-optional': '' })}
          >
            <div className={classes.quotaRowHeader}>
              <span className={classes.quotaModel}>{t(slot.labelKey)}</span>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaPercent}>–</span>
              </div>
            </div>
            <QuotaMeter percent={null} classes={classes} />
          </div>
        );
      }),
      ...windows
        .filter((window) => !known.has(window.id))
        .map((window, index) => windowRow(window, slots.length + index)),
    ];
  };

  return (
    <>
      {!fixedSlots && staleNotice}
      {(planType || fixedSlots || (!factsInPanel && planItems)) && (
        <div className={classes.codexPlan}>
          {(planType || fixedSlots) && (
            <span
              className={classes.codexPlanItem}
              {...(planType ? {} : { 'data-slot-empty': '' })}
            >
              <span className={classes.codexPlanLabel}>{t('claude_quota.plan_label')}</span>
              <span className={classes.codexPlanValue}>
                {planType ? t(`claude_quota.${planType}`) : '–'}
              </span>
            </span>
          )}
          {!factsInPanel && planItems}
        </div>
      )}
      {!factsInPanel && afterPlan}
      {/* Extra usage and dollar balances share the window-row anatomy:
          label + mono telemetry header, then one mono detail line. */}
      {!factsInPanel && extraUsage && (
        <div className={classes.quotaRow}>
          <div className={classes.quotaRowHeader}>
            <span className={classes.quotaModel}>{t('claude_quota.extra_usage_label')}</span>
            <div className={classes.quotaMeta}>
              <span className={classes.quotaPercent}>
                {t(
                  extraUsage.isEnabled === null
                    ? 'claude_quota.plan_unknown'
                    : extraUsage.isEnabled
                      ? 'claude_quota.extra_usage_enabled'
                      : 'claude_quota.extra_usage_disabled'
                )}
              </span>
              {extraUsage.utilization !== null && (
                <span className={classes.quotaResetRelative}>
                  {t('claude_quota.usage_utilization', { percent: extraUsage.utilization })}
                </span>
              )}
            </div>
          </div>
          <div className={classes.quotaAmount}>
            {t('claude_quota.usage_spent_limit', {
              // Extra-usage amounts are minor units; dollar windows are already dollars.
              spent: formatClaudeMoney(
                language,
                extraUsage.usedCredits,
                extraUsage.currency ?? 'USD',
                100
              ),
              limit: formatClaudeMoney(
                language,
                extraUsage.monthlyLimit,
                extraUsage.currency ?? 'USD',
                100
              ),
            })}
          </div>
          {extraUsageNotes.length > 0 && (
            <div className={classes.quotaMeta}>
              {extraUsageNotes.map((note, index) => (
                <span
                  key={note}
                  className={index === 0 ? classes.quotaReset : classes.quotaResetRelative}
                >
                  {note}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {!factsInPanel &&
        (quota.dollarWindows ?? []).map((balance) => {
          const resetDisplay = buildResetDisplay(
            formatQuotaResetTime(balance.resetsAt ?? undefined),
            resolveResetMs([balance.resetsAt]),
            now,
            language
          );
          return (
            <div key={balance.key} className={classes.quotaRow}>
              <div className={classes.quotaRowHeader}>
                <span className={classes.quotaModel} title={balance.key}>
                  {balance.key}
                </span>
                <div className={classes.quotaMeta}>
                  <span className={classes.quotaPercent}>
                    {t('claude_quota.dollar_balance_remaining', {
                      amount: formatClaudeMoney(language, balance.remainingDollars),
                    })}
                  </span>
                </div>
              </div>
              <div className={classes.quotaAmount}>
                {t('claude_quota.usage_spent_limit', {
                  spent: formatClaudeMoney(language, balance.usedDollars),
                  limit: formatClaudeMoney(language, balance.limitDollars),
                })}
              </div>
              <div className={classes.quotaMeta}>
                <span className={classes.quotaReset}>{t('claude_quota.balance_reset')}</span>
                {resetDisplay ? (
                  <QuotaResetLabel display={resetDisplay} classes={classes} />
                ) : (
                  <span className={classes.quotaReset}>
                    {t('claude_quota.balance_reset_unknown')}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      {fixedSlots ? (
        <>
          {slotRows()}
          {staleNotice}
        </>
      ) : windows.length === 0 && !noFiveHour && !extraUsage && !quota.dollarWindows?.length ? (
        <div className={classes.quotaMessage}>{t('claude_quota.empty_windows')}</div>
      ) : (
        <>
          {noFiveHour && !windows.some((window) => window.id === 'five-hour' && window.usedPercent !== null) && (
            <NoFiveHourRow labelKey="claude_quota.five_hour" classes={classes} />
          )}
          {windows
            .filter((window) => !(noFiveHour && window.id === 'five-hour' && window.usedPercent === null))
            .map((window, index) => windowRow(window, index))}
        </>
      )}
    </>
  );
}
