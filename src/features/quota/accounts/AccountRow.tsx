/**
 * One account on one line: identity, a meter per quota window, banked resets,
 * and actions.
 */

import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import type { CodexQuotaState } from '@/types';
import { resolveQuotaErrorMessage, resolveResetMs } from '@/utils/quota';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota/relativeTime';
import { MINUTE_MS } from '@/utils/time/durations';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants } from '../providers/claude/ClaudeResetGrants';
import bodyStyles from '../components/QuotaBody.module.scss';
import {
  credentialStatus,
  isPriorityBoosted,
  remainingTone,
  weeklyResetMs,
  type AccountColumn,
  type AccountWindowCell,
} from './rowModel';
import styles from './AccountsTable.module.scss';

const quotaClasses = bindQuotaClasses(bodyStyles, 'QuotaBody.module.scss');

export type AccountRowProps = {
  entry: QuotaFileEntry;
  quota: QuotaCardState | undefined;
  name: string;
  plan: string | null;
  columns: AccountColumn[];
  /** Live cells when loaded, otherwise the latest recorded ones. */
  cells: AccountWindowCell[];
  /** Set when `cells` come from recorded history rather than a live read. */
  recordedAtMs: number | null;
  showBank: boolean;
  priorityRouting: boolean;
  color: string;
  gridTemplate: string;
  now: number;
  locale: string;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
};

export function AccountRow(props: AccountRowProps) {
  const { entry, quota, name, plan, columns, cells, recordedAtMs, showBank } = props;
  const { priorityRouting, color, gridTemplate, now, locale, canRefresh, resetting } = props;
  const { onRefresh, onReset } = props;
  const { t } = useTranslation();
  const adapter = QUOTA_ADAPTERS[entry.type];
  const file = entry.file;
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const loaded = status === 'success' && quota !== undefined;

  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const codex = entry.type === 'codex' && loaded ? (quota as CodexQuotaState) : null;
  const showCodexReset = Boolean(
    loaded && adapter.resetQuota && quota && adapter.canResetQuota?.(quota)
  );

  const weeklyReset = weeklyResetMs(entry.type, cells);
  const routing = credentialStatus(file, now);
  const boosted = priorityRouting && isPriorityBoosted(weeklyReset, now, routing.status);
  const weight = typeof file.weight === 'number' && file.weight !== 1 ? file.weight : null;
  const renewsAtMs = codex ? resolveResetMs([codex.subscriptionActiveUntil ?? null]) : null;

  const errorMessage =
    status === 'error'
      ? t(`${adapter.i18nPrefix}.load_failed`, {
          message: resolveQuotaErrorMessage(
            t,
            quota?.errorStatus,
            quota?.error || t('common.unknown_error')
          ),
        })
      : '';

  // One status line, most important first. Recorded instants never read as future.
  const statusLine =
    status === 'error' && cells.length > 0
      ? { tone: 'warning', text: errorMessage }
      : boosted
        ? {
            tone: 'priority',
            text: t('quota_accounts.status_priority', {
              relative: formatRelativeInstant(weeklyReset as number, now, locale),
            }),
          }
        : routing.status === 'cooling' && routing.until !== null
          ? {
              tone: 'warning',
              text: t('quota_accounts.status_cooling', {
                relative: formatRelativeInstant(routing.until, now, locale),
              }),
            }
          : file.unavailable === true
            ? { tone: 'warning', text: t('quota_accounts.status_unavailable') }
            : loading
              ? { tone: 'quiet', text: t(`${adapter.i18nPrefix}.loading`) }
              : recordedAtMs !== null
                ? {
                    tone: 'quiet',
                    text: t('quota_accounts.status_recorded', {
                      relative: formatRelativeInstant(
                        Math.min(recordedAtMs, now - MINUTE_MS),
                        now,
                        locale
                      ),
                    }),
                  }
                : null;

  const windowSpan = { gridColumn: `span ${Math.max(1, columns.length)}` } as CSSProperties;
  let windowArea;
  if (cells.length > 0) {
    windowArea = columns.map((column) => {
      const cell = cells.find((candidate) => candidate.id === column.id);
      return cell ? (
        <WindowCell key={column.id} cell={cell} color={color} now={now} locale={locale} />
      ) : (
        <div key={column.id} className={`${styles.cell} ${styles.cellMuted}`}>
          <span className={styles.cellLabel}>{column.label}</span>
          <span className={styles.cellFoot}>{t('quota_accounts.not_on_plan')}</span>
        </div>
      );
    });
  } else if (loading) {
    windowArea = (
      <div className={styles.skeleton} style={windowSpan} aria-busy="true">
        <span className={styles.skeletonBar} />
        <span className={styles.skeletonBar} />
      </div>
    );
  } else if (status === 'error') {
    windowArea = (
      <div className={styles.errorText} style={windowSpan} role="alert">
        {errorMessage}
      </div>
    );
  } else if (loaded && quota) {
    // Providers without window meters (e.g. xAI spend) show their own body inline.
    windowArea = (
      <div className={styles.inlineBody} style={windowSpan}>
        <adapter.Body quota={quota} classes={quotaClasses} />
      </div>
    );
  } else {
    windowArea = (
      <button
        type="button"
        className={styles.loadButton}
        style={windowSpan}
        onClick={onRefresh}
        disabled={!canRefresh}
      >
        <IconRefreshCw size={13} aria-hidden="true" />
        {t('quota_accounts.load_quota')}
      </button>
    );
  }

  return (
    <div className={styles.rowGroup} role="listitem">
      <div className={styles.row} style={{ gridTemplateColumns: gridTemplate }}>
        <div className={styles.account}>
          <span className={styles.name} title={name}>
            {name}
          </span>
          <span className={styles.meta}>
            {plan && (
              <span className={styles.plan} style={{ color }}>
                {plan}
              </span>
            )}
            {weight !== null && (
              <span>{t('quota_accounts.weight', { weight: Number(weight.toFixed(2)) })}</span>
            )}
            {renewsAtMs !== null && (
              <span>
                {t('quota_accounts.renews', {
                  absolute: formatInstantShort(renewsAtMs),
                  relative: formatRelativeInstant(renewsAtMs, now, locale),
                })}
              </span>
            )}
          </span>
          {statusLine && (
            <span
              className={`${styles.status} ${styles[`status_${statusLine.tone}`] ?? ''}`}
              title={statusLine.text}
            >
              <span
                className={styles.statusDot}
                style={statusLine.tone === 'priority' ? { background: color } : undefined}
                aria-hidden="true"
              />
              {statusLine.text}
            </span>
          )}
        </div>

        {windowArea}

        {showBank && (
          <BankCell
            type={entry.type}
            claudeCount={loaded ? claudeReset.count : null}
            codex={codex}
            now={now}
            locale={locale}
          />
        )}

        <div className={styles.actions}>
          {entry.type === 'claude' && loaded && (
            <button
              type="button"
              className={styles.action}
              disabled={claudeReset.blocked}
              onClick={claudeReset.confirm}
            >
              <IconRefreshCw size={12} className={claudeReset.busy ? styles.spinning : undefined} />
              {claudeReset.buttonLabel === 'retry'
                ? t('claude_reset.retry')
                : t('quota_accounts.use_reset')}
            </button>
          )}
          {showCodexReset && (
            <button
              type="button"
              className={styles.action}
              onClick={onReset}
              disabled={!canRefresh || loading || resetting}
            >
              <IconRefreshCw size={12} className={resetting ? styles.spinning : undefined} />
              {t('quota_accounts.use_reset')}
            </button>
          )}
          <button
            type="button"
            className={styles.action}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={12} className={loading ? styles.spinning : undefined} />
            {t('auth_files.quota_refresh_single')}
          </button>
        </div>
      </div>

      {claudeReset.message && entry.type === 'claude' && loaded && (
        <div role="status" className={styles.rowNote}>
          {t(`claude_reset.${claudeReset.message}`)}
        </div>
      )}
    </div>
  );
}

