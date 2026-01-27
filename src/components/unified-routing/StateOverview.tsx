/**
 * State Overview Component
 */

import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { StateOverview as StateOverviewType } from '@/types';

interface StateOverviewProps {
  overview: StateOverviewType | null;
  loading: boolean;
  onRefresh: () => void;
  onSelectRoute: (routeId: string) => void;
}

export function StateOverview({ overview, loading, onRefresh, onSelectRoute }: StateOverviewProps) {
  const { t } = useTranslation();

  if (loading && !overview) {
    return (
      <Card title={t('unified_routing.state_overview')}>
        <div className="loading-container">
          <LoadingSpinner />
        </div>
      </Card>
    );
  }

  if (!overview) {
    return (
      <Card title={t('unified_routing.state_overview')}>
        <div className="empty-state">
          <p>{t('unified_routing.state_unavailable')}</p>
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            {t('common.refresh')}
          </Button>
        </div>
      </Card>
    );
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'healthy':
        return 'var(--color-success)';
      case 'degraded':
        return 'var(--color-warning)';
      case 'unhealthy':
        return 'var(--color-danger)';
      default:
        return 'var(--color-text-secondary)';
    }
  };

  return (
    <Card
      title={t('unified_routing.state_overview')}
      extra={
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          {t('common.refresh')}
        </Button>
      }
    >
      <div className="state-overview">
        {/* Summary Stats */}
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{overview.total_routes}</div>
            <div className="stat-label">{t('unified_routing.total_routes')}</div>
          </div>
          <div className="stat-card stat-success">
            <div className="stat-value">{overview.healthy_routes}</div>
            <div className="stat-label">{t('unified_routing.healthy')}</div>
          </div>
          <div className="stat-card stat-warning">
            <div className="stat-value">{overview.degraded_routes}</div>
            <div className="stat-label">{t('unified_routing.degraded')}</div>
          </div>
          <div className="stat-card stat-danger">
            <div className="stat-value">{overview.unhealthy_routes}</div>
            <div className="stat-label">{t('unified_routing.unhealthy')}</div>
          </div>
        </div>

        {/* Route Status List */}
        {overview.routes.length > 0 && (
          <div className="route-status-list">
            <h4>{t('unified_routing.route_status')}</h4>
            {overview.routes.map((route) => (
              <div
                key={route.route_id}
                className="route-status-item"
                onClick={() => onSelectRoute(route.route_id)}
              >
                <div className="route-status-header">
                  <span className="route-name">{route.route_name}</span>
                  <span
                    className="route-status-badge"
                    style={{ backgroundColor: getStatusColor(route.status) }}
                  >
                    {route.status}
                  </span>
                </div>
                <div className="route-status-meta">
                  <span>
                    {t('unified_routing.active_layer')}: {route.active_layer}
                  </span>
                  <span>
                    {t('unified_routing.layers')}: {route.layers.length}
                  </span>
                </div>
                {/* Layer status indicators */}
                <div className="layer-indicators">
                  {route.layers.map((layer) => (
                    <div
                      key={layer.level}
                      className={`layer-indicator layer-${layer.status}`}
                      title={`${t('unified_routing.layer')} ${layer.level}: ${layer.status}`}
                    >
                      <span className="layer-number">{layer.level}</span>
                      <span className="target-count">
                        {layer.targets.filter((t) => t.status === 'healthy').length}/
                        {layer.targets.length}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Global Settings Status */}
        <div className="settings-status">
          <div className="setting-item">
            <span className="setting-label">{t('unified_routing.enabled')}</span>
            <span className={`setting-value ${overview.unified_routing_enabled ? 'enabled' : 'disabled'}`}>
              {overview.unified_routing_enabled ? t('common.yes') : t('common.no')}
            </span>
          </div>
          <div className="setting-item">
            <span className="setting-label">{t('unified_routing.hide_original_models')}</span>
            <span className={`setting-value ${overview.hide_original_models ? 'enabled' : 'disabled'}`}>
              {overview.hide_original_models ? t('common.yes') : t('common.no')}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}
