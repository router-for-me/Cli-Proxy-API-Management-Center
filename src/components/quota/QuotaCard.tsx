/**
 * Generic quota card component.
 */

import { memo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { Button } from '@/components/ui/Button';
import { IconPencil, IconRefreshCw } from '@/components/ui/icons';
import type { AuthFileItem, ResolvedTheme, ThemeColors } from '@/types';
import { TYPE_COLORS, resolveQuotaErrorMessage } from '@/utils/quota';
import { QuotaProgressBar, type QuotaProgressBarProps } from './QuotaProgressBar';
import type { QuotaPlanTier } from './quotaConfigs';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaStatus = 'idle' | 'loading' | 'success' | 'error';

/**
 * Geometric provider marks. Shape distinguishes providers as well as colour, so
 * identity survives at 18px and doesn't rely on hue alone.
 */
const PROVIDER_MARK: Record<string, ReactElement> = {
  claude: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M12 3v18M3 12h18M5.6 5.6l12.8 12.8M18.4 5.6L5.6 18.4" />
    </svg>
  ),
  antigravity: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinejoin="round"
    >
      <path d="M12 3l8 15H4z" />
    </svg>
  ),
  codex: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinejoin="round"
    >
      <path d="M12 2.8 21.2 12 12 21.2 2.8 12z" />
    </svg>
  ),
  kimi: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
    >
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    </svg>
  ),
  xai: (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
    >
      <path d="M5 5l14 14M19 5L5 19" />
    </svg>
  ),
};

const FALLBACK_MARK: ReactElement = (
  <svg
    width="11"
    height="11"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
  >
    <circle cx="12" cy="12" r="8" />
  </svg>
);

