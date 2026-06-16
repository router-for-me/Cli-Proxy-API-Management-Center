import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import {
  IconAlertTriangle,
  IconDownload,
  IconExternalLink,
  IconGithub,
  IconPlug,
  IconRefreshCw,
  IconSearch,
  IconSettings,
  IconShield,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { pluginStoreApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import { getErrorMessage, isRecord } from '@/utils/helpers';
import type { PluginStoreEntry, PluginStoreResponse } from '@/types';
import {
  buildRepositoryURL,
  isDefaultPluginStoreSource,
  isOfficialPlugin,
  notifyPluginResourcesChanged,
  resolvePluginAssetURL,
} from './pluginResources';
import { PluginInstallGateModal } from './components/PluginInstallGateModal';
import { waitForPluginStoreState } from './pluginPolling';
import styles from './PluginStorePage.module.scss';

type StoreStatusFilter = 'all' | 'installed' | 'notInstalled' | 'updates';

interface StoreLoadError {
  kind: 'unsupported' | 'registry' | 'generic';
  message: string;
}

const getErrorStatus = (error: unknown): number | undefined =>
  isRecord(error) && typeof error.status === 'number' ? error.status : undefined;

const getErrorDetailMessage = (error: unknown): string => {
  if (!isRecord(error) || !isRecord(error.details)) return '';
  const message = error.details.message;
  return typeof message === 'string' ? message.trim() : '';
};

const DESCRIPTION_COLLAPSED_LINES = 2;

const getStoreEntryTitle = (entry: PluginStoreEntry) => entry.name || entry.id;
const getStoreEntryKey = (entry: PluginStoreEntry) => entry.storeId || entry.id;
const getDescriptionDOMID = (entryKey: string) =>
  `plugin-store-desc-${encodeURIComponent(entryKey)}`;

function StoreCardLogo({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = Boolean(src) && !failed;

  return showImage ? (
    <img src={src} alt="" onError={() => setFailed(true)} />
  ) : (
    <IconPlug size={18} />
  );
}

export function PluginStorePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const clearConfigCache = useConfigStore((state) => state.clearCache);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);

  const [data, setData] = useState<PluginStoreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<StoreLoadError | null>(null);
  const [filter, setFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<StoreStatusFilter>('all');
  const [installingKey, setInstallingKey] = useState('');
  const [restartRequiredKeys, setRestartRequiredKeys] = useState<string[]>([]);
  const [expandedDescriptionKeys, setExpandedDescriptionKeys] = useState<string[]>([]);
  const [overflowingDescriptionKeys, setOverflowingDescriptionKeys] = useState<string[]>([]);
  const descriptionRefs = useRef<Record<string, HTMLParagraphElement | null>>({});

  // Multi-step install gauntlet, shown only for non-official (third-party) plugins.
  const [gateOpen, setGateOpen] = useState(false);
  const [gateEntry, setGateEntry] = useState<PluginStoreEntry | null>(null);
  const [gateIsUpdate, setGateIsUpdate] = useState(false);

  const connected = connectionStatus === 'connected';

  const loadStore = useCallback(async () => {
    if (!connected) {
      setLoading(false);
      setError({ kind: 'generic', message: t('notification.connection_required') });
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const store = await pluginStoreApi.list();
      setData(store);
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      if (status === 404) {
        setError({ kind: 'unsupported', message: t('plugin_store.unsupported_backend') });
      } else if (status === 502) {
        const detail = getErrorDetailMessage(err);
        setError({
          kind: 'registry',
          message: detail
            ? `${t('plugin_store.registry_failed')}: ${detail}`
            : t('plugin_store.registry_failed'),
        });
      } else {
        setError({
          kind: 'generic',
          message: getErrorMessage(err, t('plugin_store.load_failed')),
        });
      }
    } finally {
      setLoading(false);
    }
  }, [connected, t]);

  useHeaderRefresh(loadStore, connected);

  useEffect(() => {
    void loadStore();
  }, [loadStore]);

  const stats = useMemo(() => {
    const plugins = data?.plugins ?? [];
    const installed = plugins.filter((plugin) => plugin.installed).length;
    return {
      total: plugins.length,
      installed,
      notInstalled: plugins.length - installed,
      updates: plugins.filter((plugin) => plugin.installed && plugin.updateAvailable).length,
    };
  }, [data?.plugins]);

  const visiblePlugins = useMemo(() => {
    const plugins = data?.plugins ?? [];
    const byStatus = plugins.filter((plugin) => {
      if (statusFilter === 'installed') return plugin.installed;
      if (statusFilter === 'notInstalled') return !plugin.installed;
      if (statusFilter === 'updates') return plugin.installed && plugin.updateAvailable;
      return true;
    });

    const query = filter.trim().toLowerCase();
    if (!query) return byStatus;

    return byStatus.filter((plugin) => {
      const haystack = [
        plugin.id,
        plugin.name,
        plugin.description,
        plugin.author,
        plugin.repository,
        plugin.sourceName,
        plugin.sourceUrl,
        plugin.license,
        ...plugin.tags,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [data?.plugins, filter, statusFilter]);

  const statusFilters: Array<{ key: StoreStatusFilter; label: string; count: number }> = [
    { key: 'all', label: t('plugin_store.filter_all'), count: stats.total },
    { key: 'installed', label: t('plugin_store.filter_installed'), count: stats.installed },
    {
      key: 'notInstalled',
      label: t('plugin_store.filter_not_installed'),
      count: stats.notInstalled,
    },
    { key: 'updates', label: t('plugin_store.filter_updates'), count: stats.updates },
  ];

  const restartNames = restartRequiredKeys.map((key) => {
    const entry = data?.plugins.find((plugin) => getStoreEntryKey(plugin) === key);
    return entry ? getStoreEntryTitle(entry) : key;
  });

  const hasActiveFilters = Boolean(filter.trim()) || statusFilter !== 'all';

  const expandedDescriptionKeySet = useMemo(
    () => new Set(expandedDescriptionKeys),
    [expandedDescriptionKeys]
  );
  const overflowingDescriptionKeySet = useMemo(
    () => new Set(overflowingDescriptionKeys),
    [overflowingDescriptionKeys]
  );

  const registerDescriptionRef = useCallback((id: string, node: HTMLParagraphElement | null) => {
    if (node) {
      descriptionRefs.current[id] = node;
    } else {
      delete descriptionRefs.current[id];
    }
  }, []);

  const measureDescriptionOverflow = useCallback(() => {
    const nextIDs = Object.entries(descriptionRefs.current)
      .filter(([, node]) => {
        if (!node) return false;
        const computed = window.getComputedStyle(node);
        const lineHeight = Number.parseFloat(computed.lineHeight);
        if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
          return node.scrollHeight > node.clientHeight + 1;
        }
        return node.scrollHeight > lineHeight * DESCRIPTION_COLLAPSED_LINES + 1;
      })
      .map(([id]) => id);

    setOverflowingDescriptionKeys((current) => {
      if (current.length === nextIDs.length && current.every((id) => nextIDs.includes(id))) {
        return current;
      }
      return nextIDs;
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureDescriptionOverflow);
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [measureDescriptionOverflow, visiblePlugins]);

  useEffect(() => {
    const handleResize = () => {
      window.requestAnimationFrame(measureDescriptionOverflow);
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
    };
  }, [measureDescriptionOverflow]);

  const toggleDescription = useCallback((id: string) => {
    setExpandedDescriptionKeys((current) =>
      current.includes(id) ? current.filter((currentID) => currentID !== id) : [...current, id]
    );
  }, []);

  const runInstall = useCallback(
    async (entry: PluginStoreEntry, isUpdate: boolean) => {
      const entryKey = getStoreEntryKey(entry);
      const failedKey = isUpdate ? 'plugin_store.update_failed' : 'plugin_store.install_failed';
      setInstallingKey(entryKey);
      try {
        const result = await pluginStoreApi.install(entry.id, entry.sourceId || undefined);
        clearConfigCache();
        const sourceId = result.sourceId || entry.sourceId;
        const installedState = await waitForPluginStoreState(
          entry.id,
          sourceId,
          (plugin) => plugin.installed && plugin.configured
        );
        setData(installedState.response);
        if (
          installedState.timedOut ||
          !installedState.plugin?.installed ||
          !installedState.plugin.configured
        ) {
          showNotification(t('plugin_store.status_pending'), 'warning');
          return;
        }

        if (result.restartRequired) {
          setRestartRequiredKeys((current) =>
            current.includes(entryKey) ? current : [...current, entryKey]
          );
          showNotification(
            isUpdate ? t('plugin_store.update_success') : t('plugin_store.install_success'),
            'success'
          );
          showNotification(t('plugin_store.restart_required_notice'), 'warning');
          return;
        }

        if (!installedState.response.pluginsEnabled) {
          showNotification(
            isUpdate ? t('plugin_store.update_success') : t('plugin_store.install_success'),
            'success'
          );
          showNotification(t('plugin_store.global_disabled_hint'), 'warning');
          return;
        }

        if (installedState.plugin.enabled) {
          const registeredState = await waitForPluginStoreState(
            entry.id,
            sourceId,
            (plugin) => plugin.registered && plugin.effectiveEnabled
          );
          setData(registeredState.response);
          if (
            registeredState.timedOut ||
            !registeredState.plugin?.registered ||
            !registeredState.plugin.effectiveEnabled
          ) {
            showNotification(t('plugin_store.registration_pending'), 'warning');
            return;
          }
          notifyPluginResourcesChanged();
        }

        showNotification(
          isUpdate ? t('plugin_store.update_success') : t('plugin_store.install_success'),
          'success'
        );
      } catch (err: unknown) {
        showNotification(`${t(failedKey)}: ${getErrorMessage(err, t(failedKey))}`, 'error');
        throw err;
      } finally {
        setInstallingKey('');
      }
    },
    [clearConfigCache, showNotification, t]
  );

  const handleInstall = (entry: PluginStoreEntry) => {
    const isUpdate = entry.installed && entry.updateAvailable;

    // Third-party plugins must clear the multi-step confirmation gauntlet first.
    if (!isOfficialPlugin(entry)) {
      setGateEntry(entry);
      setGateIsUpdate(isUpdate);
      setGateOpen(true);
      return;
    }

    // Official router-for-me plugins keep the lightweight single-step confirm.
    const title = getStoreEntryTitle(entry);
    const target = entry.version ? `${title} v${entry.version}` : title;
    showConfirmation({
      title: isUpdate
        ? t('plugin_store.update_confirm_title')
        : t('plugin_store.install_confirm_title'),
      message: isUpdate
        ? t('plugin_store.update_confirm_message', { target })
        : t('plugin_store.install_confirm_message', { target }),
      confirmText: isUpdate ? t('plugin_store.update') : t('plugin_store.install'),
      variant: 'primary',
      onConfirm: () => runInstall(entry, isUpdate),
    });
  };

  const handleGateConfirm = useCallback(async () => {
    if (!gateEntry) return;
    await runInstall(gateEntry, gateIsUpdate);
    setGateOpen(false);
  }, [gateEntry, gateIsUpdate, runInstall]);

  const handleGateClose = useCallback(() => setGateOpen(false), []);

  const renderCard = (entry: PluginStoreEntry) => {
    const entryKey = getStoreEntryKey(entry);
    const logo = resolvePluginAssetURL(entry.logo, apiBase);
    const repositoryURL = buildRepositoryURL(entry.repository);
    const homepageURL = /^https?:\/\//i.test(entry.homepage) ? entry.homepage : '';
    const isUpdate = entry.installed && entry.updateAvailable;
    const isOfficial = isOfficialPlugin(entry);
    const versionText =
      isUpdate && entry.installedVersion && entry.version
        ? t('plugin_store.version_arrow', { from: entry.installedVersion, to: entry.version })
        : entry.installed && entry.installedVersion
          ? `v${entry.installedVersion}`
          : entry.version
            ? `v${entry.version}`
            : '';
    const sourceName = isDefaultPluginStoreSource(entry)
      ? t('plugin_store.cli_proxy_api_source')
      : entry.sourceName;
    const sourceText = sourceName ? t('plugin_store.source_name', { source: sourceName }) : '';
    const metaItems = [versionText, sourceText, entry.author, entry.license].filter(Boolean);
    const isInstalling = installingKey === entryKey;
    const hasPendingInstall = Boolean(installingKey);
    const isDescriptionExpanded = expandedDescriptionKeySet.has(entryKey);
    const isDescriptionOverflowing = overflowingDescriptionKeySet.has(entryKey);
    const descriptionID = getDescriptionDOMID(entryKey);

    return (
      <article key={entryKey} className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.logoBox} aria-hidden="true">
            <StoreCardLogo src={logo} />
          </div>
          <div className={styles.cardTitleBlock}>
            <h2 className={styles.cardTitle}>{getStoreEntryTitle(entry)}</h2>
            <span className={styles.cardId}>{entry.id}</span>
          </div>
          <div className={styles.cardBadges}>
            {!isOfficial ? (
              <span className={styles.badgeUntrusted}>
                <IconAlertTriangle size={11} />
                {t('plugin_store.badge_untrusted')}
              </span>
            ) : null}
            {isUpdate ? (
              <span className={styles.badgeWarning}>{t('plugin_store.badge_update')}</span>
            ) : entry.installed ? (
              <span className={styles.badgeSuccess}>{t('plugin_store.badge_installed')}</span>
            ) : null}
            {entry.installed && entry.effectiveEnabled ? (
              <span className={styles.badge}>{t('plugin_store.badge_effective')}</span>
            ) : null}
          </div>
        </div>

        {entry.description ? (
          <div className={styles.cardDescBlock}>
            <p
              id={descriptionID}
              ref={(node) => registerDescriptionRef(entryKey, node)}
              className={`${styles.cardDesc} ${
                isDescriptionExpanded ? styles.cardDescExpanded : ''
              }`}
            >
              {entry.description}
            </p>
            {isDescriptionOverflowing ? (
              <button
                type="button"
                className={styles.cardDescToggle}
                onClick={() => toggleDescription(entryKey)}
                aria-expanded={isDescriptionExpanded}
                aria-controls={descriptionID}
              >
                {t(
                  isDescriptionExpanded
                    ? 'plugin_store.description_show_less'
                    : 'plugin_store.description_show_more'
                )}
              </button>
            ) : null}
          </div>
        ) : null}

        {metaItems.length > 0 ? (
          <div className={styles.cardMeta}>
            {metaItems.map((item, index) => (
              <span key={`${entryKey}-meta-${index}`} className={styles.metaItem}>
                {index > 0 ? <span className={styles.metaDot} aria-hidden="true" /> : null}
                {index === 0 && versionText ? <strong>{item}</strong> : item}
              </span>
            ))}
          </div>
        ) : null}

        {entry.tags.length > 0 ? (
          <div className={styles.tagRow}>
            {entry.tags.map((tag) => (
              <span key={`${entryKey}-tag-${tag}`} className={styles.tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <div className={styles.cardFooter}>
          <div className={styles.cardActions}>
            {!entry.installed ? (
              <Button
                size="sm"
                onClick={() => handleInstall(entry)}
                disabled={!connected || (hasPendingInstall && !isInstalling)}
                loading={isInstalling}
              >
                <IconDownload size={14} />
                {t('plugin_store.install')}
              </Button>
            ) : (
              <>
                {entry.updateAvailable ? (
                  <Button
                    size="sm"
                    onClick={() => handleInstall(entry)}
                    disabled={!connected || (hasPendingInstall && !isInstalling)}
                    loading={isInstalling}
                  >
                    <IconRefreshCw size={14} />
                    {t('plugin_store.update')}
                  </Button>
                ) : null}
                <Button variant="secondary" size="sm" onClick={() => navigate('/plugins')}>
                  <IconSettings size={14} />
                  {t('plugin_store.manage')}
                </Button>
              </>
            )}
          </div>
          <div className={styles.cardLinks}>
            {repositoryURL ? (
              <a
                className={styles.iconLink}
                href={repositoryURL}
                target="_blank"
                rel="noreferrer"
                title={t('plugin_store.open_repository')}
                aria-label={t('plugin_store.open_repository')}
              >
                <IconGithub size={14} />
              </a>
            ) : null}
            {homepageURL ? (
              <a
                className={styles.iconLink}
                href={homepageURL}
                target="_blank"
                rel="noreferrer"
                title={t('plugin_store.open_homepage')}
                aria-label={t('plugin_store.open_homepage')}
              >
                <IconExternalLink size={14} />
              </a>
            ) : null}
          </div>
        </div>
      </article>
    );
  };

  return (
    <div className={styles.page}>
      {/* ── Page Header ── */}
      <div className={styles.pageHeader}>
        <h1 className={styles.title}>{t('plugin_store.title')}</h1>
        <p className={styles.description}>{t('plugin_store.description')}</p>
      </div>

      {/* ── Security Banner ── */}
      <div className={styles.securityBanner} role="note">
        <IconShield size={20} />
        <div className={styles.securityBannerText}>
          <strong>{t('plugin_store.security_banner_title')}</strong>
          <p>{t('plugin_store.security_banner_text')}</p>
        </div>
      </div>

      {/* ── Alerts ── */}
      {error ? (
        <div className={styles.errorBox}>
          <span>{error.message}</span>
          {error.kind !== 'unsupported' ? (
            <Button variant="secondary" size="sm" onClick={loadStore} disabled={loading}>
              {t('plugin_store.retry')}
            </Button>
          ) : null}
        </div>
      ) : null}

      {data && !data.pluginsEnabled ? (
        <div className={styles.warningBox}>{t('plugin_store.global_disabled_hint')}</div>
      ) : null}

      {restartNames.length > 0 ? (
        <div className={styles.warningBox}>
          {t('plugin_store.restart_required_banner', { plugins: restartNames.join(', ') })}
        </div>
      ) : null}

      {/* ── Status Bar ── */}
      {data ? (
        <div className={styles.statusBar}>
          <div className={styles.statusPill}>
            <span
              className={`${styles.statusDot} ${
                data.pluginsEnabled ? styles.statusDotOn : styles.statusDotOff
              }`}
            />
            <span className={styles.statusLabel}>{t('plugin_store.global_status')}</span>
            <span className={styles.statusValue}>
              {data.pluginsEnabled
                ? t('plugin_store.global_enabled')
                : t('plugin_store.global_disabled')}
            </span>
          </div>

          <span className={styles.statusDivider} />

          <div className={styles.statusPill}>
            <span className={styles.statusLabel}>{t('plugin_store.plugins_dir')}</span>
            <span
              className={`${styles.statusValue} ${styles.statusPathValue}`}
              title={data.pluginsDir || 'plugins'}
            >
              {data.pluginsDir || 'plugins'}
            </span>
          </div>

          <span className={styles.statusDivider} />

          <div className={styles.statusPill}>
            <span className={styles.statusLabel}>{t('plugin_store.stat_available')}</span>
            <span className={styles.statusValue}>{stats.total}</span>
          </div>
        </div>
      ) : null}

      {/* ── Toolbar ── */}
      <div className={styles.toolbar}>
        <Input
          type="search"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder={t('plugin_store.search_placeholder')}
          aria-label={t('plugin_store.search_label')}
          rightElement={<IconSearch size={16} />}
        />
        <Button
          variant="secondary"
          size="sm"
          onClick={loadStore}
          disabled={!connected || loading}
          loading={loading}
        >
          <IconRefreshCw size={16} />
          {t('plugin_store.refresh')}
        </Button>
      </div>

      {/* ── Status Filter Chips ── */}
      <div className={styles.filterChips} role="group" aria-label={t('plugin_store.filter_label')}>
        {statusFilters.map((item) => (
          <button
            key={item.key}
            type="button"
            className={`${styles.filterChip} ${
              statusFilter === item.key ? styles.filterChipActive : ''
            }`}
            onClick={() => setStatusFilter(item.key)}
            aria-pressed={statusFilter === item.key}
          >
            {item.label}
            <span className={styles.filterChipCount}>{item.count}</span>
          </button>
        ))}
      </div>

      {/* ── Plugin Cards ── */}
      {loading ? (
        <div className={styles.cardGrid}>
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className={styles.skeletonCard}>
              <div className={styles.skeletonHeader}>
                <div className={styles.skeletonAvatar} />
                <div className={styles.skeletonText}>
                  <div className={styles.skeletonLine} />
                  <div className={styles.skeletonLine} />
                </div>
              </div>
              <div className={styles.skeletonBody} />
            </div>
          ))}
        </div>
      ) : visiblePlugins.length === 0 ? (
        !error ? (
          stats.total === 0 ? (
            <EmptyState
              title={t('plugin_store.no_plugins')}
              description={t('plugin_store.no_plugins_desc')}
              action={
                <Button variant="secondary" size="sm" onClick={loadStore} disabled={!connected}>
                  <IconRefreshCw size={16} />
                  {t('plugin_store.refresh')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              title={t('plugin_store.no_matches')}
              description={t('plugin_store.no_matches_desc')}
              action={
                hasActiveFilters ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setFilter('');
                      setStatusFilter('all');
                    }}
                  >
                    {t('plugin_store.clear_filters')}
                  </Button>
                ) : undefined
              }
            />
          )
        ) : null
      ) : (
        <div className={styles.cardGrid}>{visiblePlugins.map((entry) => renderCard(entry))}</div>
      )}

      <PluginInstallGateModal
        open={gateOpen}
        entry={gateEntry}
        isUpdate={gateIsUpdate}
        installing={gateEntry ? installingKey === getStoreEntryKey(gateEntry) : false}
        onClose={handleGateClose}
        onConfirm={handleGateConfirm}
      />
    </div>
  );
}
