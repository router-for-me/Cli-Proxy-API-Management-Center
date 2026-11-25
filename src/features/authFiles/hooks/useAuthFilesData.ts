import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type RefObject,
} from 'react';
import { useTranslation } from 'react-i18next';
import { apiClient, authFilesApi } from '@/services/api';
import type { AuthFileRefreshResult } from '@/services/api/authFiles';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';
import {
  createAuthFileRefreshPending,
  refreshAllAuthFiles,
  refreshAuthFile,
  type AuthFileRefreshDeps,
} from '@/features/authFiles/refreshActions';
import {
  batchSetAuthFileStatus,
  createAuthFileStatusPending,
  toggleAuthFileStatus,
  type AuthFileStatusDeps,
} from '@/features/authFiles/statusActions';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { formatFileSize } from '@/utils/format';
import { MAX_AUTH_FILE_SIZE } from '@/utils/constants';
import { downloadAuthFiles } from '../downloadActions';
import { isRuntimeOnlyAuthFile } from '@/features/authFiles/constants';

export type LoadFilesOptions = {
  /** 后台刷新：不置 loading（网格保持内容），改用 refreshing 标志。 */
  background?: boolean;
};

export type UseAuthFilesDataOptions = {
  /** 文件集发生变更（上传/删除/手动刷新）后触发，供缓存失效等联动。 */
  onFilesMutated?: (names?: string[]) => void;
};

export type UseAuthFilesDataResult = {
  files: AuthFileItem[];
  selectedFiles: Set<string>;
  selectionCount: number;
  loading: boolean;
  refreshing: boolean;
  error: string;
  uploading: boolean;
  deleting: string | null;
  deletingAll: boolean;
  statusUpdating: Record<string, boolean>;
  manualRefreshing: Record<string, boolean>;
  refreshingAllCredentials: boolean;
  refreshResults: AuthFileRefreshResult[] | null;
  closeRefreshResults: () => void;
  handleRefreshAllCredentials: () => void;
  cooldownResetting: Record<string, boolean>;
  batchStatusUpdating: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  loadFiles: (options?: LoadFilesOptions) => Promise<void>;
  handleUploadClick: () => void;
  handleFileChange: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  handleDelete: (name: string) => void;
  handleDownload: (name: string) => Promise<void>;
  handleManualRefresh: (item: AuthFileItem) => Promise<void>;
  handleCooldownReset: (item: AuthFileItem) => void;
  handleStatusToggle: (item: AuthFileItem, enabled: boolean) => Promise<void>;
  toggleSelect: (name: string) => void;
  selectAllVisible: (visibleFiles: AuthFileItem[]) => void;
  invertVisibleSelection: (visibleFiles: AuthFileItem[]) => void;
  deselectAll: () => void;
  batchDownload: (names: string[]) => Promise<void>;
  batchSetStatus: (names: string[], enabled: boolean) => Promise<void>;
  batchDelete: (names: string[]) => void;
};

