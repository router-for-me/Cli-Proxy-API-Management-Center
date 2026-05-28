import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { parse as parseYaml, parseDocument } from 'yaml';
import { usePageTransitionLayer } from '@/components/common/PageTransitionLayer';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconRefreshCw,
  IconSearch,
} from '@/components/ui/icons';
import { VisualConfigEditor } from '@/components/config/VisualConfigEditor';
import { DiffModal } from '@/components/config/DiffModal';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useVisualConfig } from '@/hooks/useVisualConfig';
import {
  useNotificationStore,
  useAuthStore,
  useThemeStore,
  useConfigStore,
  useUsageServiceStore,
} from '@/stores';
import { configFileApi } from '@/services/api/configFile';
import {
  getUsageServiceErrorCode,
  isUsageServiceId,
  normalizeUsageServiceBase,
  usageServiceApi,
  type CPAUsageConfig,
  type ManagerConfig,
  type ManagerConfigResponse,
} from '@/services/api/usageService';
import { detectApiBaseFromLocation } from '@/utils/connection';
import styles from './ConfigPage.module.scss';

type ConfigEditorTab = 'visual' | 'source' | 'manager';

const MANAGER_COLLECTOR_DEFAULT = {
  enabled: true,
  collectorMode: 'auto',
  queue: 'usage',
  popSide: 'right',
  batchSize: 100,
  pollIntervalMs: 500,
  queryLimit: 50000,
  tlsSkipVerify: false,
};

// eslint-disable-next-line react-refresh/only-export-components
export function getUsageServiceBootstrapToSync({
  serviceBase,
  usageServiceEnabled,
  usageServiceBase,
}: {
  serviceBase: string;
  usageServiceEnabled: boolean;
  usageServiceBase: string;
}): string {
  const normalized = normalizeUsageServiceBase(serviceBase);
  if (!normalized) return '';
  if (usageServiceEnabled && usageServiceBase === normalized) return '';
  return normalized;
}

const LazyConfigSourceEditor = lazy(() => import('@/components/config/ConfigSourceEditor'));

function readCommercialModeFromYaml(yamlContent: string): boolean {
  try {
    const parsed = parseYaml(yamlContent);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
    return Boolean((parsed as Record<string, unknown>)['commercial-mode']);
  } catch {
    return false;
  }
}

function normalizeYamlForVisualDiff(yamlContent: string): string {
  try {
    const doc = parseDocument(yamlContent);
    return doc.toString({ indent: 2, lineWidth: 120, minContentWidth: 0 });
  } catch {
    return yamlContent;
  }
}

