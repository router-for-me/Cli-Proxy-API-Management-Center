/**
 * Quota Overview building blocks: ledger rows.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { IconCheck, IconPencil, IconRefreshCw, IconX, type IconProps } from '@/components/ui/icons';
import type { ResolvedTheme } from '@/types';
import { formatInstantShort, formatRelativeInstant } from '@/utils/quota';
import {
  QUOTA_PROGRESS_HIGH_THRESHOLD,
  QUOTA_PROGRESS_MEDIUM_THRESHOLD,
} from '@/features/quota/components/QuotaMeter';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { useClaudeResetGrants } from '@/features/quota/providers/claude/ClaudeResetGrants';
import {
  containsEmail,
  credentialLabel,
  formatCountdown,
  formatTimeLeft,
  maskEmails,
  resetUrgency,
  resetGrantKind,
  fableColor,
  type ResetUrgency,
  type OverviewCredential,
} from './model';
import { ProviderIcon } from './ProviderIcon';
import styles from './QuotaOverviewPage.module.scss';
import { routingReasonKey } from './routing';

const levelClass = (percent: number | null) =>
  percent === null
    ? styles.levelNone
    : percent >= QUOTA_PROGRESS_HIGH_THRESHOLD
      ? styles.levelHigh
      : percent >= QUOTA_PROGRESS_MEDIUM_THRESHOLD
        ? styles.levelMedium
        : styles.levelLow;

function Bar({ percent }: { percent: number | null }) {
  const width = percent === null ? 0 : Math.min(100, Math.max(0, percent));
  return (
    <div className={styles.bar}>
      <div className={`${styles.barFill} ${levelClass(percent)}`} style={{ width: `${width}%` }} />
    </div>
  );
}

/** Lucide "ticket" (ISC), kept here so upstream's icon set stays untouched. */
function IconTicket({ size = 20, ...props }: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      <path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z" />
      <path d="M13 5v2" />
      <path d="M13 17v2" />
      <path d="M13 11v2" />
    </svg>
  );
}

function ResetWhen({ atMs, nowMs }: { atMs: number | null; nowMs: number }) {
  const { t, i18n } = useTranslation();
  if (atMs === null || atMs <= nowMs) {
    return <span className={styles.muted}>{t('pd_overview.no_reset')}</span>;
  }
  return (
    <span className={styles.muted}>
      <strong className={styles.relative}>
        {formatRelativeInstant(atMs, nowMs, i18n.language)}
      </strong>
      {' · '}
      {formatInstantShort(atMs)}
    </span>
  );
}

/** Text that may contain an email: blurred when emails are hidden. */
function Private({ text, hide, className }: { text: string; hide: boolean; className?: string }) {
  const redact = hide && containsEmail(text);
  return (
    <span
      className={`${className ?? ''} ${redact ? styles.redacted : ''}`}
      title={redact ? undefined : text}
      aria-label={redact ? maskEmails(text) : undefined}
    >
      {text}
    </span>
  );
}

/** Inline editor for the account's CLIProxy Note, which the page uses as its name. */
function NameEditor({
  initial,
  onSave,
  onClose,
}: {
  initial: string;
  onSave: (note: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.select(), []);
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(value.trim());
      onClose();
    } catch {
      setSaving(false);
    }
  };
  return (
    <form
      className={styles.nameEditor}
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <input
        ref={inputRef}
        className={styles.nameInput}
        value={value}
        maxLength={80}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => event.key === 'Escape' && onClose()}
        placeholder={t('pd_overview.name_placeholder')}
        aria-label={t('pd_overview.name_label')}
        disabled={saving}
      />
      <button
        type="submit"
        className={styles.tinyButton}
        disabled={saving}
        aria-label={t('pd_overview.name_save')}
        title={t('pd_overview.name_save')}
      >
        <IconCheck size={14} aria-hidden="true" />
      </button>
      <button
        type="button"
        className={styles.tinyButton}
        onClick={onClose}
        aria-label={t('pd_overview.name_cancel')}
        title={t('pd_overview.name_cancel')}
      >
        <IconX size={14} aria-hidden="true" />
      </button>
    </form>
  );
}

const urgencyClass: Record<ResetUrgency, string> = {
  day: styles.urgencyDay,
  week: styles.urgencyWeek,
  later: '',
  none: '',
};

interface ResetCreditView {
  id: string;
  count: number;
  label: string | null;
  expiresAtMs: number | null;
  kind: 'shared' | 'fable' | 'unknown';
}

