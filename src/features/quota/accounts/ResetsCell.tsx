/**
 * Banked resets of one account: a line per kind with how many are left, when
 * the first expires, and a compact button that spends one.
 */

import { useTranslation } from 'react-i18next';
import { IconLoader2, IconTimer, IconZap } from '@/components/ui/icons';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota/relativeTime';
import { compactRemaining } from './rowModel';
import styles from './AccountsTable.module.scss';

export type ResetLine = {
  key: string;
  count: number | null;
  label: string | null;
  expiresAtMs: number | null;
  action: { label: string; disabled: boolean; busy: boolean; onClick: () => void } | null;
};

export function ResetsCell({
  lines,
  known,
  now,
  locale,
}: {
  lines: ResetLine[];
  /** The count has been read, so no lines means none are banked. */
  known: boolean;
  now: number;
  locale: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.resets}>
      <span className={styles.cellLabel}>{t('quota_accounts.col_resets')}</span>
      {lines.length === 0 && (
        <span className={styles.resetsEmpty}>{known ? t('quota_accounts.resets_none') : '—'}</span>
      )}
      {lines.map((line) => {
        const expires =
          line.expiresAtMs !== null && line.expiresAtMs > now ? line.expiresAtMs : null;
        const left = expires === null ? null : compactRemaining(expires - now);
        const expiry =
          expires === null
            ? ''
            : `${t('quota_accounts.next_expires')} ${formatRelativeInstant(expires, now, locale)} · ${formatInstantShort(expires)}`;
        return (
          <div key={line.key} className={styles.resetLine}>
            <span className={styles.resetText}>
              {line.count !== null && <span className={styles.resetCount}>{line.count}</span>}
              {line.label && <span className={styles.resetKind}>{line.label}</span>}
              {left && (
                <span className={styles.resetExpiry} title={expiry}>
                  <IconTimer size={12} />
                  <span aria-hidden="true">
                    {left.under ? '<' : ''}
                    {t(`quota_forecast.${left.unit === 'day' ? 'days_short' : 'hours_short'}`, {
                      count: left.value,
                    })}
                  </span>
                  <span className={styles.srOnly}>{expiry}</span>
                </span>
              )}
            </span>
            {line.action && (
              <button
                type="button"
                className={styles.iconButton}
                onClick={line.action.onClick}
                disabled={line.action.disabled}
                aria-label={line.action.label}
                title={line.action.label}
              >
                {line.action.busy ? (
                  <IconLoader2 size={15} className={styles.spinning} />
                ) : (
                  <IconZap size={15} />
                )}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
