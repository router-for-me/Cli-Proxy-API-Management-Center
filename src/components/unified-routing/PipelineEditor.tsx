/**
 * Pipeline Editor Component
 */

import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { Pipeline, Layer, Target, LoadStrategy, CredentialInfo, RouteState, TargetState } from '@/types';

interface PipelineEditorProps {
  pipeline: Pipeline | null;
  routeState: RouteState | null;
  credentials: CredentialInfo[];
  saving: boolean;
  disabled: boolean;
  onSave: (pipeline: Pipeline) => void;
  onAddTarget: (layerLevel: number) => void;
  onEditTarget: (layerLevel: number, targetIndex: number, target: Target) => void;
  onHealthCheck: () => void;
}

const STRATEGY_OPTIONS: { value: LoadStrategy; label: string }[] = [
  { value: 'round-robin', label: 'Round Robin' },
  { value: 'weighted-round-robin', label: 'Weighted Round Robin' },
  { value: 'random', label: 'Random' },
  { value: 'first-available', label: 'First Available' },
  { value: 'least-connections', label: 'Least Connections' },
];

function getTargetState(routeState: RouteState | null, targetId: string): TargetState | undefined {
  if (!routeState) return undefined;
  for (const layer of routeState.layers) {
    const target = layer.targets.find((t) => t.target_id === targetId);
    if (target) return target;
  }
  return undefined;
}

function getStatusBadgeClass(status: string): string {
  switch (status) {
    case 'healthy':
      return 'badge-success';
    case 'cooling':
      return 'badge-warning';
    case 'unhealthy':
      return 'badge-danger';
    case 'disabled':
      return 'badge-secondary';
    default:
      return 'badge-secondary';
  }
}

