/**
 * Route List Component
 */

import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { EmptyState } from '@/components/ui/EmptyState';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { RouteListResponse } from '@/types';

interface RouteListProps {
  routes: RouteListResponse['routes'];
  selectedRouteId: string | null;
  loading: boolean;
  saving: boolean;
  disabled: boolean;
  onSelect: (routeId: string) => void;
  onAdd: () => void;
  onEdit: (routeId: string) => void;
  onDelete: (routeId: string) => void;
  onToggle: (routeId: string, enabled: boolean) => void;
}

export function RouteList({
  routes,
  selectedRouteId,
  loading,
  saving,
  disabled,
  onSelect,
  onAdd,
  onEdit,
  onDelete,
  onToggle,
}: RouteListProps) {
  const { t } = useTranslation();

  if (loading) {
    return (
      <Card title={t('unified_routing.routes')}>
        <div className="loading-container">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  return (
    <Card
      title={t('unified_routing.routes')}
      extra={
        <Button
          variant="primary"
          size="sm"
          onClick={onAdd}
          disabled={disabled}
        >
          {t('unified_routing.add_route')}
        </Button>
      }
    >
      {routes.length === 0 ? (
        <EmptyState
          title={t('unified_routing.no_routes')}
          description={t('unified_routing.no_routes_description')}
        />
      ) : (
        <div className="route-list">
          {routes.map((route) => (
            <div
              key={route.id}
              className={`route-item ${selectedRouteId === route.id ? 'selected' : ''}`}
              onClick={() => onSelect(route.id)}
            >
              <div className="route-item-header">
                <div className="route-item-title">
                  <span className="route-name">{route.name}</span>
                  <span className={`route-status ${route.enabled ? 'enabled' : 'disabled'}`}>
                    {route.enabled ? t('common.enabled') : t('common.disabled')}
                  </span>
                </div>
                <ToggleSwitch
                  checked={route.enabled}
                  onChange={(checked) => onToggle(route.id, checked)}
                  disabled={disabled || saving}
                />
              </div>
              {route.description && (
                <div className="route-item-description">{route.description}</div>
              )}
              <div className="route-item-meta">
                <span className="meta-item">
                  {t('unified_routing.layers_count', { count: route.pipeline_summary.total_layers })}
                </span>
                <span className="meta-item">
                  {t('unified_routing.targets_count', { count: route.pipeline_summary.total_targets })}
                </span>
              </div>
              <div className="route-item-actions" onClick={(e) => e.stopPropagation()}>
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
                  disabled={disabled || saving}
                >
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
