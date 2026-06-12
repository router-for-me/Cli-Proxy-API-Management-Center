import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import {
  IconDownload,
  IconExternalLink,
  IconGithub,
  IconPlug,
  IconRefreshCw,
  IconSearch,
  IconSettings,
} from '@/components/ui/icons';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { pluginStoreApi } from '@/services/api';
import { useAuthStore, useConfigStore, useNotificationStore } from '@/stores';
import type { PluginStoreEntry, PluginStoreResponse } from '@/types';
import { buildRepositoryURL, resolvePluginAssetURL } from './pluginResources';
import styles from './PluginStorePage.module.scss';

type StoreStatusFilter = 'all' | 'installed' | 'notInstalled' | 'updates';

interface StoreLoadError {
  kind: 'unsupported' | 'registry' | 'generic';
  message: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const getErrorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : typeof error === 'string' ? error : fallback;

const getErrorStatus = (error: unknown): number | undefined =>
  isRecord(error) && typeof error.status === 'number' ? error.status : undefined;

const getErrorDetailMessage = (error: unknown): string => {
  if (!isRecord(error) || !isRecord(error.details)) return '';
  const message = error.details.message;
  return typeof message === 'string' ? message.trim() : '';
};

const getStoreEntryTitle = (entry: PluginStoreEntry) => entry.name || entry.id;

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
  const [installingID, setInstallingID] = useState('');
  const [restartRequiredIDs, setRestartRequiredIDs] = useState<string[]>([]);

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

  const restartNames = restartRequiredIDs.map((id) => {
    const entry = data?.plugins.find((plugin) => plugin.id === id);
    return entry ? getStoreEntryTitle(entry) : id;
  });

  const hasActiveFilters = Boolean(filter.trim()) || statusFilter !== 'all';

  const handleInstall = (entry: PluginStoreEntry) => {
    const isUpdate = entry.installed && entry.updateAvailable;
    const title = getStoreEntryTitle(entry);
    const target = entry.version ? `${title} v${entry.version}` : title;
    const failedKey = isUpdate ? 'plugin_store.update_failed' : 'plugin_store.install_failed';

    showConfirmation({
      title: isUpdate
        ? t('plugin_store.update_confirm_title')
        : t('plugin_store.install_confirm_title'),
      message: isUpdate
        ? t('plugin_store.update_confirm_message', { target })
        : t('plugin_store.install_confirm_message', { target }),
      confirmText: isUpdate ? t('plugin_store.update') : t('plugin_store.install'),
      variant: 'primary',
      onConfirm: async () => {
        setInstallingID(entry.id);
        try {
          const result = await pluginStoreApi.install(entry.id);
          showNotification(
            isUpdate ? t('plugin_store.update_success') : t('plugin_store.install_success'),
            'success'
          );
          if (result.restartRequired) {
            setRestartRequiredIDs((current) =>
              current.includes(entry.id) ? current : [...current, entry.id]
            );
            showNotification(t('plugin_store.restart_required_notice'), 'warning');
          }
          clearConfigCache();
          await loadStore();
        } catch (err: unknown) {
          showNotification(`${t(failedKey)}: ${getErrorMessage(err, t(failedKey))}`, 'error');
          throw err;
        } finally {
          setInstallingID('');
        }
      },
    });
  };

  const renderCard = (entry: PluginStoreEntry) => {
    const logo = resolvePluginAssetURL(entry.logo, apiBase);
    const repositoryURL = buildRepositoryURL(entry.repository);
    const homepageURL = /^https?:\/\//i.test(entry.homepage) ? entry.homepage : '';
    const isUpdate = entry.installed && entry.updateAvailable;
    const versionText =
      isUpdate && entry.installedVersion && entry.version
        ? t('plugin_store.version_arrow', { from: entry.installedVersion, to: entry.version })
        : entry.installed && entry.installedVersion
          ? `v${entry.installedVersion}`
          : entry.version
            ? `v${entry.version}`
            : '';
    const metaItems = [versionText, entry.author, entry.license].filter(Boolean);

    return (
      <article key={entry.id} className={styles.card}>
        <div className={styles.cardHeader}>
          <div className={styles.logoBox} aria-hidden="true">
            <StoreCardLogo src={logo} />
          </div>
          <div className={styles.cardTitleBlock}>
            <h2 className={styles.cardTitle}>{getStoreEntryTitle(entry)}</h2>
            <span className={styles.cardId}>{entry.id}</span>
          </div>
          <div className={styles.cardBadges}>
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

        {entry.description ? <p className={styles.cardDesc}>{entry.description}</p> : null}

        {metaItems.length > 0 ? (
          <div className={styles.cardMeta}>
            {metaItems.map((item, index) => (
              <span key={`${entry.id}-meta-${index}`} className={styles.metaItem}>
                {index > 0 ? <span className={styles.metaDot} aria-hidden="true" /> : null}
                {index === 0 && versionText ? <strong>{item}</strong> : item}
              </span>
            ))}
          </div>
        ) : null}

        {entry.tags.length > 0 ? (
          <div className={styles.tagRow}>
            {entry.tags.map((tag) => (
              <span key={`${entry.id}-tag-${tag}`} className={styles.tag}>
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
                disabled={!connected || Boolean(installingID)}
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
                    disabled={!connected || Boolean(installingID)}
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
    </div>
  );
}
