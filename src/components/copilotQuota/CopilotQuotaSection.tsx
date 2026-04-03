import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconRefreshCw } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import { copilotQuotaApi } from '@/services/api';
import type { CopilotQuotaResponse } from '@/types';
import { CopilotQuotaCard } from './CopilotQuotaCard';
import { CopilotDeviceCodeModal } from './CopilotDeviceCodeModal';
import styles from '@/pages/QuotaPage.module.scss';

interface CopilotQuotaSectionProps {
  disabled: boolean;
}

export function CopilotQuotaSection({ disabled }: CopilotQuotaSectionProps) {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [data, setData] = useState<CopilotQuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const fetchQuota = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await copilotQuotaApi.getQuota(force);
      setData(res);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    fetchQuota();
  }, [fetchQuota]);

  const handleRemoveAccount = (email: string) => {
    showConfirmation({
      title: t('copilot_quota.remove_confirm_title'),
      message: t('copilot_quota.remove_confirm_message', { email }),
      variant: 'danger',
      onConfirm: async () => {
        try {
          await copilotQuotaApi.removeAccount(email);
          showNotification(t('copilot_quota.account_removed', { email }), 'success');
          fetchQuota(true);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          showNotification(t('copilot_quota.error_remove', { message }), 'error');
        }
      }
    });
  };

  const handleModalSuccess = (_email: string) => {
    setIsModalOpen(false);
    fetchQuota(true);
  };

  const accountCount = data?.accounts?.length || 0;
  const isRefreshing = loading;

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t('copilot_quota.title')}</span>
      {accountCount > 0 && (
        <span className={styles.countBadge}>{accountCount}</span>
      )}
    </div>
  );

  const headerActionsNode = (
    <div className={styles.headerActions}>
      <Button
        variant="secondary"
        size="sm"
        className={styles.refreshAllButton}
        onClick={() => fetchQuota(true)}
        disabled={disabled || isRefreshing}
        loading={isRefreshing}
      >
        {!isRefreshing && <IconRefreshCw size={16} />}
        {t('copilot_quota.refresh')}
      </Button>
      <Button
        variant="primary"
        size="sm"
        disabled={disabled}
        onClick={() => setIsModalOpen(true)}
      >
        {t('copilot_quota.add_account')}
      </Button>
    </div>
  );

  return (
    <>
      <Card title={titleNode} extra={headerActionsNode}>
        {loading && !data ? (
          <div className={styles.quotaMessage}>{t('copilot_quota.loading')}</div>
        ) : error && !data ? (
          <div className={styles.quotaError}>{error}</div>
        ) : accountCount === 0 ? (
          <EmptyState
            title={t('copilot_quota.empty_title')}
            description={data?.message || t('copilot_quota.empty_desc')}
          />
        ) : (
          <div className={styles.copilotGrid}>
            {data?.accounts.map((account) => (
              <CopilotQuotaCard
                key={account.email}
                account={account}
                onRemove={handleRemoveAccount}
                disabled={disabled}
              />
            ))}
          </div>
        )}
      </Card>

      <CopilotDeviceCodeModal
        open={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSuccess={handleModalSuccess}
      />
    </>
  );
}