function WindowCell({
  cell,
  color,
  now,
  locale,
}: {
  cell: AccountWindowCell;
  color: string;
  now: number;
  locale: string;
}) {
  const { t } = useTranslation();
  const tone = remainingTone(cell.remaining);
  const pending = cell.resetAtMs !== null && cell.resetAtMs > now;
  return (
    <div className={styles.cell}>
      <span className={styles.cellHead}>
        <span className={styles.cellLabel} title={cell.label}>
          {cell.label}
        </span>
        <span className={`${styles.cellValue} ${styles[`tone_${tone}`] ?? ''}`}>
          {cell.remaining === null
            ? '—'
            : t('quota_accounts.percent_left', { percent: Math.round(cell.remaining) })}
        </span>
      </span>
      <span className={styles.track} aria-hidden="true">
        <span
          className={styles.fill}
          style={{
            width: `${cell.remaining ?? 0}%`,
            background: tone === 'critical' ? 'var(--viz-failure)' : color,
          }}
        />
      </span>
      <span className={styles.cellFoot}>
        {pending ? (
          <>
            <strong>{formatRelativeInstant(cell.resetAtMs as number, now, locale)}</strong>
            {' · '}
            {formatInstantShort(cell.resetAtMs as number)}
          </>
        ) : (
          t('quota_accounts.no_reset')
        )}
      </span>
    </div>
  );
}

function BankCell({
  type,
  claudeCount,
  codex,
  now,
  locale,
}: {
  type: string;
  claudeCount: number | null;
  codex: CodexQuotaState | null;
  now: number;
  locale: string;
}) {
  const { t } = useTranslation();
  if (type === 'claude') {
    return (
      <div className={styles.cell}>
        <span className={styles.cellHead}>
          <span className={styles.cellLabel}>{t('claude_reset.title')}</span>
          <span className={styles.cellValue}>{claudeCount ?? '—'}</span>
        </span>
        <span className={styles.cellFoot}>{t('quota_accounts.claude_bank_hint')}</span>
      </div>
    );
  }
  const available = codex?.rateLimitResetCreditsAvailableCount ?? null;
  const next = (codex?.rateLimitResetCredits ?? [])
    .filter((credit) => credit.status === 'available')
    .map((credit) => Date.parse(credit.expiresAt))
    .filter((ms) => Number.isFinite(ms) && ms > now)
    .sort((a, b) => a - b)[0];
  return (
    <div className={styles.cell}>
      <span className={styles.cellHead}>
        <span className={styles.cellLabel}>{t('codex_quota.reset_credits_label')}</span>
        <span className={styles.cellValue}>
          {available === null ? '—' : t('quota_accounts.available', { count: available })}
        </span>
      </span>
      <span className={styles.cellFoot}>
        {next !== undefined ? (
          <>
            {t('quota_accounts.next_expires')}{' '}
            <strong>{formatRelativeInstant(next, now, locale)}</strong>
            {' · '}
            {formatInstantShort(next)}
          </>
        ) : (
          t('quota_accounts.codex_bank_hint')
        )}
      </span>
    </div>
  );
}
