/**
 * Unified Routing Types
 */

// ================== Configuration Types ==================

export interface UnifiedRoutingSettings {
  enabled: boolean;
  hide_original_models: boolean;
}

export interface HealthCheckConfig {
  default_cooldown_seconds: number;
  check_interval_seconds: number;
  check_timeout_seconds: number;
  max_consecutive_failures: number;
}

export interface Route {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface Pipeline {
  route_id: string;
  layers: Layer[];
}

export interface Layer {
  level: number;
  strategy: LoadStrategy;
  cooldown_seconds: number;
  targets: Target[];
}

export interface Target {
  id: string;
  credential_id: string;
  model: string;
  weight?: number;
  enabled: boolean;
}

export type LoadStrategy =
  | 'round-robin'
  | 'weighted-round-robin'
  | 'least-connections'
  | 'random'
  | 'first-available';

// ================== Runtime State Types ==================

export type TargetStatus = 'healthy' | 'cooling';

export interface TargetState {
  target_id: string;
  status: TargetStatus;
  consecutive_failures: number;
  cooldown_ends_at?: string;
  cooldown_remaining_seconds?: number;
  last_success_at?: string;
  last_failure_at?: string;
  last_failure_reason?: string;
  active_connections: number;
  total_requests: number;
  successful_requests: number;
}

export interface LayerState {
  level: number;
  status: 'active' | 'standby' | 'exhausted';
  targets: TargetState[];
}

export interface RouteState {
  route_id: string;
  route_name: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  active_layer: number;
  layers: LayerState[];
}

export interface StateOverview {
  unified_routing_enabled: boolean;
  hide_original_models: boolean;
  total_routes: number;
  healthy_routes: number;
  degraded_routes: number;
  unhealthy_routes: number;
  routes: RouteState[];
}

// ================== Monitoring Types ==================

export type TraceStatus = 'success' | 'retry' | 'fallback' | 'failed';
export type AttemptStatus = 'success' | 'failed' | 'skipped';

export interface AttemptTrace {
  attempt: number;
  layer: number;
  target_id: string;
  credential_id: string;
  model: string;
  status: AttemptStatus;
  latency_ms?: number;
  error?: string;
}

export interface RequestTrace {
  trace_id: string;
  route_id: string;
  route_name: string;
  timestamp: string;
  status: TraceStatus;
  total_latency_ms: number;
  attempts: AttemptTrace[];
}

export type RoutingEventType =
  | 'target_failed'
  | 'target_recovered'
  | 'layer_fallback'
  | 'cooldown_started'
  | 'cooldown_ended';

export interface RoutingEvent {
  id: string;
  type: RoutingEventType;
  timestamp: string;
  route_id: string;
  target_id?: string;
  details?: Record<string, unknown>;
}

// ================== Statistics Types ==================

export interface LayerDistribution {
  level: number;
  requests: number;
  percentage: number;
}

export interface TargetDistribution {
  target_id: string;
  credential_id: string;
  requests: number;
  success_rate: number;
  avg_latency_ms: number;
}

export interface AttemptsDistribution {
  attempts: number;
  count: number;
  percentage: number;
}

export interface AggregatedStats {
  period: string;
  total_requests: number;
  successful_requests: number;
  failed_requests: number;
  success_rate: number;
  avg_latency_ms: number;
  p95_latency_ms?: number;
  p99_latency_ms?: number;
  layer_distribution?: LayerDistribution[];
  target_distribution?: TargetDistribution[];
  attempts_distribution?: AttemptsDistribution[];
}

// ================== Credential Types ==================

export interface ModelInfo {
  id: string;
  name: string;
  available: boolean;
}

export interface CredentialInfo {
  id: string;
  provider: string;
  type: 'oauth' | 'api-key';
  label?: string;
  prefix?: string;
  base_url?: string;
  api_key?: string;
  status: string;
  models: ModelInfo[];
}

// ================== Health Check Types ==================

export interface HealthResult {
  target_id: string;
  credential_id: string;
  model: string;
  status: 'healthy' | 'unhealthy';
  latency_ms?: number;
  message?: string;
  checked_at: string;
}

// ================== Export/Import Types ==================

export interface ExportData {
  version: string;
  exported_at: string;
  config: {
    settings: UnifiedRoutingSettings;
    health_check: HealthCheckConfig;
    routes: Array<{
      route: Route;
      pipeline: Pipeline;
    }>;
  };
}

// ================== Filter Types ==================

export interface StatsFilter {
  period?: '1h' | '24h' | '7d' | '30d';
  granularity?: 'minute' | 'hour' | 'day';
}

export interface EventFilter {
  type?: 'failure' | 'recovery' | 'fallback' | 'all';
  route_id?: string;
  limit?: number;
}

export interface TraceFilter {
  route_id?: string;
  status?: TraceStatus;
  limit?: number;
}

// ================== Validation Types ==================

export interface ValidationError {
  field: string;
  message: string;
}

// ================== API Response Types ==================

export interface RouteListResponse {
  total: number;
  routes: Array<Route & {
    pipeline_summary: {
      total_layers: number;
      total_targets: number;
    };
  }>;
}

export interface RouteDetailResponse {
  route: Route;
  pipeline: Pipeline;
}

export interface EventsResponse {
  total: number;
  events: RoutingEvent[];
}

export interface TracesResponse {
  total: number;
  traces: RequestTrace[];
}

export interface HealthCheckResponse {
  checked_at: string;
  results: HealthResult[];
}

export interface HealthHistoryResponse {
  total: number;
  history: HealthResult[];
}

export interface CredentialsResponse {
  total: number;
  credentials: CredentialInfo[];
}

export interface ValidateResponse {
  valid: boolean;
  errors: ValidationError[];
}