export function ConfigPage() {
  const { t } = useTranslation();
  const pageTransitionLayer = usePageTransitionLayer();
  const isCurrentLayer = pageTransitionLayer ? pageTransitionLayer.isCurrentLayer : true;
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const apiBase = useAuthStore((state) => state.apiBase);
  const managementKey = useAuthStore((state) => state.managementKey);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const usageServiceEnabled = useUsageServiceStore((state) => state.enabled);
  const usageServiceBase = useUsageServiceStore((state) => state.serviceBase);
  const setUsageServiceConfig = useUsageServiceStore((state) => state.setUsageServiceConfig);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const {
    visualValues,
    visualDirty,
    visualParseError,
    visualValidationErrors,
    visualHasPayloadValidationErrors,
    loadVisualValuesFromYaml,
    applyVisualChangesToYaml,
    setVisualValues,
  } = useVisualConfig();

  const [activeTab, setActiveTab] = useState<ConfigEditorTab>(() => {
    const saved = localStorage.getItem('config-management:tab');
    if (saved === 'visual' || saved === 'source' || saved === 'manager') return saved;
    return 'visual';
  });

  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [diffModalOpen, setDiffModalOpen] = useState(false);
  const [serverYaml, setServerYaml] = useState('');
  const [mergedYaml, setMergedYaml] = useState('');
  const [managerConfig, setManagerConfig] = useState<ManagerConfig | null>(null);
  const [managerConfigSource, setManagerConfigSource] = useState('');
  const [managerCPAUsage, setManagerCPAUsage] = useState<CPAUsageConfig | null>(null);
  const [managerLoading, setManagerLoading] = useState(false);
  const [managerSaving, setManagerSaving] = useState(false);
  const [managerError, setManagerError] = useState('');
  const [managerDirty, setManagerDirty] = useState(false);
  const [managerServiceBase, setManagerServiceBase] = useState('');
  const [managerRequestMonitoringEnabled, setManagerRequestMonitoringEnabled] = useState(true);
  const [panelHostedByUsageService, setPanelHostedByUsageService] = useState<boolean | null>(null);
  const [managerCollectorMode, setManagerCollectorMode] = useState(
    MANAGER_COLLECTOR_DEFAULT.collectorMode
  );
  const [managerPollIntervalMs, setManagerPollIntervalMs] = useState(
    String(MANAGER_COLLECTOR_DEFAULT.pollIntervalMs)
  );
  const [managerBatchSize, setManagerBatchSize] = useState(
    String(MANAGER_COLLECTOR_DEFAULT.batchSize)
  );
  const [managerQueryLimit, setManagerQueryLimit] = useState(
    String(MANAGER_COLLECTOR_DEFAULT.queryLimit)
  );

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ current: number; total: number }>({
    current: 0,
    total: 0,
  });
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);
  const floatingActionsRef = useRef<HTMLDivElement>(null);

  const disableControls = connectionStatus !== 'connected';
  const isManagerTab = activeTab === 'manager';
  const isDirty = isManagerTab ? managerDirty : dirty || visualDirty;
  const shouldRenderFloatingActions = isCurrentLayer;
  const hasVisualModeError = !!visualParseError;
  const hasVisualValidationErrors =
    activeTab === 'visual' &&
    (Object.values(visualValidationErrors).some(Boolean) || visualHasPayloadValidationErrors);
  const managerRetentionSeconds =
    managerCPAUsage?.redisUsageQueueRetentionSeconds ||
    Number(visualValues.redisUsageQueueRetentionSeconds) ||
    60;
  const detectedPanelBase = useMemo(() => detectApiBaseFromLocation(), []);
  const managerCollectorModeOptions = useMemo(
    () => [
      { value: 'auto', label: t('config_management.manager.collector_mode_auto') },
      { value: 'http', label: t('config_management.manager.collector_mode_http') },
      { value: 'resp', label: t('config_management.manager.collector_mode_resp') },
      { value: 'subscribe', label: t('config_management.manager.collector_mode_subscribe') },
    ],
    [t]
  );
  const getUsageServiceDisplayError = useCallback(
    (error: unknown, fallbackKey: string) => {
      const code = getUsageServiceErrorCode(error);
      if (code) {
        return t(`usage_service_errors.${code}`, {
          defaultValue: t('usage_service_errors.request_failed'),
        });
      }
      if (error instanceof Error && error.name !== 'UsageServiceApiError' && error.message) {
        return error.message;
      }
      return t(fallbackKey);
    },
    [t]
  );
  const managerConfigSourceLabel = useMemo(() => {
    switch (managerConfigSource) {
      case 'env':
        return t('config_management.manager.config_source_env');
      case 'db':
        return t('config_management.manager.config_source_db');
      default:
        return t('config_management.manager.config_source_none');
    }
  }, [managerConfigSource, t]);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await configFileApi.fetchConfigYaml();
      setContent(data);
      setDirty(false);
      setDiffModalOpen(false);
      setServerYaml(data);
      setMergedYaml(data);
      loadVisualValuesFromYaml(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [loadVisualValuesFromYaml, t]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    let cancelled = false;
    const detectUsageServiceHost = async () => {
      try {
        const info = await usageServiceApi.getInfo(detectedPanelBase);
        if (!cancelled) {
          setPanelHostedByUsageService(isUsageServiceId(info.service));
        }
      } catch {
        if (!cancelled) {
          setPanelHostedByUsageService(false);
        }
      }
    };
    void detectUsageServiceHost();
    return () => {
      cancelled = true;
    };
  }, [detectedPanelBase]);

  const resolveManagerServiceBase = useCallback(() => {
    if (panelHostedByUsageService) {
      return normalizeUsageServiceBase(detectedPanelBase);
    }
    const preferred = managerServiceBase || (usageServiceEnabled && usageServiceBase ? usageServiceBase : '');
    return normalizeUsageServiceBase(preferred || '');
  }, [detectedPanelBase, managerServiceBase, panelHostedByUsageService, usageServiceBase, usageServiceEnabled]);

  const syncUsageServiceBootstrap = useCallback(
    (serviceBase: string) => {
      const normalized = getUsageServiceBootstrapToSync({
        serviceBase,
        usageServiceEnabled,
        usageServiceBase,
      });
      if (!normalized) return;
      setUsageServiceConfig({
        enabled: true,
        serviceBase: normalized,
      });
    },
    [setUsageServiceConfig, usageServiceBase, usageServiceEnabled]
  );

  const applyManagerConfigResponse = useCallback(
    (response: ManagerConfigResponse, fallbackBase: string) => {
      const nextConfig = response.config;
      const collector = nextConfig.collector ?? MANAGER_COLLECTOR_DEFAULT;
      const serviceBase =
        nextConfig.externalUsageService?.serviceBase || fallbackBase || managerServiceBase;

      setManagerConfig(nextConfig);
      setManagerConfigSource(response.source || '');
      setManagerCPAUsage(response.cpaUsage ?? null);
      setManagerServiceBase(serviceBase);
      setManagerRequestMonitoringEnabled(collector.enabled !== false);
      setManagerCollectorMode(collector.collectorMode || MANAGER_COLLECTOR_DEFAULT.collectorMode);
      setManagerPollIntervalMs(String(collector.pollIntervalMs || MANAGER_COLLECTOR_DEFAULT.pollIntervalMs));
      setManagerBatchSize(String(collector.batchSize || MANAGER_COLLECTOR_DEFAULT.batchSize));
      setManagerQueryLimit(String(collector.queryLimit || MANAGER_COLLECTOR_DEFAULT.queryLimit));
      setManagerDirty(false);
    },
    [managerServiceBase]
  );

  const loadManagerConfig = useCallback(async () => {
    const serviceBase = resolveManagerServiceBase();
    if (!managementKey) return;
    if (!serviceBase) {
      setManagerError('');
      setManagerConfig(null);
      setManagerCPAUsage(null);
      setManagerConfigSource('');
      return;
    }
    setManagerLoading(true);
    setManagerError('');
    try {
      const response = await usageServiceApi.getManagerConfig(serviceBase, managementKey);
      applyManagerConfigResponse(response, serviceBase);
      syncUsageServiceBootstrap(serviceBase);
    } catch (error: unknown) {
      setManagerError(getUsageServiceDisplayError(error, 'config_management.manager.load_failed'));
    } finally {
      setManagerLoading(false);
    }
  }, [
    applyManagerConfigResponse,
    getUsageServiceDisplayError,
    managementKey,
    resolveManagerServiceBase,
    syncUsageServiceBootstrap,
  ]);

  const setManagerFieldDirty = useCallback(() => {
    setManagerDirty(true);
  }, []);

  const readManagerPositiveInteger = useCallback(
    (value: string, label: string) => {
      const trimmed = value.trim();
      if (!/^\d+$/.test(trimmed)) {
        throw new Error(
          t('config_management.manager.number_invalid', {
            label,
          })
        );
      }
      const parsed = Number(trimmed);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(
          t('config_management.manager.number_invalid', {
            label,
          })
        );
      }
      return Math.floor(parsed);
    },
    [t]
  );

  useEffect(() => {
    if (activeTab !== 'visual' || !visualParseError) return;

    setActiveTab('source');
    localStorage.setItem('config-management:tab', 'source');
    showNotification(
      t('config_management.visual_mode_unavailable_detail', { message: visualParseError }),
      'error'
    );
  }, [activeTab, showNotification, t, visualParseError]);

  useEffect(() => {
    if (activeTab !== 'manager') return;
    void loadManagerConfig();
  }, [activeTab, loadManagerConfig]);

  const handleConfirmSave = async () => {
    setSaving(true);
    try {
      const previousCommercialMode = readCommercialModeFromYaml(serverYaml);
      const nextCommercialMode = readCommercialModeFromYaml(mergedYaml);
      const commercialModeChanged = previousCommercialMode !== nextCommercialMode;

      await configFileApi.saveConfigYaml(mergedYaml);
      const latestContent = await configFileApi.fetchConfigYaml();
      setDirty(false);
      setDiffModalOpen(false);
      setContent(latestContent);
      setServerYaml(latestContent);
      setMergedYaml(latestContent);
      loadVisualValuesFromYaml(latestContent);

      // Keep the global config store in sync so sidebar / other pages reflect YAML changes immediately.
      try {
        useConfigStore.getState().clearCache();
        await useConfigStore.getState().fetchConfig(undefined, true);
      } catch (refreshError: unknown) {
        const message =
          refreshError instanceof Error
            ? refreshError.message
            : typeof refreshError === 'string'
              ? refreshError
              : '';
        showNotification(
          `${t('notification.refresh_failed')}${message ? `: ${message}` : ''}`,
          'error'
        );
      }

      showNotification(t('config_management.save_success'), 'success');
      if (commercialModeChanged) {
        showNotification(t('notification.commercial_mode_restart_required'), 'warning');
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleManagerSave = async () => {
    if (disableControls) return;
    const serviceBase = resolveManagerServiceBase();
    if (!serviceBase) {
      showNotification(t('config_management.manager.service_base_required'), 'warning');
      return;
    }
    const isEmbeddedUsageService = panelHostedByUsageService === true;
    setManagerSaving(true);
    try {
      const pollIntervalMs = managerRequestMonitoringEnabled
        ? readManagerPositiveInteger(
            managerPollIntervalMs,
            t('config_management.manager.poll_interval_ms')
          )
        : MANAGER_COLLECTOR_DEFAULT.pollIntervalMs;
      const batchSize = managerRequestMonitoringEnabled
        ? readManagerPositiveInteger(
            managerBatchSize,
            t('config_management.manager.batch_size')
          )
        : MANAGER_COLLECTOR_DEFAULT.batchSize;
      const queryLimit = managerRequestMonitoringEnabled
        ? readManagerPositiveInteger(
            managerQueryLimit,
            t('config_management.manager.query_limit')
          )
        : MANAGER_COLLECTOR_DEFAULT.queryLimit;
      if (managerRequestMonitoringEnabled && pollIntervalMs > managerRetentionSeconds * 1000) {
        showNotification(t('config_management.manager.poll_interval_retention_error'), 'error');
        return;
      }
      const nextConfig: ManagerConfig = {
        ...(managerConfig ?? {
          cpaConnection: { cpaBaseUrl: apiBase, managementKey },
          collector: MANAGER_COLLECTOR_DEFAULT,
          externalUsageService: { enabled: !isEmbeddedUsageService, serviceBase: !isEmbeddedUsageService ? serviceBase : '' },
        }),
        cpaConnection: {
          ...(managerConfig?.cpaConnection ?? {}),
          cpaBaseUrl: managerConfig?.cpaConnection?.cpaBaseUrl || apiBase,
          managementKey: managerConfig?.cpaConnection?.managementKey || managementKey,
        },
        collector: {
          ...(managerConfig?.collector ?? MANAGER_COLLECTOR_DEFAULT),
          enabled: managerRequestMonitoringEnabled,
          collectorMode: managerCollectorMode,
          pollIntervalMs,
          batchSize,
          queryLimit,
        },
        externalUsageService: {
          enabled: !isEmbeddedUsageService,
          serviceBase: !isEmbeddedUsageService ? serviceBase : '',
        },
      };
      const response = await usageServiceApi.saveManagerConfig(serviceBase, nextConfig, managementKey);
      applyManagerConfigResponse(response, serviceBase);
      setUsageServiceConfig({
        enabled: true,
        serviceBase,
      });
      showNotification(t('config_management.manager.save_success'), 'success');
    } catch (error: unknown) {
      const message = getUsageServiceDisplayError(error, 'usage_service_errors.request_failed');
      showNotification(
        `${t('notification.save_failed')}${message ? `: ${message}` : ''}`,
        'error'
      );
    } finally {
      setManagerSaving(false);
    }
  };

  const handleSave = async () => {
    if (activeTab === 'manager') {
      await handleManagerSave();
      return;
    }

    if (activeTab === 'visual' && visualParseError) {
      showNotification(t('config_management.visual_mode_save_blocked'), 'error');
      return;
    }

    setSaving(true);
    try {
      const latestServerYaml = await configFileApi.fetchConfigYaml();
      const visualBaseYaml = dirty ? content : latestServerYaml;

      if (activeTab !== 'source') {
        const latestDocument = parseDocument(latestServerYaml);
        if (latestDocument.errors.length > 0) {
          showNotification(
            t('config_management.visual_mode_latest_yaml_invalid', {
              message:
                latestDocument.errors[0]?.message ??
                t('config_management.visual_mode_save_blocked'),
            }),
            'error'
          );
          return;
        }

        if (visualBaseYaml !== latestServerYaml) {
          const visualBaseDocument = parseDocument(visualBaseYaml);
          if (visualBaseDocument.errors.length > 0) {
            showNotification(
              t('config_management.visual_mode_latest_yaml_invalid', {
                message:
                  visualBaseDocument.errors[0]?.message ??
                  t('config_management.visual_mode_save_blocked'),
              }),
              'error'
            );
            return;
          }
        }
      }

      // In source mode, save exactly what the user edited. In visual mode, preserve
      // unsaved source edits as the visual patch base so backend-only fields survive.
      const nextMergedYaml =
        activeTab === 'source' ? content : applyVisualChangesToYaml(visualBaseYaml);

      // In visual mode, applyVisualChangesToYaml re-serializes YAML via parseDocument → toString,
      // which may reformat comments/whitespace. Normalize the server YAML through the same pipeline
      // so the diff only shows actual value changes, not cosmetic reformatting.
      let diffOriginal = latestServerYaml;
      if (activeTab !== 'source') {
        diffOriginal = normalizeYamlForVisualDiff(latestServerYaml);
      }

      if (diffOriginal === nextMergedYaml) {
        setDirty(false);
        setContent(latestServerYaml);
        setServerYaml(latestServerYaml);
        setMergedYaml(nextMergedYaml);
        loadVisualValuesFromYaml(latestServerYaml);
        showNotification(t('config_management.diff.no_changes'), 'info');
        return;
      }

      setServerYaml(diffOriginal);
      setMergedYaml(nextMergedYaml);
      setDiffModalOpen(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleChange = useCallback((value: string) => {
    setContent(value);
    setDirty(true);
  }, []);

  const handleTabChange = useCallback(
    (tab: ConfigEditorTab) => {
      if (tab === activeTab) return;

      if (tab === 'manager') {
        setActiveTab(tab);
        localStorage.setItem('config-management:tab', tab);
        return;
      }

      if (tab === 'source') {
        // Only rewrite YAML when there are pending visual changes; otherwise preserve raw YAML + comments.
        if (visualDirty) {
          const nextContent = applyVisualChangesToYaml(content);
          if (nextContent !== content) {
            setContent(nextContent);
            setDirty(true);
          }
        }
      } else {
        const result = loadVisualValuesFromYaml(content);
        if (!result.ok) {
          showNotification(
            t('config_management.visual_mode_unavailable_detail', { message: result.error }),
            'error'
          );
          return;
        }
      }

      setActiveTab(tab);
      localStorage.setItem('config-management:tab', tab);
    },
    [
      activeTab,
      applyVisualChangesToYaml,
      content,
      loadVisualValuesFromYaml,
      showNotification,
      t,
      visualDirty,
    ]
  );

  // Search functionality
  const performSearch = useCallback((query: string, direction: 'next' | 'prev' = 'next') => {
    if (!query || !editorRef.current?.view) return;

    const view = editorRef.current.view;
    const doc = view.state.doc.toString();
    const matches: number[] = [];
    const lowerQuery = query.toLowerCase();
    const lowerDoc = doc.toLowerCase();

    let pos = 0;
    while (pos < lowerDoc.length) {
      const index = lowerDoc.indexOf(lowerQuery, pos);
      if (index === -1) break;
      matches.push(index);
      pos = index + 1;
    }

    if (matches.length === 0) {
      setSearchResults({ current: 0, total: 0 });
      return;
    }

    // Find current match based on cursor position
    const selection = view.state.selection.main;
    const cursorPos = direction === 'prev' ? selection.from : selection.to;
    let currentIndex = 0;

    if (direction === 'next') {
      // Find next match after cursor
      for (let i = 0; i < matches.length; i++) {
        if (matches[i] > cursorPos) {
          currentIndex = i;
          break;
        }
        // If no match after cursor, wrap to first
        if (i === matches.length - 1) {
          currentIndex = 0;
        }
      }
    } else {
      // Find previous match before cursor
      for (let i = matches.length - 1; i >= 0; i--) {
        if (matches[i] < cursorPos) {
          currentIndex = i;
          break;
        }
        // If no match before cursor, wrap to last
        if (i === 0) {
          currentIndex = matches.length - 1;
        }
      }
    }

    const matchPos = matches[currentIndex];
    setSearchResults({ current: currentIndex + 1, total: matches.length });

    // Scroll to and select the match
    view.dispatch({
      selection: { anchor: matchPos, head: matchPos + query.length },
      scrollIntoView: true,
    });
    view.focus();
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value);
    // Do not auto-search on each keystroke. Clear previous results when query changes.
    if (!value) {
      setSearchResults({ current: 0, total: 0 });
      setLastSearchedQuery('');
    } else {
      setSearchResults({ current: 0, total: 0 });
    }
  }, []);

  const executeSearch = useCallback(
    (direction: 'next' | 'prev' = 'next') => {
      if (!searchQuery) return;
      setLastSearchedQuery(searchQuery);
      performSearch(searchQuery, direction);
    },
    [searchQuery, performSearch]
  );

  const handleSearchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeSearch(e.shiftKey ? 'prev' : 'next');
      }
    },
    [executeSearch]
  );

  const handlePrevMatch = useCallback(() => {
    if (!lastSearchedQuery) return;
    performSearch(lastSearchedQuery, 'prev');
  }, [lastSearchedQuery, performSearch]);

  const handleNextMatch = useCallback(() => {
    if (!lastSearchedQuery) return;
    performSearch(lastSearchedQuery, 'next');
  }, [lastSearchedQuery, performSearch]);

  // Keep bottom floating actions from covering page content by syncing its height to a CSS variable.
  useLayoutEffect(() => {
    if (typeof window === 'undefined' || !shouldRenderFloatingActions) return;

    const actionsEl = floatingActionsRef.current;
    if (!actionsEl) return;

    const updatePadding = () => {
      const height = actionsEl.getBoundingClientRect().height;
      document.documentElement.style.setProperty('--config-action-bar-height', `${height}px`);
    };

    updatePadding();
    window.addEventListener('resize', updatePadding);

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePadding);
    ro?.observe(actionsEl);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', updatePadding);
      document.documentElement.style.removeProperty('--config-action-bar-height');
    };
  }, [shouldRenderFloatingActions]);

  // Status text
  const getStatusText = () => {
    if (isManagerTab) {
      if (disableControls) return t('config_management.status_disconnected');
      if (managerLoading) return t('config_management.status_loading');
      if (managerError) return t('config_management.status_load_failed');
      if (managerSaving) return t('config_management.status_saving');
      if (managerDirty) return t('config_management.status_dirty');
      return t('config_management.status_loaded');
    }
    if (disableControls) return t('config_management.status_disconnected');
    if (loading) return t('config_management.status_loading');
    if (error) return t('config_management.status_load_failed');
    if (hasVisualModeError) return t('config_management.visual_mode_unavailable');
    if (hasVisualValidationErrors)
      return t('config_management.visual.validation.validation_blocked');
    if (saving) return t('config_management.status_saving');
    if (isDirty) return t('config_management.status_dirty');
    return t('config_management.status_loaded');
  };

  const getStatusClass = () => {
    if (isManagerTab) {
      if (managerError) return styles.error;
      if (managerDirty) return styles.modified;
      if (!managerLoading && !managerSaving) return styles.saved;
      return '';
    }
    if (error || hasVisualModeError || hasVisualValidationErrors) return styles.error;
    if (isDirty) return styles.modified;
    if (!loading && !saving) return styles.saved;
    return '';
  };

  const getFloatingStatusText = () => {
    if (isManagerTab) {
      if (!isMobile) return getStatusText();
      if (disableControls)
        return t('config_management.status_disconnected_short', { defaultValue: 'Disconnected' });
      if (managerLoading)
        return t('config_management.status_loading_short', { defaultValue: 'Loading' });
      if (managerError)
        return t('config_management.status_load_failed_short', { defaultValue: 'Failed' });
      if (managerSaving)
        return t('config_management.status_saving_short', { defaultValue: 'Saving' });
      if (managerDirty)
        return t('config_management.status_dirty_short', { defaultValue: 'Unsaved' });
      return t('config_management.status_loaded_short', { defaultValue: 'Loaded' });
    }
    if (!isMobile) return getStatusText();
    if (disableControls)
      return t('config_management.status_disconnected_short', { defaultValue: 'Disconnected' });
    if (loading) return t('config_management.status_loading_short', { defaultValue: 'Loading' });
    if (error) return t('config_management.status_load_failed_short', { defaultValue: 'Failed' });
    if (hasVisualModeError)
      return t('config_management.visual_mode_unavailable_short', { defaultValue: 'YAML issue' });
    if (hasVisualValidationErrors)
      return t('config_management.visual.validation_blocked_short');
    if (saving) return t('config_management.status_saving_short', { defaultValue: 'Saving' });
    if (isDirty) return t('config_management.status_dirty_short', { defaultValue: 'Unsaved' });
    return t('config_management.status_loaded_short', { defaultValue: 'Loaded' });
  };

  const handleReload = useCallback(() => {
    if (activeTab === 'manager') {
      if (!managerDirty) {
        void loadManagerConfig();
        return;
      }
      showConfirmation({
        title: t('common.unsaved_changes_title'),
        message: t('config_management.reload_confirm_message'),
        confirmText: t('config_management.reload'),
        cancelText: t('common.cancel'),
        variant: 'danger',
        onConfirm: async () => {
          await loadManagerConfig();
        },
      });
      return;
    }

    if (!isDirty) {
      void loadConfig();
      return;
    }

    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('config_management.reload_confirm_message'),
      confirmText: t('config_management.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await loadConfig();
      },
    });
  }, [activeTab, isDirty, loadConfig, loadManagerConfig, managerDirty, showConfirmation, t]);

  const floatingActions = (
    <div className={styles.floatingActionContainer} ref={floatingActionsRef}>
      <div className={styles.floatingActionList}>
        <div
          className={`${styles.floatingStatus} ${
            isMobile ? styles.floatingStatusCompact : ''
          } ${getStatusClass()}`}
        >
          {getFloatingStatusText()}
        </div>
        <button
          type="button"
          className={styles.floatingActionButton}
          onClick={handleReload}
          disabled={loading || saving}
          title={t('config_management.reload')}
          aria-label={t('config_management.reload')}
        >
          <IconRefreshCw size={16} />
        </button>
        <button
          type="button"
          className={styles.floatingActionButton}
          onClick={handleSave}
          disabled={
            isManagerTab
              ? disableControls || managerLoading || managerSaving || !managerDirty
              : disableControls ||
                loading ||
                saving ||
                !isDirty ||
                diffModalOpen ||
                hasVisualModeError ||
                hasVisualValidationErrors
          }
          title={t('config_management.save')}
          aria-label={t('config_management.save')}
        >
          <IconCheck size={16} />
          {isDirty && <span className={styles.dirtyDot} aria-hidden="true" />}
        </button>
      </div>
    </div>
  );

  const pageDescription =
    activeTab === 'manager'
      ? t('config_management.manager.description')
      : activeTab === 'visual'
      ? t('config_management.visual.notice')
      : t('config_management.description');
  const managerServiceTarget = resolveManagerServiceBase();
  const canConfigureRequestMonitoring = Boolean(managerServiceTarget);
  const managerRuntimeModeLabel =
    panelHostedByUsageService === true
      ? t('config_management.manager.runtime_embedded')
      : t('config_management.manager.runtime_external');

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('config_management.title')}</h1>
        <p className={styles.description}>{pageDescription}</p>
      </div>

      <div className={styles.workspaceShell}>
        <div className={styles.pageMeta}>
          <div className={styles.tabBar}>
            <button
              type="button"
              className={`${styles.tabItem} ${activeTab === 'visual' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('visual')}
              disabled={saving || loading}
            >
              {t('config_management.tabs.visual')}
            </button>
            <button
              type="button"
              className={`${styles.tabItem} ${activeTab === 'source' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('source')}
              disabled={saving || loading}
            >
              {t('config_management.tabs.source')}
            </button>
            <button
              type="button"
              className={`${styles.tabItem} ${activeTab === 'manager' ? styles.tabActive : ''}`}
              onClick={() => handleTabChange('manager')}
              disabled={managerSaving || managerLoading}
            >
              {t('config_management.tabs.manager')}
            </button>
          </div>
          <div className={`${styles.statusBadge} ${getStatusClass()}`}>{getStatusText()}</div>
        </div>

        <div className={styles.content}>
          {activeTab !== 'manager' && error && <div className="error-box">{error}</div>}
          {activeTab === 'manager' && managerError && (
            <div className="error-box">{managerError}</div>
          )}
          {activeTab !== 'manager' && !error && visualParseError && (
            <div className="error-box">
              {t('config_management.visual_mode_unavailable_detail', { message: visualParseError })}
            </div>
          )}

          {activeTab === 'manager' ? (
            <div className={styles.managerConfigPanel}>
              <div className={styles.managerConfigHeader}>
                <div>
                  <h2>{t('config_management.manager.title')}</h2>
                  <p>
                    {t('config_management.manager.boundary_hint')}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void loadManagerConfig()}
                  loading={managerLoading}
                >
                  {t('common.refresh')}
                </Button>
              </div>

              <section className={styles.managerSection}>
                <div className={styles.managerSectionHeader}>
                  <div>
                    <h3>{t('config_management.manager.runtime_title')}</h3>
                    <p>
                      {panelHostedByUsageService === true
                        ? t('config_management.manager.runtime_embedded_hint')
                        : t('config_management.manager.runtime_external_hint')}
                    </p>
                  </div>
                  <span className={styles.managerRuntimeBadge}>{managerRuntimeModeLabel}</span>
                </div>

                {panelHostedByUsageService === true ? (
                  <div className={styles.managerReadonlyGrid}>
                    <div>
                      <span>{t('config_management.manager.service_base')}</span>
                      <strong>{detectedPanelBase}</strong>
                    </div>
                  </div>
                ) : (
                  <Input
                    label={t('config_management.manager.external_service_base')}
                    placeholder="http://127.0.0.1:18317"
                    value={managerServiceBase}
                    onChange={(event) => {
                      setManagerServiceBase(event.target.value);
                      setManagerFieldDirty();
                    }}
                    disabled={disableControls || managerLoading}
                    hint={t('config_management.manager.external_service_hint')}
                  />
                )}
              </section>

              <section className={styles.managerSection}>
                <div className={styles.managerSectionHeader}>
                  <div>
                    <h3>{t('config_management.manager.request_monitoring_title')}</h3>
                    <p>
                      {t('config_management.manager.request_monitoring_hint')}
                    </p>
                  </div>
                  <ToggleSwitch
                    label={t('config_management.manager.request_monitoring_enabled')}
                    labelPosition="left"
                    checked={managerRequestMonitoringEnabled}
                    onChange={(value) => {
                      setManagerRequestMonitoringEnabled(value);
                      setManagerFieldDirty();
                    }}
                    disabled={disableControls || managerLoading || !canConfigureRequestMonitoring}
                  />
                </div>

                {!canConfigureRequestMonitoring ? (
                  <div className={styles.managerDependencyNote}>
                    {t('config_management.manager.request_monitoring_dependency')}
                  </div>
                ) : null}

                <div className={styles.managerQueueNote}>
                  {t('config_management.manager.request_monitoring_queue_note')}
                </div>

                <div className={styles.managerConfigGrid}>
                  <div className={styles.managerField}>
                    <span className={styles.managerFieldLabel}>
                      {t('config_management.manager.collector_mode')}
                    </span>
                    <Select
                      value={managerCollectorMode}
                      options={managerCollectorModeOptions}
                      triggerClassName={styles.managerSelectTrigger}
                      onChange={(value) => {
                        setManagerCollectorMode(value);
                        setManagerFieldDirty();
                      }}
                      disabled={
                        disableControls ||
                        managerLoading ||
                        !managerRequestMonitoringEnabled ||
                        !canConfigureRequestMonitoring
                      }
                      ariaLabel={t('config_management.manager.collector_mode')}
                    />
                  </div>
                  <Input
                    label={t('config_management.manager.poll_interval_ms')}
                    type="number"
                    min="1"
                    placeholder="500"
                    value={managerPollIntervalMs}
                    onChange={(event) => {
                      setManagerPollIntervalMs(event.target.value);
                      setManagerFieldDirty();
                    }}
                    disabled={
                      disableControls ||
                      managerLoading ||
                      !managerRequestMonitoringEnabled ||
                      !canConfigureRequestMonitoring
                    }
                    hint={t('config_management.manager.poll_interval_hint', {
                      seconds: managerRetentionSeconds,
                    })}
                  />
                  <Input
                    label={t('config_management.manager.batch_size')}
                    type="number"
                    min="1"
                    placeholder="100"
                    value={managerBatchSize}
                    onChange={(event) => {
                      setManagerBatchSize(event.target.value);
                      setManagerFieldDirty();
                    }}
                    disabled={
                      disableControls ||
                      managerLoading ||
                      !managerRequestMonitoringEnabled ||
                      !canConfigureRequestMonitoring
                    }
                  />
                  <Input
                    label={t('config_management.manager.query_limit')}
                    type="number"
                    min="1"
                    placeholder="50000"
                    value={managerQueryLimit}
                    onChange={(event) => {
                      setManagerQueryLimit(event.target.value);
                      setManagerFieldDirty();
                    }}
                    disabled={
                      disableControls ||
                      managerLoading ||
                      !managerRequestMonitoringEnabled ||
                      !canConfigureRequestMonitoring
                    }
                  />
                </div>
              </section>

              <div className={styles.managerMetaGrid}>
                <div>
                  <span>{t('config_management.manager.config_source')}</span>
                  <strong>{managerConfigSourceLabel}</strong>
                </div>
                <div>
                  <span>{t('config_management.manager.cpa_usage_enabled')}</span>
                  <strong>
                    {managerCPAUsage?.usageStatisticsEnabled
                      ? t('common.enabled')
                      : t('common.disabled')}
                  </strong>
                </div>
                <div>
                  <span>{t('config_management.manager.cpa_retention')}</span>
                  <strong>
                    {t('config_management.manager.cpa_retention_value', {
                      seconds: managerRetentionSeconds,
                    })}
                  </strong>
                </div>
              </div>
            </div>
          ) : activeTab === 'visual' ? (
            <VisualConfigEditor
              values={visualValues}
              validationErrors={visualValidationErrors}
              hasPayloadValidationErrors={visualHasPayloadValidationErrors}
              disabled={disableControls || loading}
              onChange={setVisualValues}
            />
          ) : (
            <div className={styles.sourceWorkspace}>
              <div className={styles.sourceToolbar}>
                <div className={styles.searchInputWrapper}>
                  <Input
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    onKeyDown={handleSearchKeyDown}
                    placeholder={t('config_management.search_placeholder')}
                    disabled={disableControls || loading}
                    className={styles.searchInput}
                    rightElement={
                      <div className={styles.searchRight}>
                        {searchQuery && lastSearchedQuery === searchQuery && (
                          <span className={styles.searchCount}>
                            {searchResults.total > 0
                              ? `${searchResults.current} / ${searchResults.total}`
                              : t('config_management.search_no_results')}
                          </span>
                        )}
                        <button
                          type="button"
                          className={styles.searchButton}
                          onClick={() => executeSearch('next')}
                          disabled={!searchQuery || disableControls || loading}
                          title={t('config_management.search_button')}
                        >
                          <IconSearch size={16} />
                        </button>
                      </div>
                    }
                  />
                </div>

                <div className={styles.searchActions}>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handlePrevMatch}
                    disabled={
                      !searchQuery || lastSearchedQuery !== searchQuery || searchResults.total === 0
                    }
                    title={t('config_management.search_prev')}
                  >
                    <IconChevronUp size={16} />
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleNextMatch}
                    disabled={
                      !searchQuery || lastSearchedQuery !== searchQuery || searchResults.total === 0
                    }
                    title={t('config_management.search_next')}
                  >
                    <IconChevronDown size={16} />
                  </Button>
                </div>
              </div>

              <div className={styles.editorWrapper}>
                <Suspense fallback={null}>
                  <LazyConfigSourceEditor
                    editorRef={editorRef}
                    value={content}
                    onChange={handleChange}
                    theme={resolvedTheme}
                    editable={!disableControls && !loading}
                    placeholder={t('config_management.editor_placeholder')}
                  />
                </Suspense>
              </div>
            </div>
          )}
        </div>
      </div>

      {shouldRenderFloatingActions && typeof document !== 'undefined'
        ? createPortal(floatingActions, document.body)
        : null}
      <DiffModal
        open={diffModalOpen}
        original={serverYaml}
        modified={mergedYaml}
        onConfirm={handleConfirmSave}
        onCancel={() => setDiffModalOpen(false)}
        loading={saving}
      />
    </div>
  );
}
