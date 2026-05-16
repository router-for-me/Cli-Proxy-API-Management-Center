import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { getErrorMessage } from '@/utils/error';
import { useNotificationStore, useAuthStore } from '@/stores';
import { configApi, usageApi } from '@/services/api';
import { webdavClient } from '../client/webdavClient';
import { useWebdavStore } from '../store/useWebdavStore';
import type { BackupPayload, BackupData, BackupScope, WebdavFileInfo } from '../types';
import {
  BACKUP_LOCALSTORAGE_KEYS,
} from '../constants';
import {
  generateBackupFilename,
  isBackupFile,
  encryptForBackup,
  decryptFromBackup,
} from '../utils';

function getAppVersion(): string {
  try {
    return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

async function collectBackupData(scope: BackupScope): Promise<BackupData> {
  const data: BackupData = {};

  if (scope.localStorage) {
    const lsData: Record<string, string> = {};
    for (const key of BACKUP_LOCALSTORAGE_KEYS) {
      const val = localStorage.getItem(key);
      if (val !== null) lsData[key] = val;
    }
    data.localStorage = lsData;
  }

  if (scope.config) {
    try {
      const cfg = await configApi.getRawConfig();
      data.config = cfg as Record<string, unknown>;
    } catch (err) {
      console.warn('[WebDAV Backup] Failed to fetch config:', err);
    }
  }

  if (scope.usage) {
    try {
      const usage = await usageApi.exportUsage();
      data.usage = usage as Record<string, unknown>;
    } catch (err) {
      console.warn('[WebDAV Backup] Failed to export usage:', err);
    }
  }

  return data;
}

function buildPayload(data: BackupData): BackupPayload {
  const authState = useAuthStore.getState();
  const encryptedData = encryptForBackup(JSON.stringify(data));
  return {
    version: 2,
    format: 'cpamc-backup',
    createdAt: new Date().toISOString(),
    source: {
      appVersion: getAppVersion(),
      apiBase: authState.apiBase,
      serverVersion: authState.serverVersion,
    },
    data: encryptedData,
  };
}

export function useBackupActions() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const backup = useCallback(async () => {
    const { connection, backupScope, maxBackupCount, setIsBackingUp, setLastBackupTime } =
      useWebdavStore.getState();
    if (!connection.serverUrl) {
      showNotification(t('backup.error_no_connection'), 'error');
      return;
    }

    setIsBackingUp(true);
    try {
      await webdavClient.ensureDirectory(connection);
      const data = await collectBackupData(backupScope);
      const payload = buildPayload(data);
      const filename = generateBackupFilename();
      await webdavClient.putFile(connection, filename, JSON.stringify(payload, null, 2));
      const now = new Date().toISOString();
      setLastBackupTime(now);
      showNotification(t('backup.backup_success'), 'success');

      // 自动清理：超出最大备份数时删除最旧的文件
      if (maxBackupCount > 0) {
        try {
          const files = await webdavClient.listDirectory(connection);
          const backupFiles = files
            .filter((f) => !f.isCollection && isBackupFile(f.displayName))
            .sort((a, b) => {
              const da = new Date(a.lastModified).getTime() || 0;
              const db = new Date(b.lastModified).getTime() || 0;
              return db - da;
            });
          if (backupFiles.length > maxBackupCount) {
            const toDelete = backupFiles.slice(maxBackupCount);
            let deleted = 0;
            for (const f of toDelete) {
              try {
                await webdavClient.deleteFile(connection, f.displayName);
                deleted++;
              } catch (delErr) {
                console.warn(`[WebDAV Backup] Failed to delete ${f.displayName}:`, delErr);
              }
            }
            if (deleted > 0) {
              console.info(`[WebDAV Backup] Cleaned up ${deleted}/${toDelete.length} old backup(s)`);
            }
          }
        } catch (cleanupErr) {
          console.warn('[WebDAV Backup] Cleanup failed:', cleanupErr);
        }
      }
    } catch (err) {
      console.error('[WebDAV Backup] Backup failed:', err);
      const msg = getErrorMessage(err) || String(err);
      showNotification(`${t('backup.backup_failed')}: ${msg}`, 'error');
    } finally {
      setIsBackingUp(false);
    }
  }, [t, showNotification]);

  const exportLocal = useCallback(async () => {
    const { backupScope } = useWebdavStore.getState();
    try {
      const data = await collectBackupData(backupScope);
      const payload = buildPayload(data);
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = generateBackupFilename();
      a.click();
      URL.revokeObjectURL(url);
      showNotification(t('backup.export_success'), 'success');
    } catch (err) {
      console.error('[WebDAV Backup] Export failed:', err);
      const msg = getErrorMessage(err) || String(err);
      showNotification(`${t('backup.export_failed')}: ${msg}`, 'error');
    }
  }, [t, showNotification]);

  const loadHistory = useCallback(async (): Promise<WebdavFileInfo[]> => {
    const { connection, setIsLoadingHistory } = useWebdavStore.getState();
    if (!connection.serverUrl) return [];

    setIsLoadingHistory(true);
    try {
      const files = await webdavClient.listDirectory(connection);
      return files
        .filter((f) => isBackupFile(f.displayName))
        .sort((a, b) => {
          const da = new Date(a.lastModified).getTime() || 0;
          const db = new Date(b.lastModified).getTime() || 0;
          return db - da;
        });
    } catch (err) {
      console.error('[WebDAV Backup] List failed:', err);
      const msg = getErrorMessage(err) || String(err);
      showNotification(`${t('backup.list_failed')}: ${msg}`, 'error');
      return [];
    } finally {
      setIsLoadingHistory(false);
    }
  }, [t, showNotification]);

  const downloadFile = useCallback(
    async (filename: string) => {
      const { connection } = useWebdavStore.getState();
      try {
        const content = await webdavClient.getFile(connection, filename);
        const blob = new Blob([content], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        console.error('[WebDAV Backup] Download failed:', err);
        const msg = getErrorMessage(err) || String(err);
        showNotification(`${t('backup.download_failed')}: ${msg}`, 'error');
      }
    },
    [t, showNotification]
  );

  const deleteRemote = useCallback(
    async (filename: string) => {
      const { connection } = useWebdavStore.getState();
      try {
        await webdavClient.deleteFile(connection, filename);
        showNotification(t('backup.delete_success'), 'success');
      } catch (err) {
        console.error('[WebDAV Backup] Delete failed:', err);
        const msg = getErrorMessage(err) || String(err);
        showNotification(`${t('backup.delete_failed')}: ${msg}`, 'error');
      }
    },
    [t, showNotification]
  );

  const restore = useCallback(
    async (filename: string, scope: BackupScope) => {
      const { connection, setIsRestoring } = useWebdavStore.getState();
      setIsRestoring(true);
      try {
        const content = await webdavClient.getFile(connection, filename);
        const payload: BackupPayload = JSON.parse(content);

        if (payload.format !== 'cpamc-backup' || (payload.version !== 1 && payload.version !== 2)) {
          showNotification(t('backup.invalid_format'), 'error');
          return;
        }

        await applyRestore(payload, scope);
        showNotification(t('backup.restore_success'), 'success');
      } catch (err) {
        console.error('[WebDAV Backup] Restore failed:', err);
        const msg = getErrorMessage(err) || String(err);
        showNotification(`${t('backup.restore_failed')}: ${msg}`, 'error');
      } finally {
        setIsRestoring(false);
      }
    },
    [t, showNotification]
  );

  const restoreFromLocal = useCallback(
    async (file: File, scope: BackupScope) => {
      const { setIsRestoring } = useWebdavStore.getState();
      setIsRestoring(true);
      try {
        const text = await file.text();
        const payload: BackupPayload = JSON.parse(text);

        if (payload.format !== 'cpamc-backup' || (payload.version !== 1 && payload.version !== 2)) {
          showNotification(t('backup.invalid_format'), 'error');
          return;
        }

        await applyRestore(payload, scope);
        showNotification(t('backup.restore_success'), 'success');
      } catch (err) {
        console.error('[WebDAV Backup] Local restore failed:', err);
        const msg = getErrorMessage(err) || String(err);
        showNotification(`${t('backup.restore_failed')}: ${msg}`, 'error');
      } finally {
        setIsRestoring(false);
      }
    },
    [t, showNotification]
  );

  return {
    backup,
    exportLocal,
    loadHistory,
    downloadFile,
    deleteRemote,
    restore,
    restoreFromLocal,
  };
}

/**
 * 从 payload 中提取 data：v2 加密格式需要解密，v1 旧格式直接使用
 */
function extractData(payload: BackupPayload): BackupData {
  if (typeof payload.data === 'string') {
    const decrypted = decryptFromBackup(payload.data);
    try {
      return JSON.parse(decrypted) as BackupData;
    } catch {
      console.warn('[WebDAV Backup] Failed to parse decrypted backup data');
      return {};
    }
  }
  return payload.data;
}

async function applyRestore(payload: BackupPayload, scope: BackupScope): Promise<void> {
  const data = extractData(payload);

  if (scope.localStorage && data.localStorage) {
    for (const [key, val] of Object.entries(data.localStorage)) {
      localStorage.setItem(key, val);
    }
  }

  if (scope.usage && data.usage) {
    try {
      await usageApi.importUsage(data.usage);
    } catch (err) {
      console.warn('[WebDAV Backup] Usage import failed:', err);
    }
  }

  // config 只提供查看，不自动写入后端
}
