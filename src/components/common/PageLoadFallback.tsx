import { useTranslation } from 'react-i18next';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import styles from './PageLoadFallback.module.scss';

interface PageLoadFallbackProps {
  fullScreen?: boolean;
  label?: string;
}

export function PageLoadFallback({
  fullScreen = false,
  label,
}: PageLoadFallbackProps) {
  const { t } = useTranslation();

  return (
    <div className={`${styles.wrapper} ${fullScreen ? styles.fullScreen : ''}`} role="status">
      <div className={styles.panel}>
        <LoadingSpinner size={18} className={styles.spinner} />
        <span className={styles.label}>{label ?? t('common.loading')}</span>
      </div>
    </div>
  );
}
