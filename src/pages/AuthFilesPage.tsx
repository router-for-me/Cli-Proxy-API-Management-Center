import {
  useCallback,
  type CSSProperties,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { useInterval } from '@/hooks/useInterval';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useActionBarHeightVar } from '@/hooks/useActionBarHeightVar';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { IconFilterAll, IconSearch } from '@/components/ui/icons';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { copyToClipboard } from '@/utils/clipboard';
import {
  MAX_CARD_PAGE_SIZE,
  MIN_CARD_PAGE_SIZE,
  QUOTA_PROVIDER_TYPES,
  clampCardPageSize,
  getAuthFileIcon,
  getTypeColor,
  getTypeLabel,
  hasAuthFileStatusMessage,
  isRuntimeOnlyAuthFile,
  normalizeProviderKey,
  parsePriorityValue,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { AuthFileCard } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { AuthFilesPrefixProxyEditorModal } from '@/features/authFiles/components/AuthFilesPrefixProxyEditorModal';
import { OAuthExcludedCard } from '@/features/authFiles/components/OAuthExcludedCard';
import { OAuthModelAliasCard } from '@/features/authFiles/components/OAuthModelAliasCard';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import {
  getCodexAccountStatus,
  getCodexPlanFilterValue,
  getCodexPlanSortRank,
  matchesCodexPlanFilter,
  matchesCodexStatusFilter,
  type CodexRefreshState,
  type CodexPlanFilter,
  type CodexStatusFilter,
} from '@/features/authFiles/codexStatus';
import {
  XAI_STATUS_FILTERS,
  getXaiAccountStatus,
  matchesXaiStatusFilter,
  type XaiStatusFilter,
} from '@/features/authFiles/xaiStatus';
import { fetchCodexUsageSnapshot } from '@/components/quota/quotaConfigs';
import {
  isAuthFilesStatusFilterMode,
  isAuthFilesSortMode,
  readAuthFilesUiState,
  readPersistedAuthFilesCompactMode,
  writeAuthFilesUiState,
  writePersistedAuthFilesCompactMode,
  type AuthFilesStatusFilterMode,
  type AuthFilesSortMode,
} from '@/features/authFiles/uiState';
import { authFilesApi } from '@/services/api';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import styles from './AuthFilesPage.module.scss';

const DEFAULT_REGULAR_PAGE_SIZE = 50;
const DEFAULT_COMPACT_PAGE_SIZE = 50;
const CODEX_REFRESH_CONCURRENCY = 4;

const escapeWildcardSearchSegment = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildWildcardSearch = (value: string): RegExp | null => {
  if (!value.includes('*')) return null;
  const pattern = value.split('*').map(escapeWildcardSearchSegment).join('.*');
  return new RegExp(pattern, 'i');
};

const resolveStatusFilterMode = (
  problemOnly: boolean,
  disabledOnly: boolean
): AuthFilesStatusFilterMode => {
  if (problemOnly) return 'problem';
  if (disabledOnly) return 'disabled';
  return 'all';
};

const normalizePersistedStatusFilterMode = (value: unknown): AuthFilesStatusFilterMode | null => {
  if (value === 'disabledProblem') return 'problem';
  return isAuthFilesStatusFilterMode(value) ? value : null;
};

const requestStatus = (error: unknown): number | undefined => {
  if (!error || typeof error !== 'object' || !('status' in error)) return undefined;
  const value = (error as { status?: unknown }).status;
  return typeof value === 'number' ? value : undefined;
};

export function AuthFilesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();

  const [filter, setFilter] = useState<'all' | string>('all');
  const [statusFilterMode, setStatusFilterMode] = useState<AuthFilesStatusFilterMode>('all');
  const [privateInstructionsOnly, setPrivateInstructionsOnly] = useState(false);
  const [compactMode, setCompactMode] = useState(false);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSizeByMode, setPageSizeByMode] = useState({
    regular: DEFAULT_REGULAR_PAGE_SIZE,
    compact: DEFAULT_COMPACT_PAGE_SIZE,
  });
  const [pageSizeInput, setPageSizeInput] = useState(String(DEFAULT_REGULAR_PAGE_SIZE));
  const [viewMode, setViewMode] = useState<'diagram' | 'list'>('list');
  const [sortMode, setSortMode] = useState<AuthFilesSortMode>('default');
  const [codexStatusFilter, setCodexStatusFilter] = useState<CodexStatusFilter>('all');
  const [codexPlanFilter, setCodexPlanFilter] = useState<CodexPlanFilter>('all');
  const [xaiStatusFilter, setXaiStatusFilter] = useState<XaiStatusFilter>('all');
  const [codexRefreshByName, setCodexRefreshByName] = useState<Record<string, CodexRefreshState>>(
    {}
  );
  const [codexRefreshing, setCodexRefreshing] = useState(false);
  const [batchActionBarVisible, setBatchActionBarVisible] = useState(false);
  const [uiStateHydrated, setUiStateHydrated] = useState(false);
  const floatingBatchActionsRef = useRef<HTMLDivElement>(null);

  const {
    files,
    selectedFiles,
    selectionCount,
    loading,
    error,
    uploading,
    deleting,
    deletingAll,
    statusUpdating,
    batchStatusUpdating,
    fileInputRef,
    loadFiles,
    handleUploadClick,
    handleFileChange,
    handleDelete,
    handleDeleteAll,
    handleDownload,
    handleStatusToggle,
    toggleSelect,
    selectAllVisible,
    invertVisibleSelection,
    deselectAll,
    batchDownload,
    batchSetStatus,
    batchDelete,
  } = useAuthFilesData();

  const statusBarCache = useAuthFilesStatusBarCache(files);

  const {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias,
  } = useAuthFilesOauth({ viewMode, files });

  const {
    modelsModalOpen,
    modelsLoading,
    modelsList,
    modelsFileName,
    modelsFileType,
    modelsError,
    showModels,
    closeModelsModal,
  } = useAuthFilesModels();

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: connectionStatus !== 'connected',
    loadFiles,
  });

  const disableControls = connectionStatus !== 'connected';
  const normalizedFilter = normalizeProviderKey(String(filter));
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    normalizedFilter as QuotaProviderType
  )
    ? (normalizedFilter as QuotaProviderType)
    : null;
  const pageSize = compactMode ? pageSizeByMode.compact : pageSizeByMode.regular;
  const problemOnly = statusFilterMode === 'problem';
  const disabledOnly = statusFilterMode === 'disabled';
  const enabledOnly = statusFilterMode === 'enabled';
  const isCodexSelected = normalizedFilter === 'codex';
  const isXaiSelected = normalizedFilter === 'xai';

  useEffect(() => {
    const persistedCompactMode = readPersistedAuthFilesCompactMode();
    if (typeof persistedCompactMode === 'boolean') {
      setCompactMode(persistedCompactMode);
    }

    const persisted = readAuthFilesUiState();
    if (persisted) {
      if (typeof persisted.filter === 'string' && persisted.filter.trim()) {
        setFilter(normalizeProviderKey(persisted.filter));
      }
      const persistedStatusFilterMode = normalizePersistedStatusFilterMode(
        persisted.statusFilterMode
      );
      if (persistedStatusFilterMode) {
        setStatusFilterMode(persistedStatusFilterMode);
      } else if (
        typeof persisted.problemOnly === 'boolean' ||
        typeof persisted.disabledOnly === 'boolean'
      ) {
        setStatusFilterMode(
          resolveStatusFilterMode(persisted.problemOnly === true, persisted.disabledOnly === true)
        );
      }
      if (typeof persistedCompactMode !== 'boolean' && typeof persisted.compactMode === 'boolean') {
        setCompactMode(persisted.compactMode);
      }
      if (typeof persisted.privateInstructionsOnly === 'boolean') {
        setPrivateInstructionsOnly(persisted.privateInstructionsOnly);
      }
      if (typeof persisted.search === 'string') {
        setSearch(persisted.search);
      }
      if (typeof persisted.page === 'number' && Number.isFinite(persisted.page)) {
        setPage(Math.max(1, Math.round(persisted.page)));
      }
      const legacyPageSize =
        typeof persisted.pageSize === 'number' && Number.isFinite(persisted.pageSize)
          ? clampCardPageSize(persisted.pageSize)
          : null;
      const regularPageSize =
        typeof persisted.regularPageSize === 'number' && Number.isFinite(persisted.regularPageSize)
          ? clampCardPageSize(persisted.regularPageSize)
          : (legacyPageSize ?? DEFAULT_REGULAR_PAGE_SIZE);
      const compactPageSize =
        typeof persisted.compactPageSize === 'number' && Number.isFinite(persisted.compactPageSize)
          ? clampCardPageSize(persisted.compactPageSize)
          : (legacyPageSize ?? DEFAULT_COMPACT_PAGE_SIZE);
      setPageSizeByMode({
        regular: regularPageSize,
        compact: compactPageSize,
      });
      if (isAuthFilesSortMode(persisted.sortMode)) {
        setSortMode(persisted.sortMode);
      }
      if (
        typeof persisted.xaiStatusFilter === 'string' &&
        XAI_STATUS_FILTERS.includes(persisted.xaiStatusFilter as XaiStatusFilter)
      ) {
        setXaiStatusFilter(persisted.xaiStatusFilter as XaiStatusFilter);
      }
    }

    setUiStateHydrated(true);
  }, []);

  useEffect(() => {
    if (!uiStateHydrated) return;

    writeAuthFilesUiState({
      filter,
      statusFilterMode,
      problemOnly,
      disabledOnly,
      privateInstructionsOnly,
      compactMode,
      search,
      page,
      pageSize,
      regularPageSize: pageSizeByMode.regular,
      compactPageSize: pageSizeByMode.compact,
      sortMode,
      xaiStatusFilter,
    });
    writePersistedAuthFilesCompactMode(compactMode);
  }, [
    compactMode,
    disabledOnly,
    filter,
    page,
    pageSize,
    pageSizeByMode,
    privateInstructionsOnly,
    problemOnly,
    search,
    sortMode,
    statusFilterMode,
    uiStateHydrated,
    xaiStatusFilter,
  ]);

  useEffect(() => {
    setPageSizeInput(String(pageSize));
  }, [pageSize]);

  const setCurrentModePageSize = useCallback(
    (next: number) => {
      setPageSizeByMode((current) =>
        compactMode ? { ...current, compact: next } : { ...current, regular: next }
      );
    },
    [compactMode]
  );

  const commitPageSizeInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (!trimmed) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const value = Number(trimmed);
    if (!Number.isFinite(value)) {
      setPageSizeInput(String(pageSize));
      return;
    }

    const next = clampCardPageSize(value);
    setCurrentModePageSize(next);
    setPageSizeInput(String(next));
    setPage(1);
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const rawValue = event.currentTarget.value;
    setPageSizeInput(rawValue);

    const trimmed = rawValue.trim();
    if (!trimmed) return;

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;

    const rounded = Math.round(parsed);
    if (rounded < MIN_CARD_PAGE_SIZE || rounded > MAX_CARD_PAGE_SIZE) return;

    setCurrentModePageSize(rounded);
    setPage(1);
  };

  const handleSortModeChange = useCallback(
    (value: string) => {
      if (!isAuthFilesSortMode(value) || value === sortMode) return;
      setSortMode(value);
      setPage(1);
    },
    [sortMode]
  );

  const handleStatusFilterModeChange = useCallback((nextMode: AuthFilesStatusFilterMode) => {
    setStatusFilterMode(nextMode);
    setPage(1);
  }, []);

  const clearFilters = useCallback(() => {
    setFilter('all');
    setStatusFilterMode('all');
    setPrivateInstructionsOnly(false);
    setCompactMode(false);
    setSearch('');
    setPage(1);
    setPageSizeByMode({
      regular: DEFAULT_REGULAR_PAGE_SIZE,
      compact: DEFAULT_COMPACT_PAGE_SIZE,
    });
    setPageSizeInput(String(DEFAULT_REGULAR_PAGE_SIZE));
    setViewMode('list');
    setSortMode('default');
    setCodexStatusFilter('all');
    setCodexPlanFilter('all');
    setXaiStatusFilter('all');
    deselectAll();
  }, [deselectAll]);

  const refreshCodexData = useCallback(async () => {
    const codexFiles = files.filter(
      (file) => normalizeProviderKey(String(file.type ?? file.provider ?? '')) === 'codex'
    );
    if (codexFiles.length === 0) return;

    setCodexRefreshing(true);
    setCodexRefreshByName((current) => {
      const next = { ...current };
      codexFiles.forEach((file) => {
        next[file.name] = { status: 'loading', planType: null, windows: [] };
      });
      return next;
    });

    let cursor = 0;
    let successful = 0;
    let failed = 0;
    let persistenceFailed = 0;
    const refreshOne = async () => {
      while (cursor < codexFiles.length) {
        const file = codexFiles[cursor++];
        try {
          const snapshot = await fetchCodexUsageSnapshot(file, t);
          const checkedAt = new Date().toISOString();
          if (snapshot.planType) {
            try {
              await authFilesApi.patchFields(file.name, {
                plan_type: snapshot.planType,
                plan_checked_at: checkedAt,
              });
            } catch {
              persistenceFailed += 1;
            }
          }
          successful += 1;
          setCodexRefreshByName((current) => ({
            ...current,
            [file.name]: {
              status: 'success',
              planType: snapshot.planType,
              windows: snapshot.windows,
            },
          }));
        } catch (error: unknown) {
          failed += 1;
          setCodexRefreshByName((current) => ({
            ...current,
            [file.name]: {
              status: 'error',
              planType: null,
              windows: [],
              error: error instanceof Error ? error.message : t('common.unknown_error'),
              errorStatus: requestStatus(error),
            },
          }));
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(CODEX_REFRESH_CONCURRENCY, codexFiles.length) }, refreshOne)
    );
    setCodexRefreshing(false);
    await loadFiles();
    showNotification(
      t('auth_files.codex_refresh_result', { successful, failed, persistenceFailed }),
      failed > 0 || persistenceFailed > 0 ? 'warning' : 'success'
    );
  }, [files, loadFiles, showNotification, t]);

  useEffect(() => {
    if (isCodexSelected) return;
    setCodexStatusFilter('all');
    setCodexPlanFilter('all');
    if (sortMode === 'plan-desc' || sortMode === 'plan-asc') {
      setSortMode('default');
    }
  }, [isCodexSelected, sortMode]);

  useEffect(() => {
    if (!uiStateHydrated || isXaiSelected) return;
    setXaiStatusFilter('all');
  }, [isXaiSelected, uiStateHydrated]);

  const handleHeaderRefresh = useCallback(async () => {
    await Promise.all([loadFiles(), loadExcluded(), loadModelAlias()]);
  }, [loadFiles, loadExcluded, loadModelAlias]);

  useHeaderRefresh(handleHeaderRefresh);

  useEffect(() => {
    if (!isCurrentLayer) return;
    loadFiles();
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void loadFiles().catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  const existingTypes = useMemo(() => {
    const types = new Set<string>(['all']);
    files.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (type) types.add(type);
    });
    return Array.from(types);
  }, [files]);

  const filesMatchingStatusFilters = useMemo(
    () =>
      files.filter((file) => {
        if (enabledOnly && file.disabled === true) return false;
        if (disabledOnly && file.disabled !== true) return false;
        if (privateInstructionsOnly && !file.allow_private_instructions) return false;
        if (isCodexSelected) {
          const refreshed = codexRefreshByName[file.name];
          const codexStatus = getCodexAccountStatus(refreshed);
          if (
            problemOnly &&
            !hasAuthFileStatusMessage(file) &&
            !codexStatus.needsReauth &&
            !codexStatus.quotaLimited
          ) {
            return false;
          }
          if (!matchesCodexStatusFilter(codexStatusFilter, refreshed)) return false;
          if (!matchesCodexPlanFilter(file, codexPlanFilter, refreshed)) return false;
        } else if (isXaiSelected) {
          if (problemOnly && getXaiAccountStatus(file).kind === 'working') return false;
          if (!matchesXaiStatusFilter(file, xaiStatusFilter)) return false;
        } else if (problemOnly && !hasAuthFileStatusMessage(file)) {
          return false;
        }
        return true;
      }),
    [
      codexPlanFilter,
      codexRefreshByName,
      codexStatusFilter,
      disabledOnly,
      enabledOnly,
      files,
      isCodexSelected,
      isXaiSelected,
      privateInstructionsOnly,
      problemOnly,
      xaiStatusFilter,
    ]
  );

  const sortOptions = useMemo(
    () => [
      { value: 'default', label: t('auth_files.sort_default') },
      { value: 'az', label: t('auth_files.sort_az') },
      { value: 'priority', label: t('auth_files.sort_priority') },
      ...(isCodexSelected
        ? [
            { value: 'plan-desc', label: t('auth_files.sort_plan_desc') },
            { value: 'plan-asc', label: t('auth_files.sort_plan_asc') },
          ]
        : []),
    ],
    [isCodexSelected, t]
  );

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = { all: filesMatchingStatusFilters.length };
    filesMatchingStatusFilters.forEach((file) => {
      const type = normalizeProviderKey(String(file.type ?? file.provider ?? ''));
      if (!type) return;
      counts[type] = (counts[type] || 0) + 1;
    });
    return counts;
  }, [filesMatchingStatusFilters]);

  const normalizedSearch = search.trim();
  const wildcardSearch = useMemo(() => buildWildcardSearch(normalizedSearch), [normalizedSearch]);

  const filtered = useMemo(() => {
    const normalizedTerm = normalizedSearch.toLowerCase();

    return filesMatchingStatusFilters.filter((item) => {
      const type = normalizeProviderKey(String(item.type ?? item.provider ?? ''));
      const matchType = normalizedFilter === 'all' || type === normalizedFilter;
      const matchSearch =
        !normalizedSearch ||
        [item.name, item.type, item.provider, item.note, item.disabled_reason].some((value) => {
          const content = (value || '').toString();
          return wildcardSearch
            ? wildcardSearch.test(content)
            : content.toLowerCase().includes(normalizedTerm);
        });
      return matchType && matchSearch;
    });
  }, [filesMatchingStatusFilters, normalizedFilter, normalizedSearch, wildcardSearch]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    if (sortMode === 'default') {
      copy.sort((a, b) => {
        const providerA = normalizeProviderKey(String(a.provider ?? a.type ?? 'unknown'));
        const providerB = normalizeProviderKey(String(b.provider ?? b.type ?? 'unknown'));
        const providerCompare = providerA.localeCompare(providerB);
        if (providerCompare !== 0) return providerCompare;
        return a.name.localeCompare(b.name);
      });
    } else if (sortMode === 'az') {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortMode === 'priority') {
      copy.sort((a, b) => {
        const pa = parsePriorityValue(a.priority) ?? 0;
        const pb = parsePriorityValue(b.priority) ?? 0;
        return pb - pa; // 高优先级排前面
      });
    } else if (sortMode === 'plan-desc' || sortMode === 'plan-asc') {
      copy.sort((left, right) => {
        const leftRank = getCodexPlanSortRank(left, codexRefreshByName[left.name]);
        const rightRank = getCodexPlanSortRank(right, codexRefreshByName[right.name]);
        if (leftRank !== null || rightRank !== null) {
          if (leftRank === null) return 1;
          if (rightRank === null) return -1;
          const diff = sortMode === 'plan-desc' ? rightRank - leftRank : leftRank - rightRank;
          if (diff !== 0) return diff;
        }
        return left.name.localeCompare(right.name);
      });
    }
    return copy;
  }, [codexRefreshByName, filtered, sortMode]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageItems = useMemo(() => sorted.slice(start, start + pageSize), [pageSize, sorted, start]);
  const selectablePageItems = useMemo(
    () => pageItems.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [pageItems]
  );
  const selectableFilteredItems = useMemo(
    () => sorted.filter((file) => !isRuntimeOnlyAuthFile(file)),
    [sorted]
  );
  const selectedNames = useMemo(() => Array.from(selectedFiles), [selectedFiles]);
  const selectedHasStatusUpdating = useMemo(
    () => selectedNames.some((name) => statusUpdating[name] === true),
    [selectedNames, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const copyTextWithNotification = useCallback(
    async (text: string) => {
      const copied = await copyToClipboard(text);
      showNotification(
        copied
          ? t('notification.link_copied', { defaultValue: 'Copied to clipboard' })
          : t('notification.copy_failed', { defaultValue: 'Copy failed' }),
        copied ? 'success' : 'error'
      );
    },
    [showNotification, t]
  );

  const openExcludedEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-excluded${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  const openModelAliasEditor = useCallback(
    (provider?: string) => {
      const providerValue = (provider || (filter !== 'all' ? String(filter) : '')).trim();
      const params = new URLSearchParams();
      if (providerValue) {
        params.set('provider', providerValue);
      }
      const nextSearch = params.toString();
      navigate(`/auth-files/oauth-model-alias${nextSearch ? `?${nextSearch}` : ''}`, {
        state: { fromAuthFiles: true },
      });
    },
    [filter, navigate]
  );

  useActionBarHeightVar(
    floatingBatchActionsRef,
    '--auth-files-action-bar-height',
    batchActionBarVisible
  );

  useEffect(() => {
    // Instant show/hide — no Motion slide/fade on the batch action bar.
    setBatchActionBarVisible(selectionCount > 0);
  }, [selectionCount]);

  const renderFilterTags = () => (
    <div className={styles.filterRail}>
      <div className={styles.filterTags}>
        {existingTypes.map((type) => {
          const isActive = normalizedFilter === type;
          const iconSrc = getAuthFileIcon(type, resolvedTheme);
          const color =
            type === 'all'
              ? { bg: 'var(--bg-tertiary)', text: 'var(--text-primary)' }
              : getTypeColor(type, resolvedTheme);
          const buttonStyle = {
            '--filter-color': color.text,
            '--filter-surface': color.bg,
            '--filter-active-text': resolvedTheme === 'dark' ? '#111827' : '#ffffff',
          } as CSSProperties;

          return (
            <button
              key={type}
              className={`${styles.filterTag} ${isActive ? styles.filterTagActive : ''}`}
              style={buttonStyle}
              onClick={() => {
                setFilter(type);
                if (type !== 'codex') {
                  setCodexStatusFilter('all');
                  setCodexPlanFilter('all');
                }
                if (type !== 'xai') setXaiStatusFilter('all');
                setPage(1);
              }}
            >
              <span className={styles.filterTagLabel}>
                {type === 'all' ? (
                  <span className={`${styles.filterTagIconWrap} ${styles.filterAllIconWrap}`}>
                    <IconFilterAll className={styles.filterAllIcon} size={16} />
                  </span>
                ) : (
                  <span className={styles.filterTagIconWrap}>
                    {iconSrc ? (
                      <img src={iconSrc} alt="" className={styles.filterTagIcon} />
                    ) : (
                      <span className={styles.filterTagIconFallback}>
                        {getTypeLabel(t, type).slice(0, 1).toUpperCase()}
                      </span>
                    )}
                  </span>
                )}
                <span className={styles.filterTagText}>{getTypeLabel(t, type)}</span>
              </span>
              <span className={styles.filterTagCount}>{typeCounts[type] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );

  const deleteAllButtonLabel = (() => {
    if (enabledOnly || disabledOnly) {
      return t('auth_files.delete_filtered_result_button');
    }
    if (problemOnly) {
      return normalizedFilter === 'all'
        ? t('auth_files.delete_problem_button')
        : t('auth_files.delete_problem_button_with_type', {
            type: getTypeLabel(t, normalizedFilter),
          });
    }
    return normalizedFilter === 'all'
      ? t('auth_files.delete_all_button')
      : `${t('common.delete')} ${getTypeLabel(t, normalizedFilter)}`;
  })();

  return (
    <div className={styles.container}>
      <Card
        title={renderFilterTags()}
        extra={
          <div className={styles.headerActions}>
            <Button variant="secondary" size="sm" onClick={handleHeaderRefresh} disabled={loading}>
              {t('common.refresh')}
            </Button>
            {isCodexSelected && (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void refreshCodexData()}
                disabled={disableControls || codexRefreshing}
                loading={codexRefreshing}
              >
                {t('auth_files.codex_refresh_button')}
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleUploadClick}
              disabled={disableControls || uploading}
              loading={uploading}
            >
              {t('auth_files.upload_button')}
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={() =>
                handleDeleteAll({
                  filter,
                  problemOnly,
                  disabledOnly,
                  enabledOnly,
                  onResetFilterToAll: () => setFilter('all'),
                  onResetProblemOnly: () => setStatusFilterMode('all'),
                  onResetDisabledOnly: () => setStatusFilterMode('all'),
                  onResetEnabledOnly: () => setStatusFilterMode('all'),
                })
              }
              disabled={disableControls || loading || deletingAll}
              loading={deletingAll}
            >
              {deleteAllButtonLabel}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              multiple
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
          </div>
        }
      >
        {error && <div className={styles.errorBox}>{error}</div>}

        <div className={styles.filterSection}>
          <div className={styles.filterContent}>
            <div className={styles.filterControlsPanel}>
              <div
                className={`${styles.filterControls} ${
                  isCodexSelected
                    ? styles.filterControlsCodex
                    : isXaiSelected
                      ? styles.filterControlsXai
                      : ''
                }`}
              >
                <div className={`${styles.filterItem} ${styles.filterSearchItem}`}>
                  <label>{t('auth_files.search_label')}</label>
                  <Input
                    className={styles.searchInput}
                    value={search}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                    }}
                    placeholder={t('auth_files.search_placeholder')}
                    rightElement={<IconSearch className={styles.searchIcon} size={18} />}
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.pageSizeItem}`}>
                  <label>{t('auth_files.page_size_label')}</label>
                  <input
                    className={styles.pageSizeSelect}
                    type="number"
                    min={MIN_CARD_PAGE_SIZE}
                    max={MAX_CARD_PAGE_SIZE}
                    step={1}
                    value={pageSizeInput}
                    onChange={handlePageSizeChange}
                    onBlur={(e) => commitPageSizeInput(e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.currentTarget.blur();
                      }
                    }}
                  />
                </div>
                <div className={`${styles.filterItem} ${styles.sortItem}`}>
                  <label>{t('auth_files.sort_label')}</label>
                  <Select
                    className={styles.sortSelect}
                    value={sortMode}
                    options={sortOptions}
                    onChange={handleSortModeChange}
                    ariaLabel={t('auth_files.sort_label')}
                    fullWidth
                  />
                </div>
                {isCodexSelected && (
                  <>
                    <div className={`${styles.filterItem} ${styles.codexStatusItem}`}>
                      <label>{t('auth_files.codex_status_label')}</label>
                      <Select
                        value={codexStatusFilter}
                        options={[
                          { value: 'all', label: t('auth_files.codex_status_all') },
                          { value: 'reauth', label: t('auth_files.codex_status_reauth') },
                          {
                            value: 'quota_limited',
                            label: t('auth_files.codex_status_quota_limited'),
                          },
                          {
                            value: 'five_hour_limited',
                            label: t('auth_files.codex_status_five_hour_limited'),
                          },
                          {
                            value: 'weekly_limited',
                            label: t('auth_files.codex_status_weekly_limited'),
                          },
                          {
                            value: 'monthly_limited',
                            label: t('auth_files.codex_status_monthly_limited'),
                          },
                        ]}
                        onChange={(value) => {
                          setCodexStatusFilter(value as CodexStatusFilter);
                          setPage(1);
                        }}
                        ariaLabel={t('auth_files.codex_status_label')}
                        fullWidth
                      />
                    </div>
                    <div className={`${styles.filterItem} ${styles.codexPlanItem}`}>
                      <label>{t('auth_files.codex_plan_label')}</label>
                      <Select
                        value={codexPlanFilter}
                        options={[
                          { value: 'all', label: t('auth_files.codex_plan_all') },
                          { value: 'free', label: t('codex_quota.plan_free') },
                          { value: 'k12', label: t('codex_quota.plan_k12') },
                          { value: 'plus', label: t('codex_quota.plan_plus') },
                          { value: 'team', label: t('codex_quota.plan_team') },
                          { value: 'prolite', label: t('codex_quota.plan_prolite') },
                          { value: 'pro', label: t('codex_quota.plan_pro') },
                          { value: 'unknown', label: t('auth_files.codex_plan_unknown') },
                        ]}
                        onChange={(value) => {
                          setCodexPlanFilter(value as CodexPlanFilter);
                          setPage(1);
                        }}
                        ariaLabel={t('auth_files.codex_plan_label')}
                        fullWidth
                      />
                    </div>
                  </>
                )}
                {isXaiSelected && (
                  <div className={`${styles.filterItem} ${styles.xaiStatusItem}`}>
                    <label>{t('auth_files.xai_status_label')}</label>
                    <Select
                      value={xaiStatusFilter}
                      options={[
                        { value: 'all', label: t('auth_files.xai_status_all') },
                        { value: 'working', label: t('auth_files.xai_status_working') },
                        { value: 'cooldown', label: t('auth_files.xai_status_cooldown') },
                        { value: 'denied_403', label: t('auth_files.xai_status_denied_403') },
                        { value: 'other_403', label: t('auth_files.xai_status_other_403') },
                      ]}
                      onChange={(value) => {
                        setXaiStatusFilter(value as XaiStatusFilter);
                        setPage(1);
                      }}
                      ariaLabel={t('auth_files.xai_status_label')}
                      fullWidth
                    />
                  </div>
                )}
                <div className={`${styles.filterItem} ${styles.filterToggleItem}`}>
                  <label>{t('auth_files.display_options_label')}</label>
                  <div className={styles.displayOptionToggles}>
                    <ToggleSwitch
                      checked={problemOnly}
                      onChange={(checked) =>
                        handleStatusFilterModeChange(checked ? 'problem' : 'all')
                      }
                      ariaLabel={t('auth_files.problem_only_label')}
                      label={t('auth_files.problem_only_label')}
                    />
                    <ToggleSwitch
                      checked={disabledOnly}
                      onChange={(checked) =>
                        handleStatusFilterModeChange(checked ? 'disabled' : 'all')
                      }
                      ariaLabel={t('auth_files.disabled_only_label')}
                      label={t('auth_files.disabled_only_label')}
                    />
                    <ToggleSwitch
                      checked={enabledOnly}
                      onChange={(checked) =>
                        handleStatusFilterModeChange(checked ? 'enabled' : 'all')
                      }
                      ariaLabel={t('auth_files.enabled_only_label')}
                      label={t('auth_files.enabled_only_label')}
                    />
                    <ToggleSwitch
                      checked={compactMode}
                      onChange={(value) => setCompactMode(value)}
                      ariaLabel={t('auth_files.compact_mode_label')}
                      label={t('auth_files.compact_mode_label')}
                    />
                    <ToggleSwitch
                      checked={privateInstructionsOnly}
                      onChange={(value) => {
                        setPrivateInstructionsOnly(value);
                        setPage(1);
                      }}
                      ariaLabel={t('auth_files.private_instructions_only_label')}
                      label={t('auth_files.private_instructions_only_label')}
                    />
                    <Button variant="ghost" size="sm" onClick={clearFilters}>
                      {t('auth_files.clear_filters')}
                    </Button>
                  </div>
                </div>
              </div>
            </div>

            {loading ? (
              <div className={styles.hint}>{t('common.loading')}</div>
            ) : pageItems.length === 0 ? (
              <EmptyState
                title={t('auth_files.search_empty_title')}
                description={t('auth_files.search_empty_desc')}
              />
            ) : (
              <div
                className={`${styles.fileGrid} ${quotaFilterType ? styles.fileGridQuotaManaged : ''} ${compactMode ? styles.fileGridCompact : ''}`}
              >
                {pageItems.map((file) => (
                  <AuthFileCard
                    key={file.name}
                    file={file}
                    compact={compactMode}
                    selected={selectedFiles.has(file.name)}
                    resolvedTheme={resolvedTheme}
                    disableControls={disableControls}
                    deleting={deleting}
                    statusUpdating={statusUpdating}
                    quotaFilterType={quotaFilterType}
                    statusBarCache={statusBarCache}
                    codexBadges={
                      isCodexSelected
                        ? (() => {
                            const refreshed = codexRefreshByName[file.name];
                            const status = getCodexAccountStatus(refreshed);
                            const badges = [] as string[];
                            const plan = getCodexPlanFilterValue(file, refreshed);
                            if (plan) badges.push(t(`codex_quota.plan_${plan}`));
                            if (status.needsReauth)
                              badges.push(t('auth_files.codex_status_reauth'));
                            if (status.fiveHourLimited)
                              badges.push(t('auth_files.codex_status_five_hour_limited'));
                            if (status.weeklyLimited)
                              badges.push(t('auth_files.codex_status_weekly_limited'));
                            if (status.monthlyLimited)
                              badges.push(t('auth_files.codex_status_monthly_limited'));
                            return badges;
                          })()
                        : []
                    }
                    onShowModels={showModels}
                    onDownload={handleDownload}
                    onOpenPrefixProxyEditor={openPrefixProxyEditor}
                    onDelete={handleDelete}
                    onToggleStatus={handleStatusToggle}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            )}

            {!loading && sorted.length > pageSize && (
              <div className={styles.pagination}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.max(1, currentPage - 1))}
                  disabled={currentPage <= 1}
                >
                  {t('auth_files.pagination_prev')}
                </Button>
                <div className={styles.pageInfo}>
                  {t('auth_files.pagination_info', {
                    current: currentPage,
                    total: totalPages,
                    count: sorted.length,
                  })}
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage >= totalPages}
                >
                  {t('auth_files.pagination_next')}
                </Button>
              </div>
            )}
          </div>
        </div>
      </Card>

      <OAuthExcludedCard
        disableControls={disableControls}
        excludedError={excludedError}
        excluded={excluded}
        onAdd={() => openExcludedEditor()}
        onEdit={openExcludedEditor}
        onDelete={deleteExcluded}
      />

      <OAuthModelAliasCard
        disableControls={disableControls}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onAdd={() => openModelAliasEditor()}
        onEditProvider={openModelAliasEditor}
        onDeleteProvider={deleteModelAlias}
        modelAliasError={modelAliasError}
        modelAlias={modelAlias}
        allProviderModels={allProviderModels}
        onUpdate={handleMappingUpdate}
        onDeleteLink={handleDeleteLink}
        onToggleFork={handleToggleFork}
        onRenameAlias={handleRenameAlias}
        onDeleteAlias={handleDeleteAlias}
      />

      <AuthFileModelsModal
        open={modelsModalOpen}
        fileName={modelsFileName}
        fileType={modelsFileType}
        loading={modelsLoading}
        error={modelsError}
        models={modelsList}
        excluded={excluded}
        onClose={closeModelsModal}
        onCopyText={copyTextWithNotification}
      />

      <AuthFilesPrefixProxyEditorModal
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      {batchActionBarVisible && typeof document !== 'undefined'
        ? createPortal(
            <div className={styles.batchActionContainer} ref={floatingBatchActionsRef}>
              <div className={styles.batchActionBar}>
                <div className={styles.batchActionLeft}>
                  <span className={styles.batchSelectionText}>
                    {t('auth_files.batch_selected', { count: selectionCount })}
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_select_page')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => selectAllVisible(sorted)}
                    disabled={selectableFilteredItems.length === 0}
                  >
                    {t('auth_files.batch_select_filtered')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => invertVisibleSelection(pageItems)}
                    disabled={selectablePageItems.length === 0}
                  >
                    {t('auth_files.batch_invert_page')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    {t('auth_files.batch_deselect')}
                  </Button>
                </div>
                <div className={styles.batchActionRight}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void batchDownload(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('auth_files.batch_download')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, true)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_enable')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => batchSetStatus(selectedNames, false)}
                    disabled={batchStatusButtonsDisabled}
                  >
                    {t('auth_files.batch_disable')}
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => batchDelete(selectedNames)}
                    disabled={disableControls || selectedNames.length === 0}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
              </div>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
