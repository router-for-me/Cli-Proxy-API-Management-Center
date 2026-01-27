/**
 * Unified Routing State Management
 */

import { create } from 'zustand';
import { unifiedRoutingApi } from '@/services/api';
import type {
  UnifiedRoutingSettings,
  HealthCheckConfig,
  Route,
  Pipeline,
  StateOverview,
  RouteState,
  AggregatedStats,
  RoutingEvent,
  RequestTrace,
  CredentialInfo,
  HealthResult,
  RouteListResponse,
} from '@/types';

interface UnifiedRoutingState {
  // Config
  settings: UnifiedRoutingSettings | null;
  healthCheckConfig: HealthCheckConfig | null;
  routes: RouteListResponse['routes'];
  selectedRouteId: string | null;
  selectedRoute: Route | null;
  currentPipeline: Pipeline | null;
  
  // State
  overview: StateOverview | null;
  selectedRouteState: RouteState | null;
  
  // Metrics
  stats: AggregatedStats | null;
  events: RoutingEvent[];
  traces: RequestTrace[];
  
  // Credentials
  credentials: CredentialInfo[];
  
  // Health
  healthHistory: HealthResult[];
  
  // UI State
  loading: boolean;
  saving: boolean;
  error: string | null;
  
  // Actions - Config
  fetchSettings: () => Promise<void>;
  updateSettings: (settings: UnifiedRoutingSettings) => Promise<void>;
  fetchHealthCheckConfig: () => Promise<void>;
  updateHealthCheckConfig: (config: HealthCheckConfig) => Promise<void>;
  
  // Actions - Routes
  fetchRoutes: () => Promise<void>;
  selectRoute: (routeId: string | null) => Promise<void>;
  createRoute: (data: { name: string; description?: string; enabled?: boolean; pipeline?: Pipeline }) => Promise<string>;
  updateRoute: (routeId: string, data: { name: string; description?: string; enabled?: boolean; pipeline?: Pipeline }) => Promise<void>;
  toggleRoute: (routeId: string, enabled: boolean) => Promise<void>;
  deleteRoute: (routeId: string) => Promise<void>;
  
  // Actions - Pipeline
  fetchPipeline: (routeId: string) => Promise<void>;
  updatePipeline: (routeId: string, pipeline: Pipeline) => Promise<void>;
  
  // Actions - State
  fetchOverview: () => Promise<void>;
  fetchRouteState: (routeId: string) => Promise<void>;
  resetTarget: (targetId: string) => Promise<void>;
  forceCooldown: (targetId: string, durationSeconds?: number) => Promise<void>;
  
  // Actions - Health
  triggerHealthCheck: (routeId?: string) => Promise<HealthResult[]>;
  fetchHealthHistory: () => Promise<void>;
  
  // Actions - Metrics
  fetchStats: (period?: '1h' | '24h' | '7d' | '30d') => Promise<void>;
  fetchEvents: (limit?: number) => Promise<void>;
  fetchTraces: (limit?: number) => Promise<void>;
  
  // Actions - Credentials
  fetchCredentials: () => Promise<void>;
  
  // Actions - Reset
  reset: () => void;
}

