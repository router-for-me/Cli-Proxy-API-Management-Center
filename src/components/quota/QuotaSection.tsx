/**
 * Generic quota section component.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { useAuthStore, useNotificationStore, useQuotaStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { CODEX_QUOTA_AUTO_REFRESH_INTERVAL_SECONDS } from '@/features/codexCustomization/shared';
import { getStatusFromError } from '@/utils/quota';
import { QuotaCard } from './QuotaCard';
import type { QuotaStatusState } from './QuotaCard';
import { useQuotaLoader } from './useQuotaLoader';
import type { QuotaConfig } from './quotaConfigs';
import { useGridColumns } from './useGridColumns';
import { useCodexQuotaAutoRefresh } from './useCodexQuotaAutoRefresh';
import { IconRefreshCw } from '@/components/ui/icons';
import styles from '@/pages/QuotaPage.module.scss';

type QuotaUpdater<T> = T | ((prev: T) => T);

type QuotaSetter<T> = (updater: QuotaUpdater<T>) => void;

type ViewMode = 'paged' | 'all';

const MAX_ITEMS_PER_PAGE = 25;
const MAX_SHOW_ALL_THRESHOLD = 30;

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
    setPageSizeState(size);
    setPage(1);
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
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const quotaScopeKey = useAuthStore((state) => `${state.apiBase}::${state.managementKey}`);
  const setQuota = useQuotaStore((state) => state[config.storeSetter]) as QuotaSetter<
    Record<string, TState>
  >;

  /* Removed useRef */
  const [columns, gridRef] = useGridColumns(380); // Min card width 380px matches SCSS
  const [viewMode, setViewMode] = useState<ViewMode>(() =>
    config.type === 'codex' ? 'all' : 'paged'
  );
  const [showTooManyWarning, setShowTooManyWarning] = useState(false);

  const filteredFiles = useMemo(
    () => files.filter((file) => config.filterFn(file)),
    [files, config]
  );
  const showAllAllowed = config.type === 'codex' || filteredFiles.length <= MAX_SHOW_ALL_THRESHOLD;
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
      // Paged mode: 3 rows * columns, capped to avoid oversized pages.
      setPageSize(Math.min(columns * 3, MAX_ITEMS_PER_PAGE));
    }
  }, [effectiveViewMode, columns, filteredFiles.length, setPageSize]);

  const { quota, loadQuota } = useQuotaLoader(config);

  const loadQuotaForTargets = useCallback(
    async (targets: AuthFileItem[], scope: 'page' | 'all') => {
      if (targets.length === 0) {
        return;
      }

      await loadQuota(targets, scope, setLoading);
    },
    [loadQuota, setLoading]
  );

  const handleRefresh = useCallback(
    async (scope: 'page' | 'all' = effectiveViewMode === 'all' ? 'all' : 'page') => {
      const targets = scope === 'all' ? filteredFiles : pageItems;
      await loadQuotaForTargets(targets, scope);
    },
    [effectiveViewMode, filteredFiles, loadQuotaForTargets, pageItems]
  );

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

  const initialCodexRefreshSignature = useMemo(
    () =>
      `${quotaScopeKey}::${filteredFiles
        .map((file) => `${file.name}:${file['auth_index'] ?? file.authIndex ?? '-'}`)
        .join('|')}`,
    [filteredFiles, quotaScopeKey]
  );
  const didInitialCodexRefreshRef = useRef('');

  useEffect(() => {
    if (config.type === 'codex' && connectionStatus !== 'connected') {
      didInitialCodexRefreshRef.current = '';
    }
  }, [config.type, connectionStatus]);

  useEffect(() => {
    if (config.type !== 'codex' || disabled || loading || filteredFiles.length === 0) {
      return;
    }

    if (didInitialCodexRefreshRef.current === initialCodexRefreshSignature) {
      return;
    }

    didInitialCodexRefreshRef.current = initialCodexRefreshSignature;
    void handleRefresh('all');
  }, [
    config.type,
    disabled,
    filteredFiles.length,
    handleRefresh,
    initialCodexRefreshSignature,
    loading,
  ]);

  const codexAutoRefresh = useCodexQuotaAutoRefresh({
    enabled: config.type === 'codex' && filteredFiles.length > 0,
    disabled: disabled || filteredFiles.length === 0,
    refreshing: sectionLoading,
    triggerRefresh: async () => {
      await handleRefresh('all');
    },
    intervalSeconds: CODEX_QUOTA_AUTO_REFRESH_INTERVAL_SECONDS,
  });

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

  const titleNode = (
    <div className={styles.titleWrapper}>
      <span>{t(`${config.i18nPrefix}.title`)}</span>
      {filteredFiles.length > 0 && (
        <span className={styles.countBadge}>{filteredFiles.length}</span>
      )}
    </div>
  );

  const isRefreshing = sectionLoading || loading;
  const autoRefreshProgress =
    codexAutoRefresh.active && codexAutoRefresh.pageVisible
      ? ((CODEX_QUOTA_AUTO_REFRESH_INTERVAL_SECONDS - codexAutoRefresh.countdown) /
          CODEX_QUOTA_AUTO_REFRESH_INTERVAL_SECONDS) *
        100
      : 0;
  const autoRefreshLabel = isRefreshing
    ? t('common.loading')
    : !codexAutoRefresh.pageVisible
      ? t('quota_management.auto_refresh_paused', { defaultValue: '暂停' })
      : `${codexAutoRefresh.countdown}s`;

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
            onClick={() => {
              void handleRefresh();
            }}
            disabled={disabled || isRefreshing}
            loading={isRefreshing}
            title={t('quota_management.refresh_all_credentials')}
            aria-label={t('quota_management.refresh_all_credentials')}
          >
            {!isRefreshing && <IconRefreshCw size={16} />}
            {t('quota_management.refresh_all_credentials')}
          </Button>
          {config.type === 'codex' && (
            <Button
              variant="secondary"
              size="sm"
              className={styles.refreshAllButton}
              onClick={codexAutoRefresh.toggle}
              disabled={disabled || filteredFiles.length === 0}
              aria-pressed={codexAutoRefresh.active}
              title={
                codexAutoRefresh.active
                  ? `${t('quota_management.auto_refresh')} ${autoRefreshLabel}`
                  : t('quota_management.auto_refresh')
              }
              style={{
                borderColor: codexAutoRefresh.active
                  ? 'color-mix(in srgb, var(--primary-color) 38%, var(--border-color))'
                  : undefined,
                background: codexAutoRefresh.active
                  ? `linear-gradient(90deg, color-mix(in srgb, var(--primary-color) 16%, var(--card-bg, #fff)) ${autoRefreshProgress}%, color-mix(in srgb, var(--card-bg, #fff) 96%, transparent) ${autoRefreshProgress}%)`
                  : undefined,
                color: codexAutoRefresh.active ? 'var(--primary-color)' : undefined,
                boxShadow: codexAutoRefresh.active
                  ? '0 14px 26px -22px color-mix(in srgb, var(--primary-color) 72%, transparent)'
                  : undefined,
                transition:
                  'background .18s ease, border-color .18s ease, color .18s ease, box-shadow .18s ease',
              }}
            >
              <span>{t('quota_management.auto_refresh')}</span>
              {codexAutoRefresh.active && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    minWidth: '42px',
                    minHeight: '20px',
                    padding: '0 6px',
                    borderRadius: '999px',
                    background: 'color-mix(in srgb, var(--primary-color) 14%, transparent)',
                    color: 'inherit',
                    fontSize: '11px',
                    lineHeight: 1,
                  }}
                >
                  {autoRefreshLabel}
                </span>
              )}
            </Button>
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
            {pageItems.map((item) => (
              <QuotaCard
                key={item.name}
                item={item}
                quota={quota[item.name]}
                resolvedTheme={resolvedTheme}
                i18nPrefix={config.i18nPrefix}
                cardIdleMessageKey={config.cardIdleMessageKey}
                cardClassName={config.cardClassName}
                defaultType={config.type}
                canRefresh={!disabled && !item.disabled}
                onRefresh={() => void refreshQuotaForFile(item)}
                renderQuotaItems={config.renderQuotaItems}
              />
            ))}
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
