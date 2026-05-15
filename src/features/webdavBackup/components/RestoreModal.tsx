import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { BackupScope } from '../types';
import styles from '../backup.module.scss';

interface RestoreModalProps {
  open: boolean;
  onClose: () => void;
  onRestore: (scope: BackupScope) => void;
  loading: boolean;
  filename: string;
}

export function RestoreModal({ open, onClose, onRestore, loading, filename }: RestoreModalProps) {
  const { t } = useTranslation();

  const [scope, setScope] = useState<BackupScope>({
    localStorage: true,
    config: false,
    usage: true,
  });

  const scopeItems: { key: keyof BackupScope; label: string; hint: string }[] = [
    { key: 'localStorage', label: t('backup.scope_preferences'), hint: t('backup.scope_preferences_hint') },
    { key: 'config', label: t('backup.scope_config'), hint: t('backup.scope_config_restore_hint') },
    { key: 'usage', label: t('backup.scope_usage'), hint: t('backup.scope_usage_hint') },
  ];

  const hasSelection = Object.values(scope).some(Boolean);

  return (
    <Modal
      open={open}
      title={t('backup.restore_title')}
      onClose={onClose}
      closeDisabled={loading}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => onRestore(scope)}
            loading={loading}
            disabled={!hasSelection}
          >
            {t('backup.restore_confirm')}
          </Button>
        </div>
      }
    >
      <div className={styles.stackLg}>
        <div className={styles.restoreMeta}>
          {t('backup.restore_from')}: <strong>{filename}</strong>
        </div>
        <div className={styles.stack}>
          {scopeItems.map((item) => (
            <div key={item.key}>
              <ToggleSwitch
                label={item.label}
                checked={scope[item.key]}
                onChange={(val) => setScope((prev) => ({ ...prev, [item.key]: val }))}
                disabled={loading}
              />
              <div className={styles.hint}>
                {item.hint}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