/** `#rrggbb` / `#rgb` -> `"r, g, b"` for use inside rgba(). Null when unparseable. */
function hexToRgbTriple(hex: string): string | null {
  const value = hex.trim().replace(/^#/, '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const int = parseInt(full, 16);
  return `${(int >> 16) & 255}, ${(int >> 8) & 255}, ${int & 255}`;
}

export interface QuotaStatusState {
  status: QuotaStatus;
  error?: string;
  errorStatus?: number;
}

/**
 * Health dot colour for the strip. Same thresholds as the progress bars, so a
 * card's dot and its bars never disagree about what "low" means.
 */
function dotClass(percent: number): string {
  if (percent >= 70) return styles.stripDotHigh;
  if (percent >= 30) return styles.stripDotMedium;
  return styles.stripDotLow;
}

export type { QuotaProgressBarProps } from './QuotaProgressBar';

/** Paid Codex tiers keep the gold/diamond badge treatment on the strip. */
const PLAN_TIER_CLASS: Record<QuotaPlanTier, string> = {
  elite: styles.elitePlanValue,
  premium: styles.premiumPlanValue,
  standard: '',
};

/** 配额页外衣的进度条：绑定 QuotaPage 模块样式，满足 QuotaRenderHelpers 契约。 */
const BoundQuotaProgressBar = (props: QuotaProgressBarProps) => (
  <QuotaProgressBar {...props} styles={styles} />
);

export interface QuotaRenderHelpers {
  styles: typeof styles;
  QuotaProgressBar: (props: QuotaProgressBarProps) => ReactElement;
}

interface QuotaCardProps<TState extends QuotaStatusState> {
  item: AuthFileItem;
  quota?: TState;
  resolvedTheme: ResolvedTheme;
  i18nPrefix: string;
  cardClassName: string;
  defaultType: string;
  canRefresh?: boolean;
  onRefresh?: () => void;
  resetQuotaAction?: ReactNode;
  renderQuotaItems: (quota: TState, t: TFunction, helpers: QuotaRenderHelpers) => ReactNode;
  /** Display name — a local nickname when set, otherwise the account label. */
  displayName?: string;
  /** Called with the new name when the inline rename is committed. */
  onRename?: (nickname: string) => void;
  /** Plan/tier for the strip badge; omitted when the provider exposes none. */
  plan?: string | null;
  /** Badge treatment for that plan — Codex's paid tiers get the gold/diamond look. */
  planTier?: QuotaPlanTier;
  /** Lowest remaining percent, for the strip health dot. Null when unknown. */
  worstRemaining?: number | null;
  /** Optional secondary figure shown in the footer beside the actions. */
  footerNote?: { label: string; value: string } | null;
}

function QuotaCardImpl<TState extends QuotaStatusState>({
  item,
  quota,
  resolvedTheme,
  i18nPrefix,
  cardClassName,
  defaultType,
  canRefresh = false,
  onRefresh,
  resetQuotaAction,
  renderQuotaItems,
  displayName,
  onRename,
  plan,
  planTier = 'standard',
  worstRemaining,
  footerNote,
}: QuotaCardProps<TState>) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);

  const displayType = item.type || item.provider || defaultType;
  const typeColorSet = TYPE_COLORS[displayType] || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const quotaStatus = quota?.status ?? 'idle';
  const quotaLoading = quotaStatus === 'loading';
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );
  const idleMessageKey = `${i18nPrefix}.idle`;

  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (type.toLowerCase() === 'iflow') return 'iFlow';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  // A local nickname wins; otherwise the human-facing label the API returns
  // (account email / auth label); finally the filename, so it's never empty.
  const title = displayName || item.label?.trim() || item.email?.trim() || item.name;
  const showFileName = title !== item.name;

  // Drive the card's provider variables from the existing TYPE_COLORS source of
  // truth rather than duplicating hexes in SCSS — this also covers providers the
  // stylesheet doesn't enumerate (qwen, gemini, iflow, vertex, …).
  const accentRgb = hexToRgbTriple(typeColor.text);
  const providerVars = {
    '--provider-accent': typeColor.text,
    '--provider-chip-bg': typeColor.bg,
    ...(accentRgb ? { '--provider-rgb': accentRgb } : {}),
  } as CSSProperties;

  return (
    <div className={`${styles.fileCard} ${cardClassName}`} style={providerVars}>
      <div className={styles.cardStrip}>
        <span className={styles.providerMark}>{PROVIDER_MARK[displayType] ?? FALLBACK_MARK}</span>
        <span className={styles.providerName}>{getTypeLabel(displayType)}</span>
        <span className={styles.stripSpacer} />
        {/* Health at a glance, before any number is read. Hidden when quota
            hasn't loaded — a grey dot would read as a state, not as absence. */}
        {worstRemaining !== null && worstRemaining !== undefined && (
          <span
            className={`${styles.stripDot} ${dotClass(worstRemaining)}`}
            title={t('quota_management.lowest_remaining_value', {
              percent: worstRemaining,
              defaultValue: `${worstRemaining}% lowest remaining`,
            })}
          />
        )}
        {plan && (
          <span className={`${styles.stripPlan} ${PLAN_TIER_CLASS[planTier] ?? ''}`}>{plan}</span>
        )}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardHeader}>
          {renaming && onRename ? (
            <input
              className={styles.cardTitleInput}
              defaultValue={displayName ?? title}
              autoFocus
              aria-label={t('quota_management.rename', { defaultValue: 'Rename credential' })}
              // Commit on blur and Enter; Escape abandons. Clearing the field
              // removes the override rather than blanking the card.
              onBlur={(event) => {
                onRename(event.currentTarget.value);
                setRenaming(false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
                if (event.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <span className={styles.cardTitle} title={title}>
              <span className={styles.cardTitleText}>{title}</span>
              {onRename && (
                <button
                  type="button"
                  className={styles.renameButton}
                  onClick={() => setRenaming(true)}
                  title={t('quota_management.rename', { defaultValue: 'Rename credential' })}
                  aria-label={t('quota_management.rename', { defaultValue: 'Rename credential' })}
                >
                  <IconPencil size={12} />
                </button>
              )}
            </span>
          )}
          {showFileName && (
            <span className={styles.fileName} title={item.name}>
              {item.name}
            </span>
          )}
        </div>

        <div className={styles.quotaSection}>
          {quotaLoading ? (
            <div className={styles.quotaMessage}>{t(`${i18nPrefix}.loading`)}</div>
          ) : quotaStatus === 'idle' ? (
            onRefresh ? (
              <button
                type="button"
                className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
                onClick={onRefresh}
                disabled={!canRefresh}
              >
                {t(idleMessageKey)}
              </button>
            ) : (
              <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
            )
          ) : quotaStatus === 'error' ? (
            <div className={styles.quotaError}>
              {t(`${i18nPrefix}.load_failed`, {
                message: quotaErrorMessage,
              })}
            </div>
          ) : quota ? (
            renderQuotaItems(quota, t, { styles, QuotaProgressBar: BoundQuotaProgressBar })
          ) : (
            <div className={styles.quotaMessage}>{t(idleMessageKey)}</div>
          )}
        </div>

        {(footerNote || resetQuotaAction || (onRefresh && quotaStatus !== 'idle')) && (
          <div
            className={`${styles.quotaCardActions} ${
              resetQuotaAction ? styles.quotaCardActionsCrowded : ''
            }`}
          >
            {/* Sits beside the actions rather than above them, so an optional
                value never adds a row — cards with and without it stay the
                same height and the grid rows stay level. */}
            {footerNote && (
              <span
                className={styles.cardFooterNote}
                title={`${footerNote.label} ${footerNote.value}`}
              >
                {/* The label is hidden below ~2 buttons' worth of room rather
                    than ellipsed: "Renewal ti…" reads as broken, whereas the
                    bare value still informs and the full text is in the
                    tooltip. */}
                <span className={styles.cardFooterNoteLabel}>{footerNote.label}</span>
                <b>{footerNote.value}</b>
              </span>
            )}
            <span className={styles.stripSpacer} />
            {resetQuotaAction}
            {onRefresh && quotaStatus !== 'idle' && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className={styles.quotaRefreshButton}
                onClick={onRefresh}
                disabled={!canRefresh || quotaLoading}
                loading={quotaLoading}
                title={t('auth_files.quota_refresh_hint')}
              >
                {!quotaLoading && <IconRefreshCw size={14} />}
                {t('auth_files.quota_refresh_single')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Memoized: the flat board subscribes to all five store slices in one place, so
 * without this a single credential's refresh re-renders every card on the page.
 *
 * `memo` erases the generic, so the cast restores the call signature. The
 * default shallow comparison is correct here — every prop is either a stable
 * config field, a store-owned state object, or a callback the page memoizes.
 */
export const QuotaCard = memo(QuotaCardImpl) as typeof QuotaCardImpl;
