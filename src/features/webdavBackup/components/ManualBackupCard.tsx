import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Select } from '@/components/ui/Select';
import { useNotificationStore } from '@/stores';
import { useWebdavStore } from '../store/useWebdavStore';
import { useBackupActions } from '../hooks/useBackupActions';
import { MAX_BACKUP_COUNT_OPTIONS } from '../constants';
import type { AutoBackupInterval } from '../types';
import styles from '../backup.module.scss';

const SCOPE_ITEMS = ['localStorage', 'config', 'usage'] as const;

export function ManualBackupCard() {
  const { t } = useTranslation();
  const { backup, exportLocal } = useBackupActions();
  const { showConfirmation } = useNotificationStore();

  const backupScope = useWebdavStore((s) => s.backupScope);
  const setBackupScope = useWebdavStore((s) => s.setBackupScope);
  const isBackingUp = useWebdavStore((s) => s.isBackingUp);
  const serverUrl = useWebdavStore((s) => s.connection.serverUrl);

  const autoBackupEnabled = useWebdavStore((s) => s.autoBackupEnabled);
  const autoBackupInterval = useWebdavStore((s) => s.autoBackupInterval);
  const maxBackupCount = useWebdavStore((s) => s.maxBackupCount);
  const lastBackupTime = useWebdavStore((s) => s.lastBackupTime);
  const setAutoBackupEnabled = useWebdavStore((s) => s.setAutoBackupEnabled);
  const setAutoBackupInterval = useWebdavStore((s) => s.setAutoBackupInterval);
  const setMaxBackupCount = useWebdavStore((s) => s.setMaxBackupCount);

  const intervalOptions = [
    { value: '5m', label: t('backup.interval_5m') },
    { value: '30m', label: t('backup.interval_30m') },
    { value: '24h', label: t('backup.interval_24h') },
    { value: '3d', label: t('backup.interval_3d') },
  ] as const;

  const maxCountOptions = MAX_BACKUP_COUNT_OPTIONS.map((n) => ({
    value: String(n),
    label: n === 0 ? t('backup.max_count_unlimited') : String(n),
  }));

  return (
    <Card title={t('backup.manual_title')} subtitle={t('backup.manual_subtitle')}>
      <div className={`card-body ${styles.stack}`}>
        <div className={styles.stackSm}>
          {SCOPE_ITEMS.map((key) => (
            <div key={key}>
              <ToggleSwitch
                label={t(`backup.scope_${key}`)}
                checked={backupScope[key]}
                onChange={(val) => {
                  if (key === 'config' && val) {
                    showConfirmation({
                      title: t('backup.config_warning_title'),
                      message: t('backup.config_warning_message'),
                      confirmText: t('backup.config_warning_confirm'),
                      variant: 'danger',
                      onConfirm: () => setBackupScope({ config: true }),
                    });
                  } else {
                    setBackupScope({ [key]: val });
                  }
                }}
              />
              <div className={styles.hint}>
                {t(`backup.scope_${key}_detail`)}
              </div>
            </div>
          ))}

          <div className={styles.divider} />

          <ToggleSwitch
            label={t('backup.auto_enable')}
            checked={autoBackupEnabled}
            onChange={setAutoBackupEnabled}
            disabled={!serverUrl}
          />
        </div>

        <div className={styles.warningBox}>
          {t('backup.auto_browser_hint')}
        </div>
        <div className={styles.rowWrap}>
          <div className={styles.row}>
            <span className={styles.label}>{t('backup.auto_interval')}</span>
            <div className={styles.selectWide}>
              <Select
                value={autoBackupInterval}
                options={[...intervalOptions]}
                onChange={(val) => setAutoBackupInterval(val as AutoBackupInterval)}
              />
            </div>
          </div>
          <div className={styles.row}>
            <span className={styles.label}>{t('backup.max_count_label')}</span>
            <div className={styles.selectNarrow}>
              <Select
                value={String(maxBackupCount)}
                options={maxCountOptions}
                onChange={(val) => setMaxBackupCount(Number(val))}
              />
            </div>
          </div>
        </div>
        {lastBackupTime && (
          <div className={styles.lastBackup}>
            {t('backup.last_backup')}: {new Date(lastBackupTime).toLocaleString()}
          </div>
        )}
        <div className={styles.infoBox}>
          <div><strong>{t('backup.auto_label_1')}</strong>{t('backup.auto_note_1')}</div>
          <div><strong>{t('backup.auto_label_2')}</strong>{t('backup.auto_note_2')}</div>
          <div><strong>{t('backup.auto_label_3')}</strong>{t('backup.auto_note_3')}</div>
        </div>

        <div className={styles.actions}>
          <Button variant="secondary" onClick={exportLocal}>
            {t('backup.export_local')}
          </Button>
          <Button
            variant="primary"
            onClick={backup}
            loading={isBackingUp}
            disabled={!serverUrl}
          >
            {t('backup.backup_now')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
