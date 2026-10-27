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
import {
  POOL_WINDOW_IDS,
  type PoolAccount,
  type PoolReading,
  type PoolWindowId,
  type ProviderPool,
} from '../pool';
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
  const { t } = useTranslation();
  const iconSrc = getAuthFileIcon(pool.provider, resolvedTheme);
  const typeLabel = getTypeLabel(t, pool.provider);
  const total = pool.accounts.length;
  const availableCount = pool.accounts.filter(
    (account) => account.status.kind === 'available'
  ).length;

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
        <span className={styles.accounts}>{t('quota_pool.accounts', { count: total })}</span>
        <span
          className={styles.availability}
          data-state={availableCount === total ? 'ok' : availableCount === 0 ? 'none' : 'some'}
        >
          {availableCount === total
            ? t('quota_pool.all_available')
            : t('quota_pool.available_of', { available: availableCount, total })}
        </span>
      </header>

      <div className={styles.table}>
        <div className={styles.columns} aria-hidden="true">
          <span />
          {POOL_WINDOW_IDS.map((id) => (
            <span key={id} className={styles.columnLabel}>
              {t(`account_status.window_${id}`)}
            </span>
          ))}
        </div>
        {pool.accounts.map((account) => (
          <AccountRow key={account.name} account={account} now={now} />
        ))}
      </div>
    </article>
  );
}

function AccountRow({ account, now }: { account: PoolAccount; now: number }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage;
  const status =
    account.status.kind === 'available'
      ? null
      : describeAccountStatus(account.status, t, now, locale);

  return (
    <div className={styles.row}>
      <div className={styles.identity}>
        <span className={styles.name} title={account.displayName}>
          {account.displayName}
        </span>
        {status && (
          <span className={styles.status} data-tone={status.tone}>
            <span className={styles.statusDot} aria-hidden="true" />
            {status.headline}
            {status.when && <span className={styles.when}> · {status.when}</span>}
          </span>
        )}
      </div>
      {POOL_WINDOW_IDS.map((id) => (
        <WindowCell key={id} id={id} reading={account.windows[id]} now={now} locale={locale} />
      ))}
    </div>
  );
}

function WindowCell({
  id,
  reading,
  now,
  locale,
}: {
  id: PoolWindowId;
  reading: PoolReading | null;
  now: number;
  locale?: string;
}) {
  const { t } = useTranslation();
  const label = t(`account_status.window_${id}`);
  const used = reading === null ? null : Math.round(reading.usedPercent);

  return (
    <div className={styles.cell}>
      <div className={styles.cellHead}>
        <span className={styles.cellLabel}>{label}</span>
        {used === null ? (
          <span className={styles.muted}>{t('quota_pool.no_reading')}</span>
        ) : (
          <>
            <span className={styles.used}>
              {t('quota_management.percent_used', { percent: used })}
            </span>
            {reading?.resetAtMs != null && (
              <span
                className={styles.reset}
                title={formatClockTime(reading.resetAtMs, now, locale)}
              >
                {formatRelativeInstant(reading.resetAtMs, now, locale)}
              </span>
            )}
          </>
        )}
      </div>
      <span
        className={styles.bar}
        role="img"
        aria-label={`${label} · ${
          used === null
            ? t('quota_pool.no_reading')
            : t('quota_management.percent_used', { percent: used })
        }`}
      >
        {used !== null && (
          <span
            className={styles.barFill}
            data-tone={headroomTone(used)}
            style={{ width: `${used}%` }}
          />
        )}
      </span>
    </div>
  );
}