export function useAuthFilesData(options?: UseAuthFilesDataOptions): UseAuthFilesDataResult {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const onFilesMutated = options?.onFilesMutated;

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deletingAll, setDeletingAll] = useState(false);
  const [statusUpdating, setStatusUpdating] = useState<Record<string, boolean>>({});
  const [manualRefreshing, setManualRefreshing] = useState<Record<string, boolean>>({});
  const [refreshingAllCredentials, setRefreshingAllCredentials] = useState(false);
  const [refreshResults, setRefreshResults] = useState<AuthFileRefreshResult[] | null>(null);
  const closeRefreshResults = useCallback(() => setRefreshResults(null), []);
  const [cooldownResetting, setCooldownResetting] = useState<Record<string, boolean>>({});
  const [batchStatusUpdating, setBatchStatusUpdating] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const uploadPendingRef = useRef(false);
  const refreshPendingRef = useRef(createAuthFileRefreshPending());
  const cooldownResetPendingRef = useRef<Set<string>>(new Set());
  const statusPendingRef = useRef(createAuthFileStatusPending());
  /** 列表请求代号：变更操作会使在途响应过期，防止旧轮询复活已删/已改文件。 */
  const loadRequestIdRef = useRef(0);
  const invalidateInFlightLoads = useCallback(() => {
    loadRequestIdRef.current += 1;
    setLoading(false);
    setRefreshing(false);
  }, []);
  const onFilesMutatedRef = useRef(onFilesMutated);
  useEffect(() => {
    onFilesMutatedRef.current = onFilesMutated;
  }, [onFilesMutated]);
  const selectionCount = selectedFiles.size;
  const toggleSelect = useCallback((name: string) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  }, []);

  const selectAllVisible = useCallback((visibleFiles: AuthFileItem[]) => {
    const nextSelected = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => file.name);
    if (nextSelected.length === 0) return;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      nextSelected.forEach((name) => next.add(name));
      return next;
    });
  }, []);

  const invertVisibleSelection = useCallback((visibleFiles: AuthFileItem[]) => {
    const visibleNames = visibleFiles
      .filter((file) => !isRuntimeOnlyAuthFile(file))
      .map((file) => file.name);
    if (visibleNames.length === 0) return;

    setSelectedFiles((prev) => {
      const next = new Set(prev);
      visibleNames.forEach((name) => {
        if (next.has(name)) {
          next.delete(name);
        } else {
          next.add(name);
        }
      });
      return next;
    });
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedFiles(new Set());
  }, []);

  const applyDeletedFiles = useCallback(
    (names: string[]) => {
      const deletedNames = Array.from(new Set(names.map((name) => name.trim()).filter(Boolean)));
      if (deletedNames.length === 0) return;

      invalidateInFlightLoads();
      onFilesMutatedRef.current?.(deletedNames);
      const deletedSet = new Set(deletedNames);
      setFiles((prev) => prev.filter((file) => !deletedSet.has(file.name)));
      setSelectedFiles((prev) => {
        if (prev.size === 0) return prev;
        let changed = false;
        const next = new Set<string>();
        prev.forEach((name) => {
          if (deletedSet.has(name)) {
            changed = true;
          } else {
            next.add(name);
          }
        });
        return changed ? next : prev;
      });
    },
    [invalidateInFlightLoads]
  );

  useEffect(() => {
    if (selectedFiles.size === 0) return;
    const existingNames = new Set(files.map((file) => file.name));
    setSelectedFiles((prev) => {
      let changed = false;
      const next = new Set<string>();
      prev.forEach((name) => {
        if (existingNames.has(name)) {
          next.add(name);
        } else {
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [files, selectedFiles.size]);

  const loadFiles = useCallback(
    async (options?: LoadFilesOptions) => {
      const background = options?.background === true;
      const requestId = ++loadRequestIdRef.current;
      const connectionRevision = apiClient.getConnectionRevision();
      const isCurrentRequest = () =>
        requestId === loadRequestIdRef.current &&
        connectionRevision === apiClient.getConnectionRevision();

      if (background) {
        setRefreshing(true);
      } else {
        setLoading(true);
        setError('');
      }

      try {
        const data = await authFilesApi.list();
        if (!isCurrentRequest()) return; // 已被更新的请求/连接/变更取代
        setFiles(data?.files || []);
        setError('');
      } catch (err: unknown) {
        if (!isCurrentRequest()) return;
        const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
        setError(errorMessage);
      } finally {
        if (isCurrentRequest()) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [t]
  );

  const handleUploadClick = useCallback(() => {
    if (uploadPendingRef.current) return;
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const fileList = event.target.files;
      if (!fileList || fileList.length === 0) return;

      const filesToUpload = Array.from(fileList);
      const validFiles: File[] = [];
      const invalidFiles: string[] = [];
      const oversizedFiles: string[] = [];

      filesToUpload.forEach((file) => {
        if (!file.name.endsWith('.json')) {
          invalidFiles.push(file.name);
          return;
        }
        if (file.size > MAX_AUTH_FILE_SIZE) {
          oversizedFiles.push(file.name);
          return;
        }
        validFiles.push(file);
      });

      if (invalidFiles.length > 0) {
        showNotification(t('auth_files.upload_error_json'), 'error');
      }
      if (oversizedFiles.length > 0) {
        showNotification(
          t('auth_files.upload_error_size', { maxSize: formatFileSize(MAX_AUTH_FILE_SIZE) }),
          'error'
        );
      }

      if (validFiles.length === 0) {
        event.target.value = '';
        return;
      }
      if (uploadPendingRef.current) {
        event.target.value = '';
        return;
      }

      uploadPendingRef.current = true;
      setUploading(true);
      try {
        const result = await authFilesApi.uploadFiles(validFiles);
        const successCount = result.uploaded;

        if (successCount > 0) {
          const suffix = validFiles.length > 1 ? ` (${successCount}/${validFiles.length})` : '';
          showNotification(
            `${t('auth_files.upload_success')}${suffix}`,
            result.failed.length ? 'warning' : 'success'
          );
          notifyAuthFilesChanged();
          onFilesMutatedRef.current?.(result.files.length > 0 ? result.files : undefined);
          await loadFiles({ background: true });
        }

        if (result.failed.length > 0) {
          const details = result.failed.map((item) => `${item.name}: ${item.error}`).join('; ');
          showNotification(`${t('notification.upload_failed')}: ${details}`, 'error');
        }
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
      } finally {
        uploadPendingRef.current = false;
        setUploading(false);
        event.target.value = '';
      }
    },
    [loadFiles, showNotification, t]
  );

  const handleDelete = useCallback(
    (name: string) => {
      showConfirmation({
        title: t('auth_files.delete_title', { defaultValue: 'Delete File' }),
        message: t('auth_files.delete_confirm', { name }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          setDeleting(name);
          try {
            const result = await authFilesApi.deleteFile(name);
            if (!result.files.length) {
              showNotification(t('notification.delete_failed'), 'error');
              return;
            }
            applyDeletedFiles(result.files);
            notifyAuthFilesChanged();
            showNotification(t('auth_files.delete_success'), 'success');
          } catch (err: unknown) {
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeleting(null);
          }
        },
      });
    },
    [applyDeletedFiles, showConfirmation, showNotification, t]
  );

  const handleDownload = useCallback(
    async (name: string) => {
      const result = await downloadAuthFiles([name]);
      if (!result) return;
      if (result.success) {
        showNotification(t('auth_files.download_success'), 'success');
      } else {
        const [error] = result.failures;
        const detail = error instanceof Error ? `: ${error.message}` : '';
        showNotification(`${t('notification.download_failed')}${detail}`, 'error');
      }
    },
    [showNotification, t]
  );

  const refreshDeps = useMemo<AuthFileRefreshDeps>(
    () => ({
      requestManualRefresh: (name, authIndex) => authFilesApi.requestManualRefresh(name, authIndex),
      requestAllManualRefresh: () => authFilesApi.requestAllManualRefresh(),
      getConnectionRevision: () => apiClient.getConnectionRevision(),
      setManualRefreshing,
      setRefreshingAllCredentials,
      setRefreshResults,
      showConfirmation,
      showNotification,
      invalidateInFlightLoads,
      notifyAuthFilesChanged,
      onFilesMutated: (names) => onFilesMutatedRef.current?.(names),
      reloadFiles: () => loadFiles({ background: true }),
      t,
    }),
    [invalidateInFlightLoads, loadFiles, showConfirmation, showNotification, t]
  );

  const handleManualRefresh = useCallback(
    (item: AuthFileItem) => refreshAuthFile(refreshDeps, refreshPendingRef.current, item),
    [refreshDeps]
  );

  const handleRefreshAllCredentials = useCallback(
    () => refreshAllAuthFiles(refreshDeps, refreshPendingRef.current),
    [refreshDeps]
  );

  const handleCooldownReset = useCallback(
    (item: AuthFileItem) => {
      const authIndex = String(item.authIndex ?? '').trim();
      if (
        !authIndex ||
        !item.cooldownSnapshot?.records?.length ||
        cooldownResetPendingRef.current.has(authIndex)
      ) {
        return;
      }

      const connectionRevision = apiClient.getConnectionRevision();
      showConfirmation({
        title: t('auth_files.cooldown_reset_title'),
        message: t('auth_files.cooldown_reset_confirm', { name: item.name }),
        confirmText: t('auth_files.cooldown_reset_button'),
        variant: 'primary',
        onConfirm: async () => {
          if (
            connectionRevision !== apiClient.getConnectionRevision() ||
            cooldownResetPendingRef.current.has(authIndex)
          ) {
            return;
          }
          cooldownResetPendingRef.current.add(authIndex);
          setCooldownResetting((prev) => ({ ...prev, [authIndex]: true }));

          try {
            await authFilesApi.resetCooldown(authIndex);
            if (connectionRevision !== apiClient.getConnectionRevision()) return;
            invalidateInFlightLoads();
            setFiles((prev) =>
              prev.map((file) =>
                String(file.authIndex ?? '').trim() === authIndex && file.cooldownSnapshot
                  ? {
                      ...file,
                      cooldownSnapshot: {
                        ...file.cooldownSnapshot,
                        receivedAtMs: Date.now(),
                        records: [],
                      },
                    }
                  : file
              )
            );
            showNotification(
              t('auth_files.cooldown_reset_success', { name: item.name }),
              'success'
            );
            await loadFiles({ background: true });
          } catch (err: unknown) {
            if (connectionRevision !== apiClient.getConnectionRevision()) return;
            const message = err instanceof Error ? err.message : t('notification.update_failed');
            showNotification(
              t('auth_files.cooldown_reset_failed', { name: item.name, message }),
              'error'
            );
          } finally {
            cooldownResetPendingRef.current.delete(authIndex);
            setCooldownResetting((prev) => {
              if (!prev[authIndex]) return prev;
              const next = { ...prev };
              delete next[authIndex];
              return next;
            });
          }
        },
      });
    },
    [invalidateInFlightLoads, loadFiles, showConfirmation, showNotification, t]
  );

  const statusDeps = useMemo<AuthFileStatusDeps>(
    () => ({
      setStatus: (name, disabled, authIndex) => authFilesApi.setStatus(name, disabled, authIndex),
      getConnectionRevision: () => apiClient.getConnectionRevision(),
      setFiles,
      setStatusUpdating,
      setBatchStatusUpdating,
      invalidateInFlightLoads,
      showNotification,
      t,
    }),
    [invalidateInFlightLoads, showNotification, t]
  );

  const handleStatusToggle = useCallback(
    (item: AuthFileItem, enabled: boolean) =>
      toggleAuthFileStatus(statusDeps, statusPendingRef.current, item, enabled),
    [statusDeps]
  );

  const batchSetStatus = useCallback(
    (names: string[], enabled: boolean) =>
      batchSetAuthFileStatus(
        { ...statusDeps, deselectAll },
        statusPendingRef.current,
        files,
        names,
        enabled
      ),
    [deselectAll, files, statusDeps]
  );

  const batchDownload = useCallback(
    async (names: string[]) => {
      if (!names.length) return;
      const result = await downloadAuthFiles(names);
      if (!result) return;
      const successCount = result.success;
      const failCount = result.failures.length;

      if (failCount === 0) {
        showNotification(
          t('auth_files.batch_download_success', { count: successCount }),
          'success'
        );
      } else {
        showNotification(
          t('auth_files.batch_download_partial', { success: successCount, failed: failCount }),
          'warning'
        );
      }

      // 与 batchSetStatus 保持一致：批量动作完成后清空选择
      deselectAll();
    },
    [deselectAll, showNotification, t]
  );

  const batchDelete = useCallback(
    (names: string[]) => {
      const uniqueNames = Array.from(new Set(names));
      if (uniqueNames.length === 0) return;

      const revision = apiClient.getConnectionRevision();
      showConfirmation({
        title: t('common.delete'),
        message: t('auth_files.batch_delete_confirm', { count: uniqueNames.length }),
        variant: 'danger',
        confirmText: t('common.confirm'),
        onConfirm: async () => {
          if (revision !== apiClient.getConnectionRevision()) return;
          setDeletingAll(true);
          try {
            const result = await authFilesApi.deleteFiles(uniqueNames);
            if (revision !== apiClient.getConnectionRevision()) return;
            const success = result.files.length;
            const failed = uniqueNames.length - success;
            if (success > 0) {
              applyDeletedFiles(result.files);
              notifyAuthFilesChanged();
            }
            showNotification(
              t('auth_files.batch_delete_result', { success, failed }),
              success === 0 ? 'error' : failed > 0 ? 'warning' : 'success'
            );
          } catch (err: unknown) {
            if (revision !== apiClient.getConnectionRevision()) return;
            const errorMessage = err instanceof Error ? err.message : '';
            showNotification(`${t('notification.delete_failed')}: ${errorMessage}`, 'error');
          } finally {
            setDeletingAll(false);
          }
        },
      });
    },
    [applyDeletedFiles, showConfirmation, showNotification, t]
  );

  return {
    files,
    selectedFiles,
    selectionCount,
    loading,
    refreshing,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    manualRefreshing,
    refreshingAllCredentials,
    refreshResults,
    closeRefreshResults,
    handleRefreshAllCredentials,
    cooldownResetting,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDownload,
    handleManualRefresh,
    handleCooldownReset,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  };
}