export const useUnifiedRoutingStore = create<UnifiedRoutingState>((set, get) => ({
  // Initial State
  settings: null,
  healthCheckConfig: null,
  routes: [],
  selectedRouteId: null,
  selectedRoute: null,
  currentPipeline: null,
  overview: null,
  selectedRouteState: null,
  stats: null,
  events: [],
  traces: [],
  credentials: [],
  healthHistory: [],
  loading: false,
  saving: false,
  error: null,
  
  // Actions - Config
  fetchSettings: async () => {
    try {
      const settings = await unifiedRoutingApi.getSettings();
      set({ settings });
    } catch (error: any) {
      // Don't throw for 404 (endpoint not available) - module may not be loaded
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      console.error('Failed to fetch settings:', error);
      throw error;
    }
  },
  
  updateSettings: async (settings) => {
    set({ saving: true });
    try {
      const updated = await unifiedRoutingApi.updateSettings(settings);
      set({ settings: updated, saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  
  fetchHealthCheckConfig: async () => {
    try {
      const config = await unifiedRoutingApi.getHealthCheckConfig();
      set({ healthCheckConfig: config });
    } catch (error: any) {
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      console.error('Failed to fetch health check config:', error);
      throw error;
    }
  },
  
  updateHealthCheckConfig: async (config) => {
    set({ saving: true });
    try {
      const updated = await unifiedRoutingApi.updateHealthCheckConfig(config);
      set({ healthCheckConfig: updated, saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  
  // Actions - Routes
  fetchRoutes: async () => {
    set({ loading: true, error: null });
    try {
      const response = await unifiedRoutingApi.listRoutes();
      set({ routes: response.routes, loading: false });
    } catch (error: any) {
      set({ loading: false });
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      set({ error: String(error) });
      throw error;
    }
  },
  
  selectRoute: async (routeId) => {
    if (!routeId) {
      set({ selectedRouteId: null, selectedRoute: null, currentPipeline: null, selectedRouteState: null });
      return;
    }
    
    set({ selectedRouteId: routeId, loading: true });
    try {
      const [detail, stateResult] = await Promise.allSettled([
        unifiedRoutingApi.getRoute(routeId),
        unifiedRoutingApi.getRouteStatus(routeId),
      ]);
      
      if (detail.status === 'fulfilled') {
        set({
          selectedRoute: detail.value.route,
          currentPipeline: detail.value.pipeline,
        });
      }
      
      if (stateResult.status === 'fulfilled') {
        set({ selectedRouteState: stateResult.value });
      }
      
      set({ loading: false });
    } catch (error) {
      set({ loading: false, error: String(error) });
      throw error;
    }
  },
  
  createRoute: async (data) => {
    set({ saving: true });
    try {
      const result = await unifiedRoutingApi.createRoute(data);
      await get().fetchRoutes();
      set({ saving: false });
      return result.id;
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  
  updateRoute: async (routeId, data) => {
    set({ saving: true });
    try {
      await unifiedRoutingApi.updateRoute(routeId, data);
      await get().fetchRoutes();
      
      // Refresh selected route if it's the one being updated
      if (get().selectedRouteId === routeId) {
        await get().selectRoute(routeId);
      }
      
      set({ saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  
  toggleRoute: async (routeId, enabled) => {
    set({ saving: true });
    try {
      await unifiedRoutingApi.patchRoute(routeId, { enabled });
      await get().fetchRoutes();
      set({ saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  
  deleteRoute: async (routeId) => {
    set({ saving: true });
    try {
      await unifiedRoutingApi.deleteRoute(routeId);
      
      // Clear selection if deleted route was selected
      if (get().selectedRouteId === routeId) {
        set({ selectedRouteId: null, selectedRoute: null, currentPipeline: null, selectedRouteState: null });
      }
      
      await get().fetchRoutes();
      set({ saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  
  // Actions - Pipeline
  fetchPipeline: async (routeId) => {
    try {
      const pipeline = await unifiedRoutingApi.getPipeline(routeId);
      set({ currentPipeline: pipeline });
    } catch (error) {
      console.error('Failed to fetch pipeline:', error);
      throw error;
    }
  },
  
  updatePipeline: async (routeId, pipeline) => {
    set({ saving: true });
    try {
      await unifiedRoutingApi.updatePipeline(routeId, pipeline);
      set({ currentPipeline: pipeline, saving: false });
    } catch (error) {
      set({ saving: false });
      throw error;
    }
  },
  
  // Actions - State
  fetchOverview: async () => {
    try {
      const overview = await unifiedRoutingApi.getStateOverview();
      set({ overview });
    } catch (error: any) {
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      console.error('Failed to fetch overview:', error);
      throw error;
    }
  },
  
  fetchRouteState: async (routeId) => {
    try {
      const state = await unifiedRoutingApi.getRouteStatus(routeId);
      set({ selectedRouteState: state });
    } catch (error) {
      console.error('Failed to fetch route state:', error);
      throw error;
    }
  },
  
  resetTarget: async (targetId) => {
    try {
      await unifiedRoutingApi.resetTarget(targetId);
      // Refresh state
      const { selectedRouteId } = get();
      if (selectedRouteId) {
        await get().fetchRouteState(selectedRouteId);
      }
      await get().fetchOverview();
    } catch (error) {
      console.error('Failed to reset target:', error);
      throw error;
    }
  },
  
  forceCooldown: async (targetId, durationSeconds) => {
    try {
      await unifiedRoutingApi.forceCooldown(targetId, durationSeconds);
      // Refresh state
      const { selectedRouteId } = get();
      if (selectedRouteId) {
        await get().fetchRouteState(selectedRouteId);
      }
      await get().fetchOverview();
    } catch (error) {
      console.error('Failed to force cooldown:', error);
      throw error;
    }
  },
  
  // Actions - Health
  triggerHealthCheck: async (routeId) => {
    try {
      const result = await unifiedRoutingApi.triggerHealthCheck(routeId);
      // Refresh state after health check
      await get().fetchOverview();
      if (get().selectedRouteId) {
        await get().fetchRouteState(get().selectedRouteId!);
      }
      return result.results;
    } catch (error) {
      console.error('Failed to trigger health check:', error);
      throw error;
    }
  },
  
  fetchHealthHistory: async () => {
    try {
      const response = await unifiedRoutingApi.getHealthHistory({ limit: 100 });
      set({ healthHistory: response.history });
    } catch (error) {
      console.error('Failed to fetch health history:', error);
      throw error;
    }
  },
  
  // Actions - Metrics
  fetchStats: async (period = '1h') => {
    try {
      const stats = await unifiedRoutingApi.getStats({ period });
      set({ stats });
    } catch (error: any) {
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      console.error('Failed to fetch stats:', error);
      throw error;
    }
  },
  
  fetchEvents: async (limit = 100) => {
    try {
      const response = await unifiedRoutingApi.getEvents({ limit });
      set({ events: response.events });
    } catch (error: any) {
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      console.error('Failed to fetch events:', error);
      throw error;
    }
  },
  
  fetchTraces: async (limit = 50) => {
    try {
      const response = await unifiedRoutingApi.getTraces({ limit });
      set({ traces: response.traces });
    } catch (error: any) {
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      console.error('Failed to fetch traces:', error);
      throw error;
    }
  },
  
  // Actions - Credentials
  fetchCredentials: async () => {
    try {
      const response = await unifiedRoutingApi.listCredentials();
      set({ credentials: response.credentials });
    } catch (error: any) {
      if (error?.status === 404) {
        console.warn('Unified routing API not available (404)');
        return;
      }
      console.error('Failed to fetch credentials:', error);
      throw error;
    }
  },
  
  // Actions - Reset
  reset: () => {
    set({
      settings: null,
      healthCheckConfig: null,
      routes: [],
      selectedRouteId: null,
      selectedRoute: null,
      currentPipeline: null,
      overview: null,
      selectedRouteState: null,
      stats: null,
      events: [],
      traces: [],
      credentials: [],
      healthHistory: [],
      loading: false,
      saving: false,
      error: null,
    });
  },
}));
