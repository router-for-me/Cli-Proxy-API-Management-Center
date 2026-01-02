/**
 * Individual Gemini CLI quota card component.
 */

import { useTranslation } from 'react-i18next';
import type {
  GeminiCliQuotaState,
  AuthFileItem,
  ResolvedTheme,
  ThemeColors
} from '@/types';
import { TYPE_COLORS, formatQuotaResetTime } from '@/utils/quota';
import styles from '@/pages/QuotaPage.module.scss';

interface GeminiCliCardProps {
  item: AuthFileItem;
  quota?: GeminiCliQuotaState;
  resolvedTheme: ResolvedTheme;
  getQuotaErrorMessage: (status: number | undefined, fallback: string) => string;
}

export function GeminiCliCard({
  item,
  quota,
  resolvedTheme,
  getQuotaErrorMessage
}: GeminiCliCardProps) {
  const { t } = useTranslation();

  const displayType = item.type || item.provider || 'gemini-cli';
  const typeColorSet = TYPE_COLORS[displayType] || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const quotaStatus = quota?.status ?? 'idle';
  const buckets = quota?.buckets ?? [];
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
    <div className={`${styles.fileCard} ${styles.geminiCliCard}`}>
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
          <div className={styles.quotaMessage}>{t('gemini_cli_quota.loading')}</div>
        ) : quotaStatus === 'idle' ? (
          <div className={styles.quotaMessage}>{t('gemini_cli_quota.idle')}</div>
        ) : quotaStatus === 'error' ? (
          <div className={styles.quotaError}>
            {t('gemini_cli_quota.load_failed', {
              message: quotaErrorMessage
            })}
          </div>
        ) : buckets.length === 0 ? (
          <div className={styles.quotaMessage}>{t('gemini_cli_quota.empty_buckets')}</div>
        ) : (
          buckets.map((bucket) => {
            const fraction = bucket.remainingFraction;
            const clamped = fraction === null ? null : Math.max(0, Math.min(1, fraction));
            const percent = clamped === null ? null : Math.round(clamped * 100);
            const percentLabel = percent === null ? '--' : `${percent}%`;
            const resetLabel = formatQuotaResetTime(bucket.resetTime);
            const remainingAmountLabel =
              bucket.remainingAmount === null || bucket.remainingAmount === undefined
                ? null
                : t('gemini_cli_quota.remaining_amount', {
                    count: bucket.remainingAmount
                  });
            const titleBase =
              bucket.modelIds && bucket.modelIds.length > 0
                ? bucket.modelIds.join(', ')
                : bucket.label;
            const quotaBarClass =
              percent === null
                ? styles.quotaBarFillMedium
                : percent >= 60
                  ? styles.quotaBarFillHigh
                  : percent >= 20
                    ? styles.quotaBarFillMedium
                    : styles.quotaBarFillLow;

            return (
              <div key={bucket.id} className={styles.quotaRow}>
                <div className={styles.quotaRowHeader}>
                  <span
                    className={styles.quotaModel}
                    title={bucket.tokenType ? `${titleBase} (${bucket.tokenType})` : titleBase}
                  >
                    {bucket.label}
                  </span>
                  <div className={styles.quotaMeta}>
                    <span className={styles.quotaPercent}>{percentLabel}</span>
                    {remainingAmountLabel && (
                      <span className={styles.quotaAmount}>{remainingAmountLabel}</span>
                    )}
                    <span className={styles.quotaReset}>{resetLabel}</span>
                  </div>
                </div>
                <div className={styles.quotaBar}>
                  <div
                    className={`${styles.quotaBarFill} ${quotaBarClass}`}
                    style={{ width: `${percent ?? 0}%` }}
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
