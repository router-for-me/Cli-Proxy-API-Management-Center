import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import { useConfigStore } from '@/stores';
import styles from './UsageStatisticsPage.module.scss';

function getSafeUsageStatisticsUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

export function UsageStatisticsPage() {
  const { t } = useTranslation();
  const usageStatisticsUrl = useConfigStore(
    (state) => state.config?.usageStatisticsUrl?.trim() ?? ''
  );
  const safeUsageStatisticsUrl = getSafeUsageStatisticsUrl(usageStatisticsUrl);

  if (!safeUsageStatisticsUrl) {
    return (
      <EmptyState
        title={t('usage_statistics.empty_title')}
        description={t('usage_statistics.empty_desc')}
      />
    );
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.pageTitle}>{t('usage_statistics.title')}</h1>
      <div className={styles.frameShell}>
        <iframe
          className={styles.frame}
          src={safeUsageStatisticsUrl}
          title={t('usage_statistics.title')}
          loading="lazy"
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}
