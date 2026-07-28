/**
 * Quota management page.
 *
 * The page owns one continuous grid of credential cards. It deliberately does
 * NOT wrap providers in sections: a section emits a full-width header row and a
 * full-width pagination row, and those spanning rows *are* the banding that the
 * flat layout exists to remove. Filtering moved to chips, and the per-section
 * refresh/view controls collapsed into a single board control row.
 *
 * Cards are still drawn by each provider's own `renderQuotaItems` over raw
 * provider state — nothing about the five data shapes is normalized. See
 * useQuotaBoard for the per-file dispatch.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconRefreshCw } from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useThemeStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  QuotaCard,
  QuotaDensityPicker,
  QuotaFilterChips,
  QuotaSummaryTiles,
  QUOTA_PROVIDER_ORDER,
  readNicknames,
  readStoredDensity,
  resolveDisplayName,
  storeDensity,
  summarizeProvider,
  useQuotaBoard,
  worstRemainingFor,
  writeNickname,
} from '@/components/quota';
import type { QuotaBoardEntry, QuotaDensity, QuotaProviderKey } from '@/components/quota';
import type { AuthFileItem, ResolvedTheme } from '@/types';
import styles from './QuotaPage.module.scss';

export function QuotaPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme: ResolvedTheme = useThemeStore((state) => state.resolvedTheme);

  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeProvider, setActiveProvider] = useState<QuotaProviderKey | 'all'>('all');
  const [density, setDensity] = useState<QuotaDensity>(() => readStoredDensity());
  const [nicknames, setNicknames] = useState(() => readNicknames());

  const handleRename = useCallback((name: string, nickname: string) => {
    setNicknames((prev) => writeNickname(prev, name, nickname));
  }, []);

  const disableControls = connectionStatus !== 'connected';

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await authFilesApi.list();
      setFiles(data?.files || []);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(loadFiles);

  useEffect(() => {
    loadFiles();
  }, [loadFiles]);

  const board = useQuotaBoard({ files, filesLoading: loading, disabled: disableControls });
  const { entries, filesByProvider, refreshing, refreshAll, refreshFile, resetFile, resettingName } =
    board;

  /* Auto-load quota once the credential list arrives. Without this the board
   * renders a wall of "not loaded" cards and empty tiles, which reads as broken.
   * Fetching is bounded by the shared gate in utils/quota/concurrency, so this
   * is 4 requests in flight regardless of how many credentials exist. */
  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (autoLoadedRef.current) return;
    if (loading || disableControls) return;
    if (entries.length === 0) return;
    autoLoadedRef.current = true;
    refreshAll();
  }, [loading, disableControls, entries.length, refreshAll]);

  const handleDensityChange = useCallback((value: QuotaDensity) => {
    setDensity(value);
    storeDensity(value);
  }, []);

  const labelFor = useCallback(
    (provider: QuotaProviderKey) => {
      const key = `auth_files.filter_${provider}`;
      const translated = t(key);
      if (translated !== key) return translated;
      return provider.charAt(0).toUpperCase() + provider.slice(1);
    },
    [t]
  );

  const summaries = useMemo(
    () =>
      QUOTA_PROVIDER_ORDER.map((provider) =>
        summarizeProvider(
          provider,
          filesByProvider[provider].map((file) => ({
            name: file.name,
            // Same resolution QuotaCard uses for its title — including the local
            // nickname — so a tile row and its card agree on what to call it.
            label: resolveDisplayName(file.name, file.label, file.email, nicknames),
          })),
          entriesSliceFor(entries, provider)
        )
      ),
    [filesByProvider, entries, nicknames]
  );

  const chipProviders = useMemo(
    () =>
      QUOTA_PROVIDER_ORDER.filter((provider) => filesByProvider[provider].length > 0).map(
        (provider) => ({ key: provider, count: filesByProvider[provider].length })
      ),
    [filesByProvider]
  );

  const visibleEntries = useMemo(
    () =>
      activeProvider === 'all'
        ? entries
        : entries.filter((entry) => entry.provider === activeProvider),
    [entries, activeProvider]
  );

  return (
    <div
      className={`${styles.container} ${styles.densityScope}`}
      style={{ '--quota-columns': density } as CSSProperties}
    >
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('quota_management.title')}</h1>
        <p className={styles.description}>{t('quota_management.description')}</p>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      <QuotaSummaryTiles
        summaries={summaries}
        activeProvider={activeProvider}
        onSelect={setActiveProvider}
        resolvedTheme={resolvedTheme}
        labelFor={labelFor}
      />

      <div className={styles.boardControls}>
        <QuotaFilterChips
          providers={chipProviders}
          total={entries.length}
          active={activeProvider}
          onSelect={setActiveProvider}
          resolvedTheme={resolvedTheme}
          labelFor={labelFor}
        />
        <span className={styles.stripSpacer} />
        <Button
          variant="secondary"
          size="sm"
          className={styles.refreshAllButton}
          onClick={refreshAll}
          disabled={disableControls || refreshing || entries.length === 0}
          loading={refreshing}
          title={t('quota_management.refresh_all_credentials')}
        >
          {!refreshing && <IconRefreshCw size={16} />}
          {t('quota_management.refresh_all_credentials')}
        </Button>
        <QuotaDensityPicker value={density} onChange={handleDensityChange} />
      </div>

      {visibleEntries.length === 0 ? (
        <EmptyState
          title={t('quota_management.empty_title', { defaultValue: t('common.no_data') })}
          description={t('quota_management.description')}
        />
      ) : (
        <div className={styles.boardGrid}>
          {visibleEntries.map((entry) => (
            <BoardCard
              key={entry.file.name}
              entry={entry}
              resolvedTheme={resolvedTheme}
              disabled={disableControls}
              resetting={resettingName === entry.file.name}
              nickname={nicknames[entry.file.name]}
              onRefresh={refreshFile}
              onReset={resetFile}
              onRename={handleRename}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One card.
 *
 * `QuotaCard` is memoized, so a refresh of one credential should not re-render
 * the other seven. That only holds if the props are referentially stable, which
 * is why the board's callbacks are addressed by credential name and bound here
 * with `useCallback` — an inline `() => onRefresh(entry)` would allocate a new
 * function every render and defeat the memo entirely.
 */
interface BoardCardProps {
  entry: QuotaBoardEntry;
  resolvedTheme: ResolvedTheme;
  disabled: boolean;
  resetting: boolean;
  nickname?: string;
  onRefresh: (name: string) => void;
  onReset: (name: string) => void;
  onRename: (name: string, nickname: string) => void;
}

function BoardCard({
  entry,
  resolvedTheme,
  disabled,
  resetting,
  nickname,
  onRefresh,
  onReset,
  onRename,
}: BoardCardProps) {
  const { t } = useTranslation();
  const { file, config, quota, provider } = entry;
  const name = file.name;

  const handleRefresh = useCallback(() => onRefresh(name), [onRefresh, name]);
  const handleReset = useCallback(() => onReset(name), [onReset, name]);
  const handleRename = useCallback(
    (value: string) => onRename(name, value),
    [onRename, name]
  );

  // Strip badge / dot / footer note. Each provider declares how to read its own
  // state; a provider with no plan (Kimi, xAI) simply renders no badge rather
  // than a fabricated one.
  const plan = quota?.status === 'success' ? (config.resolvePlan?.(quota, t) ?? null) : null;
  const planTier =
    quota?.status === 'success' ? (config.resolvePlanTier?.(quota) ?? 'standard') : 'standard';
  const footerNote =
    quota?.status === 'success' ? (config.resolveFooterNote?.(quota, t) ?? null) : null;
  const worst = worstRemainingFor(provider, quota);

  const canUseQuotaAction = !disabled && !file.disabled && quota?.status !== 'loading';
  const showReset = quota !== undefined && Boolean(config.canResetQuota?.(quota));

  const resetAction =
    config.resetQuota && showReset ? (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className={styles.quotaResetCreditButton}
        onClick={handleReset}
        disabled={!canUseQuotaAction || resetting}
        loading={resetting}
        title={t('codex_quota.reset_button')}
        aria-label={t('codex_quota.reset_button')}
      >
        {!resetting && <IconRefreshCw size={14} />}
        {t('codex_quota.reset_button')}
      </Button>
    ) : undefined;

  return (
    <QuotaCard
      item={file}
      quota={quota}
      resolvedTheme={resolvedTheme}
      i18nPrefix={config.i18nPrefix}
      cardClassName={config.cardClassName}
      defaultType={config.type}
      canRefresh={canUseQuotaAction && !resetting}
      onRefresh={handleRefresh}
      resetQuotaAction={resetAction}
      renderQuotaItems={config.renderQuotaItems}
      displayName={nickname}
      onRename={handleRename}
      plan={plan}
      planTier={planTier}
      worstRemaining={worst}
      footerNote={footerNote}
    />
  );
}

/** Rebuild a provider's `{ name -> state }` slice from the flat entry list. */
function entriesSliceFor(entries: QuotaBoardEntry[], provider: QuotaProviderKey) {
  const slice: Record<string, { status?: string }> = {};
  for (const entry of entries) {
    if (entry.provider !== provider) continue;
    if (entry.quota) slice[entry.file.name] = entry.quota;
  }
  return slice;
}
