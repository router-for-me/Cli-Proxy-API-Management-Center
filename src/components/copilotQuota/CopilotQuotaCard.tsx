import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { QuotaProgressBar } from '@/components/quota/QuotaCard';
import type { CopilotAccountQuota, CopilotQuotaSnapshot } from '@/types';
import { TYPE_COLORS } from '@/utils/quota';
import { useThemeStore } from '@/stores';
import type { ThemeColors } from '@/types';
import styles from '@/pages/QuotaPage.module.scss';
import cardStyles from './CopilotQuotaSection.module.scss';

interface CopilotQuotaCardProps {
  account: CopilotAccountQuota;
  onRemove: (email: string) => void;
  disabled: boolean;
}

export function CopilotQuotaCard({ account, onRemove, disabled }: CopilotQuotaCardProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const typeColorSet = TYPE_COLORS.copilot || TYPE_COLORS.unknown;
  const typeColor: ThemeColors =
    resolvedTheme === 'dark' && typeColorSet.dark ? typeColorSet.dark : typeColorSet.light;

  const renderQuotaRow = (key: keyof typeof account.quota_snapshots, label: string) => {
    const snapshot: CopilotQuotaSnapshot = account.quota_snapshots[key];
    const remainingPercent = 100 - snapshot.percent_used;

    return (
      <div className={styles.quotaRow} key={key}>
        <div className={styles.quotaRowHeader}>
          <span className={styles.quotaModel}>{label}</span>
        </div>

        {snapshot.unlimited ? (
          <div className={styles.quotaAmount}>{t('copilot_quota.unlimited')}</div>
        ) : (
          <>
            <QuotaProgressBar percent={remainingPercent} highThreshold={70} mediumThreshold={30} />
            <div className={styles.quotaMeta}>
              <span className={styles.quotaPercent}>
                {t('copilot_quota.percent_used', { percent: snapshot.percent_used.toFixed(1) })}
              </span>
              <span className={styles.quotaAmount}>
                {t('copilot_quota.used_of_total', { used: snapshot.used, total: snapshot.entitlement })}
              </span>
              <span className={styles.quotaAmount}>
                {t('copilot_quota.remaining', { remaining: snapshot.remaining })}
              </span>
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div className={`${styles.fileCard} ${styles.copilotCard}`}>
      <div className={styles.cardHeader}>
        <span
          className={styles.typeBadge}
          style={{
            backgroundColor: typeColor.bg,
            color: typeColor.text,
            ...(typeColor.border ? { border: typeColor.border } : {})
          }}
        >
          Copilot
        </span>
        <span className={styles.fileName}>{account.email}</span>
      </div>

      <div className={styles.quotaSection}>
        {account.error ? (
          <div className={styles.quotaError}>{account.error}</div>
        ) : (
          <>
            {renderQuotaRow('premium_interactions', t('copilot_quota.premium_interactions'))}
            {renderQuotaRow('completions', t('copilot_quota.completions'))}
            {renderQuotaRow('chat', t('copilot_quota.chat'))}
          </>
        )}
      </div>

      <div className={cardStyles.copilotCardFooter}>
        <div className={cardStyles.copilotCardMeta}>
          {account.plan && (
            <span className={cardStyles.copilotPlan}>
              {t('copilot_quota.plan', { plan: account.plan })}
            </span>
          )}
          {account.reset_date && (
            <span>{t('copilot_quota.reset_date', { date: new Date(account.reset_date).toLocaleDateString() })}</span>
          )}
        </div>
        <Button
          variant="danger"
          size="sm"
          disabled={disabled}
          onClick={() => onRemove(account.email)}
        >
          {t('copilot_quota.remove_account')}
        </Button>
      </div>
    </div>
  );
}
