/**
 * Route Card Component
 * Displays a route with its layer/target structure
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { unifiedRoutingApi } from '@/services/api/unifiedRouting';
import type { Route, Pipeline, RouteState, CredentialInfo, Target, HealthResult } from '@/types';
import styles from './RouteCard.module.scss';

interface RouteCardProps {
  route: Route & { pipeline_summary: { total_layers: number; total_targets: number } };
  pipeline: Pipeline | null;
  routeState: RouteState | null;
  credentials: CredentialInfo[];
  loading?: boolean;
  disabled?: boolean;
  onEdit: (routeId: string) => void;
  onDelete: (routeId: string) => void;
  onAddTarget: (routeId: string, layerLevel: number) => void;
  onEditTarget: (routeId: string, layerLevel: number, target: Target) => void;
  onDeleteTarget: (routeId: string, layerLevel: number, targetId: string) => void;
  onDeleteLayer: (routeId: string, layerLevel: number) => void;
  onAddLayer: (routeId: string) => void;
  onSelect: (routeId: string) => void;
}

// Health check/simulate result for a target
interface TargetHealthStatus {
  status: 'checking' | 'success' | 'failed' | 'skipped';
  message?: string;
  latency_ms?: number;
}

// Error detail modal info
interface ErrorModalInfo {
  targetName: string;
  errorMessage: string;
}

export function RouteCard({
  route,
  pipeline,
  routeState,
  credentials,
  loading,
  disabled,
  onEdit,
  onDelete,
  onAddTarget,
  onEditTarget,
  onDeleteTarget,
  onDeleteLayer,
  onAddLayer,
  onSelect,
}: RouteCardProps) {
  const { t } = useTranslation();
  
  // Expanded state persisted in localStorage
  const storageKey = `route-expanded-${route.id}`;
  const [expanded, setExpanded] = useState(() => {
    const stored = localStorage.getItem(storageKey);
    return stored !== 'false'; // Default to expanded (true)
  });
  
  const handleToggleExpand = () => {
    const newState = !expanded;
    setExpanded(newState);
    localStorage.setItem(storageKey, String(newState));
  };
  
  // Health check state
  const [checkingAll, setCheckingAll] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [healthStatus, setHealthStatus] = useState<Record<string, TargetHealthStatus>>({});
  
  // Error modal state
  const [errorModal, setErrorModal] = useState<ErrorModalInfo | null>(null);

  // Handle "Check All" - check all targets in this route
  const handleCheckAll = async () => {
    if (!pipeline) return;
    
    setCheckingAll(true);
    
    // Mark all targets as checking
    const allTargets: Record<string, TargetHealthStatus> = {};
    pipeline.layers.forEach(layer => {
      layer.targets.forEach(target => {
        if (target.enabled) {
          allTargets[target.id] = { status: 'checking' };
        }
      });
    });
    setHealthStatus(allTargets);
    
    try {
      const response = await unifiedRoutingApi.triggerHealthCheck(route.id);
      
      // Update health status based on results
      const newStatus: Record<string, TargetHealthStatus> = {};
      (response.results || []).forEach((result: HealthResult) => {
        newStatus[result.target_id] = {
          status: result.status === 'healthy' ? 'success' : 'failed',
          message: result.message,
          latency_ms: result.latency_ms,
        };
      });
      setHealthStatus(newStatus);
    } catch (error) {
      console.error('Check all failed:', error);
      // Mark all as failed on error
      const errorStatus: Record<string, TargetHealthStatus> = {};
      Object.keys(allTargets).forEach(id => {
        errorStatus[id] = { status: 'failed', message: 'Check failed' };
      });
      setHealthStatus(errorStatus);
    } finally {
      setCheckingAll(false);
    }
  };
  
  // Handle "Simulate Route" - simulate routing flow (follows real routing logic)
  const handleSimulateRoute = async () => {
    setSimulating(true);
    setHealthStatus({});
    
    try {
      const result = await unifiedRoutingApi.simulateRoute(route.id, false);
      
      // Update health status based on simulate results
      // Only targets that were actually tried will have results
      const newStatus: Record<string, TargetHealthStatus> = {};
      result.attempts.forEach(layer => {
        layer.targets.forEach(target => {
          newStatus[target.target_id] = {
            status: target.status === 'success' ? 'success' : 'failed',
            message: target.message,
            latency_ms: target.latency_ms,
          };
        });
      });
      setHealthStatus(newStatus);
    } catch (error) {
      console.error('Simulate route failed:', error);
    } finally {
      setSimulating(false);
    }
  };
  
  // Clear health check results
  const clearHealthStatus = () => {
    setHealthStatus({});
  };

  // Get credential info by ID
  const getCredentialInfo = (credentialId: string) => {
    return credentials?.find((c) => c.id === credentialId);
  };

  // Get target state
  const getTargetState = (targetId: string) => {
    if (!routeState) return null;
    for (const layer of routeState.layers) {
      const target = layer.targets.find((t) => t.target_id === targetId);
      if (target) return target;
    }
    return null;
  };

  // Format cooldown remaining
  const formatCooldown = (seconds?: number) => {
    if (!seconds || seconds <= 0) return '';
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  // Get status color class (simplified to only healthy and cooling)
  const getStatusClass = (status?: string) => {
    switch (status) {
      case 'healthy':
        return styles.statusHealthy;
      case 'cooling':
        return styles.statusCooling;
      default:
        return styles.statusHealthy; // Default to healthy
    }
  };

  return (
    <div className={`${styles.card} ${!route.enabled ? styles.disabled : ''}`}>
      {/* Header */}
      <div className={styles.header} onClick={handleToggleExpand}>
        <div className={styles.headerLeft}>
          <span className={styles.expandIcon}>{expanded ? '▼' : '▶'}</span>
          <span className={styles.routeName}>{route.name}</span>
          {!route.enabled && (
            <span className={styles.disabledBadge}>{t('common.disabled')}</span>
          )}
        </div>
        <div className={styles.headerActions} onClick={(e) => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleSimulateRoute}
            disabled={disabled || simulating || checkingAll || !pipeline?.layers?.length}
            loading={simulating}
          >
            {t('unified_routing.simulate_route')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleCheckAll}
            disabled={disabled || checkingAll || simulating || !pipeline?.layers?.length}
            loading={checkingAll}
          >
            {t('unified_routing.check_all')}
          </Button>
          {Object.keys(healthStatus).length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearHealthStatus}
              disabled={disabled || checkingAll || simulating}
            >
              ✕
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => onEdit(route.id)}
            disabled={disabled}
          >
            {t('common.edit')}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => onDelete(route.id)}
            disabled={disabled}
          >
            {t('common.delete')}
          </Button>
        </div>
      </div>

      {/* Description */}
      {route.description && (
        <div className={styles.description}>"{route.description}"</div>
      )}

      {/* Expanded Content - Layers */}
      {expanded && (
        <div className={styles.layersContainer}>
          {loading ? (
            <div className={styles.loadingLayers}>{t('common.loading')}</div>
          ) : pipeline && pipeline.layers.length > 0 ? (
            <>
              {pipeline.layers
                .sort((a, b) => a.level - b.level)
                .map((layer) => (
                  <div key={layer.level} className={styles.layer}>
                    <div className={styles.layerHeader}>
                      <span className={styles.layerTitle}>
                        Layer {layer.level}
                      </span>
                      <span className={styles.layerStrategy}>
                        {layer.strategy}
                      </span>
                      <div className={styles.layerActions}>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => onAddTarget(route.id, layer.level)}
                          disabled={disabled}
                        >
                          + {t('unified_routing.add_target')}
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          onClick={() => onDeleteLayer(route.id, layer.level)}
                          disabled={disabled}
                        >
                          {t('common.delete')}
                        </Button>
                      </div>
                    </div>
                    <div className={styles.targets}>
                      {layer.targets.map((target, idx) => {
                        const cred = getCredentialInfo(target.credential_id);
                        const state = getTargetState(target.id);
                        const health = healthStatus[target.id];
                        const isLast = idx === layer.targets.length - 1;

                        return (
                          <div
                            key={target.id}
                            className={`${styles.target} ${!target.enabled ? styles.targetDisabled : ''}`}
                          >
                            <span className={styles.targetBranch}>
                              {isLast ? '└─' : '├─'}
                            </span>
                            <span className={styles.targetPath}>
                              <span className={styles.provider}>
                                {cred?.provider || 'unknown'}
                              </span>
                              /
                              <span className={styles.credential}>
                                {cred?.label || target.credential_id}
                              </span>
                              /
                              <span className={styles.model}>{target.model}</span>
                            </span>
                            
                            {/* Target runtime status (always show) */}
                            <span
                              className={`${styles.targetStatus} ${getStatusClass(state?.status)} ${state?.status === 'cooling' && state?.last_failure_reason ? styles.clickable : ''}`}
                              title={state?.status === 'cooling' && state?.last_failure_reason ? state.last_failure_reason : undefined}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (state?.status === 'cooling' && state?.last_failure_reason) {
                                  const credInfo = getCredentialInfo(target.credential_id);
                                  setErrorModal({
                                    targetName: `${credInfo?.provider || 'unknown'}/${credInfo?.label || target.credential_id}/${target.model}`,
                                    errorMessage: state.last_failure_reason,
                                  });
                                }
                              }}
                            >
                              {state?.status === 'cooling' ? (
                                <>
                                  ○ {formatCooldown(state.cooldown_remaining_seconds)}
                                </>
                              ) : (
                                <>●</>
                              )}
                            </span>
                            
                            {/* Request stats */}
                            {state && state.total_requests > 0 && (
                              <span className={styles.targetStats}>
                                [{state.successful_requests}/{state.total_requests}]
                              </span>
                            )}
                            
                            {/* Health check result (separate column, only when available) */}
                            {health && (
                              <span
                                className={`${styles.healthStatus} ${
                                  health.status === 'checking' ? styles.healthChecking :
                                  health.status === 'success' ? styles.healthSuccess :
                                  health.status === 'skipped' ? styles.healthSkipped :
                                  styles.healthFailed
                                }`}
                                title={health.message}
                              >
                                {health.status === 'checking' ? (
                                  <>⟳ {t('unified_routing.checking')}</>
                                ) : health.status === 'success' ? (
                                  <>✓ {health.latency_ms ? `${health.latency_ms}ms` : t('unified_routing.success')}</>
                                ) : health.status === 'skipped' ? (
                                  <>- {t('unified_routing.skipped')}</>
                                ) : (
                                  <>✕ {t('unified_routing.failed')}</>
                                )}
                              </span>
                            )}
                            <div
                              className={styles.targetActions}
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                className={styles.iconButton}
                                onClick={() => onEditTarget(route.id, layer.level, target)}
                                disabled={disabled}
                                title={t('common.edit')}
                              >
                                ✎
                              </button>
                              <button
                                className={styles.iconButton}
                                onClick={() =>
                                  onDeleteTarget(route.id, layer.level, target.id)
                                }
                                disabled={disabled}
                                title={t('common.delete')}
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        );
                      })}
                      {layer.targets.length === 0 && (
                        <div className={styles.emptyLayer}>
                          {t('unified_routing.no_targets_in_layer')}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              <div className={styles.addLayerSection}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => onAddLayer(route.id)}
                  disabled={disabled}
                >
                  + {t('unified_routing.add_layer')}
                </Button>
              </div>
            </>
          ) : (
            <div className={styles.emptyPipeline}>
              <p>{t('unified_routing.no_pipeline')}</p>
              <Button
                variant="primary"
                size="sm"
                onClick={() => onSelect(route.id)}
                disabled={disabled}
              >
                {t('unified_routing.configure_pipeline')}
              </Button>
            </div>
          )}
        </div>
      )}
      
      {/* Error Detail Modal */}
      <Modal
        open={!!errorModal}
        onClose={() => setErrorModal(null)}
        title={t('unified_routing.error_details')}
        width={500}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (errorModal) {
                  navigator.clipboard.writeText(errorModal.errorMessage);
                }
              }}
            >
              {t('common.copy')}
            </Button>
            <Button onClick={() => setErrorModal(null)}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        {errorModal && (
          <>
            <div className={styles.modalTarget}>
              <strong>{t('unified_routing.target')}:</strong> {errorModal.targetName}
            </div>
            <div className={styles.modalError}>
              <strong>{t('unified_routing.error_message')}:</strong>
              <pre className={styles.errorContent}>{errorModal.errorMessage}</pre>
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}
