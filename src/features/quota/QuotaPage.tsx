import { useSourceLease } from '@/hooks/useSourceLease';
/**
 * 额度查询页：提供商 tabs + 统一卡网格。
 *
 * 保留的行为契约（重设计不改）：
 * - Registry enumeration loads inventory only; quota actions remain explicit;
 * - cacheGeneration 会话隔离 + request-id 去重（见 useQuotaBatchLoader）；
 * - 文件列表变化后按 provider 剪枝额度缓存（已删文件不残留）；
 * - Header refresh: each source section registers itself; a click re-reads the list from the
 *   round's one inventory read, then the quota of every card the tab and search show.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { sourceOwnerKey, type SourceSession } from '@/services/api/sourceSession';
import { useProviderSources } from '@/stores/useProviderSources';
import {
  selectSourceFiles,
  useCredentialInventoryStore,
  type RefreshOutcome,
} from '@/stores/useCredentialInventoryStore';
import { providerSources } from '@/stores/useProviderSources';
import { sourceQuotaStore } from '@/stores/sourceQuotaStores';
import { useServerAccountsStore } from '@/stores/useServerAccountsStore';
import { isServedFile, serverAccountFor } from '@/features/quotaPool/serverQuota';
import { useServerQuota } from '@/features/quotaPool/useServerQuota';
import { isQuotaSourceCurrent } from './sourceCurrent';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh, type HeaderRefreshRound } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useThemeStore } from '@/stores';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getQuotaCacheKey } from '@/utils/quota/identity';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { QuotaCard } from './components/QuotaCard';
import { QuotaTimeline } from './components/QuotaTimeline';
import {
  CARD_ENTRANCE_BUDGET_MS,
  QUOTA_PAGE_SIZE,
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  filterEntriesBySearch,
  paginate,
  sortQuotaEntries,
  type QuotaFileEntry,
} from './logic';
import { nextRecoveryMs } from './resetSchedule';
import { createQuotaAdapters, getQuotaSetter, type QuotaCardState } from './providers';
import type { QuotaProviderType } from './providers/types';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

const TAB_IDS: string[] = ['all', ...QUOTA_TAB_ORDER];
const SKELETON_CARD_COUNT = 6;

/**
 * Existing providers display filenames; Devin's card and timeline share an
 * identity-aware display label. Keep the filename fallback stable for memoization.
 */
const displayNameFor = (name: string) => name;

export function QuotaPage() {
  const { t } = useTranslation();
  const registry = useProviderSources();
  return (
    <div>
      {registry.status === 'loading' && <Skeleton height={168} />}
      {registry.status === 'error' && <div role="alert">{t('notification.refresh_failed')}</div>}
      {registry.sources.map((view) => (
        <section key={view.session ? sourceOwnerKey(view.session.owner) : view.source.instanceId}>
          <h2>{view.source.label}</h2>
          {view.session && view.status === 'ready' ? (
            <SourceQuotaPage session={view.session} />
          ) : (
            <div role="status">{t('login.error_unauthorized')}</div>
          )}
        </section>
      ))}
    </div>
  );
}

