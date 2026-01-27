/**
 * Route Monitor Component
 * 路由监控面板 - 展示流量分布、请求追踪
 */

import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { Modal } from '@/components/ui/Modal';
import { unifiedRoutingApi } from '@/services/api';
import type {
  Route,
  AggregatedStats,
  RequestTrace,
  CredentialInfo,
} from '@/types';
import styles from './RouteMonitor.module.scss';

interface RouteMonitorProps {
  routes: Route[];
  credentials: CredentialInfo[];
  disabled?: boolean;
}

type Period = '1h' | '24h' | '7d' | '30d';

export function RouteMonitor({ routes, credentials, disabled }: RouteMonitorProps) {
  const { t } = useTranslation();
  const [selectedRouteId, setSelectedRouteId] = useState<string>('all');
  const [period, setPeriod] = useState<Period>('1h');
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AggregatedStats | null>(null);
  const [traces, setTraces] = useState<RequestTrace[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<RequestTrace | null>(null);

  // Load data - showLoading controls whether to display loading spinner
  // Set to false for background/auto refresh to avoid UI flicker
  const loadData = useCallback(async (showLoading = true) => {
    if (disabled) return;
    
    // Only show loading on initial load or manual refresh
    if (showLoading) {
      setLoading(true);
    }
    try {
      const routeFilter = selectedRouteId === 'all' ? undefined : selectedRouteId;
      
      const [statsResult, tracesResult] = await Promise.allSettled([
        routeFilter
          ? unifiedRoutingApi.getRouteStats(routeFilter, { period })
          : unifiedRoutingApi.getStats({ period }),
        unifiedRoutingApi.getTraces({ route_id: routeFilter, limit: 30 }),
      ]);

      if (statsResult.status === 'fulfilled') {
        // Handle both global stats and route stats response format
        const data = statsResult.value;
        setStats('stats' in data ? data.stats : data);
      }
      if (tracesResult.status === 'fulfilled') {
        setTraces(tracesResult.value.traces ?? []);
      }
    } catch (error) {
      console.error('Failed to load monitoring data:', error);
    } finally {
      if (showLoading) {
        setLoading(false);
      }
    }
  }, [disabled, selectedRouteId, period]);

  // Initial load
  useEffect(() => {
    loadData();
  }, [loadData]);

  // Auto-refresh every 1 second for live monitoring
  // Pass false to avoid showing loading spinner during auto-refresh
  useEffect(() => {
    if (disabled) return;
    
    const interval = setInterval(() => {
      loadData(false);  // Silent refresh - no loading spinner
    }, 1000);
    
    return () => clearInterval(interval);
  }, [disabled, loadData]);

  // Format timestamp to HH:MM:SS
  const formatTime = (ts: string): string => {
    const date = new Date(ts);
    return date.toLocaleTimeString('zh-CN', { hour12: false });
  };

  // Get credential label
  const getCredentialLabel = (credentialId: string): string => {
    const cred = credentials.find((c) => c.id === credentialId);
    if (cred) {
      return `${cred.provider}/${cred.label || cred.prefix || credentialId.slice(0, 8)}`;
    }
    return credentialId.slice(0, 12);
  };

  // Get success rate class
  const getSuccessRateClass = (rate: number): string => {
    if (rate >= 0.95) return styles.high;
    if (rate >= 0.8) return styles.medium;
    return styles.low;
  };

  // Build trace path - show the actual path taken
  // Format: route → L1/provider/email (red if failed, green if success)
  const buildTracePath = (trace: RequestTrace): React.ReactNode => {
    const parts: React.ReactNode[] = [];
    parts.push(<span key="route" className={styles.routeName}>{trace.route_name}</span>);

    if (trace.attempts && trace.attempts.length > 0) {
      trace.attempts.forEach((attempt, idx) => {
        const isSuccess = attempt.status === 'success';
        const targetLabel = `L${attempt.layer}/${getCredentialLabel(attempt.credential_id)}/${attempt.model}`;
        parts.push(
          <span key={`arrow-${idx}`} className={`${styles.traceArrow} ${isSuccess ? styles.arrowSuccess : styles.arrowFailed}`}>
            →
          </span>
        );
        parts.push(
          <span
            key={`target-${idx}`}
            className={`${styles.traceTarget} ${isSuccess ? styles.targetSuccess : styles.targetFailed}`}
          >
            {targetLabel}
          </span>
        );
      });
    }

    return parts;
  };

  // Get final status label
  const getFinalStatus = (trace: RequestTrace): { label: string; class: string } => {
    const isSuccess = trace.status === 'success' || trace.status === 'retry' || trace.status === 'fallback';
    return {
      label: isSuccess ? `✓ ${t('unified_routing.successful')}` : `✗ ${t('unified_routing.failed')}`,
      class: isSuccess ? styles.statusSuccess : styles.statusFailed,
    };
  };

  const periodLabels: Record<Period, string> = {
    '1h': t('unified_routing.period_1h'),
    '24h': t('unified_routing.period_24h'),
    '7d': t('unified_routing.period_7d'),
    '30d': t('unified_routing.period_30d'),
  };

  return (
    <Card
      title={t('unified_routing.route_monitor')}
      extra={
        <Button
          variant="secondary"
          size="sm"
          onClick={() => loadData(true)}
          disabled={disabled || loading}
          loading={loading}
        >
          {t('common.refresh')}
        </Button>
      }
    >
      <div className={styles.container}>
        {/* Header: Route Selector & Period */}
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <div className={styles.routeSelector}>
              <label>{t('unified_routing.monitor_route')}:</label>
              <select
                value={selectedRouteId}
                onChange={(e) => setSelectedRouteId(e.target.value)}
                disabled={disabled}
              >
                <option value="all">{t('unified_routing.monitor_all_routes')}</option>
                {routes.map((route) => (
                  <option key={route.id} value={route.id}>
                    {route.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className={styles.periodSelector}>
            {(['1h', '24h', '7d', '30d'] as Period[]).map((p) => (
              <button
                key={p}
                className={period === p ? styles.active : ''}
                onClick={() => setPeriod(p)}
                disabled={disabled}
              >
                {periodLabels[p]}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className={styles.loadingState}>
            <LoadingSpinner />
          </div>
        ) : (
          <>
            {/* Stats Overview */}
            {stats && (
              <div className={styles.statsOverview}>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.total_requests}</div>
                  <div className={styles.statLabel}>{t('unified_routing.total_requests')}</div>
                </div>
                <div className={`${styles.statCard} ${styles.success}`}>
                  <div className={styles.statValue}>{stats.successful_requests}</div>
                  <div className={styles.statLabel}>{t('unified_routing.successful')}</div>
                </div>
                <div className={`${styles.statCard} ${styles.danger}`}>
                  <div className={styles.statValue}>{stats.failed_requests}</div>
                  <div className={styles.statLabel}>{t('unified_routing.failed')}</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>
                    {(stats.success_rate * 100).toFixed(1)}%
                  </div>
                  <div className={styles.statLabel}>{t('unified_routing.success_rate')}</div>
                </div>
                <div className={styles.statCard}>
                  <div className={styles.statValue}>{stats.avg_latency_ms}ms</div>
                  <div className={styles.statLabel}>{t('unified_routing.avg_latency')}</div>
                </div>
              </div>
            )}

            {/* Traffic Distribution */}
            {stats?.layer_distribution && stats.layer_distribution.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <span className={styles.icon}>📈</span>
                  {t('unified_routing.traffic_distribution')}
                </div>
                <div className={styles.trafficSection}>
                  {stats.layer_distribution.map((layer) => (
                    <div key={layer.level} className={styles.layerBlock}>
                      <div className={styles.layerHeader}>
                        <span className={styles.layerName}>Layer {layer.level}</span>
                        <div className={styles.layerBar}>
                          <div
                            className={`${styles.layerBarFill} ${
                              layer.level === 1
                                ? styles.layer1
                                : layer.level === 2
                                  ? styles.layer2
                                  : styles.layer3
                            }`}
                            style={{ width: `${layer.percentage}%` }}
                          />
                        </div>
                        <span className={styles.layerPercent}>
                          {layer.percentage.toFixed(0)}%
                        </span>
                      </div>

                      {/* Target breakdown within layer */}
                      {stats.target_distribution && (
                        <div className={styles.layerTargets}>
                          {stats.target_distribution
                            .filter((t) => t.target_id.includes(`L${layer.level}`))
                            .slice(0, 5)
                            .map((target) => (
                              <div key={target.target_id} className={styles.targetRow}>
                                <span className={styles.targetConnector}>├─</span>
                                <span className={styles.targetName}>
                                  {getCredentialLabel(target.credential_id)}
                                </span>
                                <div className={styles.targetBar}>
                                  <div
                                    className={styles.targetBarFill}
                                    style={{
                                      width: `${Math.min(
                                        (target.requests / stats.total_requests) * 100 * 3,
                                        100
                                      )}%`,
                                    }}
                                  />
                                </div>
                                <span className={styles.targetPercent}>
                                  {((target.requests / stats.total_requests) * 100).toFixed(0)}%
                                </span>
                                <span
                                  className={`${styles.targetSuccessRate} ${getSuccessRateClass(
                                    target.success_rate
                                  )}`}
                                >
                                  成功率 {(target.success_rate * 100).toFixed(0)}%
                                </span>
                              </div>
                            ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Attempts Distribution - how many retries needed */}
            {stats?.attempts_distribution && stats.attempts_distribution.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionTitle}>
                  <span className={styles.icon}>🎯</span>
                  {t('unified_routing.attempts_distribution')}
                </div>
                <div className={styles.attemptsSection}>
                  {stats.attempts_distribution.map((item) => (
                    <div key={item.attempts} className={styles.attemptRow}>
                      <span className={styles.attemptLabel}>
                        {item.attempts === 1 
                          ? t('unified_routing.first_attempt_success')
                          : t('unified_routing.nth_attempt_success', { n: item.attempts })}
                      </span>
                      <div className={styles.attemptBar}>
                        <div
                          className={`${styles.attemptBarFill} ${
                            item.attempts === 1 ? styles.attempt1 : 
                            item.attempts === 2 ? styles.attempt2 : styles.attempt3
                          }`}
                          style={{ width: `${Math.min(item.percentage, 100)}%` }}
                        />
                      </div>
                      <span className={styles.attemptStats}>
                        {item.count} ({item.percentage.toFixed(1)}%)
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.divider} />

            {/* Request Traces */}
            <div className={styles.section}>
              <div className={styles.sectionTitle}>
                <span className={styles.icon}>📊</span>
                {t('unified_routing.request_traces')}
              </div>
              <div className={styles.tracesSection}>
                {traces.length === 0 ? (
                  <div className={styles.emptyState}>{t('unified_routing.no_traces')}</div>
                ) : (
                  <div className={styles.tracesList}>
                    {traces.slice(0, 20).map((trace) => {
                      const statusInfo = getFinalStatus(trace);
                      return (
                        <div 
                          key={trace.trace_id} 
                          className={styles.traceItem}
                          onClick={() => setSelectedTrace(trace)}
                        >
                          <span className={styles.traceTime}>{formatTime(trace.timestamp)}</span>
                          <span className={styles.traceId}>
                            trace-{trace.trace_id.slice(0, 2)}
                          </span>
                          <span className={styles.tracePath}>{buildTracePath(trace)}</span>
                          <span className={`${styles.traceStatus} ${statusInfo.class}`}>
                            {statusInfo.label}
                          </span>
                          <span className={styles.traceLatency}>
                            {(trace.total_latency_ms / 1000).toFixed(1)}s
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
      
      {/* Trace Detail Modal */}
      <Modal
        open={!!selectedTrace}
        onClose={() => setSelectedTrace(null)}
        title={t('unified_routing.trace_details')}
        width={600}
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                if (selectedTrace) {
                  const text = JSON.stringify(selectedTrace, null, 2);
                  navigator.clipboard.writeText(text);
                }
              }}
            >
              {t('common.copy')} JSON
            </Button>
            <Button onClick={() => setSelectedTrace(null)}>
              {t('common.close')}
            </Button>
          </>
        }
      >
        {selectedTrace && (
          <>
            {/* Basic Info */}
            <div className={styles.traceInfo}>
              <div className={styles.traceInfoRow}>
                <span className={styles.traceInfoLabel}>Trace ID:</span>
                <span className={styles.traceInfoValue}>{selectedTrace.trace_id}</span>
              </div>
              <div className={styles.traceInfoRow}>
                <span className={styles.traceInfoLabel}>{t('unified_routing.route')}:</span>
                <span className={styles.traceInfoValue}>{selectedTrace.route_name}</span>
              </div>
              <div className={styles.traceInfoRow}>
                <span className={styles.traceInfoLabel}>{t('unified_routing.time')}:</span>
                <span className={styles.traceInfoValue}>
                  {new Date(selectedTrace.timestamp).toLocaleString('zh-CN')}
                </span>
              </div>
              <div className={styles.traceInfoRow}>
                <span className={styles.traceInfoLabel}>{t('unified_routing.total_latency')}:</span>
                <span className={styles.traceInfoValue}>{selectedTrace.total_latency_ms}ms</span>
              </div>
              <div className={styles.traceInfoRow}>
                <span className={styles.traceInfoLabel}>{t('unified_routing.status')}:</span>
                <span className={`${styles.traceInfoValue} ${
                  selectedTrace.status === 'success' || selectedTrace.status === 'retry' || selectedTrace.status === 'fallback' 
                    ? styles.successText 
                    : styles.failedText
                }`}>
                  {selectedTrace.status === 'success' || selectedTrace.status === 'retry' || selectedTrace.status === 'fallback' 
                    ? t('unified_routing.successful') 
                    : t('unified_routing.failed')}
                </span>
              </div>
            </div>
            
            {/* Request Path */}
            <div className={styles.tracePathSection}>
              <div className={styles.tracePathTitle}>{t('unified_routing.request_path')}:</div>
              <div className={styles.tracePathFlow}>
                {selectedTrace.attempts && selectedTrace.attempts.length > 0 ? (
                  selectedTrace.attempts.map((attempt, idx) => {
                    const isSuccess = attempt.status === 'success';
                    return (
                      <div 
                        key={idx} 
                        className={`${styles.attemptCard} ${isSuccess ? styles.attemptSuccess : styles.attemptFailed}`}
                      >
                        <div className={styles.attemptHeader}>
                          <span className={styles.attemptNumber}>#{idx + 1}</span>
                          <span className={`${styles.attemptStatus} ${isSuccess ? styles.successBadge : styles.failedBadge}`}>
                            {isSuccess ? '✓' : '✕'}
                          </span>
                        </div>
                        <div className={styles.attemptDetail}>
                          <div className={styles.attemptRow}>
                            <span className={styles.attemptLabel}>Layer:</span>
                            <span className={styles.attemptValue}>L{attempt.layer}</span>
                          </div>
                          <div className={styles.attemptRow}>
                            <span className={styles.attemptLabel}>{t('unified_routing.credential')}:</span>
                            <span className={styles.attemptValue}>{getCredentialLabel(attempt.credential_id)}</span>
                          </div>
                          <div className={styles.attemptRow}>
                            <span className={styles.attemptLabel}>{t('unified_routing.model')}:</span>
                            <span className={styles.attemptValue}>{attempt.model}</span>
                          </div>
                          <div className={styles.attemptRow}>
                            <span className={styles.attemptLabel}>{t('unified_routing.latency')}:</span>
                            <span className={styles.attemptValue}>{attempt.latency_ms}ms</span>
                          </div>
                          {attempt.error && (
                            <div className={styles.attemptError}>
                              <span className={styles.attemptLabel}>{t('unified_routing.error')}:</span>
                              <pre className={styles.errorText}>{attempt.error}</pre>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className={styles.noAttempts}>{t('unified_routing.no_attempts')}</div>
                )}
              </div>
            </div>
          </>
        )}
      </Modal>
    </Card>
  );
}
