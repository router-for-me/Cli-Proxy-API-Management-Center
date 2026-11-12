/**
 * One account on one line: identity and plan, a meter per quota window, banked
 * resets by kind with the button that spends one, and refresh.
 */

import type { CSSProperties } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { IconAlertTriangle, IconRefreshCw } from '@/components/ui/icons';
import type { CodexQuotaState } from '@/types';
import { resolveQuotaErrorMessage, resolveResetMs } from '@/utils/quota';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota/relativeTime';
import { MINUTE_MS } from '@/utils/time/durations';
import { bindQuotaClasses } from '../types';
import { QUOTA_ADAPTERS, type QuotaCardState } from '../providers';
import { isQuotaRefreshDisabled, type QuotaFileEntry } from '../logic';
import { useClaudeResetGrants, type ClaudeResetLine } from '../providers/claude/ClaudeResetGrants';
import { CodexCreditOverageDialog } from '../providers/codex/CodexCreditOverageDialog';
import { CodexCreditOverageRow } from '../providers/codex/CodexCreditOverageRow';
import { useCodexCreditOverage } from '../providers/codex/useCodexCreditOverage';
import bodyStyles from '../components/QuotaBody.module.scss';
import { ResetsCell, type ResetLine } from './ResetsCell';
import {
  credentialStatus,
  fableUsedUp,
  meterTone,
  timeLeftParts,
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
  /** The weekly-reset router boosts this credential now. */
  boosted: boolean;
  color: string;
  gridTemplate: string;
  now: number;
  locale: string;
  canRefresh: boolean;
  resetting: boolean;
  /** Codex only: credentials in the panel sharing this account user's credit setting. */
  creditOverageSharedCount?: number;
  onRefresh: () => void;
  onReset: () => void;
};

export function AccountRow(props: AccountRowProps) {
  const { entry, quota, name, plan, columns, cells, recordedAtMs, showBank } = props;
  const { boosted, color, gridTemplate, now, locale, canRefresh, resetting } = props;
  const { creditOverageSharedCount = 1, onRefresh, onReset } = props;
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
  // QuotaCard's Codex credit setting, on the row like the card's other actions.
  const creditOverage = useCodexCreditOverage(
    file,
    entry.type === 'codex' ? (quota as CodexQuotaState | undefined) : undefined,
    !canRefresh || loading || resetting
  );
  const codex = entry.type === 'codex' && loaded ? (quota as CodexQuotaState) : null;
  const showCodexReset = Boolean(
    loaded && adapter.resetQuota && quota && adapter.canResetQuota?.(quota)
  );

  const weeklyReset = weeklyResetMs(entry.type, cells);
  const routing = credentialStatus(file, now);
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
        : (routing.status === 'cooling' || routing.status === 'unavailable') &&
            routing.until !== null
          ? {
              tone: 'warning',
              text: t('quota_accounts.status_cooling', {
                relative: formatRelativeInstant(routing.until, now, locale),
              }),
            }
          : routing.status === 'unavailable'
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
        <WindowCell key={column.id} cell={cell} now={now} />
      ) : (
        <div key={column.id} className={`${styles.cell} ${styles.cellMuted}`}>
          <span className={styles.cellLabel}>{column.label}</span>
          <span className={styles.cellValue}>—</span>
          <span className={styles.track} aria-hidden="true" />
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

  let resetLines: ResetLine[] = [];
  let resetsKnown = false;
  if (entry.type === 'claude' && loaded) {
    resetsKnown = claudeReset.known;
    const fableReady = fableUsedUp(cells);
    resetLines = claudeReset.lines.map((line) => claudeResetLine(line, t, fableReady));
  } else if (codex) {
    const available = codex.rateLimitResetCreditsAvailableCount ?? null;
    resetsKnown = available !== null;
    if ((available ?? 0) > 0 || showCodexReset) {
      resetLines = [
        {
          key: 'codex',
          count: available,
          label: t('quota_accounts.reset_available'),
          expiresAtMs: nextCodexCreditExpiry(codex, now),
          action: showCodexReset
            ? {
                label: t('quota_accounts.use_reset'),
                disabled: !canRefresh || loading || resetting,
                busy: resetting,
                onClick: onReset,
              }
            : null,
        },
      ];
    }
  }

  return (
    <div
      className={styles.rowGroup}
      role="listitem"
      style={{ '--account-color': color } as CSSProperties}
    >
      <div className={styles.row} style={{ gridTemplateColumns: gridTemplate }}>
        <div className={styles.account}>
          <span className={styles.nameLine}>
            <span className={styles.name} title={name}>
              {name}
            </span>
            {plan && <span className={styles.plan}>{plan}</span>}
          </span>
          {(weight !== null || renewsAtMs !== null) && (
            <span className={styles.meta}>
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
          )}
          {statusLine && (
            <span
              className={`${styles.status} ${styles[`status_${statusLine.tone}`] ?? ''}`}
              title={statusLine.text}
            >
              <span className={styles.statusDot} aria-hidden="true" />
              {statusLine.text}
            </span>
          )}
        </div>

        {windowArea}

        {showBank && (
          <ResetsCell lines={resetLines} known={resetsKnown} now={now} locale={locale} />
        )}

        <div className={styles.actions}>
          <button
            type="button"
            className={styles.iconButton}
            onClick={onRefresh}
            disabled={isQuotaRefreshDisabled(canRefresh, loading, resetting || claudeReset.busy)}
            aria-label={t('auth_files.quota_refresh_single')}
            title={t('auth_files.quota_refresh_hint')}
          >
            <IconRefreshCw size={15} className={loading ? styles.spinning : undefined} />
          </button>
        </div>
      </div>

      {creditOverage.visible && (
        <div className={styles.rowExtra}>
          <CodexCreditOverageRow
            entry={creditOverage.entry}
            classes={quotaClasses}
            disabled={creditOverage.blocked}
            name={name}
            onManage={creditOverage.openDialog}
          />
        </div>
      )}

      {claudeReset.message && entry.type === 'claude' && loaded && (
        <div role="status" className={styles.rowNote}>
          {t(`claude_reset.${claudeReset.message}`)}
        </div>
      )}

      {creditOverage.context && (
        <CodexCreditOverageDialog
          open={creditOverage.open}
          context={creditOverage.context}
          entry={creditOverage.entry}
          operation={creditOverage.operation}
          writeDisabled={creditOverage.writeDisabled}
          contextCurrent={creditOverage.contextCurrent}
          sharedCredentialCount={creditOverageSharedCount}
          selection={creditOverage.selection}
          pendingTarget={creditOverage.pendingTarget}
          feedback={creditOverage.feedback}
          onSelect={creditOverage.selectValue}
          onSave={() => void creditOverage.save()}
          onClose={creditOverage.closeDialog}
        />
      )}
    </div>
  );
}

