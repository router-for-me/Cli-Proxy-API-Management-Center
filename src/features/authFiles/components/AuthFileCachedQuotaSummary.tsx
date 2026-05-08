import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type {
  AntigravityQuotaGroup,
  AntigravityQuotaState,
  ClaudeQuotaState,
  ClaudeQuotaWindow,
  CodexQuotaState,
  CodexQuotaWindow,
  GeminiCliQuotaBucketState,
  GeminiCliQuotaState,
  KimiQuotaRow,
  KimiQuotaState,
} from '@/types';
import { useQuotaStore } from '@/stores';
import { formatQuotaResetTime, normalizePlanType } from '@/utils/quota';
import type { QuotaProviderType } from '@/features/authFiles/constants';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import { hasCachedQuota, type QuotaStore } from '@/components/quota/quotaConfigs';
import styles from '@/pages/AuthFilesPage.module.scss';

type CachedQuotaState =
  | AntigravityQuotaState
  | ClaudeQuotaState
  | CodexQuotaState
  | GeminiCliQuotaState
  | KimiQuotaState;

type AuthFileCachedQuotaSummaryProps = {
  fileName: string;
  quotaType: QuotaProviderType;
};

const MAX_ROWS = 2;
const CODEX_PRIMARY_WINDOWS = ['five-hour', 'weekly'];
const PREMIUM_CODEX_PLAN_TYPES = new Set(['pro', 'prolite', 'pro-lite', 'pro_lite']);
const PREMIUM_GEMINI_CLI_TIER_IDS = new Set(['g1-ultra-tier']);
const QUOTA_STORE_KEYS = {
  antigravity: 'antigravityQuota',
  claude: 'claudeQuota',
  codex: 'codexQuota',
  kimi: 'kimiQuota',
  'gemini-cli': 'geminiCliQuota',
} satisfies Record<QuotaProviderType, keyof Pick<
  QuotaStore,
  'antigravityQuota' | 'claudeQuota' | 'codexQuota' | 'geminiCliQuota' | 'kimiQuota'
>>;

const clampPercent = (value: number | null): number | null => {
  if (value === null || Number.isNaN(value)) return null;
  return Math.max(0, Math.min(100, value));
};

const formatPercentLabel = (value: number | null): string => {
  const normalized = clampPercent(value);
  return normalized === null ? '--' : `${Math.round(normalized)}%`;
};

const formatRelativeTime = (value: number, locale: string): string => {
  const diffSeconds = Math.round((value - Date.now()) / 1000);

  if (typeof Intl !== 'undefined' && typeof Intl.RelativeTimeFormat === 'function') {
    const formatter = new Intl.RelativeTimeFormat(locale || undefined, { numeric: 'auto' });

    if (Math.abs(diffSeconds) < 60) {
      return formatter.format(diffSeconds, 'second');
    }

    const diffMinutes = Math.round(diffSeconds / 60);
    if (Math.abs(diffMinutes) < 60) {
      return formatter.format(diffMinutes, 'minute');
    }

    const diffHours = Math.round(diffMinutes / 60);
    if (Math.abs(diffHours) < 24) {
      return formatter.format(diffHours, 'hour');
    }

    const diffDays = Math.round(diffHours / 24);
    return formatter.format(diffDays, 'day');
  }

  return new Date(value).toLocaleString(locale || undefined);
};

const resolveCodexPlanLabel = (
  planType: string | null | undefined,
  t: (key: string) => string
): { label: string | null; premium: boolean } => {
  const normalized = normalizePlanType(planType);
  if (!normalized) {
    return { label: null, premium: false };
  }
  if (normalized === 'pro') {
    return { label: t('codex_quota.plan_pro'), premium: true };
  }
  if (PREMIUM_CODEX_PLAN_TYPES.has(normalized) && normalized !== 'pro') {
    return { label: t('codex_quota.plan_prolite'), premium: true };
  }
  if (normalized === 'plus') {
    return { label: t('codex_quota.plan_plus'), premium: false };
  }
  if (normalized === 'team') {
    return { label: t('codex_quota.plan_team'), premium: false };
  }
  if (normalized === 'free') {
    return { label: t('codex_quota.plan_free'), premium: false };
  }
  return { label: planType || normalized, premium: false };
};

