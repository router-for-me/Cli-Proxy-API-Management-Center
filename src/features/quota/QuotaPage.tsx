/**
 * 额度查询页：提供商 tabs + 统一卡网格。
 *
 * 保留的行为契约（重设计不改）：
 * - 现有提供商保持点击加载；Devin 首次可见时主动查询一次，不轮询；
 * - cacheGeneration 会话隔离 + request-id 去重（见 useQuotaBatchLoader）；
 * - 文件列表变化后按 provider 剪枝额度缓存（已删文件不残留）；
 * - useHeaderRefresh 单槽位：本页唯一注册者，全局刷新 = 重取文件列表。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconSearch, IconX } from '@/components/ui/icons';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useNow } from '@/hooks/useNow';
import { useRevealGroup } from '@/hooks/motion';
import { useAuthStore, useConfigStore, useQuotaStore, useThemeStore } from '@/stores';
import type { QuotaHistory } from '@/services/api/quotaHistory';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import { getQuotaCacheKey, getQuotaDisplayName } from '@/utils/quota/identity';
import { ProviderTabs } from '@/features/authFiles/components/ProviderTabs';
import { QuotaHeader } from './components/QuotaHeader';
import { AccountsTable } from './accounts/AccountsTable';
import { WEEKLY_RESET_STRATEGY } from './accounts/rowModel';
import { maskEmails } from './emailMask';
import { QuotaForecastSection } from './forecast/QuotaForecastSection';
import type { PoolSummary } from './forecast/pools';
import { useForecastPrefs } from './forecast/prefs';
import {
  QUOTA_PAGE_SIZE,
  QUOTA_SORT_MODES,
  QUOTA_TAB_ORDER,
  type QuotaSortMode,
  type QuotaTabId,
} from './constants';
import {
  buildTabCounts,
  canRefreshQuotaAfterList,
  classifyQuotaFiles,
  filterEntriesByTab,
  filterEntriesBySearch,
  paginate,
  sortQuotaEntries,
  type QuotaFileEntry,
} from './logic';
import { nextRecoveryMs } from './resetSchedule';
import { QUOTA_ADAPTERS, getQuotaSetter, type QuotaCardState } from './providers';
import {
  codexCreditOverageKey,
  countCodexCreditOverageKeys,
} from './providers/codex/creditOverage';
import type { QuotaProviderType } from './providers/types';
import { useDevinQuotaAutoLoad } from './providers/devin/useDevinQuotaAutoLoad';
import { useQuotaActions } from './hooks/useQuotaActions';
import { useQuotaBatchLoader } from './hooks/useQuotaBatchLoader';
import { readQuotaUiState, writeQuotaUiState } from './uiState';
import styles from './QuotaPage.module.scss';

const TAB_IDS: string[] = ['all', ...QUOTA_TAB_ORDER];
const SKELETON_ROW_COUNT = 6;
/** How often the credential list (status, cooldowns) is re-read in the background. */
const FILES_REFRESH_MS = 60 * 1000;