export function ResetsCell({
  credits,
  nowMs,
  canUse,
  onUse,
  readError,
}: {
  credits: ResetCreditView[] | null;
  nowMs: number;
  canUse: boolean;
  onUse: () => void;
  readError?: boolean;
}) {
  const { t, i18n } = useTranslation();
  if (credits === null) {
    return (
      <div className={styles.rowResets}>
        {readError && <span className={styles.muted}>{t('pd_overview.resets_unreadable')}</span>}
      </div>
    );
  }
  const sorted = [...credits].sort(
    (a, b) => (a.expiresAtMs ?? Infinity) - (b.expiresAtMs ?? Infinity)
  );
  return (
    <div className={styles.rowResets}>
      {sorted.length > 0 && (
        <button
          type="button"
          className={styles.iconButton}
          disabled={!canUse}
          onClick={onUse}
          aria-label={t('pd_overview.use_reset')}
          title={t('pd_overview.use_reset')}
        >
          <IconTicket size={16} />
        </button>
      )}
      {sorted.length === 0 ? (
        <span className={styles.muted}>{t('pd_overview.no_resets')}</span>
      ) : (
        <ul className={styles.resetList}>
          {sorted.map((credit) => (
            <li
              key={credit.id}
              className={urgencyClass[resetUrgency(credit.expiresAtMs, nowMs)]}
              title={credit.label ?? undefined}
            >
              <span
                className={`${styles.resetScope} ${credit.kind === 'fable' ? styles.fableScope : ''}`}
                title={
                  credit.kind === 'unknown'
                    ? t('pd_overview.reset_scope_unknown')
                    : (credit.label ?? undefined)
                }
              >
                {t(`pd_overview.reset_${credit.kind}`)}
              </span>
              <span className={styles.resetDate}>
                {credit.expiresAtMs === null
                  ? t('pd_overview.no_expiry')
                  : formatInstantShort(credit.expiresAtMs)}
              </span>
              <span className={styles.resetLeft}>
                {credit.expiresAtMs === null
                  ? ''
                  : formatTimeLeft(credit.expiresAtMs, nowMs, i18n.language)}
              </span>
              <span className={styles.resetCount}>
                {credit.count > 1 ? t('pd_overview.reset_count', { count: credit.count }) : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function LedgerHeader() {
  const { t } = useTranslation();
  return (
    <div className={`${styles.row} ${styles.rowHeader}`} aria-hidden="true">
      <span>{t('pd_overview.col_account')}</span>
      <span>{t('pd_overview.col_limits')}</span>
      <span>{t('pd_overview.col_resets')}</span>
      <span />
    </div>
  );
}

export interface LedgerRowProps {
  credential: OverviewCredential;
  resolvedTheme: ResolvedTheme;
  nowMs: number;
  firstInLine: boolean;
  hideEmails: boolean;
  tier?: string | null;
  canRefresh: boolean;
  resetting: boolean;
  onRefresh: () => void;
  onReset: () => void;
  onRename: (note: string) => Promise<void>;
}

export function LedgerRow({
  credential,
  resolvedTheme,
  nowMs,
  firstInLine,
  hideEmails,
  tier,
  canRefresh,
  resetting,
  onRefresh,
  onReset,
  onRename,
}: LedgerRowProps) {
  const [editing, setEditing] = useState(false);
  const { t, i18n } = useTranslation();
  const { entry, quota } = credential;
  const file = entry.file;
  const status = quota?.status ?? 'idle';
  const loading = status === 'loading';
  const claudeReset = useClaudeResetGrants(
    file,
    entry.type === 'claude' && status !== 'idle',
    !canRefresh || loading || resetting,
    quota,
    onRefresh
  );
  const adapter = QUOTA_ADAPTERS[entry.type];

  let credits: ResetCreditView[] | null = null;
  let canUseReset = false;
  let useReset = () => {};
  if (entry.type === 'claude' && claudeReset.count !== null) {
    credits = claudeReset.grants
      .filter((grant) => grant.resetsLeft > 0)
      .map((grant) => {
        const ends = grant.endsAt ? Date.parse(grant.endsAt) : NaN;
        return {
          id: grant.id,
          count: grant.resetsLeft,
          label: grant.label || null,
          expiresAtMs: Number.isFinite(ends) ? ends : null,
          kind: resetGrantKind(grant),
        };
      });
    canUseReset = !claudeReset.blocked;
    useReset = claudeReset.confirm;
  } else if (entry.type === 'codex' && quota?.status === 'success') {
    const raw =
      (quota as { rateLimitResetCredits?: { id?: string; status?: string; expiresAt?: string }[] })
        .rateLimitResetCredits ?? [];
    credits = raw
      .filter((credit) => credit.status === 'available')
      .map((credit, index) => {
        const ends = Date.parse(credit.expiresAt ?? '');
        return {
          id: credit.id || `credit-${index}`,
          count: 1,
          label: null,
          expiresAtMs: Number.isFinite(ends) ? ends : null,
          kind: 'shared',
        };
      });
    canUseReset = Boolean(
      adapter.resetQuota && adapter.canResetQuota?.(quota) && canRefresh && !resetting
    );
    useReset = onReset;
  }

  const name = credentialLabel(file);
  const planLabel = tier
    ? tier
    : credential.plan
      ? ([
          `${adapter.i18nPrefix}.${credential.plan}`,
          `${adapter.i18nPrefix}.plan_${credential.plan}`,
        ]
          .filter((key) => i18n.exists(key))
          .map((key) => t(key))[0] ?? credential.plan)
      : null;
  const refreshLabel = status === 'idle' ? t('pd_overview.load') : t('pd_overview.refresh');

  return (
    <div
      className={styles.row}
      data-first={firstInLine || undefined}
      style={{ '--fable-color': fableColor(resolvedTheme) } as CSSProperties}
    >
      <div className={styles.rowIdentity}>
        <div className={styles.rowName}>
          <ProviderIcon provider={entry.type} resolvedTheme={resolvedTheme} />
          {editing ? (
            <NameEditor
              initial={file.note?.trim() ?? ''}
              onSave={onRename}
              onClose={() => setEditing(false)}
            />
          ) : (
            <>
              <Private text={name} hide={hideEmails} className={styles.mono} />
              <button
                type="button"
                className={styles.renameButton}
                onClick={() => setEditing(true)}
                aria-label={t('pd_overview.name_edit')}
                title={t('pd_overview.name_edit')}
              >
                <IconPencil size={13} aria-hidden="true" />
              </button>
            </>
          )}
        </div>
        <div className={styles.rowMeta}>
          <span
            className={styles.badge}
            title={t('pd_overview.priority_hint')}
            aria-label={t('pd_overview.priority_hint')}
          >
            {t('pd_overview.priority', { value: credential.priority })}
          </span>
          {planLabel && <span>{planLabel}</span>}
          {firstInLine && (
            <span className={styles.badgeActive} title={t('pd_overview.first_in_line_hint')}>
              {t('pd_overview.first_in_line')}
            </span>
          )}
          {credential.routing && (
            <span>
              {credential.routing.pool &&
                `${t(`pd_overview.routing_pool_${credential.routing.pool.key}`, {
                  defaultValue: credential.routing.pool.label,
                })}: `}
              {t(
                routingReasonKey(credential.routing.skippedReason || credential.routing.quotaState)
              )}
              {credential.routing.ageSeconds !== null &&
                ` · ${t('pd_overview.routing_age', { seconds: credential.routing.ageSeconds })}`}
              {credential.routing.window &&
                ` · ${credential.routing.window.key} · ${formatInstantShort(credential.routing.window.resetsAtMs)}`}
              {credential.routing.refreshError && ` · ${t('pd_overview.routing_refresh_error')}`}
            </span>
          )}
          {credential.source === 'proxy' && credential.observedAtMs !== null && (
            <span title={t('pd_overview.seen_hint')}>
              {t('pd_overview.seen', { time: formatCountdown(nowMs, credential.observedAtMs) })}
            </span>
          )}
          {file.disabled && <span className={styles.danger}>{t('pd_overview.disabled')}</span>}
          {credential.backAtMs !== null && (
            <span className={styles.danger}>
              {t('pd_overview.back_in', { time: formatCountdown(credential.backAtMs, nowMs) })}
            </span>
          )}
          {credential.backAtMs === null && credential.cooldownUntilMs !== null && (
            <span className={styles.warning} title={t('pd_overview.parked_hint')}>
              {t('pd_overview.parked', {
                time: formatCountdown(credential.cooldownUntilMs, nowMs),
              })}
            </span>
          )}
        </div>
        {name !== file.name && (
          <Private text={file.name} hide={hideEmails} className={styles.rowFile} />
        )}
      </div>

      <div className={styles.rowWindows}>
        {credential.windows.length > 0 ? (
          credential.windows.map((window) => (
            <div key={window.id} className={styles.window}>
              <div className={styles.windowHead}>
                <span className={styles.windowLabel} title={window.label}>
                  {window.label}
                </span>
                <strong>
                  {window.remaining === null ? '–' : `${Math.round(window.remaining)}%`}
                </strong>
              </div>
              <Bar percent={window.remaining} />
              <ResetWhen atMs={window.resetAtMs} nowMs={nowMs} />
            </div>
          ))
        ) : (
          <div className={styles.rowState}>
            {loading
              ? '…'
              : status === 'error'
                ? `${t('pd_overview.error')}${quota?.error ? `: ${quota.error}` : ''}`
                : t('pd_overview.not_loaded_row')}
          </div>
        )}
      </div>

      <ResetsCell
        credits={credits}
        nowMs={nowMs}
        canUse={canUseReset}
        onUse={useReset}
        readError={entry.type === 'claude' && claudeReset.message === 'read_error'}
      />

      <button
        type="button"
        className={styles.iconButton}
        disabled={!canRefresh || loading}
        onClick={onRefresh}
        aria-label={refreshLabel}
        title={refreshLabel}
      >
        <IconRefreshCw size={16} aria-hidden="true" className={loading ? styles.spin : undefined} />
      </button>
    </div>
  );
}