function SourceQuotaPage({ session: owner }: { session: SourceSession }) {
  const { session } = useSourceLease(owner);
  // The source session's one quota store, shared with Auth Files and the pool's reset panel.
  const useSourceQuotaStore = sourceQuotaStore(owner.owner);
  const adapters = useMemo(
    () => createQuotaAdapters(session, useSourceQuotaStore),
    [session, useSourceQuotaStore]
  );
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<QuotaTabId>(() => readQuotaUiState()?.tab ?? 'all');
  const [sortMode, setSortMode] = useState<QuotaSortMode>(
    () => readQuotaUiState()?.sortMode ?? 'default'
  );
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  // 页头 + tabs 的入场级联（标题 → meta → 动作 → tabs，级差 70ms）
  const revealRef = useRevealGroup<HTMLDivElement>();

  const disableControls = connectionStatus !== 'connected' || !isQuotaSourceCurrent(session);

  /* ---------- 文件列表 ---------- */

  const sessionGeneration = useSourceQuotaStore((state) => state.cacheGeneration);
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const listRequestRef = useRef(0);
  /** Resolves to the list it read, or null when it failed or was superseded. */
  const loadFiles = useCallback(
    async (inventory?: Promise<RefreshOutcome>) => {
      const requestId = ++listRequestRef.current;
      if (connectionStatus !== 'connected') {
        setFiles([]);
        setFilesGeneration(null);
        setLoading(false);
        return null;
      }
      const isCurrent = () =>
        isQuotaSourceCurrent(session) &&
        requestId === listRequestRef.current &&
        sessionGeneration === useSourceQuotaStore.getState().cacheGeneration;
      setLoading(true);
      setError('');
      try {
        const outcome = await (inventory ?? useCredentialInventoryStore.getState().refresh());
        if (!isCurrent()) return null;
        const failure = outcome[session.owner.instanceId];
        if (failure !== null) throw failure ?? new Error(t('notification.refresh_failed'));
        const list = selectSourceFiles(useCredentialInventoryStore.getState(), session.owner) ?? [];
        setFiles(list);
        setFilesGeneration(sessionGeneration);
        return list;
      } catch (err: unknown) {
        if (!isCurrent()) return null;
        const message = err instanceof Error ? err.message : t('notification.refresh_failed');
        setError(message);
        return null;
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [connectionStatus, sessionGeneration, t, session, useSourceQuotaStore]
  );

  useEffect(() => {
    void loadFiles();
    return () => {
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  // Commits from the credential inventory (an add or remove anywhere, the poll, another tab) reach
  // this page without a fetch of its own; a quiet page has no edit of its own to protect.
  const inventoryFiles = useCredentialInventoryStore((state) =>
    selectSourceFiles(state, session.owner)
  );
  useEffect(() => {
    if (inventoryFiles && filesGeneration === sessionGeneration) setFiles(inventoryFiles);
  }, [inventoryFiles, filesGeneration, sessionGeneration]);

  /* ---------- 额度缓存 ----------
   * 排在归类/排序之前：「最快恢复优先」要读它算排序键。 */

  const antigravityQuota = useSourceQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useSourceQuotaStore((state) => state.claudeQuota);
  const codexQuota = useSourceQuotaStore((state) => state.codexQuota);
  const devinQuota = useSourceQuotaStore((state) => state.devinQuota);
  const kimiQuota = useSourceQuotaStore((state) => state.kimiQuota);
  const metaQuota = useSourceQuotaStore((state) => state.metaQuota);
  const pluginQuota = useSourceQuotaStore((state) => state.pluginQuota);
  const xaiQuota = useSourceQuotaStore((state) => state.xaiQuota);
  const fetchedAt = useSourceQuotaStore((state) => state.fetchedAt);
  const nextReadAt = useSourceQuotaStore((state) => state.nextReadAt);
  // Claude and Codex accounts of a source the history server covers show its readings.
  useServerQuota(session, files);
  const routing = useServerAccountsStore((state) => state.routing);
  const serverAccounts = useServerAccountsStore((state) => state.accounts);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        meta: metaQuota,
        plugin: pluginQuota,
        xai: xaiQuota,
      }) as unknown as Record<QuotaProviderType, Record<string, QuotaCardState>>,
    [
      antigravityQuota,
      claudeQuota,
      codexQuota,
      devinQuota,
      kimiQuota,
      metaQuota,
      pluginQuota,
      xaiQuota,
    ]
  );

  const getQuota = useCallback(
    (entry: QuotaFileEntry): QuotaCardState | undefined =>
      quotaByType[entry.type][getQuotaCacheKey(entry.file)],
    [quotaByType]
  );

  /* ---------- 归类 / 过滤 / 排序 / 分页 ---------- */

  // 只在「最快恢复优先」下订阅分钟时钟。默认序下不门控的话，pageItems 每分钟
  // 换一次身份，会反复空转下面那个「刷新全部」的 loading 下降沿 effect。
  const tick = useNow(sortMode !== 'default');
  const sortNow = sortMode === 'default' ? 0 : tick;

  const entries = useMemo(() => classifyQuotaFiles(files), [files]);
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  const filteredEntries = useMemo(
    () => filterEntriesBySearch(filterEntriesByTab(entries, tab), search),
    [entries, tab, search]
  );
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value);
    setPage(1);
  }, []);

  const resolveNextRecovery = useCallback(
    (entry: QuotaFileEntry) => nextRecoveryMs(entry.type, getQuota(entry), sortNow),
    [getQuota, sortNow]
  );
  // 排序在分页之前：否则「最快恢复」只在当前页内成立。
  const sortedEntries = useMemo(
    () => sortQuotaEntries(filteredEntries, sortMode, resolveNextRecovery),
    [filteredEntries, sortMode, resolveNextRecovery]
  );

  const { pageItems, currentPage, totalPages } = useMemo(
    () => paginate(sortedEntries, page, QUOTA_PAGE_SIZE),
    [sortedEntries, page]
  );

  const handleTabChange = useCallback((next: string) => {
    setTab(next as QuotaTabId);
    setPage(1);
    writeQuotaUiState({ tab: next as QuotaTabId });
  }, []);

  const handleSortModeChange = useCallback((next: string) => {
    setSortMode(next as QuotaSortMode);
    setPage(1);
    writeQuotaUiState({ sortMode: next as QuotaSortMode });
  }, []);

  const sortOptions = useMemo(
    () =>
      QUOTA_SORT_MODES.map((mode) => ({ value: mode, label: t(`quota_management.sort_${mode}`) })),
    [t]
  );

  const { loadedCount, attentionCount } = useMemo(() => {
    let loaded = 0;
    let attention = 0;
    entries.forEach((entry) => {
      const status = quotaByType[entry.type][getQuotaCacheKey(entry.file)]?.status;
      if (status === 'success') loaded += 1;
      else if (status === 'error') attention += 1;
    });
    return { loadedCount: loaded, attentionCount: attention };
  }, [entries, quotaByType]);

  // 剪枝：文件列表落定后，各 provider 缓存只保留仍存在的凭证
  useEffect(() => {
    if (loading || error || filesGeneration !== sessionGeneration) return;
    const survivorsByType = new Map<QuotaProviderType, Set<string>>(
      QUOTA_TAB_ORDER.map((type) => [type, new Set<string>()])
    );
    entries.forEach((entry) => survivorsByType.get(entry.type)?.add(getQuotaCacheKey(entry.file)));

    QUOTA_TAB_ORDER.forEach((type) => {
      const survivors = survivorsByType.get(type) ?? new Set<string>();
      const setQuota = getQuotaSetter(adapters[type], useSourceQuotaStore);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, error, filesGeneration, loading, sessionGeneration, adapters, useSourceQuotaStore]);

  /* ---------- 加载与操作 ---------- */

  const { batchLoading, loadQuota } = useQuotaBatchLoader(adapters, useSourceQuotaStore, session);
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(
    disableControls,
    useSourceQuotaStore,
    session
  );

  // Refresh all (this section's button, or the header with its round's inventory read): re-read
  // the list, then the quota of every card the tab and search show, on every page. Cards read
  // under a minute ago are reused (quotaFreshness.ts).
  const viewRef = useRef({ tab, search, disableControls });
  useEffect(() => {
    viewRef.current = { tab, search, disableControls };
  });
  const refreshEverything = useCallback(
    async (round?: HeaderRefreshRound) => {
      if (viewRef.current.disableControls) return;
      // The header armed every hub already; the section's own button arms them here.
      if (!round) providerSources.armAuthProbes();
      const list = await loadFiles(round?.inventory);
      if (!list || viewRef.current.disableControls) return;
      const { tab: shownTab, search: shownSearch } = viewRef.current;
      let failed = 0;
      await loadQuota(
        filterEntriesBySearch(filterEntriesByTab(classifyQuotaFiles(list), shownTab), shownSearch),
        (ok) => {
          if (!ok) failed += 1;
        }
      );
      if (failed > 0) round?.quotaFailed(session.owner.instanceId, failed);
    },
    [loadFiles, loadQuota, session]
  );
  const handleRefreshAll = useCallback(() => void refreshEverything(), [refreshEverything]);
  useHeaderRefresh(refreshEverything);

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;

  /* ---------- 首屏卡片一次性级联入场 ----------
   * 首批数据渲染后立即翻转 cardsAnimated；已挂载的卡片在挂载时捕获过自己的
   * 延迟（QuotaCard 内 useState 初始化），后续切 tab/翻页/刷新新挂载的卡片
   * 拿到 null —— 不重播。 */

  const [cardsAnimated, setCardsAnimated] = useState(false);
  const enableCardEntrance = !cardsAnimated && !loading && pageItems.length > 0;
  useEffect(() => {
    if (enableCardEntrance) {
      setCardsAnimated(true);
    }
  }, [enableCardEntrance]);
  const cardEntranceDelay = (index: number): number | null => {
    if (!enableCardEntrance) return null;
    if (pageItems.length <= 1) return 0;
    return Math.round((index / (pageItems.length - 1)) * CARD_ENTRANCE_BUDGET_MS);
  };

  /* ---------- 渲染 ---------- */

  const isEmpty = !loading && filteredEntries.length === 0;

  return (
    <div className={styles.page} ref={revealRef}>
      <QuotaHeader
        totalCount={entries.length}
        loadedCount={loadedCount}
        attentionCount={attentionCount}
        refreshing={loading || batchLoading}
        disableControls={disableControls}
        onRefreshAll={handleRefreshAll}
      />

      <section className={styles.workbench}>
        {/* 提供商导航与搜索工具栏分层，避免不同控件争夺视觉焦点。 */}
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={TAB_IDS}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={handleTabChange}
          />
        </div>

        <div className={styles.toolbar}>
          <div className={styles.search}>
            <IconSearch size={16} className={styles.searchIcon} aria-hidden="true" />
            <input
              ref={searchInputRef}
              className={styles.searchInput}
              type="search"
              value={search}
              onChange={(event) => handleSearchChange(event.target.value)}
              placeholder={t('quota_management.search_placeholder')}
              aria-label={t('quota_management.search_label')}
            />
            {search && (
              <button
                type="button"
                className={styles.clearSearch}
                aria-label={t('quota_management.search_clear')}
                title={t('quota_management.search_clear')}
                onClick={() => {
                  handleSearchChange('');
                  searchInputRef.current?.focus();
                }}
              >
                <IconX size={14} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className={styles.sort}>
            <Select
              value={sortMode}
              options={sortOptions}
              onChange={handleSortModeChange}
              ariaLabel={t('quota_management.sort_label')}
              size="sm"
            />
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.grid} aria-hidden="true">
            {Array.from({ length: SKELETON_CARD_COUNT }, (_, index) => (
              <Skeleton key={index} height={168} rounded={14} />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={
              search.trim()
                ? t('quota_management.search_empty_title')
                : tab === 'all'
                  ? t('quota_management.empty_title')
                  : t(`${adapters[tab].i18nPrefix}.empty_title`)
            }
            description={
              search.trim()
                ? t('quota_management.search_empty_desc')
                : tab === 'all'
                  ? t('quota_management.empty_desc')
                  : t(`${adapters[tab].i18nPrefix}.empty_desc`)
            }
            action={
              search.trim() ? (
                <Button variant="secondary" size="sm" onClick={() => handleSearchChange('')}>
                  {t('quota_management.search_clear')}
                </Button>
              ) : tab === 'all' ? undefined : (
                <Button variant="secondary" size="sm" onClick={() => handleTabChange('all')}>
                  {t('auth_files.filter_all')}
                </Button>
              )
            }
          />
        ) : (
          <div className={styles.grid}>
            {pageItems.map((entry, index) => (
              <QuotaCard
                key={`${entry.type}:${getQuotaCacheKey(entry.file)}`}
                entry={entry}
                adapter={adapters[entry.type]}
                quota={getQuota(entry)}
                resolvedTheme={resolvedTheme}
                canRefresh={canUseActions}
                resetting={resettingQuotaName === getQuotaCacheKey(entry.file)}
                entranceDelayMs={cardEntranceDelay(index)}
                fetchedAt={fetchedAt[getQuotaCacheKey(entry.file)]}
                nextReadAt={nextReadAt[getQuotaCacheKey(entry.file)]}
                server={
                  entry.type === 'claude' &&
                  isServedFile(routing, session.owner.instanceId, entry.file)
                    ? {
                        resets:
                          serverAccountFor(
                            routing,
                            serverAccounts,
                            session.owner.instanceId,
                            'claude',
                            entry.file
                          )?.resets ?? null,
                      }
                    : undefined
                }
                onRefresh={(options) =>
                  void refreshQuota(entry.file, adapters[entry.type], options)
                }
                onReset={() => resetQuota(entry.file, adapters[entry.type])}
              />
            ))}
          </div>
        )}

        {!loading && filteredEntries.length > QUOTA_PAGE_SIZE && (
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
                count: filteredEntries.length,
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

        {/* 时间线只比较当前页凭证，避免大量凭证一次性生成无界泳道。 */}
        <QuotaTimeline
          entries={pageItems}
          quotaFor={getQuota}
          displayNameFor={displayNameFor}
          resolvedTheme={resolvedTheme}
        />
      </section>
    </div>
  );
}