const pickCodexWindows = (windows: CodexQuotaWindow[]): CodexQuotaWindow[] =>
  [...windows]
    .sort((left, right) => {
      const leftIndex = CODEX_PRIMARY_WINDOWS.indexOf(left.id);
      const rightIndex = CODEX_PRIMARY_WINDOWS.indexOf(right.id);
      if (leftIndex === -1 && rightIndex === -1) return 0;
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    })
    .slice(0, MAX_ROWS);

const renderWindowRow = (
  label: string,
  remainingPercent: number | null,
  resetLabel: string,
  key: string,
  options?: { amountLabel?: string | null; resetRecovered?: boolean }
) => {
  const resetClassName = options?.resetRecovered
    ? `${styles.quotaReset} ${styles.quotaResetRecovered}`
    : styles.quotaReset;

  return (
    <div key={key} className={styles.quotaRow}>
      <div className={styles.quotaRowHeader}>
        <span className={styles.quotaModel}>{label}</span>
        <div className={styles.quotaMeta}>
          <span className={styles.quotaPercent}>{formatPercentLabel(remainingPercent)}</span>
          {options?.amountLabel ? (
            <span className={styles.quotaAmount}>{options.amountLabel}</span>
          ) : null}
          <span className={resetClassName}>{resetLabel}</span>
        </div>
      </div>
      <QuotaProgressBar
        percent={remainingPercent}
        highThreshold={70}
        mediumThreshold={30}
      />
    </div>
  );
};

const renderCodexSummary = (
  quota: CodexQuotaState,
  t: TFunction
) => {
  const plan = resolveCodexPlanLabel(quota.planType, t);
  const windows = pickCodexWindows(quota.windows ?? []);

  return (
    <>
      {plan.label ? (
        <div className={styles.codexPlan}>
          <span className={styles.codexPlanLabel}>{t('codex_quota.plan_label')}</span>
          <span className={plan.premium ? styles.premiumPlanValue : styles.codexPlanValue}>
            {plan.label}
          </span>
        </div>
      ) : null}
      {windows.length === 0 ? (
        <div className={styles.quotaMessage}>{t('codex_quota.empty_windows')}</div>
      ) : (
        windows.map((window) => {
          const remainingPercent =
            window.usedPercent === null ? null : 100 - window.usedPercent;
          const label = window.labelKey
            ? t(window.labelKey, window.labelParams as Record<string, unknown>)
            : window.label;
          return renderWindowRow(label, remainingPercent, window.resetLabel, window.id, {
            resetRecovered: window.isFreshQuotaWindow,
          });
        })
      )}
    </>
  );
};

const renderClaudeSummary = (
  quota: ClaudeQuotaState,
  t: TFunction
) => {
  const windows = (quota.windows ?? []).slice(0, MAX_ROWS);

  return (
    <>
      {quota.planType ? (
        <div className={styles.codexPlan}>
          <span className={styles.codexPlanLabel}>{t('claude_quota.plan_label')}</span>
          <span className={styles.codexPlanValue}>{t(`claude_quota.${quota.planType}`)}</span>
        </div>
      ) : null}
      {quota.extraUsage?.is_enabled ? (
        <div className={styles.codexPlan}>
          <span className={styles.codexPlanLabel}>{t('claude_quota.extra_usage_label')}</span>
          <span className={styles.codexPlanValue}>
            {`$${(quota.extraUsage.used_credits / 100).toFixed(2)} / $${(
              quota.extraUsage.monthly_limit / 100
            ).toFixed(2)}`}
          </span>
        </div>
      ) : null}
      {windows.length === 0 ? (
        <div className={styles.quotaMessage}>{t('claude_quota.empty_windows')}</div>
      ) : (
        windows.map((window: ClaudeQuotaWindow) =>
          renderWindowRow(
            window.labelKey ? t(window.labelKey) : window.label,
            window.usedPercent === null ? null : 100 - window.usedPercent,
            window.resetLabel,
            window.id
          )
        )
      )}
    </>
  );
};

