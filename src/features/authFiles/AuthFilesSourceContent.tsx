import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router-dom';
import { useInterval } from '@/hooks/useInterval';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconRefreshCw, IconTrash2, IconUpload } from '@/components/ui/icons';
import { copyToClipboard } from '@/utils/clipboard';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import {
  QUOTA_PROVIDER_TYPES,
  getTypeLabel,
  isRuntimeOnlyAuthFile,
  type AuthFileQuotaFilter,
  type QuotaProviderType,
  type ResolvedTheme,
} from '@/features/authFiles/constants';
import { countCredentials } from '@/features/authFiles/credentialFacts';
import { AuthFileCard, AuthFileCardSkeleton } from '@/features/authFiles/components/AuthFileCard';
import { AuthFileDetailsSheet } from '@/features/authFiles/components/AuthFileDetailsSheet';
import { getAuthFileRefreshKey } from '@/features/authFiles/manualRefresh';
import { AuthFileRefreshResults } from '@/features/authFiles/components/AuthFileRefreshResults';
import { AuthFileModelsModal } from '@/features/authFiles/components/AuthFileModelsModal';
import { BatchActionBar } from '@/features/authFiles/components/BatchActionBar';
import { invalidateAuthFileDerivedCaches } from '@/features/authFiles/cacheInvalidation';
import { useAuthFilesData } from '@/features/authFiles/hooks/useAuthFilesData';
import { useAuthFilesModels } from '@/features/authFiles/hooks/useAuthFilesModels';
import { useAuthFilesOauth } from '@/features/authFiles/hooks/useAuthFilesOauth';
import { useAuthFilesPrefixProxyEditor } from '@/features/authFiles/hooks/useAuthFilesPrefixProxyEditor';
import { useAuthFilesStatusBarCache } from '@/features/authFiles/hooks/useAuthFilesStatusBarCache';
import { createCoalescingRunner, type QuotaRun } from '@/features/authFiles/quotaRunner';
import { quotaRefreshTargets, quotaTargetsShown } from '@/features/authFiles/quotaSlot';
import type { HeaderRefreshRound } from '@/hooks/useHeaderRefresh';
import { providerSources } from '@/stores/useProviderSources';
import { useQuotaBatchLoader } from '@/features/quota/hooks/useQuotaBatchLoader';
import { useServerQuota } from '@/features/quotaPool/useServerQuota';
import {
  OTHER_PROVIDER_GROUP,
  UNKNOWN,
  deletableShown,
  healthParts,
  listLoadState,
  modelsScreenPath,
  pageOfAuthFiles,
  providerGroupOf,
  type AuthFilesFilters,
  type SourceAnswer,
} from '@/features/authFiles/unifiedList';
import { useThemeStore } from '@/stores';
import { sourceOwnerKey } from '@/services/api/sourceSession';
import { useCredentialInventoryStore } from '@/stores/useCredentialInventoryStore';
import type { AuthFileItem } from '@/types';
import { useAuthFilesSource, useAuthFilesNotifications } from './AuthFilesSourceContext';
import styles from './AuthFilesPage.module.scss';

const SKELETON_CARD_COUNT = 6;
/** First-render cascade budget for cards, the same 360 ms vocabulary as useRevealGroup. */
const CARD_ENTRANCE_BUDGET_MS = 360;

export type AnswerState = SourceAnswer['state'];

export type QuotaRunner = {
  count: number;
  run: (onSettled: (ok: boolean) => void) => Promise<void>;
};
export type RegisterQuotaRefresh = (key: string, runner: QuotaRunner) => () => void;

export type RegisterRefresh = (
  key: string,
  refresh: (round?: HeaderRefreshRound) => Promise<void>
) => () => void;
export type RegisterUpload = (instanceId: string, upload: () => void) => () => void;
export type ReportAnswer = (instanceId: string, state: AnswerState) => void;

