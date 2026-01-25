/**
 * Unified Routing Management Page
 * 智能路由管理界面
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import {
  RouteModal,
  TargetModal,
  CredentialsOverview,
  RouteCard,
  RouteMonitor,
} from '@/components/unified-routing';
import { useUnifiedRoutingStore, useAuthStore, useNotificationStore } from '@/stores';
import type { Route, Pipeline, Target, Layer } from '@/types';
import styles from './UnifiedRoutingPage.module.scss';

export function UnifiedRoutingPage() {
  const { t } = useTranslation();
  const { showNotification, showConfirmation } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  // Store state
  const {
    settings,
    routes,
    overview,
    credentials,
    loading,
    saving,
    fetchSettings,
    updateSettings,
    fetchRoutes,
    selectRoute,
    createRoute,
    updateRoute,
    deleteRoute,
    updatePipeline,
    fetchOverview,
    fetchCredentials,
  } = useUnifiedRoutingStore();

  // Route pipelines cache - use ref to avoid useEffect dependency issues
  const routePipelinesRef = useRef<Record<string, Pipeline | null>>({});
  const loadingPipelinesRef = useRef<Record<string, boolean>>({});
  const [routePipelines, setRoutePipelines] = useState<Record<string, Pipeline | null>>({});
  const [loadingPipelines, setLoadingPipelines] = useState<Record<string, boolean>>({});

  // Track if component has been initialized to avoid showing stale data
  const initializedRef = useRef(false);

  // Local UI state
  const [routeModalOpen, setRouteModalOpen] = useState(false);
  const [editingRoute, setEditingRoute] = useState<Route | null>(null);
  const [targetModalOpen, setTargetModalOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState<{
    routeId: string;
    layerLevel: number;
    target: Target | null;
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Reset store on mount to clear stale data from previous sessions
  useEffect(() => {
    if (!initializedRef.current) {
      // Clear local pipeline cache
      routePipelinesRef.current = {};
      loadingPipelinesRef.current = {};
      setRoutePipelines({});
      setLoadingPipelines({});
      initializedRef.current = true;
    }
  }, []);

  // Initial data load
  useEffect(() => {
    if (connectionStatus !== 'connected') return;

    const loadData = async () => {
      await Promise.allSettled([
        fetchSettings(),
        fetchRoutes(),
        fetchOverview(),
        fetchCredentials(),
      ]);
    };
    loadData();
  }, [connectionStatus, fetchSettings, fetchRoutes, fetchOverview, fetchCredentials]);

  // Auto-refresh state overview every 1 second for live status updates
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    
    const interval = setInterval(() => {
      fetchOverview();
    }, 1000);
    
    return () => clearInterval(interval);
  }, [connectionStatus, fetchOverview]);

  // Load pipelines for all routes - using refs to avoid dependency loop
  useEffect(() => {
    if (connectionStatus !== 'connected') return;
    if (routes.length === 0) return;

    let cancelled = false;

    const loadPipelines = async () => {
      for (const route of routes) {
        if (cancelled) break;
        
        // Check refs instead of state to avoid dependency issues
        if (routePipelinesRef.current[route.id] !== undefined || loadingPipelinesRef.current[route.id]) {
          continue;
        }

        loadingPipelinesRef.current[route.id] = true;
        setLoadingPipelines({ ...loadingPipelinesRef.current });

        try {
          await selectRoute(route.id);
          const store = useUnifiedRoutingStore.getState();
          routePipelinesRef.current[route.id] = store.currentPipeline;
          if (!cancelled) {
            setRoutePipelines({ ...routePipelinesRef.current });
          }
        } catch (e) {
          console.error(`Failed to load pipeline for route ${route.id}:`, e);
          // Mark as loaded (with null) to avoid retrying
          routePipelinesRef.current[route.id] = null;
        } finally {
          loadingPipelinesRef.current[route.id] = false;
          if (!cancelled) {
            setLoadingPipelines({ ...loadingPipelinesRef.current });
          }
        }
      }
    };

    loadPipelines();

    return () => {
      cancelled = true;
    };
  }, [connectionStatus, routes, selectRoute]);

  // Helper functions
  const getErrorMessage = (err: unknown) => {
    if (err instanceof Error) return err.message;
    if (typeof err === 'string') return err;
    return t('notification.unknown_error');
  };

  const getRouteState = (routeId: string) => {
    return overview?.routes?.find((r) => r.route_id === routeId) ?? null;
  };

  // Toggle unified routing enabled
  const handleToggleEnabled = async (enabled: boolean) => {
    try {
      await updateSettings({
        enabled,
        hide_original_models: settings?.hide_original_models || false,
      });
      showNotification(
        enabled
          ? t('unified_routing.enabled_success')
          : t('unified_routing.disabled_success'),
        'success'
      );
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  // Toggle hide original models
  const handleToggleHideModels = async (hideOriginalModels: boolean) => {
    if (!settings?.enabled) return;
    try {
      await updateSettings({
        enabled: settings.enabled,
        hide_original_models: hideOriginalModels,
      });
      showNotification(
        t('unified_routing.settings_updated'),
        'success'
      );
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  // Route handlers
  const handleAddRoute = () => {
    setEditingRoute(null);
    setRouteModalOpen(true);
  };

  const handleEditRoute = (routeId: string) => {
    const route = routes.find((r) => r.id === routeId);
    if (route) {
      setEditingRoute(route);
      setRouteModalOpen(true);
    }
  };

  const handleSaveRoute = async (data: { name: string; description?: string; enabled: boolean }) => {
    try {
      if (editingRoute) {
        await updateRoute(editingRoute.id, data);
        showNotification(t('unified_routing.route_updated'), 'success');
      } else {
        await createRoute(data);
        showNotification(t('unified_routing.route_created'), 'success');
      }
      setRouteModalOpen(false);
      await fetchRoutes();
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  const handleDeleteRoute = (routeId: string) => {
    const route = routes.find((r) => r.id === routeId);
    if (!route) return;

    showConfirmation({
      title: t('unified_routing.delete_route'),
      message: t('unified_routing.delete_route_confirm', { name: route.name }),
      variant: 'danger',
      confirmText: t('common.delete'),
      onConfirm: async () => {
        try {
          await deleteRoute(routeId);
          showNotification(t('unified_routing.route_deleted'), 'success');
          // Remove from local cache (both ref and state)
          delete routePipelinesRef.current[routeId];
          delete loadingPipelinesRef.current[routeId];
          setRoutePipelines({ ...routePipelinesRef.current });
          setLoadingPipelines({ ...loadingPipelinesRef.current });
        } catch (error) {
          showNotification(getErrorMessage(error), 'error');
        }
      },
    });
  };

  // Target handlers
  const handleAddTarget = (routeId: string, layerLevel: number) => {
    setEditingTarget({ routeId, layerLevel, target: null });
    setTargetModalOpen(true);
  };

  const handleEditTarget = (routeId: string, layerLevel: number, target: Target) => {
    setEditingTarget({ routeId, layerLevel, target });
    setTargetModalOpen(true);
  };

  const handleDeleteTarget = async (routeId: string, layerLevel: number, targetId: string) => {
    const pipeline = routePipelines[routeId];
    if (!pipeline) return;

    const newPipeline: Pipeline = {
      ...pipeline,
      layers: pipeline.layers.map((layer) => {
        if (layer.level !== layerLevel) return layer;
        return {
          ...layer,
          targets: layer.targets.filter((t) => t.id !== targetId),
        };
      }),
    };

    try {
      await updatePipeline(routeId, newPipeline);
      // Update both ref and state
      routePipelinesRef.current[routeId] = newPipeline;
      setRoutePipelines({ ...routePipelinesRef.current });
      showNotification(t('unified_routing.target_deleted'), 'success');
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  const handleSaveTarget = async (layerLevel: number, target: Target, isEdit: boolean) => {
    if (!editingTarget) return;

    const { routeId } = editingTarget;
    let pipeline = routePipelines[routeId];

    // If no pipeline exists, create one with the new layer
    if (!pipeline) {
      pipeline = {
        route_id: routeId,
        layers: [],
      };
    }

    // Check if layer exists
    const layerExists = pipeline.layers.some((l) => l.level === layerLevel);

    let newPipeline: Pipeline;

    if (layerExists) {
      newPipeline = {
        ...pipeline,
        layers: pipeline.layers.map((layer) => {
          if (layer.level !== layerLevel) return layer;

          if (isEdit) {
            return {
              ...layer,
              targets: layer.targets.map((t) => (t.id === target.id ? target : t)),
            };
          } else {
            return {
              ...layer,
              targets: [...layer.targets, target],
            };
          }
        }),
      };
    } else {
      // Create new layer with target
      const newLayer: Layer = {
        level: layerLevel,
        strategy: 'round-robin',
        cooldown_seconds: 30,
        targets: [target],
      };
      newPipeline = {
        ...pipeline,
        layers: [...pipeline.layers, newLayer].sort((a, b) => a.level - b.level),
      };
    }

    try {
      await updatePipeline(routeId, newPipeline);
      // Update both ref and state
      routePipelinesRef.current[routeId] = newPipeline;
      setRoutePipelines({ ...routePipelinesRef.current });
      showNotification(
        isEdit ? t('unified_routing.target_updated') : t('unified_routing.target_added'),
        'success'
      );
      setTargetModalOpen(false);
    } catch (error) {
      showNotification(getErrorMessage(error), 'error');
    }
  };

  // Add layer handler
  const handleAddLayer = (routeId: string) => {
    const pipeline = routePipelines[routeId];
    const maxLevel = pipeline?.layers.reduce((max, l) => Math.max(max, l.level), 0) || 0;
    // Open target modal for new layer
    setEditingTarget({ routeId, layerLevel: maxLevel + 1, target: null });
    setTargetModalOpen(true);
  };

  // Select route (for configure pipeline)
  const handleSelectRoute = async (routeId: string) => {
    // For now, just open add target modal for layer 1
    const pipeline = routePipelines[routeId];
    const layerLevel = pipeline?.layers[0]?.level || 1;
    setEditingTarget({ routeId, layerLevel, target: null });
    setTargetModalOpen(true);
  };

  // Refresh handler - fully reset state and reload
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Clear all local pipeline cache (refs and state)
      routePipelinesRef.current = {};
      loadingPipelinesRef.current = {};
      setRoutePipelines({});
      setLoadingPipelines({});

      // Reload all data including settings
      await Promise.all([
        fetchSettings(),
        fetchRoutes(),
        fetchOverview(),
        fetchCredentials(),
      ]);
    } catch (error) {
      console.error('Refresh failed:', error);
    } finally {
      setRefreshing(false);
    }
  }, [fetchSettings, fetchRoutes, fetchOverview, fetchCredentials]);

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.pageHeader}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>{t('unified_routing.title')}</h1>
          <div className={styles.enableToggle}>
            <ToggleSwitch
              checked={settings?.enabled || false}
              onChange={handleToggleEnabled}
              disabled={disableControls || saving}
            />
            <span className={styles.toggleLabel}>
              {settings?.enabled
                ? t('unified_routing.status_enabled')
                : t('unified_routing.status_disabled')}
            </span>
          </div>
          <div className={styles.enableToggle}>
            <ToggleSwitch
              checked={settings?.hide_original_models || false}
              onChange={handleToggleHideModels}
              disabled={disableControls || saving || !settings?.enabled}
            />
            <span className={styles.toggleLabel}>
              {t('unified_routing.hide_original_models')}
            </span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleRefresh}
            disabled={disableControls || loading || refreshing}
            loading={refreshing}
          >
            {t('common.refresh')}
          </Button>
        </div>
      </div>

      {/* Credentials Overview */}
      <section className={styles.section}>
        <CredentialsOverview credentials={credentials} loading={loading} />
      </section>

      {/* Routes Section */}
      <section className={styles.section}>
        <Card
          title={t('unified_routing.routes_config')}
          extra={
            <Button
              variant="primary"
              size="sm"
              onClick={handleAddRoute}
              disabled={disableControls}
            >
              + {t('unified_routing.add_route')}
            </Button>
          }
        >
          {loading ? (
            <div className={styles.loadingState}>{t('common.loading')}</div>
          ) : routes.length === 0 ? (
            <div className={styles.emptyState}>
              <p>{t('unified_routing.no_routes')}</p>
              <p className={styles.emptyHint}>{t('unified_routing.no_routes_description')}</p>
            </div>
          ) : (
            <div className={styles.routesList}>
              {routes.map((route) => (
                <RouteCard
                  key={route.id}
                  route={route}
                  pipeline={routePipelines[route.id] || null}
                  routeState={getRouteState(route.id)}
                  credentials={credentials}
                  loading={loadingPipelines[route.id]}
                  disabled={disableControls}
                  onEdit={handleEditRoute}
                  onDelete={handleDeleteRoute}
                  onAddTarget={handleAddTarget}
                  onEditTarget={handleEditTarget}
                  onDeleteTarget={handleDeleteTarget}
                  onAddLayer={handleAddLayer}
                  onSelect={handleSelectRoute}
                />
              ))}
            </div>
          )}
        </Card>
      </section>

      {/* Route Monitor Section */}
      {routes.length > 0 && (
        <section className={styles.section}>
          <RouteMonitor
            routes={routes}
            credentials={credentials}
            disabled={disableControls}
          />
        </section>
      )}

      {/* Modals */}
      <RouteModal
        open={routeModalOpen}
        route={editingRoute}
        saving={saving}
        onClose={() => setRouteModalOpen(false)}
        onSave={handleSaveRoute}
      />

      {editingTarget && (
        <TargetModal
          open={targetModalOpen}
          target={editingTarget.target}
          layerLevel={editingTarget.layerLevel}
          credentials={credentials}
          saving={saving}
          onClose={() => {
            setTargetModalOpen(false);
            setEditingTarget(null);
          }}
          onSave={handleSaveTarget}
        />
      )}
    </div>
  );
}
