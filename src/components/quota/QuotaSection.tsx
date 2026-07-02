/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { triggerHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { authFilesApi } from '@/services/api';
import { useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { IconRefreshCw, IconTrash2 } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type ViewMode = 'paged' | 'all';

const MAX_ITEMS_PER_PAGE = 25;
const MAX_SHOW_ALL_THRESHOLD = 30;
const PAGE_ROWS = 5;

interface QuotaPaginationState<T> {
  pageSize: number;
  totalPages: number;
  currentPage: number;
  pageItems: T[];
  setPageSize: (size: number) => void;
  goToPrev: () => void;
  goToNext: () => void;
  loading: boolean;
  loadingScope: 'page' | 'all' | null;
  setLoading: (loading: boolean, scope?: 'page' | 'all' | null) => void;
}

const useQuotaPagination = <T,>(items: T[], defaultPageSize = 6): QuotaPaginationState<T> => {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [loading, setLoadingState] = useState(false);
  const [loadingScope, setLoadingScope] = useState<'page' | 'all' | null>(null);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(items.length / pageSize)),
    [items.length, pageSize]
  );

  const currentPage = useMemo(() => Math.min(page, totalPages), [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return items.slice(start, start + pageSize);
  }, [items, currentPage, pageSize]);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState((prev) => {
      if (prev === size) return prev;
      setPage(1);
      return size;
    });
  }, []);

  const goToPrev = useCallback(() => {
    setPage((prev) => Math.max(1, prev - 1));
  }, []);

  const goToNext = useCallback(() => {
    setPage((prev) => Math.min(totalPages, prev + 1));
  }, [totalPages]);

  const setLoading = useCallback((isLoading: boolean, scope?: 'page' | 'all' | null) => {
    setLoadingState(isLoading);
    setLoadingScope(isLoading ? (scope ?? null) : null);
  }, []);

  return {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading,
    loadingScope,
    setLoading,
  };
};

interface QuotaSectionProps<TState extends QuotaStatusState, TData> {
  config: QuotaConfig<TState, TData>;
  files: AuthFileItem[];
  loading: boolean;
  disabled: boolean;
}

