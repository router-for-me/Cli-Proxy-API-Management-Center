import { useTranslation } from 'react-i18next';
import type { ResolvedTheme } from '@/types';
import { formatRelativeInstant } from '@/utils/quota/relativeTime';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { describeAccountStatus, formatClockTime } from '../accountStatus';
import type { PoolAccountWindow, PoolWindowSummary, ProviderPool } from '../pool';
import { QUOTA_PROGRESS_HIGH_THRESHOLD, QUOTA_PROGRESS_MEDIUM_THRESHOLD } from './QuotaMeter';
import styles from './QuotaPool.module.scss';

export type QuotaPoolProps = {
  pools: ProviderPool[];
  now: number;
  resolvedTheme: ResolvedTheme;
};

const headroomTone = (usedPercent: number) => {
  const headroom = 100 - usedPercent;
  if (headroom >= QUOTA_PROGRESS_HIGH_THRESHOLD) return 'high';
  if (headroom >= QUOTA_PROGRESS_MEDIUM_THRESHOLD) return 'medium';
  return 'low';
};

export function QuotaPool({ pools, now, resolvedTheme }: QuotaPoolProps) {
  const { t } = useTranslation();
  if (pools.length === 0) return null;

  return (
    <section className={styles.pool} aria-label={t('quota_pool.title')}>
      {pools.map((pool) => (
        <ProviderPoolCard key={pool.provider} pool={pool} now={now} resolvedTheme={resolvedTheme} />
      ))}
      <p className={styles.source}>{t('quota_pool.source_note')}</p>
    </section>
  );
}

function ProviderPoolCard({
  pool,
  now,
  resolvedTheme,
}: {
  pool: ProviderPool;
  now: number;
  resolvedTheme: ResolvedTheme;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const iconSrc = getAuthFileIcon(pool.provider, resolvedTheme);
  const typeLabel = getTypeLabel(t, pool.provider);
  const availableCount = pool.accountCount - pool.unavailable.length;

  return (
    <article className={styles.card}>
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          style={
            isThemeSurfaceIconProvider(pool.provider)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? <img src={iconSrc} alt="" className={styles.icon} /> : null}
        </span>
        <h2 className={styles.title}>{typeLabel}</h2>
        <span className={styles.accounts}>
          {t('quota_pool.accounts', { count: pool.accountCount })}
        </span>
        <span
          className={styles.availability}
          data-state={pool.unavailable.length === 0 ? 'ok' : availableCount === 0 ? 'none' : 'some'}
        >
          {pool.unavailable.length === 0
            ? t('quota_pool.all_available')
            : t('quota_pool.available_of', { available: availableCount, total: pool.accountCount })}
        </span>
      </header>

      <div className={styles.windows}>
        {pool.windows.map((window) => (
          <PoolWindowRow key={window.id} window={window} now={now} locale={locale} />
        ))}
      </div>

      {pool.unavailable.length > 0 && (
        <ul className={styles.unavailable}>
          {pool.unavailable.map((account) => {
            const { tone, headline, when } = describeAccountStatus(account.status, t, now, locale);
            return (
              <li key={account.name} className={styles.unavailableRow} data-tone={tone}>
                <span className={styles.unavailableDot} aria-hidden="true" />
                <span className={styles.unavailableName} title={account.displayName}>
                  {account.displayName}
                </span>
                <span className={styles.unavailableStatus}>
                  {headline}
                  {when && <span className={styles.when}> · {when}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

function PoolWindowRow({
  window,
  now,
  locale,
}: {
  window: PoolWindowSummary;
  now: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const label = t(`account_status.window_${window.id}`);
  const used = Math.round(window.usedPercent);
  const left = Math.round(window.capacityPercent - window.usedPercent);
  const unreported = window.accounts.length - window.reporting;

  return (
    <div className={styles.window}>
      <span className={styles.windowLabel}>{label}</span>
      <div className={styles.slots}>
        {window.accounts.map((account) => (
          <AccountSlot key={account.name} account={account} windowLabel={label} />
        ))}
      </div>
      <div className={styles.figures}>
        {window.reporting === 0 ? (
          <span className={styles.muted}>{t('quota_pool.no_reading')}</span>
        ) : (
          <>
            <span className={styles.total}>
              {t('quota_pool.used_of', { used, capacity: window.capacityPercent })}
            </span>
            <span className={styles.left}>{t('quota_pool.left', { left })}</span>
          </>
        )}
      </div>
      <div className={styles.windowMeta}>
        {window.nextReset && (
          <span>
            {t('quota_pool.next_reset', {
              name: window.nextReset.displayName,
              time: formatClockTime(window.nextReset.atMs, now, locale),
              relative: formatRelativeInstant(window.nextReset.atMs, now, locale),
            })}
          </span>
        )}
        {unreported > 0 && window.reporting > 0 && (
          <span className={styles.muted}>{t('quota_pool.unreported', { count: unreported })}</span>
        )}
      </div>
    </div>
  );
}

function AccountSlot({
  account,
  windowLabel,
}: {
  account: PoolAccountWindow;
  windowLabel: string;
}) {
  const { t } = useTranslation();
  const used = account.reading === null ? null : Math.round(account.reading.usedPercent);
  const description = `${account.displayName} · ${windowLabel} · ${
    used === null
      ? t('quota_pool.no_reading')
      : t('quota_management.percent_used', { percent: used })
  }`;

  return (
    <span className={styles.slot} title={description} role="img" aria-label={description}>
      {used !== null && (
        <span
          className={styles.slotFill}
          data-tone={headroomTone(used)}
          style={{ width: `${used}%` }}
        />
      )}
    </span>
  );
}