/** A block one card row tall (a hidden skeleton card sets the height) for empty and error states. */
export function CardRowBlock({ compact, children }: { compact: boolean; children: ReactNode }) {
  return (
    <div className={`${styles.emptyWrap} ${styles.cardRowBlock}`}>
      <div className={styles.cardRowSizer} aria-hidden="true">
        <AuthFileCardSkeleton compact={compact} />
      </div>
      <div className={styles.cardRowContent}>{children}</div>
    </div>
  );
}

/** Secondary group actions behind one "More" button, so a phone header stays one row. */
export function GroupMenu({
  label,
  items,
}: {
  label: string;
  items: Array<{
    key: string;
    label: string;
    danger?: boolean;
    disabled?: boolean;
    run: () => void;
  }>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const buttons = [
        ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
      ];
      if (buttons.length === 0) return;
      event.preventDefault();
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + step + buttons.length) % buttons.length]?.focus();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div className={styles.groupMenu} ref={rootRef}>
      {/* The shared Button takes no ref; the trigger needs one to get focus back on Escape. */}
      <button
        ref={triggerRef}
        type="button"
        className="btn btn-ghost btn-sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        title={label}
        onClick={() => setOpen((value) => !value)}
      >
        <span aria-hidden="true" className={styles.moreGlyph}>
          ⋯
        </span>
      </button>
      {open && (
        <div className={styles.groupMenuPopover} role="menu" aria-label={label} ref={menuRef}>
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              role="menuitem"
              className={item.danger ? styles.groupMenuDanger : undefined}
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                triggerRef.current?.focus();
                item.run();
              }}
            >
              {item.danger && <IconTrash2 size={14} aria-hidden="true" />}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function AuthFilesSourceContent({
  hidden,
  pageEmpty,
  filters,
  onClearFilters,
  registerRefresh,
  registerUpload,
  registerQuotaRefresh,
  onAnswer,
}: {
  hidden: boolean;
  pageEmpty: boolean;
  filters: AuthFilesFilters;
  onClearFilters: () => void;
  registerRefresh: RegisterRefresh;
  registerUpload?: RegisterUpload;
  registerQuotaRefresh?: RegisterQuotaRefresh;
  onAnswer?: ReportAnswer;
}) {
  const { t } = useTranslation();
  const sourceScope = useAuthFilesSource();
  const { showNotification } = useAuthFilesNotifications();
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.status === 'current' : true;
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  // Every filter change returns this group to its first page.
  useEffect(() => setPage(1), [filters.revision]);

  const {
    modelsModalOpen,
    modelsFile,
    showModels,
    reloadModels,
    closeModelsModal,
    invalidateModels,
  } = useAuthFilesModels();

  const invalidateDerivedCaches = useCallback(
    (names?: string[]) =>
      invalidateAuthFileDerivedCaches(invalidateModels, names, sourceScope.quotaStore),
    [invalidateModels, sourceScope.quotaStore]
  );
  // Names that leave the inventory (from any tab, the poll or a local delete) clear this
  // source's model and quota caches in the same step that publishes the new file list.
  useEffect(
    () =>
      useCredentialInventoryStore.getState().registerInvalidator((owner, names) => {
        if (sourceOwnerKey(owner) === sourceOwnerKey(sourceScope.session.owner)) {
          invalidateDerivedCaches(names);
        }
      }),
    [invalidateDerivedCaches, sourceScope.session.owner]
  );

  const {
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
    handleDeleteAll,
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
  } = useAuthFilesData({ onFilesMutated: invalidateDerivedCaches });

  const statusBarCache = useAuthFilesStatusBarCache(files);

  // Only the provider lists and alias counts are needed here; edits happen on the Models screen.
  const { excluded, excludedError, modelAlias, modelAliasError, loadExcluded, loadModelAlias } =
    useAuthFilesOauth({
      viewMode: 'list',
      files,
    });

  const {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  } = useAuthFilesPrefixProxyEditor({
    disableControls: !sourceScope.isCurrent() || refreshingAllCredentials,
    loadFiles,
    onFilesMutated: invalidateDerivedCaches,
  });

  const disableControls = !sourceScope.isCurrent() || refreshingAllCredentials;
  const quotaFilterType: QuotaProviderType | null = QUOTA_PROVIDER_TYPES.has(
    filters.provider as QuotaProviderType
  )
    ? (filters.provider as QuotaProviderType)
    : null;
  const activeQuotaFilter: AuthFileQuotaFilter =
    filters.provider === 'all' ? 'all' : (quotaFilterType ?? filters.provider) || null;

  /* ---------- answered once / unreachable, reported to the page header ---------- */

  const [answered, setAnswered] = useState(false);
  useEffect(() => {
    if (!loading) setAnswered(true);
  }, [loading]);
  const instanceId = sourceScope.source.instanceId;
  const answer: AnswerState = !answered ? 'loading' : error ? 'error' : 'ready';
  useEffect(() => onAnswer?.(instanceId, answer), [answer, instanceId, onAnswer]);
  // An unreachable hub takes no header actions; its banner offers "Try again" instead.
  const sourceDown = Boolean(error);
  const groupActionsDisabled = disableControls || sourceDown || !answered;
  useEffect(
    () => registerUpload?.(instanceId, handleUploadClick),
    [handleUploadClick, instanceId, registerUpload]
  );

  /* ---------- loading: foreground the first time (skeletons), background afterwards ---------- */

  const initialLoadDoneRef = useRef(false);
  // Resolves to the list the re-read returned, or null when it failed or was superseded.
  const rereadList = useCallback(async () => {
    const [list] = await Promise.all([
      loadFiles({ background: true }),
      loadExcluded(),
      loadModelAlias(),
    ]);
    return list;
  }, [loadFiles, loadExcluded, loadModelAlias]);
  useEffect(() => {
    if (!isCurrentLayer) return;
    void loadFiles(initialLoadDoneRef.current ? { background: true } : undefined);
    initialLoadDoneRef.current = true;
    loadExcluded();
    loadModelAlias();
  }, [isCurrentLayer, loadFiles, loadExcluded, loadModelAlias]);

  useInterval(
    () => {
      void loadFiles({ background: true }).catch(() => {});
    },
    isCurrentLayer ? 240_000 : null
  );

  /* ---------- filter / sort / group / paginate ---------- */

  // Batch actions act on what is selected: a filter change clears it, so nothing hidden is hit.
  const filterKey = [filters.provider, filters.statusFilterMode, filters.search, hidden].join('\n');
  useEffect(() => deselectAll(), [filterKey, deselectAll]);

  const { sorted, totalPages, currentPage, pageItems } = useMemo(
    () => pageOfAuthFiles(files, filters, page),
    [files, filters, page]
  );
  const deleteTargets = useMemo(() => deletableShown(files, filters), [files, filters]);
  const pageSize = filters.pageSize;
  const pageGroups = useMemo(() => {
    const groups: Array<{ provider: string; items: AuthFileItem[] }> = [];
    pageItems.forEach((file) => {
      const key = providerGroupOf(file);
      const last = groups[groups.length - 1];
      if (last && last.provider === key) last.items.push(file);
      else groups.push({ provider: key, items: [file] });
    });
    return groups;
  }, [pageItems]);
  const providerTotals = useMemo(() => {
    const counts: Record<string, number> = {};
    sorted.forEach((file) => {
      const key = providerGroupOf(file);
      counts[key] = (counts[key] ?? 0) + 1;
    });
    return counts;
  }, [sorted]);
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
    () =>
      files.some(
        (file) =>
          selectedFiles.has(file.name) && statusUpdating[getAuthFileRefreshKey(file)] === true
      ),
    [files, selectedFiles, statusUpdating]
  );
  const batchStatusButtonsDisabled =
    disableControls ||
    selectedNames.length === 0 ||
    batchStatusUpdating ||
    selectedHasStatusUpdating;

  const groupCounts = useMemo(() => countCredentials(files), [files]);

  /* ---------- page-wide quota refresh: the cards this group shows that can have quota ---------- */

  // Claude and Codex accounts the history server covers show its readings, not hub reads.
  useServerQuota(sourceScope.session, files);
  // The Quota page's loader, its guards and its limit: at most QUOTA_PAGE_SIZE reads at once.
  const { loadQuota } = useQuotaBatchLoader(
    sourceScope.quotaAdapters,
    sourceScope.quotaStore,
    sourceScope.session
  );
  const quotaGated = hidden || pageEmpty || loading || disableControls || filters.compactMode;
  // Every card the filters show, on every page: turning the page then shows fresh quota too.
  const quotaTargets = useMemo(
    () => (quotaGated ? [] : quotaRefreshTargets(sorted, activeQuotaFilter)),
    [activeQuotaFilter, sorted, quotaGated]
  );
  // The runner derives its targets when it runs, from the latest render's inputs (or from the
  // list a re-read just returned), so it is registered again only when the count changes
  // (each registration updates page state; re-registering per render would never settle).
  const quotaInputsRef = useRef({ files, filters, activeQuotaFilter, quotaGated });
  useEffect(() => {
    quotaInputsRef.current = { files, filters, activeQuotaFilter, quotaGated };
  });
  // One runner per group for both entry points: a request during a run waits for it, so neither
  // the group's Refresh nor the page-wide "Refresh quota" is ever dropped by the batch loader.
  const [coalesceQuota] = useState(() => createCoalescingRunner<AuthFileItem[]>());
  const executeQuota = useCallback<QuotaRun<AuthFileItem[]>>(
    async (lists, onSettled) => {
      const inputs = quotaInputsRef.current;
      const list = [...lists].reverse().find((entry) => entry) ?? inputs.files;
      const targets = inputs.quotaGated
        ? []
        : quotaTargetsShown(list, inputs.filters, inputs.activeQuotaFilter);
      // The loader reuses cards read under a minute ago and keeps a few reads open at a time.
      if (sourceScope.isCurrent()) await loadQuota(targets, onSettled);
    },
    [loadQuota, sourceScope]
  );
  const requestQuota = useCallback(
    (list?: AuthFileItem[], onSettled?: (ok: boolean) => void) =>
      coalesceQuota(executeQuota, list, onSettled),
    [coalesceQuota, executeQuota]
  );
  const runQuotaRefresh = useCallback(
    (onSettled: (ok: boolean) => void) => requestQuota(undefined, onSettled),
    [requestQuota]
  );
  useEffect(
    () =>
      registerQuotaRefresh?.(sourceOwnerKey(sourceScope.session.owner), {
        count: quotaTargets.length,
        run: runQuotaRefresh,
      }),
    [quotaTargets.length, registerQuotaRefresh, runQuotaRefresh, sourceScope.session.owner]
  );

  // The group's Refresh: one click re-reads the list, then loads quota for the cards the
  // refreshed list shows, with no dialog or toast; a list failure shows in the group's banner
  // (quota then loads for the cards already shown), a quota one in its card.
  const [refreshingGroup, setRefreshingGroup] = useState(false);
  const handleGroupRefresh = useCallback(async () => {
    setRefreshingGroup(true);
    // Each hub proves the key with one request before the rest (services/api/authGate.ts).
    providerSources.armAuthProbes();
    try {
      const list = await rereadList().catch(() => null);
      await requestQuota(list ?? undefined).catch(() => {});
    } finally {
      setRefreshingGroup(false);
    }
  }, [requestQuota, rereadList]);

  // The header's refresh: the round already reads every hub's list once and re-reads the model
  // lists store-wide, so this group takes its files from that read, then refreshes its quota.
  const handleHeaderRefresh = useCallback(
    async (round?: HeaderRefreshRound) => {
      const list = round
        ? await loadFiles({ background: true, inventory: round.inventory })
        : await rereadList().catch(() => null);
      let failed = 0;
      await requestQuota(list ?? undefined, (ok) => {
        if (!ok) failed += 1;
      });
      if (failed > 0) round?.quotaFailed(instanceId, failed);
    },
    [instanceId, loadFiles, requestQuota, rereadList]
  );
  useEffect(
    () => registerRefresh(sourceOwnerKey(sourceScope.session.owner), handleHeaderRefresh),
    [registerRefresh, sourceScope.session.owner, handleHeaderRefresh]
  );

  /* ---------- one-time card entrance cascade (see AuthFileCard) ---------- */

  const [cardsAnimated, setCardsAnimated] = useState(false);
  const enableCardEntrance = !cardsAnimated && isCurrentLayer && !loading && pageItems.length > 0;
  useEffect(() => {
    if (enableCardEntrance) setCardsAnimated(true);
  }, [enableCardEntrance]);
  const cardEntranceDelay = (index: number): number | null => {
    if (!enableCardEntrance) return null;
    if (pageItems.length <= 1) return 0;
    return Math.round((index / (pageItems.length - 1)) * CARD_ENTRANCE_BUDGET_MS);
  };

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

  const listState = listLoadState({ loading, refreshing, error, fileCount: files.length });
  const groupKnown = answered && !(sourceDown && files.length === 0);
  const errorBanner = (
    <div
      className={`${styles.errorBanner} ${styles.errorWithAction} ${
        listState === 'error' ? styles.errorBlock : ''
      }`}
      role="alert"
    >
      <span>{error}</span>
      <Button
        variant="secondary"
        size="sm"
        loading={loading || refreshing}
        disabled={loading || refreshing}
        onClick={() => void loadFiles(files.length > 0 ? { background: true } : undefined)}
      >
        {t('auth_files.retry')}
      </Button>
    </div>
  );
  const isFirstRunEmpty = listState === 'empty';
  const isNoResults = !loading && files.length > 0 && pageItems.length === 0;
  const linkState = { fromAuthFiles: true, sourceOwner: sourceScope.session.owner };

  const gridClasses = [
    styles.grid,
    filters.compactMode ? styles.gridCompact : '',
    activeQuotaFilter ? styles.gridQuota : '',
  ]
    .filter(Boolean)
    .join(' ');

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept=".json,application/json"
      multiple
      style={{ display: 'none' }}
      onChange={handleFileChange}
    />
  );

  // The page shows one empty state for every source: this group keeps only its upload input.
  if (pageEmpty) {
    return (
      <div
        className={styles.sourceGroup}
        data-machine="auth-files-list"
        data-state={listState}
        hidden
      >
        {fileInput}
      </div>
    );
  }

  const providerHeading = (provider: string, shownOnPage: number) => {
    const named = provider !== OTHER_PROVIDER_GROUP;
    const label = getTypeLabel(t, provider);
    // Every heading states rules and aliases; a pending or failed read (or no provider) says "–".
    const rulesText =
      named && excludedError === null
        ? t('auth_files.provider_rules', { count: excluded[provider]?.length ?? 0 })
        : t('auth_files.provider_rules_unknown');
    const aliasesText =
      named && modelAliasError === null
        ? t('auth_files.provider_aliases', { count: modelAlias[provider]?.length ?? 0 })
        : t('auth_files.provider_aliases_unknown');
    return (
      <div className={styles.providerHeader}>
        <h3 className={styles.providerHeading}>
          {t('auth_files.unified_provider_heading', {
            provider: label,
            count: providerTotals[provider] ?? shownOnPage,
          })}
        </h3>
        <span className={styles.providerFacts}>
          {rulesText} · {aliasesText}
        </span>
        {named ? (
          <Link
            className={styles.providerLink}
            to={modelsScreenPath(instanceId, provider)}
            state={linkState}
            aria-label={t('auth_files.provider_models_link_aria', { provider: label })}
            aria-disabled={groupActionsDisabled || undefined}
            tabIndex={groupActionsDisabled ? -1 : undefined}
            onClick={(event) => {
              if (groupActionsDisabled) event.preventDefault();
            }}
          >
            {t('auth_files.provider_models_link')} <span aria-hidden="true">→</span>
          </Link>
        ) : (
          <span
            className={styles.providerLink}
            aria-disabled="true"
            title={t('auth_files.provider_models_link_none')}
          >
            {t('auth_files.provider_models_link')} <span aria-hidden="true">→</span>
          </span>
        )}
      </div>
    );
  };

  return (
    <div className={styles.sourceGroup} data-machine="auth-files-list" data-state={listState}>
      <header className={styles.groupHeader}>
        <div className={styles.groupTitle}>
          <h2 className={styles.sourceHeading}>
            {sourceScope.source.label} <code>{sourceScope.source.instanceId}</code>
          </h2>
          <p className={styles.groupMeta}>
            {/* The same parts in every state: "–" until this source has answered. */}
            <span>
              {t('auth_files.unified_group_count', {
                shown: groupKnown ? sorted.length : UNKNOWN,
                total: groupKnown ? files.length : UNKNOWN,
              })}
            </span>
            {healthParts(t, groupKnown ? groupCounts : null).map((part, index) => (
              <span
                key={index}
                className={
                  index === 1 && groupKnown && groupCounts.problem > 0
                    ? styles.groupProblem
                    : undefined
                }
              >
                {part}
              </span>
            ))}
            {answered && sourceDown && files.length === 0 && (
              <span className={styles.groupProblem}>{t('auth_files.source_unreachable')}</span>
            )}
            {(!answered || refreshing) && <span role="status">{t('common.loading')}</span>}
          </p>
        </div>
        <div className={styles.groupActions}>
          <Button
            variant="ghost"
            size="sm"
            data-testid="auth-files-group-refresh"
            onClick={handleGroupRefresh}
            loading={refreshingGroup}
            disabled={groupActionsDisabled || refreshingGroup}
            title={t('auth_files.refresh_group_title')}
            aria-label={t('auth_files.refresh_group_title')}
          >
            <IconRefreshCw size={14} aria-hidden="true" /> {t('auth_files.refresh_all_short')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleUploadClick}
            loading={uploading}
            disabled={groupActionsDisabled || uploading}
          >
            <IconUpload size={14} aria-hidden="true" /> {t('auth_files.upload_button')}
          </Button>
          <GroupMenu
            label={t('auth_files.more_actions', { source: sourceScope.source.label })}
            items={[
              {
                key: 'refresh-tokens',
                label: t('auth_files.refresh_tokens_menu'),
                disabled: groupActionsDisabled || Object.keys(manualRefreshing).length > 0,
                run: handleRefreshAllCredentials,
              },
              {
                key: 'delete-shown',
                label: t('auth_files.delete_shown_menu', { count: deleteTargets.length }),
                danger: true,
                disabled:
                  groupActionsDisabled || loading || deletingAll || deleteTargets.length === 0,
                run: () => handleDeleteAll(deleteTargets),
              },
            ]}
          />
        </div>
      </header>
      <AuthFileRefreshResults results={refreshResults} onClose={closeRefreshResults} />
      {fileInput}

      {error && listState === 'error-stale' && errorBanner}

      {loading ? (
        <div className={gridClasses} aria-hidden="true">
          {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
            <AuthFileCardSkeleton key={index} compact={filters.compactMode} />
          ))}
        </div>
      ) : listState === 'error' ? (
        <CardRowBlock compact={filters.compactMode}>{errorBanner}</CardRowBlock>
      ) : isFirstRunEmpty ? (
        <CardRowBlock compact={filters.compactMode}>
          <EmptyState
            title={t('auth_files.empty_title')}
            description={t('auth_files.empty_desc')}
            action={
              <div className={styles.emptyActions}>
                <Button
                  size="sm"
                  onClick={handleUploadClick}
                  disabled={disableControls || uploading}
                >
                  {t('auth_files.upload_button')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() =>
                    navigate(`/oauth?source=${encodeURIComponent(instanceId)}`, {
                      state: { sourceOwner: sourceScope.session.owner },
                    })
                  }
                >
                  {t('auth_files.empty_oauth_link')}
                </Button>
              </div>
            }
          />
        </CardRowBlock>
      ) : isNoResults ? (
        <CardRowBlock compact={filters.compactMode}>
          <EmptyState
            title={t('auth_files.unified_group_filtered_out')}
            action={
              <Button variant="secondary" size="sm" onClick={onClearFilters}>
                {t('auth_files.no_results_clear')}
              </Button>
            }
          />
        </CardRowBlock>
      ) : (
        pageGroups.map((group) => {
          const offset = pageItems.indexOf(group.items[0]);
          return (
            <div key={group.provider} className={styles.providerGroup}>
              {providerHeading(group.provider, group.items.length)}
              <div className={gridClasses}>
                {group.items.map((file, index) => (
                  <AuthFileCard
                    key={getQuotaCacheKey(file)}
                    file={file}
                    compact={filters.compactMode}
                    selected={selectedFiles.has(file.name)}
                    resolvedTheme={resolvedTheme}
                    disableControls={disableControls}
                    deleting={deleting}
                    statusUpdating={statusUpdating}
                    manualRefreshing={manualRefreshing}
                    cooldownResetting={cooldownResetting}
                    quotaFilterType={activeQuotaFilter}
                    statusBarCache={statusBarCache}
                    entranceDelayMs={cardEntranceDelay(offset + index)}
                    onShowModels={showModels}
                    onDownload={handleDownload}
                    onManualRefresh={handleManualRefresh}
                    onCooldownReset={handleCooldownReset}
                    onOpenPrefixProxyEditor={openPrefixProxyEditor}
                    onDelete={handleDelete}
                    onToggleStatus={handleStatusToggle}
                    onToggleSelect={toggleSelect}
                  />
                ))}
              </div>
            </div>
          );
        })
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

      <AuthFileModelsModal
        open={modelsModalOpen}
        file={modelsFile}
        onClose={closeModelsModal}
        onRetry={reloadModels}
        onCopyText={copyTextWithNotification}
      />

      <AuthFileDetailsSheet
        disableControls={disableControls}
        editor={prefixProxyEditor}
        updatedText={prefixProxyUpdatedText}
        dirty={prefixProxyDirty}
        onClose={closePrefixProxyEditor}
        onCopyText={copyTextWithNotification}
        onSave={handlePrefixProxySave}
        onChange={handlePrefixProxyChange}
      />

      <BatchActionBar
        inline
        sourceLabel={sourceScope.source.label}
        selectionCount={selectionCount}
        selectablePageCount={selectablePageItems.length}
        selectableFilteredCount={selectableFilteredItems.length}
        disableControls={disableControls}
        batchStatusDisabled={batchStatusButtonsDisabled}
        onSelectPage={() => selectAllVisible(pageItems)}
        onSelectFiltered={() => selectAllVisible(sorted)}
        onInvertPage={() => invertVisibleSelection(pageItems)}
        onDeselectAll={deselectAll}
        onDownload={() => void batchDownload(selectedNames)}
        onEnable={() => batchSetStatus(selectedNames, true)}
        onDisable={() => batchSetStatus(selectedNames, false)}
        onDelete={() => batchDelete(selectedNames)}
      />
    </div>
  );
}