export function PipelineEditor({
  pipeline,
  routeState,
  credentials,
  saving,
  disabled,
  onSave,
  onAddTarget,
  onEditTarget,
  onHealthCheck,
}: PipelineEditorProps) {
  const { t } = useTranslation();
  const [localPipeline, setLocalPipeline] = useState<Pipeline | null>(pipeline);

  // Sync local state with props
  useEffect(() => {
    if (pipeline) {
      setLocalPipeline(pipeline);
    }
  }, [pipeline]);

  const handleAddLayer = () => {
    if (!localPipeline) return;
    
    const newLevel = localPipeline.layers.length > 0
      ? Math.max(...localPipeline.layers.map((l) => l.level)) + 1
      : 1;
    
    const newLayer: Layer = {
      level: newLevel,
      strategy: 'round-robin',
      cooldown_seconds: 60,
      targets: [],
    };
    
    setLocalPipeline({
      ...localPipeline,
      layers: [...localPipeline.layers, newLayer],
    });
  };

  const handleRemoveLayer = (level: number) => {
    if (!localPipeline) return;
    setLocalPipeline({
      ...localPipeline,
      layers: localPipeline.layers.filter((l) => l.level !== level),
    });
  };

  const handleUpdateLayer = (level: number, updates: Partial<Layer>) => {
    if (!localPipeline) return;
    setLocalPipeline({
      ...localPipeline,
      layers: localPipeline.layers.map((l) =>
        l.level === level ? { ...l, ...updates } : l
      ),
    });
  };

  const handleToggleTarget = (layerLevel: number, targetIndex: number, enabled: boolean) => {
    if (!localPipeline) return;
    setLocalPipeline({
      ...localPipeline,
      layers: localPipeline.layers.map((l) => {
        if (l.level !== layerLevel) return l;
        return {
          ...l,
          targets: l.targets.map((t, i) =>
            i === targetIndex ? { ...t, enabled } : t
          ),
        };
      }),
    });
  };

  const handleRemoveTarget = (layerLevel: number, targetIndex: number) => {
    if (!localPipeline) return;
    setLocalPipeline({
      ...localPipeline,
      layers: localPipeline.layers.map((l) => {
        if (l.level !== layerLevel) return l;
        return {
          ...l,
          targets: l.targets.filter((_, i) => i !== targetIndex),
        };
      }),
    });
  };

  const handleSave = () => {
    if (localPipeline) {
      onSave(localPipeline);
    }
  };

  const getCredentialLabel = (credentialId: string): string => {
    const cred = credentials.find((c) => c.id === credentialId);
    if (!cred) return credentialId;
    return cred.label || cred.prefix || `${cred.provider} (${cred.id.slice(0, 8)})`;
  };

  const hasChanges = JSON.stringify(localPipeline) !== JSON.stringify(pipeline);

  if (!pipeline || !localPipeline) {
    return (
      <Card title={t('unified_routing.pipeline')}>
        <EmptyState
          title={t('unified_routing.select_route')}
          description={t('unified_routing.select_route_description')}
        />
      </Card>
    );
  }

  return (
    <Card
      title={t('unified_routing.pipeline')}
      extra={
        <div className="button-group">
          <Button
            variant="secondary"
            size="sm"
            onClick={onHealthCheck}
            disabled={disabled || saving}
          >
            {t('unified_routing.health_check')}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleSave}
            disabled={disabled || saving || !hasChanges}
            loading={saving}
          >
            {t('common.save')}
          </Button>
        </div>
      }
    >
      <div className="pipeline-editor">
        {localPipeline.layers.length === 0 ? (
          <EmptyState
            title={t('unified_routing.no_layers')}
            description={t('unified_routing.no_layers_description')}
          />
        ) : (
          <div className="layers-container">
            {localPipeline.layers
              .sort((a, b) => a.level - b.level)
              .map((layer, layerIndex) => (
                <div key={layer.level} className="layer-card">
                  <div className="layer-header">
                    <div className="layer-title">
                      <span className="layer-level">
                        {t('unified_routing.layer')} {layer.level}
                      </span>
                      {layerIndex === 0 && (
                        <span className="badge badge-primary">{t('unified_routing.primary')}</span>
                      )}
                      {routeState && (
                        <span className={`badge ${getStatusBadgeClass(routeState.layers[layerIndex]?.status || 'standby')}`}>
                          {routeState.layers[layerIndex]?.status || 'standby'}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleRemoveLayer(layer.level)}
                      disabled={disabled || saving}
                    >
                      {t('common.remove')}
                    </Button>
                  </div>
                  
                  <div className="layer-settings">
                    <div className="setting-item">
                      <label>{t('unified_routing.strategy')}</label>
                      <select
                        value={layer.strategy}
                        onChange={(e) => handleUpdateLayer(layer.level, { strategy: e.target.value as LoadStrategy })}
                        disabled={disabled || saving}
                      >
                        {STRATEGY_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="setting-item">
                      <label>{t('unified_routing.cooldown_seconds')}</label>
                      <input
                        type="number"
                        value={layer.cooldown_seconds}
                        onChange={(e) => handleUpdateLayer(layer.level, { cooldown_seconds: parseInt(e.target.value) || 60 })}
                        min={0}
                        disabled={disabled || saving}
                      />
                    </div>
                  </div>
                  
                  <div className="targets-container">
                    <div className="targets-header">
                      <span>{t('unified_routing.targets')} ({layer.targets.length})</span>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onAddTarget(layer.level)}
                        disabled={disabled || saving}
                      >
                        {t('unified_routing.add_target')}
                      </Button>
                    </div>
                    
                    {layer.targets.length === 0 ? (
                      <div className="empty-targets">
                        {t('unified_routing.no_targets')}
                      </div>
                    ) : (
                      <div className="targets-list">
                        {layer.targets.map((target, targetIndex) => {
                          const targetState = getTargetState(routeState, target.id);
                          return (
                            <div key={target.id} className="target-row">
                              <div className="target-info">
                                <span className="target-credential">
                                  {getCredentialLabel(target.credential_id)}
                                </span>
                                <span className="target-model">{target.model}</span>
                                {target.weight && target.weight > 1 && (
                                  <span className="target-weight">
                                    {t('unified_routing.weight')}: {target.weight}
                                  </span>
                                )}
                              </div>
                              <div className="target-status">
                                {targetState && (
                                  <span className={`badge ${getStatusBadgeClass(targetState.status)}`}>
                                    {targetState.status}
                                    {targetState.status === 'cooling' && targetState.cooldown_remaining_seconds && (
                                      <> ({targetState.cooldown_remaining_seconds}s)</>
                                    )}
                                  </span>
                                )}
                              </div>
                              <div className="target-actions">
                                <ToggleSwitch
                                  checked={target.enabled}
                                  onChange={(checked) => handleToggleTarget(layer.level, targetIndex, checked)}
                                  disabled={disabled || saving}
                                />
                                <Button
                                  variant="secondary"
                                  size="sm"
                                  onClick={() => onEditTarget(layer.level, targetIndex, target)}
                                  disabled={disabled || saving}
                                >
                                  {t('common.edit')}
                                </Button>
                                <Button
                                  variant="danger"
                                  size="sm"
                                  onClick={() => handleRemoveTarget(layer.level, targetIndex)}
                                  disabled={disabled || saving}
                                >
                                  {t('common.remove')}
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              ))}
          </div>
        )}
        
        <div className="pipeline-actions">
          <Button
            variant="secondary"
            onClick={handleAddLayer}
            disabled={disabled || saving}
          >
            {t('unified_routing.add_layer')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