/** A Fable reset lights up once Fable is used up: then it gives back the full 50 %. */
const claudeResetLine = (
  line: ClaudeResetLine,
  t: (key: string) => string,
  fableUsedUp: boolean
): ResetLine => {
  const ready = line.kind === 'fable' && fableUsedUp && !line.retry && !line.blocked;
  return {
    key: line.kind ?? 'retry',
    count: line.count,
    label: line.kind ? t(`quota_accounts.reset_${line.kind}`) : null,
    expiresAtMs: line.expiresAtMs,
    action: {
      label:
        line.retry || !line.kind
          ? t('claude_reset.retry')
          : ready
            ? t('quota_accounts.use_reset_fable_ready')
            : t(`quota_accounts.use_reset_${line.kind}`),
      disabled: line.blocked,
      busy: line.busy,
      ready,
      onClick: line.confirm,
    },
  };
};

/** When the first available Codex reset credit expires. */
const nextCodexCreditExpiry = (codex: CodexQuotaState, now: number): number | null =>
  (codex.rateLimitResetCredits ?? [])
    .filter((credit) => credit.status === 'available')
    .map((credit) => Date.parse(credit.expiresAt))
    .filter((ms) => Number.isFinite(ms) && ms > now)
    .sort((a, b) => a - b)[0] ?? null;

/** "19h 12m" in the UI language; the unit strings are shared with the Antigravity countdown. */
const formatTimeLeft = (t: TFunction, remainingMs: number): string => {
  const { days, hours, minutes } = timeLeftParts(remainingMs);
  if (days > 0) return t('antigravity_quota.duration_day_hour', { days, hours });
  if (hours > 0) return t('antigravity_quota.duration_hour_minute', { hours, minutes });
  if (minutes > 0) return t('antigravity_quota.duration_minute', { minutes });
  return t('antigravity_quota.duration_less_than_minute');
};

function WindowCell({ cell, now }: { cell: AccountWindowCell; now: number }) {
  const { t } = useTranslation();
  const tone = meterTone(cell.remaining);
  const resetAtMs = cell.resetAtMs !== null && cell.resetAtMs > now ? cell.resetAtMs : null;
  return (
    <div className={styles.cell}>
      <span className={styles.cellLabel}>{cell.label}</span>
      <span className={`${styles.cellValue} ${styles[`tone_${tone}`] ?? ''}`}>
        {cell.remaining === null
          ? '—'
          : t('quota_accounts.percent_left', { percent: Math.round(cell.remaining) })}
        {tone === 'low' && (
          <span className={styles.lowTag} title={t('quota_accounts.low')}>
            <IconAlertTriangle size={12} />
            <span className={styles.lowText}>{t('quota_accounts.low')}</span>
          </span>
        )}
      </span>
      <span className={styles.track} aria-hidden="true">
        <span
          className={`${styles.fill} ${styles[`fill_${tone}`] ?? ''}`}
          style={{ width: `${cell.remaining ?? 0}%` }}
        />
      </span>
      {/* Time left only; the exact instant is one hover away. */}
      <span
        className={styles.cellFoot}
        title={resetAtMs === null ? undefined : formatInstantShort(resetAtMs)}
      >
        {resetAtMs === null
          ? t('quota_accounts.no_reset')
          : t('quota_accounts.resets_in', { duration: formatTimeLeft(t, resetAtMs - now) })}
      </span>
    </div>
  );
}
