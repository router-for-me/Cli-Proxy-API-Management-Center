/**
 * Per-provider summary tiles shown above the quota sections.
 *
 * Each tile doubles as a filter: clicking one shows only that provider, so a
 * provider further down the page is one click away instead of a long scroll.
 * Clicking the active tile clears the filter.
 */

import { useTranslation } from 'react-i18next';
import type { CSSProperties } from 'react';
import { TYPE_COLORS } from '@/utils/quota';
import type { ResolvedTheme, ThemeColors } from '@/types';
import type { QuotaProviderSummary, QuotaProviderKey } from './quotaSummary';
import { AT_RISK_THRESHOLD } from './quotaSummary';
import styles from '@/pages/QuotaPage.module.scss';
import local from './QuotaSummaryTiles.module.scss';

const HIGH_THRESHOLD = 70;

/** Mini list rows before collapsing the tail into a "+N more" line. */
const MAX_MINI_ACCOUNTS = 5;

function barClass(percent: number | null): string {
  if (percent === null) return styles.quotaBarFillMedium;
  if (percent >= HIGH_THRESHOLD) return styles.quotaBarFillHigh;
  if (percent >= AT_RISK_THRESHOLD) return styles.quotaBarFillMedium;
  return styles.quotaBarFillLow;
}

export interface QuotaSummaryTilesProps {
  summaries: QuotaProviderSummary[];
  activeProvider: QuotaProviderKey | 'all';
  onSelect: (provider: QuotaProviderKey | 'all') => void;
  resolvedTheme: ResolvedTheme;
  labelFor: (provider: QuotaProviderKey) => string;
}

export function QuotaSummaryTiles({
  summaries,
  activeProvider,
  onSelect,
  resolvedTheme,
  labelFor,
}: QuotaSummaryTilesProps) {
  const { t } = useTranslation();

  const visible = summaries.filter((summary) => summary.total > 0);
  if (visible.length === 0) return null;

  return (
    <div className={styles.summaryTiles}>
      {visible.map((summary) => {
        const colorSet = TYPE_COLORS[summary.provider] || TYPE_COLORS.unknown;
        const color: ThemeColors =
          resolvedTheme === 'dark' && colorSet.dark ? colorSet.dark : colorSet.light;
        const active = activeProvider === summary.provider;
        const percent = summary.worstRemaining;
        const miniAccounts = summary.accounts.slice(0, MAX_MINI_ACCOUNTS);
        const overflow = summary.accounts.length - miniAccounts.length;

        return (
          <button
            key={summary.provider}
            type="button"
            className={styles.summaryTile}
            aria-pressed={active}
            style={{ '--provider-accent': color.text } as CSSProperties}
            onClick={() => onSelect(active ? 'all' : summary.provider)}
          >
            <span className={styles.summaryTileHead}>
              <span
                className={styles.summaryTileBadge}
                style={{ backgroundColor: color.bg, color: color.text }}
              >
                {labelFor(summary.provider)}
              </span>
              <span className={styles.countBadge}>{summary.total}</span>
              <span className={styles.stripSpacer} />
              {summary.atRisk > 0 && (
                <span className={styles.summaryTileRisk}>
                  {t('quota_management.at_risk', {
                    count: summary.atRisk,
                    defaultValue: `${summary.atRisk} at risk`,
                  })}
                </span>
              )}
            </span>

            <span className={styles.summaryTileFigures}>
              <span className={styles.summaryTileValue}>
                {percent === null ? '—' : `${percent}%`}
              </span>
              <span className={styles.summaryTileCaption}>
                {percent === null
                  ? t('quota_management.not_loaded', { defaultValue: 'not loaded' })
                  : t('quota_management.lowest_remaining', { defaultValue: 'lowest remaining' })}
              </span>
            </span>

            <span className={local.mini}>
              {miniAccounts.map((account) => (
                <span key={account.name} className={local.miniRow}>
                  <span className={local.miniName} title={account.name}>
                    {account.label}
                  </span>
                  <span className={local.miniBar}>
                    {account.remaining !== null && (
                      <span
                        className={`${styles.quotaBarFill} ${barClass(account.remaining)}`}
                        style={{ width: `${account.remaining}%` }}
                      />
                    )}
                  </span>
                  <span className={local.miniPercent}>
                    {account.remaining === null ? '—' : `${account.remaining}%`}
                  </span>
                </span>
              ))}
              {overflow > 0 && (
                <span className={local.miniMore}>
                  {t('quota_management.more_accounts', {
                    count: overflow,
                    defaultValue: `+${overflow} more`,
                  })}
                </span>
              )}
            </span>

            <span className={`${styles.summaryTileFoot} ${local.foot}`}>
              <span>
                {t('quota_management.next_reset', { defaultValue: 'next reset' })}{' '}
                <b className={local.footValue}>{summary.nextResetLabel ?? '—'}</b>
              </span>
              <span>
                <b className={local.footValue}>{summary.total}</b>{' '}
                {t('quota_management.credentials', {
                  count: summary.total,
                  defaultValue: summary.total === 1 ? 'credential' : 'credentials',
                })}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
