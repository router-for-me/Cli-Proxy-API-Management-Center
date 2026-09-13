/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  XaiQuotaState,
} from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  cacheGeneration: number;
  fileGenerations: Record<string, number>;
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  clearQuotaCache: (names?: string[]) => void;
}

const resolveUpdater = <T>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  cacheGeneration: 0,
  fileGenerations: {},
  antigravityQuota: {},
  claudeQuota: {},
  codexQuota: {},
  kimiQuota: {},
  xaiQuota: {},
  setAntigravityQuota: (updater) =>
    set((state) => ({
      antigravityQuota: resolveUpdater(updater, state.antigravityQuota),
    })),
  setClaudeQuota: (updater) =>
    set((state) => ({
      claudeQuota: resolveUpdater(updater, state.claudeQuota),
    })),
  setCodexQuota: (updater) =>
    set((state) => ({
      codexQuota: resolveUpdater(updater, state.codexQuota),
    })),
  setKimiQuota: (updater) =>
    set((state) => ({
      kimiQuota: resolveUpdater(updater, state.kimiQuota),
    })),
  setXaiQuota: (updater) =>
    set((state) => ({
      xaiQuota: resolveUpdater(updater, state.xaiQuota),
    })),
  clearQuotaCache: (names) =>
    set((state) => {
      if (names) {
        if (names.length === 0) return state;
        const fileGenerations = { ...state.fileGenerations };
        names.forEach((name) => {
          fileGenerations[name] = (fileGenerations[name] ?? 0) + 1;
        });
        const omitNames = <T>(cache: Record<string, T>): Record<string, T> => {
          if (!names.some((name) => Object.prototype.hasOwnProperty.call(cache, name)))
            return cache;
          const next = { ...cache };
          names.forEach((name) => delete next[name]);
          return next;
        };
        return {
          fileGenerations,
          antigravityQuota: omitNames(state.antigravityQuota),
          claudeQuota: omitNames(state.claudeQuota),
          codexQuota: omitNames(state.codexQuota),
          kimiQuota: omitNames(state.kimiQuota),
          xaiQuota: omitNames(state.xaiQuota),
        };
      }
      return {
        cacheGeneration: state.cacheGeneration + 1,
        fileGenerations: {},
        antigravityQuota: {},
        claudeQuota: {},
        codexQuota: {},
        kimiQuota: {},
        xaiQuota: {},
      };
    }),
}));

export const captureQuotaCacheGeneration = (name?: string) => {
  const { cacheGeneration, fileGenerations } = useQuotaStore.getState();
  return { cacheGeneration, fileGenerations, name };
};

export const commitIfQuotaCacheCurrent = (
  generation: ReturnType<typeof captureQuotaCacheGeneration>,
  commit: () => void,
  name: string | undefined = generation.name
): boolean => {
  const current = useQuotaStore.getState();
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
