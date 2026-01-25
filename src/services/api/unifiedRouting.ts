/**
 * Unified Routing API Service
 */

const DEBUG = true;
const log = (msg: string, ...args: any[]) => {
  if (DEBUG) console.log(`[UnifiedRoutingAPI] ${msg}`, ...args);
};

import { apiClient } from './client';
import type {
  UnifiedRoutingSettings,
  HealthCheckConfig,
  Route,
  Pipeline,
  StateOverview,
  RouteState,
  TargetState,
  AggregatedStats,
  RouteListResponse,
  RouteDetailResponse,
  EventsResponse,
  TracesResponse,
  RequestTrace,
  HealthCheckResponse,
  HealthHistoryResponse,
  CredentialsResponse,
  CredentialInfo,
  ExportData,
  ValidateResponse,
  StatsFilter,
  EventFilter,
  TraceFilter,
} from '@/types';

const BASE_PATH = '/unified-routing';

// ================== Config: Settings ==================

export async function getSettings(): Promise<UnifiedRoutingSettings> {
  log('getSettings: requesting', `${BASE_PATH}/config/settings`);
  try {
    const result = await apiClient.get(`${BASE_PATH}/config/settings`);
    log('getSettings: success', result);
    return result;
  } catch (error: any) {
    log('getSettings: error', error?.status, error?.message, error);
    throw error;
  }
}

export async function updateSettings(settings: UnifiedRoutingSettings): Promise<UnifiedRoutingSettings> {
  return apiClient.put(`${BASE_PATH}/config/settings`, settings);
}

export async function getHealthCheckConfig(): Promise<HealthCheckConfig> {
  return apiClient.get(`${BASE_PATH}/config/health-check`);
}

export async function updateHealthCheckConfig(config: HealthCheckConfig): Promise<HealthCheckConfig> {
  return apiClient.put(`${BASE_PATH}/config/health-check`, config);
}

// ================== Config: Routes ==================

export async function listRoutes(): Promise<RouteListResponse> {
  log('listRoutes: requesting', `${BASE_PATH}/config/routes`);
  try {
    const result = await apiClient.get(`${BASE_PATH}/config/routes`);
    log('listRoutes: success', result);
    return result;
  } catch (error: any) {
    log('listRoutes: error', error?.status, error?.message, error);
    throw error;
  }
}

export async function getRoute(routeId: string): Promise<RouteDetailResponse> {
  return apiClient.get(`${BASE_PATH}/config/routes/${routeId}`);
}

export async function createRoute(data: {
  name: string;
  description?: string;
  enabled?: boolean;
  pipeline?: Pipeline;
}): Promise<{ id: string; name: string; message: string }> {
  return apiClient.post(`${BASE_PATH}/config/routes`, data);
}

export async function updateRoute(
  routeId: string,
  data: {
    name: string;
    description?: string;
    enabled?: boolean;
    pipeline?: Pipeline;
  }
): Promise<{ message: string }> {
  return apiClient.put(`${BASE_PATH}/config/routes/${routeId}`, data);
}

export async function patchRoute(
  routeId: string,
  data: Partial<{
    name: string;
    description: string;
    enabled: boolean;
  }>
): Promise<{ message: string }> {
  return apiClient.patch(`${BASE_PATH}/config/routes/${routeId}`, data);
}

export async function deleteRoute(routeId: string): Promise<{ message: string }> {
  return apiClient.delete(`${BASE_PATH}/config/routes/${routeId}`);
}

// ================== Config: Pipeline ==================

export async function getPipeline(routeId: string): Promise<Pipeline> {
  return apiClient.get(`${BASE_PATH}/config/routes/${routeId}/pipeline`);
}

export async function updatePipeline(routeId: string, pipeline: Pipeline): Promise<{ message: string }> {
  return apiClient.put(`${BASE_PATH}/config/routes/${routeId}/pipeline`, pipeline);
}

// ================== Config: Export/Import ==================

export async function exportConfig(): Promise<ExportData> {
  return apiClient.get(`${BASE_PATH}/config/export`);
}

export async function importConfig(data: ExportData, merge: boolean = false): Promise<{ message: string }> {
  return apiClient.post(`${BASE_PATH}/config/import?merge=${merge}`, data);
}

export async function validateConfig(data: {
  route?: Route;
  pipeline?: Pipeline;
}): Promise<ValidateResponse> {
  return apiClient.post(`${BASE_PATH}/config/validate`, data);
}

// ================== State ==================

export async function getStateOverview(): Promise<StateOverview> {
  log('getStateOverview: requesting', `${BASE_PATH}/state/overview`);
  try {
    const result = await apiClient.get(`${BASE_PATH}/state/overview`);
    log('getStateOverview: success', result);
    return result;
  } catch (error: any) {
    log('getStateOverview: error', error?.status, error?.message, error);
    throw error;
  }
}

export async function getRouteStatus(routeId: string): Promise<RouteState> {
  return apiClient.get(`${BASE_PATH}/state/routes/${routeId}`);
}

export async function getTargetStatus(targetId: string): Promise<TargetState> {
  return apiClient.get(`${BASE_PATH}/state/targets/${targetId}`);
}

export async function resetTarget(targetId: string): Promise<{
  message: string;
  target_id: string;
  new_status: string;
}> {
  return apiClient.post(`${BASE_PATH}/state/targets/${targetId}/reset`);
}

export async function forceCooldown(
  targetId: string,
  durationSeconds?: number
): Promise<{
  message: string;
  target_id: string;
  duration_seconds: number;
}> {
  return apiClient.post(`${BASE_PATH}/state/targets/${targetId}/force-cooldown`, {
    duration_seconds: durationSeconds,
  });
}

// ================== Health ==================

