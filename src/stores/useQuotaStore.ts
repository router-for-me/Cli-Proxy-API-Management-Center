/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodeBuddyQuotaState,
  CodexQuotaState,
  KimiQuotaState,
  XaiQuotaState,
} from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  cacheGeneration: number;
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codebuddyQuota: Record<string, CodeBuddyQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  xaiQuota: Record<string, XaiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodebuddyQuota: (updater: QuotaUpdater<Record<string, CodeBuddyQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  setXaiQuota: (updater: QuotaUpdater<Record<string, XaiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

const resolveUpdater = <T>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  cacheGeneration: 0,
  antigravityQuota: {},
  claudeQuota: {},
  codebuddyQuota: {},
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
  setCodebuddyQuota: (updater) =>
    set((state) => ({
      codebuddyQuota: resolveUpdater(updater, state.codebuddyQuota),
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
  clearQuotaCache: () =>
    set((state) => ({
      cacheGeneration: state.cacheGeneration + 1,
      antigravityQuota: {},
      claudeQuota: {},
      codebuddyQuota: {},
      codexQuota: {},
      kimiQuota: {},
      xaiQuota: {},
    })),
}));

export const captureQuotaCacheGeneration = (): number =>
  useQuotaStore.getState().cacheGeneration;

export const commitIfQuotaCacheCurrent = (
  generation: number,
  commit: () => void
): boolean => {
  if (useQuotaStore.getState().cacheGeneration !== generation) return false;
  commit();
  return true;
};
