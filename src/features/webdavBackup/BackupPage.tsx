import { useTranslation } from 'react-i18next';
import { WebdavConnectionCard } from './components/WebdavConnectionCard';
import { ManualBackupCard } from './components/ManualBackupCard';
import { RestoreCard } from './components/RestoreCard';
import styles from './backup.module.scss';

export function BackupPage() {
  const { t } = useTranslation();

  return (
    <div className="page">
      <div className="page-header">
        <h1>{t('backup.page_title')}</h1>
        <p className="subtitle">{t('backup.page_subtitle')}</p>
      </div>
      <div className={styles.stackLg}>
        <WebdavConnectionCard />
        <ManualBackupCard />
        <RestoreCard />
      </div>
    </div>
  );
}
