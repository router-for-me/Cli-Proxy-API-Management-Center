/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import { getQuotaCacheFileName } from '@/utils/quota/identity';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  DevinQuotaState,
  KimiQuotaState,
  MetaQuotaState,
  PluginQuotaState,
  XaiQuotaState,
} from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  cacheGeneration: number;
  fileGenerations: Record<string, number>;
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  devinQuota: Record<string, DevinQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  metaQuota: Record<string, MetaQuotaState>;
  pluginQuota: Record<string, PluginQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  /**
   * When each credential's quota last landed from a read (loading → success), by cache key.
   * A failed read or a cleared credential drops its entry. quotaFreshness.ts reads it.
   */
  fetchedAt: Record<string, number>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setDevinQuota: (updater: QuotaUpdater<Record<string, DevinQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setMetaQuota: (updater: QuotaUpdater<Record<string, MetaQuotaState>>) => void;
  setPluginQuota: (updater: QuotaUpdater<Record<string, PluginQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  clearQuotaCache: (names?: string[]) => void;
}

const resolveUpdater = <T>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

type QuotaEntry = { status?: string };

/** Stamps keys whose read just landed and forgets keys whose read failed. */
function stampReads(
  fetchedAt: Record<string, number>,
  prev: Record<string, QuotaEntry>,
  next: Record<string, QuotaEntry>,
  now: () => number
): Record<string, number> {
  let stamped = fetchedAt;
  for (const [key, quota] of Object.entries(next)) {
    if (quota === prev[key]) continue;
    if (quota.status === 'success' && prev[key]?.status === 'loading') {
      if (stamped === fetchedAt) stamped = { ...fetchedAt };
      stamped[key] = now();
    } else if (quota.status === 'error' && key in stamped) {
      if (stamped === fetchedAt) stamped = { ...fetchedAt };
      delete stamped[key];
    }
  }
  return stamped;
}

export const createQuotaStore = (now: () => number = Date.now) =>
  create<QuotaStoreState>((set) => ({
    cacheGeneration: 0,
    fileGenerations: {},
    antigravityQuota: {},
    claudeQuota: {},
    codexQuota: {},
    devinQuota: {},
    kimiQuota: {},
    metaQuota: {},
    pluginQuota: {},
    xaiQuota: {},
    fetchedAt: {},
    setAntigravityQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.antigravityQuota);
        return {
          antigravityQuota: next,
          fetchedAt: stampReads(state.fetchedAt, state.antigravityQuota, next, now),
        };
      }),
    setClaudeQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.claudeQuota);
        let retained = next;
        for (const [key, quota] of Object.entries(next)) {
          const previous = state.claudeQuota[key];
          if (
            previous &&
            quota !== previous &&
            (quota.status === 'loading' || quota.status === 'error') &&
            !quota.observedAt &&
            (previous.observedAt ||
              previous.windows.length ||
              previous.extraUsage ||
              previous.dollarWindows?.length)
          ) {
            if (retained === next) retained = { ...next };
            retained[key] = {
              ...quota,
              windows: previous.windows,
              extraUsage: previous.extraUsage,
              dollarWindows: previous.dollarWindows,
              observedAt: previous.observedAt,
              planType: previous.planType,
              billing: previous.billing,
              stale: quota.status === 'error' || previous.stale,
            };
          }
        }
        return {
          claudeQuota: retained,
          fetchedAt: stampReads(state.fetchedAt, state.claudeQuota, retained, now),
        };
      }),
    setCodexQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.codexQuota);
        return {
          codexQuota: next,
          fetchedAt: stampReads(state.fetchedAt, state.codexQuota, next, now),
        };
      }),
    setDevinQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.devinQuota);
        return {
          devinQuota: next,
          fetchedAt: stampReads(state.fetchedAt, state.devinQuota, next, now),
        };
      }),
    setKimiQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.kimiQuota);
        return {
          kimiQuota: next,
          fetchedAt: stampReads(state.fetchedAt, state.kimiQuota, next, now),
        };
      }),
    setMetaQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.metaQuota);
        return {
          metaQuota: next,
          fetchedAt: stampReads(state.fetchedAt, state.metaQuota, next, now),
        };
      }),
    setPluginQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.pluginQuota);
        return {
          pluginQuota: next,
          fetchedAt: stampReads(state.fetchedAt, state.pluginQuota, next, now),
        };
      }),
    setXaiQuota: (updater) =>
      set((state) => {
        const next = resolveUpdater(updater, state.xaiQuota);
        return {
          xaiQuota: next,
          fetchedAt: stampReads(state.fetchedAt, state.xaiQuota, next, now),
        };
      }),
    clearQuotaCache: (names) =>
      set((state) => {
        if (names) {
          if (names.length === 0) return state;
          const fileGenerations = { ...state.fileGenerations };
          names.forEach((name) => {
            fileGenerations[name] = (fileGenerations[name] ?? 0) + 1;
          });
          const invalidatedNames = new Set(names);
          const omitNames = <T>(cache: Record<string, T>): Record<string, T> => {
            const keysToDelete = Object.keys(cache).filter((key) =>
              invalidatedNames.has(getQuotaCacheFileName(key))
            );
            if (keysToDelete.length === 0) return cache;
            const next = { ...cache };
            keysToDelete.forEach((key) => delete next[key]);
            return next;
          };
          return {
            fileGenerations,
            antigravityQuota: omitNames(state.antigravityQuota),
            claudeQuota: omitNames(state.claudeQuota),
            codexQuota: omitNames(state.codexQuota),
            devinQuota: omitNames(state.devinQuota),
            kimiQuota: omitNames(state.kimiQuota),
            metaQuota: omitNames(state.metaQuota),
            pluginQuota: omitNames(state.pluginQuota),
            xaiQuota: omitNames(state.xaiQuota),
            fetchedAt: omitNames(state.fetchedAt),
          };
        }
        return {
          cacheGeneration: state.cacheGeneration + 1,
          fileGenerations: {},
          antigravityQuota: {},
          claudeQuota: {},
          codexQuota: {},
          devinQuota: {},
          kimiQuota: {},
          metaQuota: {},
          pluginQuota: {},
          xaiQuota: {},
          fetchedAt: {},
        };
      }),
  }));

export const useQuotaStore = createQuotaStore();
export type QuotaStore = ReturnType<typeof createQuotaStore>;

export const captureQuotaCacheGeneration = (name?: string, store: QuotaStore = useQuotaStore) => {
  const { cacheGeneration, fileGenerations } = store.getState();
  return { cacheGeneration, fileGenerations, name, store };
};

export const commitIfQuotaCacheCurrent = (
  generation: ReturnType<typeof captureQuotaCacheGeneration>,
  commit: () => void,
  name: string | undefined = generation.name
): boolean => {
  const current = generation.store.getState();
  if (current.cacheGeneration !== generation.cacheGeneration) return false;
  // File-scoped requests survive mutations to unrelated credentials.
  if (name !== undefined) {
    if ((current.fileGenerations[name] ?? 0) !== (generation.fileGenerations[name] ?? 0)) {
      return false;
    }
  } else if (current.fileGenerations !== generation.fileGenerations) {
    return false;
  }
  commit();
  return true;
};
