/**
 * Provider quota card: identity, loading/error state, quota body, and actions.
 * Claude observations remain visible while refreshing or after a failed read.
 */

import { useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { AccountResets } from '@/domain/quotaPool/types';
import type { ClaudeQuotaState, ResolvedTheme } from '@/types';
import { resolveQuotaErrorMessage } from '@/utils/quota';
import { getQuotaDisplayName } from '@/utils/quota/identity';
import {
  getAuthFileIcon,
  getThemeSurfaceIconBackground,
  getTypeLabel,
  isThemeSurfaceIconProvider,
} from '@/features/authFiles/constants';
import { isCredentialDisabled } from '@/features/authFiles/credentialFacts';
import { bindQuotaClasses } from '../types';
import { type QuotaCardState, type QuotaAdapter } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import { AccountDetails } from './AccountDetails';
import { QuotaFreshness } from './QuotaFreshness';
import { hasClaudeUsageData } from '../providers/claude/data';
import bodyStyles from './QuotaBody.module.scss';
import styles from './QuotaCard.module.scss';

/** Bind the quota-page styles to the shared rendering contract. */
const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type QuotaCardProps = {
  entry: QuotaFileEntry;
  adapter: QuotaAdapter;
  quota?: QuotaCardState;
  resolvedTheme: ResolvedTheme;
  canRefresh: boolean;
  resetting: boolean;
  /** Initial cascade delay; null disables entrance motion for later mounts. */
  entranceDelayMs?: number | null;
  /** force: after a reset claim (the claim changed the quota the card last read). */
  onRefresh: (options?: { force?: boolean }) => void;
  onReset: () => void;
  /** When the shown quota was read, for the "updated 25s ago" label. */
  fetchedAt?: number;
  /** Served by the history server: the held resets of its reading; the hub is not polled. */
  server?: { resets: AccountResets | null };
  /** The server's read floor skipped a Refresh: when the next read may run. */
  nextReadAt?: number;
};

export function QuotaCard(props: QuotaCardProps) {
  const {
    entry,
    quota,
    resolvedTheme,
    canRefresh,
    resetting,
    entranceDelayMs,
    onRefresh,
    onReset,
    fetchedAt,
    nextReadAt,
  } = props;
  const { t } = useTranslation();
  const adapter = props.adapter;
  const file = entry.file;
  const retainedClaudeUsage =
    entry.type === 'claude' && hasClaudeUsageData(quota as ClaudeQuotaState | undefined);
  const displayName = getQuotaDisplayName(file);
  // Switched off: its quota is still read, but it serves nothing and its resets stay unspent.
  const accountOff = isCredentialDisabled(file);

  // Capture the entrance delay only at mount, without a render-time ref read.
  const [mountEntranceDelayMs] = useState<number | null>(entranceDelayMs ?? null);
  const entranceStyle =
    mountEntranceDelayMs === null
      ? undefined
      : ({ '--card-delay': `${mountEntranceDelayMs}ms` } as CSSProperties);

  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh,
    adapter.resetGrants,
    accountOff,
    props.server
  );
  const providerType =
    entry.type === 'plugin'
      ? String(
          file.quotaProvider ?? file['quota_provider'] ?? file.provider ?? file.type ?? 'plugin'
        )
      : entry.type;
  const iconSrc = getAuthFileIcon(providerType, resolvedTheme);
  const typeLabel = getTypeLabel(t, providerType);
  const errorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <article
      className={[
        styles.card,
        mountEntranceDelayMs === null ? '' : styles.cardEnter,
        accountOff ? styles.cardOff : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={entranceStyle}
    >
      <header className={styles.head}>
        <span
          className={styles.iconWrap}
          title={typeLabel}
          style={
            isThemeSurfaceIconProvider(providerType)
              ? { background: getThemeSurfaceIconBackground(resolvedTheme) }
              : undefined
          }
        >
          {iconSrc ? (
            <img src={iconSrc} alt="" className={styles.icon} />
          ) : (
            <span className={styles.iconFallback}>{typeLabel.slice(0, 1).toUpperCase()}</span>
          )}
        </span>
        <span className={styles.fileName} title={displayName}>
          {displayName}
        </span>
        {accountOff && (
          <span className={styles.offBadge} title={t('quota_management.account_off_hint')}>
            {t('quota_management.account_off')}
          </span>
        )}
      </header>

      <div className={styles.body}>
        {status === 'idle' ? (
          <button
            type="button"
            className={styles.idleBody}
            onClick={() => onRefresh()}
            disabled={!canRefresh}
          >
            <IconRefreshCw size={15} aria-hidden="true" className={styles.idleGlyph} />
            <span className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</span>
          </button>
        ) : loading && !retainedClaudeUsage ? (
          <div className={styles.skeleton} aria-busy="true">
            <span className={styles.srOnly}>{t(`${adapter.i18nPrefix}.loading`)}</span>
            {[0, 1].map((row) => (
              <div key={row} className={styles.skeletonRow} aria-hidden="true">
                <span className={styles.skeletonLabel} />
                <span className={styles.skeletonTrack} />
              </div>
            ))}
          </div>
        ) : status === 'error' ? (
          <div className={styles.errorStrip} role="alert">
            {t(`${adapter.i18nPrefix}.load_failed`, { message: errorMessage })}
          </div>
        ) : quota && !retainedClaudeUsage ? (
          <adapter.Body quota={quota} classes={quotaClasses} factsInPanel />
        ) : !retainedClaudeUsage ? (
          <div className={styles.idleHint}>{t(`${adapter.i18nPrefix}.idle`)}</div>
        ) : null}
        {loading && retainedClaudeUsage && (
          <div role="status" aria-busy="true" className={quotaClasses.quotaMessage}>
            {t(`${adapter.i18nPrefix}.loading`)}
          </div>
        )}
        {retainedClaudeUsage && quota && (
          <adapter.Body quota={quota} classes={quotaClasses} factsInPanel />
        )}
      </div>

      {/* Claude's reset grants load independently of usage, so its resets stay reachable. */}
      {((quota && (status === 'success' || retainedClaudeUsage)) ||
        (entry.type === 'claude' && status !== 'idle')) && (
        <AccountDetails
          provider={entry.type}
          quota={status === 'success' || retainedClaudeUsage ? quota : undefined}
          name={displayName}
          accountOff={accountOff}
          claudeReset={entry.type === 'claude' ? claudeReset : undefined}
          reset={
            entry.type === 'codex' && adapter.resetQuota
              ? {
                  disabled:
                    !canRefresh ||
                    accountOff ||
                    loading ||
                    resetting ||
                    !quota ||
                    !adapter.canResetQuota?.(quota),
                  onClick: onReset,
                }
              : undefined
          }
        />
      )}

      {status !== 'idle' && (
        <footer className={styles.actionRow}>
          {status === 'success' && (
            <QuotaFreshness
              fetchedAt={fetchedAt}
              nextReadAtMs={nextReadAt}
              className={styles.freshness}
            />
          )}
          <button
            type="button"
            className={styles.actionPill}
            onClick={() => onRefresh()}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={13} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </footer>
      )}
    </article>
  );
}
