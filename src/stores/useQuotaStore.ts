/**
 * Quota cache that survives route switches.
 */

import { create } from 'zustand';
import type { AntigravityQuotaState, CodexQuotaState, GeminiCliQuotaState, GithubCopilotQuotaState } from '@/types';

type QuotaUpdater<T> = T | ((prev: T) => T);

interface QuotaStoreState {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  githubCopilotQuota: Record<string, GithubCopilotQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setGithubCopilotQuota: (updater: QuotaUpdater<Record<string, GithubCopilotQuotaState>>) => void;
  clearQuotaCache: () => void;
}

const resolveUpdater = <T,>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

export const useQuotaStore = create<QuotaStoreState>((set) => ({
  antigravityQuota: {},
  codexQuota: {},
  geminiCliQuota: {},
  githubCopilotQuota: {},
  setAntigravityQuota: (updater) =>
    set((state) => ({
      antigravityQuota: resolveUpdater(updater, state.antigravityQuota)
    })),
  setCodexQuota: (updater) =>
    set((state) => ({
      codexQuota: resolveUpdater(updater, state.codexQuota)
    })),
  setGeminiCliQuota: (updater) =>
    set((state) => ({
      geminiCliQuota: resolveUpdater(updater, state.geminiCliQuota)
    })),
  setGithubCopilotQuota: (updater) =>
    set((state) => ({
      githubCopilotQuota: resolveUpdater(updater, state.githubCopilotQuota)
    })),
  clearQuotaCache: () =>
    set({
      antigravityQuota: {},
      codexQuota: {},
      geminiCliQuota: {},
      githubCopilotQuota: {}
    })
}));