const renderGeminiCliSummary = (
  quota: GeminiCliQuotaState,
  t: TFunction
) => {
  const buckets = (quota.buckets ?? []).slice(0, MAX_ROWS);

  return (
    <>
      {quota.tierLabel ? (
        <div className={styles.codexPlan}>
          <span className={styles.codexPlanLabel}>{t('gemini_cli_quota.tier_label')}</span>
          <span
            className={
              quota.tierId && PREMIUM_GEMINI_CLI_TIER_IDS.has(quota.tierId)
                ? styles.premiumPlanValue
                : styles.codexPlanValue
            }
          >
            {quota.tierLabel}
          </span>
        </div>
      ) : null}
      {quota.creditBalance !== null && quota.creditBalance !== undefined ? (
        <div className={styles.codexPlan}>
          <span className={styles.codexPlanLabel}>{t('gemini_cli_quota.credit_label')}</span>
          <span className={styles.codexPlanValue}>
            {t('gemini_cli_quota.credit_amount', { count: quota.creditBalance })}
          </span>
        </div>
      ) : null}
      {buckets.length === 0 ? (
        <div className={styles.quotaMessage}>{t('gemini_cli_quota.empty_buckets')}</div>
      ) : (
        buckets.map((bucket: GeminiCliQuotaBucketState) =>
          renderWindowRow(
            bucket.label,
            bucket.remainingFraction === null ? null : bucket.remainingFraction * 100,
            formatQuotaResetTime(bucket.resetTime),
            bucket.id,
            {
              amountLabel:
                bucket.remainingAmount === null || bucket.remainingAmount === undefined
                  ? null
                  : t('gemini_cli_quota.remaining_amount', {
                      count: bucket.remainingAmount,
                    }),
            }
          )
        )
      )}
    </>
  );
};

const renderAntigravitySummary = (
  quota: AntigravityQuotaState,
  t: TFunction
) => {
  const groups = (quota.groups ?? []).slice(0, MAX_ROWS);

  return groups.length === 0 ? (
    <div className={styles.quotaMessage}>{t('antigravity_quota.empty_models')}</div>
  ) : (
    <>
      {groups.map((group: AntigravityQuotaGroup) =>
        renderWindowRow(
          group.label,
          group.remainingFraction * 100,
          formatQuotaResetTime(group.resetTime),
          group.id
        )
      )}
    </>
  );
};

const renderKimiSummary = (
  quota: KimiQuotaState,
  t: TFunction
) => {
  const rows = (quota.rows ?? []).slice(0, MAX_ROWS);

  return rows.length === 0 ? (
    <div className={styles.quotaMessage}>{t('kimi_quota.empty_data')}</div>
  ) : (
    <>
      {rows.map((row: KimiQuotaRow) =>
        renderWindowRow(
          row.labelKey
            ? t(row.labelKey, row.labelParams as Record<string, unknown>)
            : row.label || row.id,
          row.limit > 0 ? ((row.limit - row.used) / row.limit) * 100 : null,
          row.resetHint || '-',
          row.id
        )
      )}
    </>
  );
};

const QUOTA_SUMMARY_RENDERERS: Record<
  QuotaProviderType,
  (quota: CachedQuotaState, t: TFunction) => ReactNode
> = {
  antigravity: (quota, t) => renderAntigravitySummary(quota as AntigravityQuotaState, t),
  claude: (quota, t) => renderClaudeSummary(quota as ClaudeQuotaState, t),
  codex: (quota, t) => renderCodexSummary(quota as CodexQuotaState, t),
  kimi: (quota, t) => renderKimiSummary(quota as KimiQuotaState, t),
  'gemini-cli': (quota, t) => renderGeminiCliSummary(quota as GeminiCliQuotaState, t),
};

export function AuthFileCachedQuotaSummary(props: AuthFileCachedQuotaSummaryProps) {
  const { fileName, quotaType } = props;
  const { t, i18n } = useTranslation();

  const quota = useQuotaStore(
    (state) =>
      (state[QUOTA_STORE_KEYS[quotaType]] as Record<string, CachedQuotaState | undefined>)[fileName]
  );

  if (!hasCachedQuota(quota)) {
    return null;
  }

  return (
    <div className={styles.cachedQuotaSummary}>
      <div className={styles.cachedQuotaHeader}>
        <span className={styles.cachedQuotaLabel}>{t('auth_files.quota_cached_label')}</span>
        <span className={styles.cachedQuotaTimestamp}>
          {formatRelativeTime(quota.checkedAt, i18n.language)}
        </span>
      </div>
      {QUOTA_SUMMARY_RENDERERS[quotaType](quota, t)}
    </div>
  );
}