export async function triggerHealthCheck(routeId?: string, targetId?: string): Promise<HealthCheckResponse> {
  let url = `${BASE_PATH}/health/check`;
  if (routeId) {
    url = `${BASE_PATH}/health/check/routes/${routeId}`;
  }
  if (targetId) {
    url += `?target_id=${targetId}`;
  }
  return apiClient.post(url);
}

// Simulate route types
export interface SimulateTargetResult {
  target_id: string;
  credential_id: string;
  model: string;
  status: 'success' | 'failed' | 'skipped' | 'available';
  message?: string;
  latency_ms?: number;
}

export interface SimulateLayerResult {
  layer: number;
  targets: SimulateTargetResult[];
}

export interface SimulateRouteResponse {
  route_id: string;
  route_name: string;
  success: boolean;
  final_target?: SimulateTargetResult;
  attempts: SimulateLayerResult[];
  total_time_ms: number;
}

export async function simulateRoute(routeId: string, dryRun: boolean = false): Promise<SimulateRouteResponse> {
  return apiClient.post(`${BASE_PATH}/simulate/routes/${routeId}`, { dry_run: dryRun });
}

export async function getHealthSettings(): Promise<HealthCheckConfig> {
  return apiClient.get(`${BASE_PATH}/health/settings`);
}

export async function updateHealthSettings(settings: HealthCheckConfig): Promise<HealthCheckConfig> {
  return apiClient.put(`${BASE_PATH}/health/settings`, settings);
}

export async function getHealthHistory(filter?: {
  target_id?: string;
  status?: string;
  limit?: number;
}): Promise<HealthHistoryResponse> {
  const params = new URLSearchParams();
  if (filter?.target_id) params.append('target_id', filter.target_id);
  if (filter?.status) params.append('status', filter.status);
  if (filter?.limit) params.append('limit', String(filter.limit));
  
  const query = params.toString();
  return apiClient.get(`${BASE_PATH}/health/history${query ? `?${query}` : ''}`);
}

// ================== Metrics ==================

export async function getStats(filter?: StatsFilter): Promise<AggregatedStats> {
  const params = new URLSearchParams();
  if (filter?.period) params.append('period', filter.period);
  if (filter?.granularity) params.append('granularity', filter.granularity);
  
  const query = params.toString();
  return apiClient.get(`${BASE_PATH}/metrics/stats${query ? `?${query}` : ''}`);
}

export async function getRouteStats(
  routeId: string,
  filter?: StatsFilter
): Promise<{ route_id: string; stats: AggregatedStats }> {
  const params = new URLSearchParams();
  if (filter?.period) params.append('period', filter.period);
  if (filter?.granularity) params.append('granularity', filter.granularity);
  
  const query = params.toString();
  return apiClient.get(`${BASE_PATH}/metrics/stats/routes/${routeId}${query ? `?${query}` : ''}`);
}

export async function getEvents(filter?: EventFilter): Promise<EventsResponse> {
  const params = new URLSearchParams();
  if (filter?.type) params.append('type', filter.type);
  if (filter?.route_id) params.append('route_id', filter.route_id);
  if (filter?.limit) params.append('limit', String(filter.limit));
  
  const query = params.toString();
  return apiClient.get(`${BASE_PATH}/metrics/events${query ? `?${query}` : ''}`);
}

export async function getTraces(filter?: TraceFilter): Promise<TracesResponse> {
  const params = new URLSearchParams();
  if (filter?.route_id) params.append('route_id', filter.route_id);
  if (filter?.status) params.append('status', filter.status);
  if (filter?.limit) params.append('limit', String(filter.limit));
  
  const query = params.toString();
  return apiClient.get(`${BASE_PATH}/metrics/traces${query ? `?${query}` : ''}`);
}

export async function getTrace(traceId: string): Promise<RequestTrace> {
  return apiClient.get(`${BASE_PATH}/metrics/traces/${traceId}`);
}

// ================== Credentials ==================

export async function listCredentials(filter?: {
  type?: 'oauth' | 'api-key' | 'all';
  provider?: string;
}): Promise<CredentialsResponse> {
  const params = new URLSearchParams();
  if (filter?.type) params.append('type', filter.type);
  if (filter?.provider) params.append('provider', filter.provider);
  
  const query = params.toString();
  const url = `${BASE_PATH}/credentials${query ? `?${query}` : ''}`;
  log('listCredentials: requesting', url);
  try {
    const result = await apiClient.get(url);
    log('listCredentials: success', result);
    return result;
  } catch (error: any) {
    log('listCredentials: error', error?.status, error?.message, error);
    throw error;
  }
}

export async function getCredential(credentialId: string): Promise<CredentialInfo> {
  return apiClient.get(`${BASE_PATH}/credentials/${credentialId}`);
}

// ================== Export all as unifiedRoutingApi ==================

export const unifiedRoutingApi = {
  // Settings
  getSettings,
  updateSettings,
  getHealthCheckConfig,
  updateHealthCheckConfig,
  
  // Routes
  listRoutes,
  getRoute,
  createRoute,
  updateRoute,
  patchRoute,
  deleteRoute,
  
  // Pipeline
  getPipeline,
  updatePipeline,
  
  // Export/Import
  exportConfig,
  importConfig,
  validateConfig,
  
  // State
  getStateOverview,
  getRouteStatus,
  getTargetStatus,
  resetTarget,
  forceCooldown,
  
  // Health
  triggerHealthCheck,
  getHealthSettings,
  updateHealthSettings,
  getHealthHistory,
  
  // Simulate
  simulateRoute,
  
  // Metrics
  getStats,
  getRouteStats,
  getEvents,
  getTraces,
  getTrace,
  
  // Credentials
  listCredentials,
  getCredential,
};
