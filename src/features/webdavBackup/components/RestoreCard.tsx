import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useNotificationStore } from '@/stores';
import { useWebdavStore } from '../store/useWebdavStore';
import { useBackupActions } from '../hooks/useBackupActions';
import { formatFileSize } from '../utils';
import type { WebdavFileInfo, BackupScope } from '../types';
import { RestoreModal } from './RestoreModal';
import styles from '../backup.module.scss';

export function RestoreCard() {
  const { t } = useTranslation();
  const { showConfirmation } = useNotificationStore();
  const { loadHistory, restoreFromLocal, restore, downloadFile, deleteRemote } =
    useBackupActions();

  const isRestoring = useWebdavStore((s) => s.isRestoring);
  const isLoadingHistory = useWebdavStore((s) => s.isLoadingHistory);
  const serverUrl = useWebdavStore((s) => s.connection.serverUrl);
  const lastBackupTime = useWebdavStore((s) => s.lastBackupTime);

  const [files, setFiles] = useState<WebdavFileInfo[]>([]);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    if (!serverUrl) {
      setFiles([]);
      return;
    }
    const result = await loadHistory();
    setFiles(result);
  }, [serverUrl, loadHistory]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!serverUrl) {
        if (!cancelled) setFiles([]);
        return;
      }
      const result = await loadHistory();
      if (!cancelled) setFiles(result);
    };
    void load();
    return () => { cancelled = true; };
  }, [serverUrl, loadHistory, lastBackupTime]);

  const handleRestore = useCallback(
    async (scope: BackupScope) => {
      if (restoreFile) {
        await restoreFromLocal(restoreFile, scope);
        setRestoreFile(null);
      } else if (restoreTarget) {
        await restore(restoreTarget, scope);
      }
      setRestoreTarget(null);
    },
    [restoreTarget, restoreFile, restore, restoreFromLocal],
  );

  const handleFileSelected = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setRestoreFile(file);
    }
    e.target.value = '';
  }, []);

  const handleDelete = useCallback(
    (filename: string) => {
      showConfirmation({
        title: t('backup.delete_confirm_title'),
        message: t('backup.delete_confirm_message', { name: filename }),
        confirmText: t('common.delete'),
        variant: 'danger',
        onConfirm: async () => {
          await deleteRemote(filename);
          await refresh();
        },
      });
    },
    [showConfirmation, deleteRemote, refresh, t],
  );

  return (
    <>
      <Card
        title={t('backup.restore_card_title')}
        subtitle={t('backup.restore_card_subtitle')}
        extra={
          <Button variant="ghost" size="sm" onClick={refresh} disabled={!serverUrl}>
            {t('common.refresh')}
          </Button>
        }
      >
        <div className={`card-body ${styles.stackLg}`}>
          <div className={styles.restoreLocalBox}>
            <div className={styles.flexMin}>
              <div className={styles.sectionTitle}>
                {t('backup.restore_from_local')}
              </div>
              <div className={styles.sectionHint}>
                {t('backup.restore_local_hint')}
              </div>
            </div>
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRestoring}
              loading={isRestoring && restoreFile !== null}
            >
              {t('backup.restore_local_btn')}
            </Button>
          </div>

          {!serverUrl ? (
            <div className={styles.emptyHint}>
              {t('backup.restore_no_connection')}
            </div>
          ) : isLoadingHistory ? (
            <div className={styles.center}>
              <LoadingSpinner />
            </div>
          ) : files.length === 0 ? (
            <EmptyState title={t('backup.no_backups')} />
          ) : (
            <div className={styles.stackXs}>
              {files.map((file) => (
                <div key={file.href} className={styles.fileItem}>
                  <div>
                    <div className={styles.fileName}>
                      <span className={styles.name}>{file.displayName}</span>
                      <span className={styles.tag}>
                        {t('backup.source_cloud')}
                      </span>
                    </div>
                    <div className={styles.meta}>
                      {file.lastModified ? new Date(file.lastModified).toLocaleString() : ''}
                      {file.contentLength > 0 ? ` · ${formatFileSize(file.contentLength)}` : ''}
                    </div>
                  </div>
                  <div className={styles.actionsSm}>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRestoreTarget(file.displayName)}
                      disabled={isRestoring}
                    >
                      {t('backup.restore')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => downloadFile(file.displayName)}
                    >
                      {t('backup.download')}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(file.displayName)}
                    >
                      {t('common.delete')}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Card>

      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        className={styles.hidden}
        onChange={handleFileSelected}
      />

      <RestoreModal
        open={restoreTarget !== null || restoreFile !== null}
        onClose={() => {
          setRestoreTarget(null);
          setRestoreFile(null);
        }}
        onRestore={handleRestore}
        loading={isRestoring}
        filename={restoreFile?.name ?? restoreTarget ?? ''}
      />
    </>
  );
}
