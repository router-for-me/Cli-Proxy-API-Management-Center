/**
 * One line per account: whether it is serving, its share of recent traffic,
 * quota left in the 5-hour and weekly windows, and the next weekly reset.
 */

import { useTranslation } from 'react-i18next';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  isThemeSurfaceIconProvider,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { maskEmail } from '@/features/quota/emailMask';
import { formatDuration, formatUpcoming } from '@/features/quota/forecast/format';
import { remainingTone } from '@/features/quota/accounts/rowModel';
import type { AccountRow, AccountStatus, QuotaReading } from './model';
import styles from './ProxDashboard.module.scss';

type Props = {
  rows: AccountRow[] | null;
  totalRequests: number;
  routingStrategy: string;
  showEmails: boolean;
  onToggleEmails: () => void;
  colorOf: (provider: string) => string;
  theme: ResolvedTheme;
  now: number;
};

const STATUS_CLASS: Record<AccountStatus, string> = {
  serving: styles.statusServing,
  cooling: styles.statusCooling,
  unavailable: styles.statusFailing,
  error: styles.statusFailing,
  disabled: styles.statusDisabled,
};

export function AccountsCard(props: Props) {
  const { rows, totalRequests, routingStrategy, showEmails, onToggleEmails } = props;
  const { colorOf, theme, now } = props;
  const { t, i18n } = useTranslation();
  const locale = i18n.language || 'en';

  const quotaCell = (reading: QuotaReading | null) => {
    if (!reading) return <span className={styles.muted}>—</span>;
    const left = Math.round(100 - reading.used);
    return (
      <span className={styles.quota} data-tone={remainingTone(left)}>
        <span className={styles.quotaValue}>{left}%</span>
        <span className={styles.quotaTrack} aria-hidden="true">
          <span style={{ width: `${left}%` }} />
        </span>
      </span>
    );
  };

  return (
    <section className={styles.card} aria-labelledby="prox-accounts-title">
      <header className={styles.cardHeader}>
        <h2 id="prox-accounts-title" className={styles.cardTitle}>
          {t('prox.accounts')}
          {rows && <span className={styles.cardCount}>{rows.length}</span>}
        </h2>
        <div className={styles.cardTools}>
          {routingStrategy && (
            <span className={styles.routing} title={t('prox.routing')}>
              {routingStrategy}
            </span>
          )}
          <button
            type="button"
            className={styles.iconButton}
            onClick={onToggleEmails}
            aria-pressed={showEmails}
            aria-label={
              showEmails ? t('quota_forecast.hide_emails') : t('quota_forecast.show_emails')
            }
            title={showEmails ? t('quota_forecast.hide_emails') : t('quota_forecast.show_emails')}
          >
            {showEmails ? <IconEyeOff size={15} /> : <IconEye size={15} />}
          </button>
        </div>
      </header>

      {rows === null ? (
        <p className={styles.cardEmpty}>{t('prox.loading')}</p>
      ) : rows.length === 0 ? (
        <p className={styles.cardEmpty}>{t('prox.no_accounts')}</p>
      ) : (
        <div className={styles.accounts} role="table" aria-labelledby="prox-accounts-title">
          <div className={`${styles.accountRow} ${styles.accountHead}`} role="row">
            <span role="columnheader">{t('prox.col_account')}</span>
            <span role="columnheader">{t('prox.col_status')}</span>
            <span role="columnheader">{t('prox.col_requests')}</span>
            <span role="columnheader" className={styles.colFive}>
              {t('prox.col_five_hour')}
            </span>
            <span role="columnheader">{t('prox.col_weekly')}</span>
            <span role="columnheader" className={styles.colReset}>
              {t('prox.col_reset')}
            </span>
          </div>
          {rows.map((row) => {
            const icon = getAuthFileIcon(row.provider, theme);
            const share = totalRequests > 0 ? (row.total / totalRequests) * 100 : 0;
            const reset = row.weekly?.resetAt ?? null;
            return (
              <div key={row.key} className={styles.accountRow} role="row">
                <span role="cell" className={styles.accountName}>
                  {icon && (
                    <span
                      className={styles.providerIcon}
                      style={
                        isThemeSurfaceIconProvider(row.provider)
                          ? { background: getThemeSurfaceIconBackground(theme) }
                          : undefined
                      }
                    >
                      <img src={icon} alt="" />
                    </span>
                  )}
                  <span className={styles.ellipsis} title={showEmails ? row.name : undefined}>
                    {showEmails ? row.name : maskEmail(row.name)}
                  </span>
                </span>
                <span role="cell" className={styles.status}>
                  <i className={STATUS_CLASS[row.status]} aria-hidden="true" />
                  {t(`prox.status_${row.status}`)}
                  {row.statusUntil !== null && (
                    <span
                      className={styles.muted}
                      title={formatUpcoming(row.statusUntil, now, locale)}
                    >
                      {formatDuration(row.statusUntil - now)}
                    </span>
                  )}
                  {row.priority && (
                    <span className={styles.priority} title={t('prox.priority_hint')}>
                      {t('prox.priority')}
                    </span>
                  )}
                </span>
                <span role="cell" className={styles.requests}>
                  <span className={styles.requestsValue}>{row.total.toLocaleString()}</span>
                  <span className={styles.shareTrack} aria-hidden="true">
                    <span style={{ width: `${share}%`, background: colorOf(row.provider) }} />
                  </span>
                </span>
                <span role="cell" className={styles.colFive}>
                  {quotaCell(row.fiveHour)}
                </span>
                <span role="cell">{quotaCell(row.weekly)}</span>
                <span role="cell" className={styles.colReset}>
                  {reset !== null ? (
                    <span title={formatUpcoming(reset, now, locale)}>
                      {t('prox.in_duration', { duration: formatDuration(reset - now) })}
                    </span>
                  ) : (
                    <span className={styles.muted}>—</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
