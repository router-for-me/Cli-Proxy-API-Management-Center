/**
 * Full-screen loading state while a session is restored (fork): a word and an
 * indeterminate bar, nothing else.
 */

import { useTranslation } from 'react-i18next';
import styles from './BootLoader.module.scss';

export function BootLoader() {
  const { t } = useTranslation();
  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <span className={styles.label}>{t('prox.loading')}</span>
      <span className={styles.track} aria-hidden="true">
        <span className={styles.bar} />
      </span>
    </div>
  );
}