export function QuotaSection<TState extends QuotaStatusState, TData>({
  config,
  files,
  loading,
  disabled,
}: QuotaSectionProps<TState, TData>) {
  const { t } = useTranslation();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  /* Removed useRef */
  const [columns, gridRef] = useGridColumns(380); // Min card width 380px matches SCSS
  const [viewMode, setViewMode] = useState<ViewMode>('paged');
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);
  const [resettingQuotaName, setResettingQuotaName] = useState<string | null>(null);
  const [deletingFileNames, setDeletingFileNames] = useState<Set<string>>(() => new Set());
  const [deletedFileNames, setDeletedFileNames] = useState<Set<string>>(() => new Set());
  const [selectedFileNames, setSelectedFileNames] = useState<Set<string>>(() => new Set());

  const filteredFiles = useMemo(
    () => files.filter((file) => config.filterFn(file) && !deletedFileNames.has(file.name)),
    [files, config, deletedFileNames]
  );
  const selectedCount = selectedFileNames.size;
  const showAllAllowed = filteredFiles.length <= MAX_SHOW_ALL_THRESHOLD;
  const effectiveViewMode: ViewMode = viewMode === 'all' && !showAllAllowed ? 'paged' : viewMode;

  const {
    pageSize,
    totalPages,
    currentPage,
    pageItems,
    setPageSize,
    goToPrev,
    goToNext,
    loading: sectionLoading,
    setLoading,
  } = useQuotaPagination(filteredFiles);

  useEffect(() => {
    if (showAllAllowed) return;
    if (viewMode !== 'all') return;

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setViewMode('paged');
      setShowTooManyWarning(true);
    });

    return () => {
      cancelled = true;
    };
  }, [showAllAllowed, viewMode]);

  // Update page size based on view mode and columns
  useEffect(() => {
    if (effectiveViewMode === 'all') {
      setPageSize(Math.max(1, filteredFiles.length));
    } else {
      // Paged mode: fixed rows * columns, capped to avoid oversized pages.
      setPageSize(Math.min(columns * PAGE_ROWS, MAX_ITEMS_PER_PAGE));
    }
  }, [effectiveViewMode, columns, filteredFiles.length, setPageSize]);

  useEffect(() => {
    setDeletedFileNames((prev) => {
      if (prev.size === 0) return prev;
      const fileNames = new Set(files.map((file) => file.name));
      const next = new Set([...prev].filter((name) => fileNames.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  useEffect(() => {
    setSelectedFileNames((prev) => {
      if (prev.size === 0) return prev;
      const filteredNames = new Set(filteredFiles.map((file) => file.name));
      const next = new Set([...prev].filter((name) => filteredNames.has(name)));
      return next.size === prev.size ? prev : next;
    });
  }, [filteredFiles]);

  const { quota, loadQuota } = useQuotaLoader(config);

  const pendingQuotaRefreshRef = useRef(false);
  const prevFilesLoadingRef = useRef(loading);

  const handleRefresh = useCallback(() => {
    pendingQuotaRefreshRef.current = true;
    void triggerHeaderRefresh();
  }, []);

  useEffect(() => {
    const wasLoading = prevFilesLoadingRef.current;
    prevFilesLoadingRef.current = loading;

    if (!pendingQuotaRefreshRef.current) return;
    if (loading) return;
    if (!wasLoading) return;

    pendingQuotaRefreshRef.current = false;
    const scope = effectiveViewMode === 'all' ? 'all' : 'page';
    const targets = effectiveViewMode === 'all' ? filteredFiles : pageItems;
    if (targets.length === 0) return;
    loadQuota(targets, scope, setLoading);
  }, [loading, effectiveViewMode, filteredFiles, pageItems, loadQuota, setLoading]);

  useEffect(() => {
    if (loading) return;
    if (filteredFiles.length === 0) {
      setQuota({});
      return;
    }
    setQuota((prev) => {
      const nextState: Record<string, TState> = {};
      filteredFiles.forEach((file) => {
        const cached = prev[file.name];
        if (cached) {
          nextState[file.name] = cached;
        }
      });
      return nextState;
    });
  }, [filteredFiles, loading, setQuota]);

  const refreshQuotaForFile = useCallback(
    async (file: AuthFileItem) => {
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;

      setQuota((prev) => ({
        ...prev,
        [file.name]: config.buildLoadingState(),
      }));

      try {
        const data = await config.fetchQuota(file, t);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildSuccessState(data),
        }));
        showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('common.unknown_error');
        const status = getStatusFromError(err);
        setQuota((prev) => ({
          ...prev,
          [file.name]: config.buildErrorState(message, status),
        }));
        showNotification(
          t('auth_files.quota_refresh_failed', { name: file.name, message }),
          'error'
        );
      }
    },
    [config, disabled, quota, setQuota, showNotification, t]
  );

  const resetQuotaForFile = useCallback(
    (file: AuthFileItem) => {
      const resetQuota = config.resetQuota;
      if (!resetQuota) return;
      if (disabled || file.disabled) return;
      if (quota[file.name]?.status === 'loading') return;
      if (resettingQuotaName === file.name) return;

      showConfirmation({
        title: t('codex_quota.reset_confirm_title'),
        message: t('codex_quota.reset_confirm_message', { name: file.name }),
        confirmText: t('codex_quota.reset_confirm_button'),
        variant: 'primary',
        onConfirm: async () => {
          setResettingQuotaName(file.name);
          try {
            const data = await resetQuota(file, t);
            setQuota((prev) => ({
              ...prev,
              [file.name]: config.buildSuccessState(data),
            }));
            showNotification(t('codex_quota.reset_success', { name: file.name }), 'success');
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            showNotification(t('codex_quota.reset_failed', { name: file.name, message }), 'error');
          } finally {
            setResettingQuotaName((current) => (current === file.name ? null : current));
          }
        },
      });
    },
    [config, disabled, quota, resettingQuotaName, setQuota, showConfirmation, showNotification, t]
  );

  const applyDeletedAuthFiles = useCallback(
    (names: string[]) => {
      if (names.length === 0) return;
      setDeletedFileNames((prev) => {
        const next = new Set(prev);
        names.forEach((name) => next.add(name));
        return next;
      });
      setSelectedFileNames((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        names.forEach((name) => next.delete(name));
        return next;
      });
      setQuota((prev) => {
        const next = { ...prev };
        names.forEach((name) => {
          delete next[name];
        });
        return next;
      });
    },
    [setQuota]
  );

  const deleteAuthFile = useCallback(
    (file: AuthFileItem) => {
      if (disabled) return;
      if (deletingFileNames.has(file.name)) return;

      showConfirmation({
        title: t('auth_files.delete_title', { defaultValue: 'Delete File' }),
        message: `${t('auth_files.delete_confirm')} "${file.name}" ?`,
        confirmText: t('common.confirm'),
        variant: 'danger',
        onConfirm: async () => {
          setDeletingFileNames((prev) => new Set(prev).add(file.name));
          try {
            const result = await authFilesApi.deleteFile(file.name);
            applyDeletedAuthFiles(result.files.length > 0 ? result.files : [file.name]);
            showNotification(t('auth_files.delete_success'), 'success');
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : t('common.unknown_error');
            showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
          } finally {
            setDeletingFileNames((prev) => {
              const next = new Set(prev);
              next.delete(file.name);
              return next;
            });
          }
        },
      });
    },
    [applyDeletedAuthFiles, deletingFileNames, disabled, showConfirmation, showNotification, t]
  );

  const toggleSelectedFile = useCallback((name: string, selected: boolean) => {
    setSelectedFileNames((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(name);
      } else {
        next.delete(name);
      }
      return next;
    });
  }, []);

  const deleteSelectedAuthFiles = useCallback(() => {
    if (disabled || selectedFileNames.size === 0) return;
    const names = [...selectedFileNames].filter((name) => !deletingFileNames.has(name));
    if (names.length === 0) return;

    showConfirmation({
      title: t('auth_files.batch_delete_title'),
      message: t('auth_files.batch_delete_confirm', { count: names.length }),
      confirmText: t('common.confirm'),
      variant: 'danger',
      onConfirm: async () => {
        setDeletingFileNames((prev) => {
          const next = new Set(prev);
          names.forEach((name) => next.add(name));
          return next;
        });
        try {
          const result = await authFilesApi.deleteFiles(names);
          const failedNames = new Set(result.failed.map((item) => item.name));
          const deletedNames =
            result.files.length > 0
              ? result.files
              : result.failed.length === 0
                ? names
                : names.filter((name) => !failedNames.has(name));
          applyDeletedAuthFiles(deletedNames);
          if (result.failed.length > 0) {
            showNotification(
              t('auth_files.delete_filtered_result_partial', {
                success: deletedNames.length,
                failed: result.failed.length,
              }),
              'warning'
            );
          } else {
            showNotification(
              t('auth_files.delete_filtered_result_success', { count: deletedNames.length }),
              'success'
            );
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : t('common.unknown_error');
          showNotification(`${t('notification.delete_failed')}: ${message}`, 'error');
        } finally {
          setDeletingFileNames((prev) => {
            const next = new Set(prev);
            names.forEach((name) => next.delete(name));
            return next;
          });
        }
      },
    });
  }, [
    applyDeletedAuthFiles,
    deletingFileNames,
    disabled,
    selectedFileNames,
    showConfirmation,
    showNotification,
    t,
  ]);

  const clearSelectedFiles = useCallback(() => {
    setSelectedFileNames(new Set());
  }, []);

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>{filteredFiles.length}</span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;

  return (
    <Card
      title={titleNode}
      extra={
        <div className={styles.headerActions}>
          <div className={styles.viewModeToggle}>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'paged' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => setViewMode('paged')}
            >
              {t('auth_files.view_mode_paged')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              className={`${styles.viewModeButton} ${
                effectiveViewMode === 'all' ? styles.viewModeButtonActive : ''
              }`}
              onClick={() => {
                if (filteredFiles.length > MAX_SHOW_ALL_THRESHOLD) {
                  setShowTooManyWarning(true);
                } else {
                  setViewMode('all');
                }
              }}
            >
              {t('auth_files.view_mode_all')}
            </Button>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className={styles.refreshAllButton}
            onClick={handleRefresh}
            disabled={disabled || isRefreshing}
            loading={isRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
          {selectedCount > 0 && (
            <div className={styles.quotaBatchActions}>
              <span className={styles.quotaBatchSelected}>
                {t('auth_files.batch_selected', { count: selectedCount })}
              </span>
              <Button variant="danger" size="sm" onClick={deleteSelectedAuthFiles} disabled={disabled}>
                <IconTrash2 size={16} />
                {t('auth_files.delete_button')}
              </Button>
              <Button variant="secondary" size="sm" onClick={clearSelectedFiles}>
                {t('auth_files.batch_deselect')}
              </Button>
            </div>
          )}
        </div>
      }
    >
      {filteredFiles.length === 0 ? (
        <EmptyState
          title={t(`${config.i18nPrefix}.empty_title`)}
          description={t(`${config.i18nPrefix}.empty_desc`)}
        />
      ) : (
        <>
          <div ref={gridRef} className={config.gridClassName}>
            {pageItems.map((item) => {
              const itemQuota = quota[item.name];
              const isResettingQuota = resettingQuotaName === item.name;
              const isDeletingFile = deletingFileNames.has(item.name);
              const canUseQuotaAction =
                !disabled && !item.disabled && itemQuota?.status !== 'loading' && !isDeletingFile;
              const canDeleteAuthFile = !disabled && !isDeletingFile;
              const showResetQuotaAction =
                itemQuota !== undefined && Boolean(config.canResetQuota?.(itemQuota));
              const resetQuotaAction =
                config.resetQuota && showResetQuotaAction ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className={styles.quotaResetCreditButton}
                    onClick={() => resetQuotaForFile(item)}
                    disabled={!canUseQuotaAction || isResettingQuota}
                    loading={isResettingQuota}
                    title={t('codex_quota.reset_button')}
                    aria-label={t('codex_quota.reset_button')}
                  >
                    {!isResettingQuota && <IconRefreshCw size={14} />}
                    {t('codex_quota.reset_button')}
                  </Button>
                ) : undefined;
              const deleteAuthFileAction = (
                <Button
                  type="button"
                  variant="danger"
                  size="sm"
                  className={styles.quotaDeleteAuthFileButton}
                  onClick={() => deleteAuthFile(item)}
                  disabled={!canDeleteAuthFile}
                  title={t('auth_files.delete_button')}
                  aria-label={t('auth_files.delete_button')}
                >
                  {isDeletingFile ? <LoadingSpinner size={14} /> : <IconTrash2 size={16} />}
                </Button>
              );

              return (
                <QuotaCard
                  key={item.name}
                  item={item}
                  quota={itemQuota}
                  resolvedTheme={resolvedTheme}
                  i18nPrefix={config.i18nPrefix}
                  cardIdleMessageKey={config.cardIdleMessageKey}
                  cardClassName={config.cardClassName}
                  defaultType={config.type}
                  canRefresh={canUseQuotaAction && !isResettingQuota}
                  onRefresh={() => void refreshQuotaForFile(item)}
                  selected={selectedFileNames.has(item.name)}
                  onToggleSelect={toggleSelectedFile}
                  resetQuotaAction={resetQuotaAction}
                  deleteAuthFileAction={deleteAuthFileAction}
                  renderQuotaItems={config.renderQuotaItems}
                />
              );
            })}
          </div>
          {filteredFiles.length > pageSize && effectiveViewMode === 'paged' && (
            <div className={styles.pagination}>
              <Button variant="secondary" size="sm" onClick={goToPrev} disabled={currentPage <= 1}>
                {t('auth_files.pagination_prev')}
              </Button>
              <div className={styles.pageInfo}>
                {t('auth_files.pagination_info', {
                  current: currentPage,
                  total: totalPages,
                  count: filteredFiles.length,
                })}
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={goToNext}
                disabled={currentPage >= totalPages}
              >
                {t('auth_files.pagination_next')}
              </Button>
            </div>
          )}
        </>
      )}
      {showTooManyWarning && (
        <div className={styles.warningOverlay} onClick={() => setShowTooManyWarning(false)}>
          <div className={styles.warningModal} onClick={(e) => e.stopPropagation()}>
            <p>{t('auth_files.too_many_files_warning')}</p>
            <Button variant="primary" size="sm" onClick={() => setShowTooManyWarning(false)}>
              {t('common.confirm')}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
