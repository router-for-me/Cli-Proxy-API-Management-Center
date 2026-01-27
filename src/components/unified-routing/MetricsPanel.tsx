/**
 * Metrics Panel Component
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import type { AggregatedStats, RoutingEvent, RequestTrace } from '@/types';

interface MetricsPanelProps {
  stats: AggregatedStats | null;
  events: RoutingEvent[];
  traces: RequestTrace[];
  loading: boolean;
  onRefresh: () => void;
  onPeriodChange: (period: '1h' | '24h' | '7d' | '30d') => void;
}

type Tab = 'stats' | 'events' | 'traces';

export function MetricsPanel({
  stats,
  events,
  traces,
  loading,
  onRefresh,
  onPeriodChange,
}: MetricsPanelProps) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<Tab>('stats');
  const [period, setPeriod] = useState<'1h' | '24h' | '7d' | '30d'>('1h');

  const handlePeriodChange = (newPeriod: '1h' | '24h' | '7d' | '30d') => {
    setPeriod(newPeriod);
    onPeriodChange(newPeriod);
  };

  const formatTimestamp = (ts: string): string => {
    return new Date(ts).toLocaleString();
  };

  const getEventTypeLabel = (type: string): string => {
    switch (type) {
      case 'target_failed':
        return t('unified_routing.event_target_failed');
      case 'target_recovered':
        return t('unified_routing.event_target_recovered');
      case 'layer_fallback':
        return t('unified_routing.event_layer_fallback');
      case 'cooldown_started':
        return t('unified_routing.event_cooldown_started');
      case 'cooldown_ended':
        return t('unified_routing.event_cooldown_ended');
      default:
        return type;
    }
  };

  const getTraceStatusClass = (status: string): string => {
    switch (status) {
      case 'success':
        return 'status-success';
      case 'retry':
        return 'status-warning';
      case 'fallback':
        return 'status-warning';
      case 'failed':
        return 'status-danger';
      default:
        return '';
    }
  };

  return (
    <Card
      title={t('unified_routing.metrics')}
      extra={
        <Button variant="secondary" size="sm" onClick={onRefresh} disabled={loading}>
          {t('common.refresh')}
        </Button>
      }
    >
      <div className="metrics-panel">
        {/* Tabs */}
        <div className="metrics-tabs">
          <button
            className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => setActiveTab('stats')}
          >
            {t('unified_routing.statistics')}
          </button>
          <button
            className={`tab ${activeTab === 'events' ? 'active' : ''}`}
            onClick={() => setActiveTab('events')}
          >
            {t('unified_routing.events')} ({events.length})
          </button>
          <button
            className={`tab ${activeTab === 'traces' ? 'active' : ''}`}
            onClick={() => setActiveTab('traces')}
          >
            {t('unified_routing.traces')} ({traces.length})
          </button>
        </div>

        {/* Period Selector (for stats) */}
        {activeTab === 'stats' && (
          <div className="period-selector">
            {(['1h', '24h', '7d', '30d'] as const).map((p) => (
              <button
                key={p}
                className={`period-btn ${period === p ? 'active' : ''}`}
                onClick={() => handlePeriodChange(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {/* Content */}
        <div className="metrics-content">
          {loading ? (
            <div className="loading-container">
              <LoadingSpinner />
            </div>
          ) : (
            <>
              {/* Stats Tab */}
              {activeTab === 'stats' && stats && (
                <div className="stats-content">
                  <div className="stats-grid">
                    <div className="stat-item">
                      <div className="stat-value">{stats.total_requests}</div>
                      <div className="stat-label">{t('unified_routing.total_requests')}</div>
                    </div>
                    <div className="stat-item stat-success">
                      <div className="stat-value">{stats.successful_requests}</div>
                      <div className="stat-label">{t('unified_routing.successful')}</div>
                    </div>
                    <div className="stat-item stat-danger">
                      <div className="stat-value">{stats.failed_requests}</div>
                      <div className="stat-label">{t('unified_routing.failed')}</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{(stats.success_rate * 100).toFixed(1)}%</div>
                      <div className="stat-label">{t('unified_routing.success_rate')}</div>
                    </div>
                    <div className="stat-item">
                      <div className="stat-value">{stats.avg_latency_ms}ms</div>
                      <div className="stat-label">{t('unified_routing.avg_latency')}</div>
                    </div>
                  </div>

                  {/* Layer Distribution */}
                  {stats.layer_distribution && stats.layer_distribution.length > 0 && (
                    <div className="distribution-section">
                      <h4>{t('unified_routing.layer_distribution')}</h4>
                      <div className="distribution-bars">
                        {stats.layer_distribution.map((dist) => (
                          <div key={dist.level} className="distribution-bar">
                            <span className="bar-label">L{dist.level}</span>
                            <div className="bar-container">
                              <div
                                className="bar-fill"
                                style={{ width: `${dist.percentage}%` }}
                              />
                            </div>
                            <span className="bar-value">{dist.percentage.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Events Tab */}
              {activeTab === 'events' && (
                <div className="events-content">
                  {events.length === 0 ? (
                    <div className="empty-state">{t('unified_routing.no_events')}</div>
                  ) : (
                    <div className="events-list">
                      {events.map((event) => (
                        <div key={event.id} className={`event-item event-${event.type}`}>
                          <div className="event-header">
                            <span className="event-type">{getEventTypeLabel(event.type)}</span>
                            <span className="event-time">{formatTimestamp(event.timestamp)}</span>
                          </div>
                          <div className="event-details">
                            {event.route_id && (
                              <span className="detail-item">Route: {event.route_id}</span>
                            )}
                            {event.target_id && (
                              <span className="detail-item">Target: {event.target_id}</span>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Traces Tab */}
              {activeTab === 'traces' && (
                <div className="traces-content">
                  {traces.length === 0 ? (
                    <div className="empty-state">{t('unified_routing.no_traces')}</div>
                  ) : (
                    <div className="traces-list">
                      {traces.map((trace) => (
                        <div key={trace.trace_id} className="trace-item">
                          <div className="trace-header">
                            <span className={`trace-status ${getTraceStatusClass(trace.status)}`}>
                              {trace.status}
                            </span>
                            <span className="trace-route">{trace.route_name}</span>
                            <span className="trace-latency">{trace.total_latency_ms}ms</span>
                            <span className="trace-time">{formatTimestamp(trace.timestamp)}</span>
                          </div>
                          <div className="trace-attempts">
                            {trace.attempts.map((attempt, idx) => (
                              <span
                                key={idx}
                                className={`attempt-badge attempt-${attempt.status}`}
                                title={`L${attempt.layer}: ${attempt.model} - ${attempt.status}`}
                              >
                                L{attempt.layer}
                              </span>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </Card>
  );
}
