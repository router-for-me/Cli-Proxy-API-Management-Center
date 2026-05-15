import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './UsageStatPage.module.scss';

const DEFAULT_USAGE_KEEPER_URL = 'https://api_stat.i.tangworks.net';

const resolveUsageKeeperUrl = (): string => {
  const configured = String(import.meta.env.VITE_USAGE_KEEPER_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  return DEFAULT_USAGE_KEEPER_URL;
};

export function UsageStatPage() {
  const { t } = useTranslation();
  const usageKeeperUrl = useMemo(() => resolveUsageKeeperUrl(), []);

  return (
    <div className={styles.container}>
      <iframe
        title={t('usage_stat.iframe_title')}
        src={usageKeeperUrl}
        className={styles.iframe}
      />
    </div>
  );
}
