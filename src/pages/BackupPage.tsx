import { useEffect, useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconDownload, IconTrash2, IconRefreshCw, IconInbox, IconFileText } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore } from '@/stores';
import { backupApi } from '@/services/api/backup';
import type { 
  BackupMetadata, 
  BackupContent, 
  BackupCreateRequest, 
  BackupRestoreRequest 
} from '@/types/backup';
import { formatFileSize } from '@/utils/format';
import styles from './BackupPage.module.scss';

/** Backup content options for type-safe iteration */
const BACKUP_CONTENT_OPTIONS = [
  { key: 'env', label: '.env (Environment Variables)' },
  { key: 'config', label: 'config.yaml (System Config)' },
  { key: 'auths', label: 'auths/ (Authentication Files)' },
] as const satisfies ReadonlyArray<{ key: keyof BackupContent; label: string }>;

export function BackupPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  
  const [backups, setBackups] = useState<BackupMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [processing, setProcessing] = useState(false);
  
  // Create Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createName, setCreateName] = useState('');
  const [createPath, setCreatePath] = useState('');
  const [createContent, setCreateContent] = useState<BackupContent>({
    env: true,
    config: true,
    auths: true
  });

  // Restore Modal State
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [selectedBackup, setSelectedBackup] = useState<string | null>(null);
  const [authsMode, setAuthsMode] = useState<'overwrite' | 'incremental'>('overwrite');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const disableControls = connectionStatus !== 'connected';

  const loadBackups = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await backupApi.list();
      // Use logical OR to handle potential null/undefined response
      setBackups(response?.backups || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleCreate = async () => {
    if (!createContent.env && !createContent.config && !createContent.auths) {
      showNotification(t('backup_management.error_no_content'), 'warning');
      return;
    }

    setProcessing(true);
    try {
      const request: BackupCreateRequest = {
        name: createName.trim() || undefined,
        backupPath: createPath.trim() || undefined,
        content: createContent
      };
      await backupApi.create(request);
      showNotification(t('backup_management.create_success'), 'success');
      setCreateModalOpen(false);
      loadBackups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showNotification(`${t('backup_management.create_failed')}: ${msg}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleDelete = async (name: string) => {
    if (!window.confirm(t('backup_management.delete_confirm', { name }))) return;

    setProcessing(true);
    try {
      await backupApi.delete(name);
      showNotification(t('backup_management.delete_success'), 'success');
      setBackups(prev => prev.filter(b => b.name !== name));
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showNotification(`${t('backup_management.delete_failed')}: ${msg}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const handleDownload = async (name: string) => {
    try {
      const blob = await backupApi.download(name);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showNotification(`${t('backup_management.download_failed')}: ${msg}`, 'error');
    }
  };

  const openRestoreModal = (name: string) => {
    setSelectedBackup(name);
    setUploadedFile(null);
    setRestoreModalOpen(true);
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    setUploadedFile(file);
    setSelectedBackup(null); // Clear selected backup when uploading
    setRestoreModalOpen(true);
    e.target.value = ''; // Reset input
  };

  const handleRestore = async () => {
    if (!selectedBackup && !uploadedFile) return;
    
    setProcessing(true);
    try {
      if (uploadedFile) {
        await backupApi.uploadAndRestore(uploadedFile, authsMode);
      } else if (selectedBackup) {
        const request: BackupRestoreRequest = {
          name: selectedBackup,
          authsMode
        };
        await backupApi.restore(request);
      }
      showNotification(t('backup_management.restore_success'), 'success');
      setRestoreModalOpen(false);
      loadBackups();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      showNotification(`${t('backup_management.restore_failed')}: ${msg}`, 'error');
    } finally {
      setProcessing(false);
    }
  };

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr).toLocaleString();
    } catch {
      return dateStr;
    }
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('backup_management.title')}</h1>
        <p className={styles.description}>{t('backup_management.description')}</p>
      </div>

      <Card
        title={
          <div className={styles.titleWrapper}>
            <span>{t('backup_management.backup_list')}</span>
            {backups.length > 0 && <span className={styles.countBadge}>{backups.length}</span>}
          </div>
        }
        extra={
          <div className={styles.headerActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={loadBackups}
              disabled={loading || processing}
            >
              <IconRefreshCw size={16} />
              {t('common.refresh')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleUploadClick}
              disabled={disableControls || processing}
            >
              <IconDownload size={16} className={styles.uploadIcon} />
              {t('backup_management.upload_backup')}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip,.tar.gz"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <Button
              size="sm"
              onClick={() => {
                setCreateName('');
                setCreatePath('');
                setCreateContent({ env: true, config: true, auths: true });
                setCreateModalOpen(true);
              }}
              disabled={disableControls || processing}
            >
              <IconInbox size={16} />
              {t('backup_management.create_backup')}
            </Button>
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        {loading ? (
          <div className={styles.emptyState}>
            <LoadingSpinner />
            <div className={styles.hint}>{t('common.loading')}</div>
          </div>
        ) : backups.length === 0 ? (
          <EmptyState
            title={t('backup_management.empty_title')}
            description={t('backup_management.empty_desc')}
          />
        ) : (
          <div className={styles.tableContainer}>
            <table className={styles.backupTable}>
              <thead>
                <tr>
                  <th>{t('backup_management.col_name')}</th>
                  <th>{t('backup_management.col_date')}</th>
                  <th>{t('backup_management.col_content')}</th>
                  <th>{t('backup_management.col_size')}</th>
                  <th className={styles.actionsHeader}>{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {backups.map((backup) => (
                  <tr key={backup.name}>
                    <td className={styles.backupName}>{backup.name}</td>
                    <td className={styles.backupDate}>{formatDate(backup.date)}</td>
                    <td>
                      <div className={styles.contentTags}>
                        <span className={`${styles.contentTag} ${backup.content.env ? styles.contentTagActive : ''}`}>
                          .env
                        </span>
                        <span className={`${styles.contentTag} ${backup.content.config ? styles.contentTagActive : ''}`}>
                          config
                        </span>
                        <span className={`${styles.contentTag} ${backup.content.auths ? styles.contentTagActive : ''}`}>
                          auths
                        </span>
                      </div>
                    </td>
                    <td className={styles.backupSize}>{formatFileSize(backup.size)}</td>
                    <td>
                      <div className={styles.actionsCell}>
                        <Button
                          variant="secondary"
                          size="sm"
                          className={styles.iconButton}
                          onClick={() => handleDownload(backup.name)}
                          title={t('common.download')}
                          disabled={disableControls}
                        >
                          <IconDownload size={16} />
                        </Button>
                        <Button
                          variant="secondary"
                          size="sm"
                          className={styles.iconButton}
                          onClick={() => openRestoreModal(backup.name)}
                          title={t('backup_management.restore')}
                          disabled={disableControls}
                        >
                          <IconFileText size={16} />
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          className={styles.iconButton}
                          onClick={() => handleDelete(backup.name)}
                          title={t('common.delete')}
                          disabled={disableControls}
                        >
                          <IconTrash2 size={16} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Backup Modal */}
      <Modal
        open={createModalOpen}
        onClose={() => setCreateModalOpen(false)}
        title={t('backup_management.create_modal_title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateModalOpen(false)} disabled={processing}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} loading={processing}>
              {t('common.create')}
            </Button>
          </>
        }
      >
        <div className={styles.formGroup}>
          <Input
            label={t('backup_management.backup_name')}
            placeholder={t('backup_management.backup_name_placeholder')}
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
          />
        </div>
        
        <div className={styles.formGroup}>
          <Input
            label={t('backup_management.backup_path_optional')}
            placeholder={t('backup_management.backup_path_placeholder')}
            value={createPath}
            onChange={(e) => setCreatePath(e.target.value)}
          />
        </div>

        <div className={styles.formGroup}>
          <label>{t('backup_management.content_to_backup')}</label>
          <div className={styles.checkboxGroup}>
            {BACKUP_CONTENT_OPTIONS.map(({ key, label }) => (
              <label key={key} className={styles.checkboxItem}>
                <input
                  type="checkbox"
                  checked={createContent[key]}
                  onChange={(e) => setCreateContent(prev => ({ ...prev, [key]: e.target.checked }))}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>
        </div>
      </Modal>

      {/* Restore Confirmation Modal */}
      <Modal
        open={restoreModalOpen}
        onClose={() => setRestoreModalOpen(false)}
        title={t('backup_management.restore_modal_title')}
        footer={
          <>
            <Button variant="secondary" onClick={() => setRestoreModalOpen(false)} disabled={processing}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleRestore} loading={processing} variant="danger">
              {t('backup_management.confirm_restore')}
            </Button>
          </>
        }
      >
        <div className={styles.warningBox}>
          <IconTrash2 size={20} />
          <div>
            <strong>{t('common.warning')}</strong>
            <div style={{ marginTop: 4 }}>
              {t('backup_management.restore_warning_msg')}
            </div>
          </div>
        </div>

        {uploadedFile && (
           <div className={styles.formGroup}>
             <label>{t('backup_management.selected_file')}:</label>
             <div className={styles.hint}>{uploadedFile.name} ({formatFileSize(uploadedFile.size)})</div>
           </div>
        )}

        <div className={styles.formGroup}>
          <label>{t('backup_management.auths_restore_mode')}</label>
          <div className={styles.checkboxGroup}>
            <label className={styles.radioItem}>
              <input
                type="radio"
                name="authsMode"
                value="overwrite"
                checked={authsMode === 'overwrite'}
                onChange={(e) => setAuthsMode(e.target.value as 'overwrite')}
              />
              <span>
                <strong>{t('backup_management.mode_overwrite')}</strong>
                <div className={styles.hint}>{t('backup_management.mode_overwrite_desc')}</div>
              </span>
            </label>
            <label className={styles.radioItem}>
              <input
                type="radio"
                name="authsMode"
                value="incremental"
                checked={authsMode === 'incremental'}
                onChange={(e) => setAuthsMode(e.target.value as 'incremental')}
              />
              <span>
                <strong>{t('backup_management.mode_incremental')}</strong>
                <div className={styles.hint}>{t('backup_management.mode_incremental_desc')}</div>
              </span>
            </label>
          </div>
        </div>
      </Modal>
    </div>
  );
}