export function QuotaPage() {
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
  const [forecastPrefs, updateForecastPrefs] = useForecastPrefs();
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  // Recorded history, shared by the pool charts and the account rows.
  const [forecastHistory, setForecastHistory] = useState<QuotaHistory | null>(null);
  // Pool figures from the charts, repeated in the account list's provider headers.
  const [poolSummaries, setPoolSummaries] = useState<Record<string, PoolSummary>>({});
  // 页头 + tabs 的入场级联（标题 → meta → 动作 → tabs，级差 70ms）
  const revealRef = useRevealGroup<HTMLDivElement>();

  const disableControls = connectionStatus !== 'connected';

  /* ---------- 文件列表 ---------- */

  const sessionGeneration = useQuotaStore((state) => state.cacheGeneration);
  const [filesGeneration, setFilesGeneration] = useState<number | null>(null);
  const listRequestRef = useRef(0);
  const loadFiles = useCallback(async () => {
    const requestId = ++listRequestRef.current;
    if (connectionStatus !== 'connected') {
      setFiles([]);
      setFilesGeneration(null);
      setLoading(false);
      return;
    }
    const isCurrent = () =>
      requestId === listRequestRef.current &&
      sessionGeneration === useQuotaStore.getState().cacheGeneration;
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      if (!isCurrent()) return;
      setFiles(data?.files || []);
      setFilesGeneration(sessionGeneration);
    } catch (err: unknown) {
      if (!isCurrent()) return;
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      if (isCurrent()) setLoading(false);
    }
  }, [connectionStatus, sessionGeneration, t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    void loadFiles();
    return () => {
      listRequestRef.current += 1;
    };
  }, [loadFiles]);

  // Cooldowns start and end on their own, so re-read the list quietly (no loading state)
  // while the page is visible: a row must not keep a status the router has left.
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      const requestId = listRequestRef.current;
      const generation = sessionGeneration;
      void authFilesApi
        .list()
        .then((data) => {
          if (
            requestId !== listRequestRef.current ||
            generation !== useQuotaStore.getState().cacheGeneration
          ) {
            return;
          }
          setFiles(data?.files || []);
        })
        .catch(() => undefined);
    }, FILES_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [connectionStatus, sessionGeneration]);

  /* ---------- 额度缓存 ----------
   * 排在归类/排序之前：「最快恢复优先」要读它算排序键。 */

  const antigravityQuota = useQuotaStore((state) => state.antigravityQuota);
  const claudeQuota = useQuotaStore((state) => state.claudeQuota);
  const codexQuota = useQuotaStore((state) => state.codexQuota);
  const devinQuota = useQuotaStore((state) => state.devinQuota);
  const kimiQuota = useQuotaStore((state) => state.kimiQuota);
  const copilotQuota = useQuotaStore((state) => state.copilotQuota);
  const metaQuota = useQuotaStore((state) => state.metaQuota);
  const pluginQuota = useQuotaStore((state) => state.pluginQuota);
  const xaiQuota = useQuotaStore((state) => state.xaiQuota);

  const quotaByType = useMemo<Record<QuotaProviderType, Record<string, QuotaCardState>>>(
    () =>
      ({
        antigravity: antigravityQuota,
        claude: claudeQuota,
        codex: codexQuota,
        devin: devinQuota,
        kimi: kimiQuota,
        copilot: copilotQuota,
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
      copilotQuota,
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

  // Emails in account names are masked until "Show emails" is on.
  const showEmails = forecastPrefs.showEmails;
  const accountNameFor = useCallback(
    (entry: QuotaFileEntry): string => {
      const name = getQuotaDisplayName(entry.file);
      return showEmails ? name : maskEmails(name, entry.file.email);
    },
    [showEmails]
  );
  const tabCounts = useMemo(() => buildTabCounts(entries), [entries]);
  // Account-level settings span every page and tab, so count over all entries.
  const codexCreditOverageCounts = useMemo(
    () =>
      countCodexCreditOverageKeys(
        entries.filter((entry) => entry.type === 'codex').map((entry) => entry.file)
      ),
    [entries]
  );
  const creditOverageCountFor = useCallback(
    (entry: QuotaFileEntry) =>
      entry.type === 'codex'
        ? codexCreditOverageCounts.get(codexCreditOverageKey(entry.file) ?? '')
        : undefined,
    [codexCreditOverageCounts]
  );
  // The plugin tab only appears once a plugin credential exists.
  const visibleTabIds = useMemo(
    () => TAB_IDS.filter((id) => id !== 'plugin' || (tabCounts[id] ?? 0) > 0 || tab === id),
    [tab, tabCounts]
  );
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
      const setQuota = getQuotaSetter(QUOTA_ADAPTERS[type]);
      setQuota((prev) => {
        const staleKeys = Object.keys(prev).filter((name) => !survivors.has(name));
        if (staleKeys.length === 0) return prev;
        const next = { ...prev };
        staleKeys.forEach((name) => delete next[name]);
        return next;
      });
    });
  }, [entries, error, filesGeneration, loading, sessionGeneration]);

  /* ---------- 加载与操作 ---------- */

  const { batchLoading, loadQuota } = useQuotaBatchLoader();
  const { resettingQuotaName, refreshQuota, resetQuota } = useQuotaActions(disableControls);

  const pendingRefreshRef = useRef<number | null>(null);
  const prevLoadingRef = useRef(loading);

  // 刷新全部：先重取文件列表，待其落定（loading 下降沿）再批量拉当前页额度
  const handleRefreshAll = useCallback(() => {
    if (disableControls) return;
    pendingRefreshRef.current = sessionGeneration;
    setHistoryRefreshKey((key) => key + 1);
    void loadFiles();
  }, [disableControls, loadFiles, sessionGeneration]);

  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;

    const requestedSession = pendingRefreshRef.current;
    if (requestedSession === null) return;
    if (requestedSession !== sessionGeneration) {
      pendingRefreshRef.current = null;
      return;
    }
    if (loading || !wasLoading) return;

    pendingRefreshRef.current = null;
    if (
      canRefreshQuotaAfterList(
        requestedSession,
        sessionGeneration,
        filesGeneration,
        Boolean(error),
        disableControls
      )
    ) {
      void loadQuota(pageItems);
    }
  }, [disableControls, error, filesGeneration, loading, loadQuota, pageItems, sessionGeneration]);

  useDevinQuotaAutoLoad(
    pageItems,
    disableControls ||
      loading ||
      batchLoading ||
      Boolean(error) ||
      filesGeneration !== sessionGeneration,
    loadQuota
  );

  const canUseActions = !disableControls && !loading && filesGeneration === sessionGeneration;

  /* ---------- Routing hint ----------
   * Rows flag accounts the reset-aware routing currently prefers. */

  const routingStrategy = useConfigStore((state) => state.config?.routingStrategy ?? '');
  const fetchConfig = useConfigStore((state) => state.fetchConfig);
  useEffect(() => {
    if (connectionStatus === 'connected') void fetchConfig().catch(() => undefined);
  }, [connectionStatus, fetchConfig]);
  const priorityRouting = [WEEKLY_RESET_STRATEGY, 'weekly-reset-wrr'].includes(
    routingStrategy.trim().toLowerCase()
  );

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
        showEmails={forecastPrefs.showEmails}
        onToggleEmails={() => updateForecastPrefs({ showEmails: !forecastPrefs.showEmails })}
      />

      <section className={styles.workbench}>
        {/* 提供商导航与搜索工具栏分层，避免不同控件争夺视觉焦点。 */}
        <div className={styles.tabsRow} data-reveal>
          <ProviderTabs
            types={visibleTabIds}
            counts={tabCounts}
            active={tab}
            resolvedTheme={resolvedTheme}
            onChange={handleTabChange}
            variant="pills"
          />
        </div>

        <QuotaForecastSection
          entries={entries}
          tab={tab}
          prefs={forecastPrefs}
          onPrefsChange={updateForecastPrefs}
          refreshKey={historyRefreshKey}
          onHistory={setForecastHistory}
          onPools={setPoolSummaries}
          enabled={!disableControls && filesGeneration === sessionGeneration}
          priorityRouting={priorityRouting}
          resolvedTheme={resolvedTheme}
        />

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
          <div className={styles.viewControls}>
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
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <div className={styles.rowSkeletons} aria-hidden="true">
            {Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => (
              <Skeleton key={index} height={74} rounded={12} />
            ))}
          </div>
        ) : isEmpty ? (
          <EmptyState
            title={
              search.trim()
                ? t('quota_management.search_empty_title')
                : tab === 'all'
                  ? t('quota_management.empty_title')
                  : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_title`)
            }
            description={
              search.trim()
                ? t('quota_management.search_empty_desc')
                : tab === 'all'
                  ? t('quota_management.empty_desc')
                  : t(`${QUOTA_ADAPTERS[tab].i18nPrefix}.empty_desc`)
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
          <AccountsTable
            entries={pageItems}
            quotaFor={getQuota}
            nameFor={accountNameFor}
            history={forecastHistory}
            pools={poolSummaries}
            priorityRouting={priorityRouting}
            resolvedTheme={resolvedTheme}
            canUseActions={canUseActions}
            resettingName={resettingQuotaName}
            creditOverageCountFor={creditOverageCountFor}
            onRefresh={(entry) => void refreshQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
            onReset={(entry) => resetQuota(entry.file, QUOTA_ADAPTERS[entry.type])}
          />
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
      </section>
    </div>
  );
}
