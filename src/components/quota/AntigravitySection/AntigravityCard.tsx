/**
 * Individual Antigravity quota card component.
 */

import { useTranslation } from 'react-i18next';
import type {
  AntigravityQuotaState,
  AuthFileItem,
  ResolvedTheme,
  ThemeColors
} from '@/types';
import { TYPE_COLORS, formatQuotaResetTime } from '@/utils/quota';
import styles from '@/pages/QuotaPage.module.scss';

interface AntigravityCardProps {
  item: AuthFileItem;
  quota?: AntigravityQuotaState;
  resolvedTheme: ResolvedTheme;
  getQuotaErrorMessage: (status: number | undefined, fallback: string) => string;
}

export function AntigravityCard({
  item,
  quota,
  resolvedTheme,
  getQuotaErrorMessage
}: AntigravityCardProps) {
  const { t } = useTranslation();

  const displayType = item.type || item.provider || 'antigravity';
  const typeColorSet = TYPE_COLORS[displayType] || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const quotaStatus = quota?.status ?? 'idle';
  const quotaGroups = quota?.groups ?? [];
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

  return (
    <div className={`${styles.fileCard} ${styles.antigravityCard}`}>
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
          <div className={styles.quotaMessage}>{t('antigravity_quota.loading')}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t('antigravity_quota.idle')}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t('antigravity_quota.load_failed', {
              message: quotaErrorMessage
            })}
          </div>
        ) : quotaGroups.length === 0 ? (
          <div className={styles.quotaMessage}>{t('antigravity_quota.empty_models')}</div>
        ) : (
          quotaGroups.map((group) => {
            const clamped = Math.max(0, Math.min(1, group.remainingFraction));
            const percent = Math.round(clamped * 100);
            const resetLabel = formatQuotaResetTime(group.resetTime);
            const quotaBarClass =
              percent >= 60
                ? styles.quotaBarFillHigh
                : percent >= 20
                  ? styles.quotaBarFillMedium
                  : styles.quotaBarFillLow;
            return (
              <div key={group.id} className={styles.quotaRow}>
                <div className={styles.quotaRowHeader}>
                  <span className={styles.quotaModel} title={group.models.join(', ')}>
                    {group.label}
                  </span>
                  <div className={styles.quotaMeta}>
                    <span className={styles.quotaPercent}>{percent}%</span>
                    <span className={styles.quotaReset}>{resetLabel}</span>
                  </div>
                </div>
                <div className={styles.quotaBar}>
                  <div
                    className={`${styles.quotaBarFill} ${quotaBarClass}`}
                    style={{ width: `${percent}%` }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
