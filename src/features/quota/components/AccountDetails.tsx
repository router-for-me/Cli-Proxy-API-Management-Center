import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Fact, FactPanel, FactSection, type FactState } from '@/components/ui/FactPanel';
import { BillingFacts } from '@/components/ui/FactPanel/BillingFacts';
import { useNow } from '@/hooks/useNow';
import type {
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  PluginQuotaState,
  XaiQuotaState,
} from '@/types';
import { parseIsoToMs } from '@/utils/quota';
import { formatPoolDate } from '@/features/quotaPool/presentation';
import type { QuotaCardState } from '../providers';
import type { QuotaProviderType } from '../providers/types';
import type { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import {
  claudeResetGrantName,
  groupClaudeResetGrants,
  remainingClaudeResetGrants,
} from '../providers/claude/presentation';
import { ClaudeBalanceFacts } from './ClaudeBalanceFacts';
import { formatMetric } from '../providers/plugin/presentation';
import { formatUsdFromCents, formatXaiProductPercent } from '../providers/xai/presentation';
import styles from './AccountDetails.module.scss';

type Props = {
  provider: QuotaProviderType;
  /** Absent when usage hasn't loaded; Claude's reset grants are read separately. */
  quota?: QuotaCardState;
  name: string;
  claudeReset?: ReturnType<typeof useClaudeResetGrants>;
  reset?: { disabled: boolean; onClick: () => void };
  /** The account is switched off: its resets are shown but cannot be used. */
  accountOff?: boolean;
  /** Starts expanded; the user can still collapse it. */
  defaultOpen?: boolean;
  /**
   * The host lays out cards side by side on a shared row grid: the summary and each section take
   * their own grid rows (see AccountDetails.module.scss), so the same section starts at the same
   * height on every card. The host places this element and gives it its rows.
   */
  rows?: boolean;
  /**
   * A card's tight layout: label and value on one line, the held count beside the reset status,
   * one row per reset grant and the unreported balances named once. Nothing is left out.
   */
  compact?: boolean;
};

/** Both quota hosts use this one disclosure and the same fact states. */
export function AccountDetails({
  provider,
  quota,
  name,
  claudeReset,
  reset,
  accountOff = false,
  defaultOpen,
  rows,
  compact = false,
}: Props) {
  const { t, i18n } = useTranslation();
  const now = useNow();
  const date = (value: number) => formatPoolDate(value, i18n.resolvedLanguage ?? i18n.language);
  const missing = (reason = 'account_details.not_reported_reason'): FactState => ({
    state: 'notReported',
    reason: t(reason),
  });
  const known = (value: string | number | null | undefined): FactState =>
    value == null ? missing() : { state: 'known', value };
  const dated = (value: number | null): FactState =>
    value == null ? missing() : { state: 'known', value: date(value) };
  const billing =
    provider === 'codex' || provider === 'claude'
      ? ((quota as CodexQuotaState | ClaudeQuotaState | undefined)?.billing ?? null)
      : null;
  const codex = provider === 'codex' && quota ? (quota as CodexQuotaState) : null;
  const claude = provider === 'claude' && quota ? (quota as ClaudeQuotaState) : null;
  const devin = provider === 'devin' && quota ? (quota as DevinQuotaState) : null;
  const xai = provider === 'xai' && quota ? (quota as XaiQuotaState).billing : null;
  const plugin = provider === 'plugin' && quota ? (quota as PluginQuotaState) : null;
  const held = codex ? codex.rateLimitResetCreditsAvailableCount : claudeReset?.count;
  const usualResetReason = claudeReset
    ? claudeReset.message
      ? t(`claude_reset.${claudeReset.message}`)
      : claudeReset.busy
        ? t('quota_pool.reset_loading')
        : claudeReset.blocked
          ? t(
              held == null
                ? claudeReset.served
                  ? 'quota_pool.reset_not_reported_reason'
                  : 'quota_pool.reset_loading'
                : 'quota_pool.reset_claude_unavailable'
            )
          : t('quota_pool.reset_usable')
    : held === 0
      ? t('quota_pool.reset_none')
      : reset?.disabled
        ? t('account_details.reset_disabled')
        : (held ?? 0) > 0
          ? t('quota_pool.reset_usable')
          : t('quota_pool.reset_not_reported_reason');
  const resetReason =
    accountOff && (held ?? 0) > 0 ? t('account_details.reset_account_off') : usualResetReason;
  const resetAction = claudeReset
    ? {
        label: t(
          claudeReset.buttonLabel === 'retry'
            ? 'claude_reset.retry'
            : claudeReset.buttonLabel === 'choose'
              ? 'claude_reset.choose_button'
              : 'quota_pool.use_reset'
        ),
        context: t('quota_pool.reset_action_context', { name }),
        disabled: claudeReset.blocked,
        onClick: claudeReset.confirm,
      }
    : reset && (held ?? 0) > 0
      ? {
          label: t('quota_pool.use_reset'),
          context: t('quota_pool.reset_action_context', { name }),
          ...reset,
        }
      : undefined;
  // Compact: the held count joins the status line under the action ("Usable now · 3 held").
  const heldInNote = compact && resetAction !== undefined && held != null;
  return (
    <details
      className={[styles.details, rows && styles.rows, compact && styles.compact]
        .filter(Boolean)
        .join(' ')}
      open={defaultOpen}
      style={
        {
          '--fact-accent':
            provider === 'claude'
              ? 'var(--claude-color)'
              : provider === 'codex'
                ? 'var(--codex-color)'
                : 'var(--text-secondary)',
        } as CSSProperties
      }
    >
      <summary>{t('account_details.title')}</summary>
      <FactPanel compact={compact}>
        <FactSection title={t('quota_pool.facts_billing')}>
          {(codex || claude) && (
            <BillingFacts
              billing={billing}
              nowMs={now}
              formatDate={date}
              fallback={
                codex
                  ? {
                      value: codex.subscriptionActiveUntil,
                      source: codex.subscriptionActiveUntilSource,
                    }
                  : undefined
              }
            />
          )}
          {codex && (
            <Fact
              label={t('codex_quota.credit_balance_label')}
              {...known(
                codex.creditsUnlimited ? t('codex_quota.credit_unlimited') : codex.creditBalance
              )}
            />
          )}
          {devin && <Fact label={t('quota_pool.billing_ends')} {...dated(devin.planEndMs)} />}
          {xai && (
            <>
              {xai.mode === 'paid-health' && (
                <Fact
                  label={t('account_details.status')}
                  state="known"
                  value={t('xai_quota.paid_health')}
                />
              )}
              <Fact
                label={t('xai_quota.pay_as_you_go_label')}
                {...known(
                  xai.onDemandCapCents == null
                    ? null
                    : xai.onDemandCapCents <= 0
                      ? t('xai_quota.pay_as_you_go_disabled')
                      : formatUsdFromCents(xai.onDemandCapCents)
                )}
              />
              <Fact
                label={t('xai_quota.prepaid')}
                {...known(
                  xai.prepaidBalanceCents == null
                    ? null
                    : formatUsdFromCents(xai.prepaidBalanceCents)
                )}
              />
            </>
          )}
          {!codex && !claude && !devin && !xai && (
            <Fact
              label={t('quota_pool.billing_status')}
              {...missing('quota_pool.billing_not_reported_reason')}
            />
          )}
        </FactSection>
        {(codex || claude || claudeReset) && (
          <FactSection
            title={t('quota_pool.resets')}
            tone="accent"
            {...(resetAction
              ? {
                  action: resetAction,
                  note: heldInNote
                    ? `${resetReason} · ${t('account_details.held', { count: held })}`
                    : resetReason,
                }
              : { action: undefined })}
          >
            {!heldInNote && (
              <Fact
                label={t('quota_pool.reset_held_label')}
                {...(held == null
                  ? missing('quota_pool.reset_not_reported_reason')
                  : known(held === 0 ? t('quota_pool.reset_none') : held))}
              />
            )}
            {codex?.rateLimitResetCredits?.map((credit, index) => (
              <Fact
                key={credit.id || index}
                label={t('account_details.reset_expires', { index: index + 1 })}
                {...dated(parseIsoToMs(credit.expiresAt))}
              />
            ))}
            {codex?.rateLimitResetCreditsError && (
              <Fact
                label={t('account_details.expiry')}
                state="notReported"
                reason={codex.rateLimitResetCreditsError}
              />
            )}
            {!compact &&
              remainingClaudeResetGrants(claudeReset?.grants ?? []).map((grant) => (
                <Fact
                  key={grant.id}
                  label={claudeResetGrantName(grant, t)}
                  {...(parseIsoToMs(grant.endsAt) === null
                    ? missing('claude_reset.expiry_unknown')
                    : {
                        state: 'known',
                        value: date(parseIsoToMs(grant.endsAt)!),
                        aside: t('claude_reset.count', {
                          left: grant.resetsLeft,
                          total: grant.resetsTotal,
                        }),
                      })}
                />
              ))}
            {/* Compact: a row of kind badge and expiry per group of resets that end together,
                then one muted line with what is left and the upstream descriptions, cut short
                with the whole text as its tooltip. */}
            {compact &&
              groupClaudeResetGrants(remainingClaudeResetGrants(claudeReset?.grants ?? []), t).map(
                (row) => {
                  const left = t('claude_reset.count_short', { left: row.left, total: row.total });
                  return (
                    <Fact
                      key={row.id}
                      label={
                        <span className={styles.grantKind} data-kind={row.kind}>
                          {t(`claude_reset.kind_${row.kind}`)}
                          {row.count > 1 && ` × ${row.count}`}
                        </span>
                      }
                      note={[left, ...row.descriptions].join(' · ')}
                      clampNote
                      {...(row.at === null
                        ? missing('claude_reset.expiry_unknown')
                        : { state: 'known', value: date(row.at) })}
                    />
                  );
                }
              )}
          </FactSection>
        )}
        {claude && <ClaudeBalanceFacts quota={claude} formatDate={date} compact={compact} />}
        {plugin && plugin.summary.length > 0 && (
          <FactSection title={t('account_details.balances')}>
            {plugin.summary.map((metric) => (
              <Fact
                key={metric.key}
                label={metric.label}
                state="known"
                value={formatMetric(metric)}
              />
            ))}
          </FactSection>
        )}
        {xai && xai.productUsage.length > 0 && (
          <FactSection title={t('xai_quota.usage_breakdown')}>
            {xai.productUsage.map((item) => (
              <Fact
                key={item.product}
                label={item.product}
                {...known(formatXaiProductPercent(item.usagePercent))}
              />
            ))}
          </FactSection>
        )}
      </FactPanel>
    </details>
  );
}
