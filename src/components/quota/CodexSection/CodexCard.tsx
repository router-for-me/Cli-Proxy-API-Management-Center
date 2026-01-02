/**
 * Individual Codex quota card component.
 */

import { useTranslation } from 'react-i18next';
import type {
  CodexQuotaState,
  AuthFileItem,
  ResolvedTheme,
  ThemeColors
} from '@/types';
import { TYPE_COLORS, normalizePlanType } from '@/utils/quota';
import styles from '@/pages/QuotaPage.module.scss';

interface CodexCardProps {
  item: AuthFileItem;
  quota?: CodexQuotaState;
  resolvedTheme: ResolvedTheme;
  getQuotaErrorMessage: (status: number | undefined, fallback: string) => string;
}

export function CodexCard({
  item,
  quota,
  resolvedTheme,
  getQuotaErrorMessage
}: CodexCardProps) {
  const { t } = useTranslation();

  const displayType = item.type || item.provider || 'codex';
  const typeColorSet = TYPE_COLORS[displayType] || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const quotaStatus = quota?.status ?? 'idle';
  const windows = quota?.windows ?? [];
  const planType = quota?.planType ?? null;
  const quotaErrorMessage = getQuotaErrorMessage(
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  const getTypeLabel = (type: string): string => {
    const key = `auth_files.filter_${type}`;
    const translated = t(key);
    if (translated !== key) return translated;
    if (type.toLowerCase() === 'iflow') return 'iFlow';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  const getPlanLabel = (pt?: string | null): string | null => {
    const normalized = normalizePlanType(pt);
    if (!normalized) return null;
    if (normalized === 'plus') return t('codex_quota.plan_plus');
    if (normalized === 'team') return t('codex_quota.plan_team');
    if (normalized === 'free') return t('codex_quota.plan_free');
    return pt || normalized;
  };

  const planLabel = getPlanLabel(planType);
  const isFreePlan = normalizePlanType(planType) === 'free';

  return (
    <div className={`${styles.fileCard} ${styles.codexCard}`}>
      <div className={styles.cardHeader}>
        <span
          className={styles.typeBadge}
          style={{
            backgroundColor: typeColor.bg,
            color: typeColor.text,
            ...(typeColor.border ? { border: typeColor.border } : {})
          }}
        >
          {getTypeLabel(displayType)}
        </span>
        <span className={styles.fileName}>{item.name}</span>
      </div>

      <div className={styles.quotaSection}>
        {quotaStatus === 'loading' ? (
          <div className={styles.quotaMessage}>{t('codex_quota.loading')}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t('codex_quota.idle')}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t('codex_quota.load_failed', {
              message: quotaErrorMessage
            })}
          </div>
        ) : (
          <>
            {planLabel && (
              <div className={styles.codexPlan}>
                <span className={styles.codexPlanLabel}>{t('codex_quota.plan_label')}</span>
                <span className={styles.codexPlanValue}>{planLabel}</span>
              </div>
            )}
            {isFreePlan ? (
              <div className={styles.quotaWarning}>{t('codex_quota.no_access')}</div>
            ) : windows.length === 0 ? (
              <div className={styles.quotaMessage}>{t('codex_quota.empty_windows')}</div>
            ) : (
              windows.map((window) => {
                const used = window.usedPercent;
                const clampedUsed = used === null ? null : Math.max(0, Math.min(100, used));
                const remaining =
                  clampedUsed === null ? null : Math.max(0, Math.min(100, 100 - clampedUsed));
                const percentLabel = remaining === null ? '--' : `${Math.round(remaining)}%`;
                const quotaBarClass =
                  remaining === null
                    ? styles.quotaBarFillMedium
                    : remaining >= 80
                      ? styles.quotaBarFillHigh
                      : remaining >= 50
                        ? styles.quotaBarFillMedium
                        : styles.quotaBarFillLow;

                const windowLabel = window.labelKey ? t(window.labelKey) : window.label;

                return (
                  <div key={window.id} className={styles.quotaRow}>
                    <div className={styles.quotaRowHeader}>
                      <span className={styles.quotaModel}>{windowLabel}</span>
                      <div className={styles.quotaMeta}>
                        <span className={styles.quotaPercent}>{percentLabel}</span>
                        <span className={styles.quotaReset}>{window.resetLabel}</span>
                      </div>
                    </div>
                    <div className={styles.quotaBar}>
                      <div
                        className={`${styles.quotaBarFill} ${quotaBarClass}`}
                        style={{ width: `${Math.round(remaining ?? 0)}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </div>
    </div>
  );
}
