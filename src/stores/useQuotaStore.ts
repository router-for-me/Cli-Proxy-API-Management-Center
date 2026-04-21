/**
 * Quota cache that survives page refreshes.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import type {
  AntigravityQuotaState,
  ClaudeQuotaState,
  CodexQuotaState,
  GeminiCliQuotaState,
  KimiQuotaState,
} from '@/types';
import { STORAGE_KEY_QUOTA_CACHE } from '@/utils/constants';

type QuotaUpdater<T> = T | ((prev: T) => T);
type PersistableQuotaState = Pick<
  QuotaStoreState,
  'antigravityQuota' | 'claudeQuota' | 'codexQuota' | 'geminiCliQuota' | 'kimiQuota'
>;
type PersistedQuotaEnvelope = { state?: Partial<PersistableQuotaState>; version?: number };
type QuotaSnapshot = { status?: string };

interface QuotaStoreState {
  antigravityQuota: Record<string, AntigravityQuotaState>;
  claudeQuota: Record<string, ClaudeQuotaState>;
  codexQuota: Record<string, CodexQuotaState>;
  geminiCliQuota: Record<string, GeminiCliQuotaState>;
  kimiQuota: Record<string, KimiQuotaState>;
  setAntigravityQuota: (updater: QuotaUpdater<Record<string, AntigravityQuotaState>>) => void;
  setClaudeQuota: (updater: QuotaUpdater<Record<string, ClaudeQuotaState>>) => void;
  setCodexQuota: (updater: QuotaUpdater<Record<string, CodexQuotaState>>) => void;
  setGeminiCliQuota: (updater: QuotaUpdater<Record<string, GeminiCliQuotaState>>) => void;
  setKimiQuota: (updater: QuotaUpdater<Record<string, KimiQuotaState>>) => void;
  clearQuotaCache: () => void;
}

const createEmptyQuotaCache = (): PersistableQuotaState => ({
  antigravityQuota: {},
  claudeQuota: {},
  codexQuota: {},
  geminiCliQuota: {},
  kimiQuota: {},
});

const resolveUpdater = <T,>(updater: QuotaUpdater<T>, prev: T): T => {
  if (typeof updater === 'function') {
    return (updater as (value: T) => T)(prev);
  }
  return updater;
};

const readPersistedQuotaEnvelope = (raw: string | null): PersistedQuotaEnvelope | null => {
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PersistedQuotaEnvelope;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const sanitizeQuotaRecord = <T extends QuotaSnapshot>(
  record: Record<string, T> | undefined
): Record<string, T> => {
  if (!record) return {};

  return Object.entries(record).reduce<Record<string, T>>((result, [name, entry]) => {
    if (!entry || typeof entry !== 'object' || entry.status === 'loading') {
      return result;
    }

    result[name] = entry;
    return result;
  }, {});
};

const sanitizePersistedQuotaState = (
  state: Partial<PersistableQuotaState> | null | undefined
): PersistableQuotaState => ({
  antigravityQuota: sanitizeQuotaRecord(state?.antigravityQuota),
  claudeQuota: sanitizeQuotaRecord(state?.claudeQuota),
  codexQuota: sanitizeQuotaRecord(state?.codexQuota),
  geminiCliQuota: sanitizeQuotaRecord(state?.geminiCliQuota),
  kimiQuota: sanitizeQuotaRecord(state?.kimiQuota),
});

const mergeQuotaRecord = <T extends QuotaSnapshot>(
  previous: Record<string, T> | undefined,
  next: Record<string, T> | undefined
): Record<string, T> => {
  if (!next) return {};

  return Object.entries(next).reduce<Record<string, T>>((result, [name, entry]) => {
    if (!entry || typeof entry !== 'object') {
      return result;
    }

    if (entry.status === 'loading') {
      const cached = previous?.[name];
      if (cached && cached.status !== 'loading') {
        result[name] = cached;
      }
      return result;
    }

    result[name] = entry;
    return result;
  }, {});
};

const mergePersistedQuotaState = (
  previous: Partial<PersistableQuotaState> | null | undefined,
  next: Partial<PersistableQuotaState> | null | undefined
): PersistableQuotaState => ({
  antigravityQuota: mergeQuotaRecord(previous?.antigravityQuota, next?.antigravityQuota),
  claudeQuota: mergeQuotaRecord(previous?.claudeQuota, next?.claudeQuota),
  codexQuota: mergeQuotaRecord(previous?.codexQuota, next?.codexQuota),
  geminiCliQuota: mergeQuotaRecord(previous?.geminiCliQuota, next?.geminiCliQuota),
  kimiQuota: mergeQuotaRecord(previous?.kimiQuota, next?.kimiQuota),
});

const quotaPersistStorage = createJSONStorage<PersistableQuotaState>(() => ({
  getItem: (name) => {
    const raw = window.localStorage.getItem(name);
    const persisted = readPersistedQuotaEnvelope(raw);
    if (!persisted) return raw;

    return JSON.stringify({
      ...persisted,
      state: sanitizePersistedQuotaState(persisted.state),
    });
  },
  setItem: (name, value) => {
    const previous = readPersistedQuotaEnvelope(window.localStorage.getItem(name));
    const next = readPersistedQuotaEnvelope(value);
    if (!next) {
      window.localStorage.setItem(name, value);
      return;
    }

    window.localStorage.setItem(
      name,
      JSON.stringify({
        ...next,
        state: mergePersistedQuotaState(previous?.state, next.state),
      })
    );
  },
  removeItem: (name) => {
    window.localStorage.removeItem(name);
  },
}));

export const useQuotaStore = create<QuotaStoreState>()(
  persist(
    (set) => ({
      ...createEmptyQuotaCache(),
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
      setGeminiCliQuota: (updater) =>
        set((state) => ({
          geminiCliQuota: resolveUpdater(updater, state.geminiCliQuota),
        })),
      setKimiQuota: (updater) =>
        set((state) => ({
          kimiQuota: resolveUpdater(updater, state.kimiQuota),
        })),
      clearQuotaCache: () => set(createEmptyQuotaCache()),
    }),
    {
      name: STORAGE_KEY_QUOTA_CACHE,
      storage: quotaPersistStorage,
      partialize: (state) => ({
        antigravityQuota: state.antigravityQuota,
        claudeQuota: state.claudeQuota,
        codexQuota: state.codexQuota,
        geminiCliQuota: state.geminiCliQuota,
        kimiQuota: state.kimiQuota,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedQuotaState(persistedState as Partial<PersistableQuotaState>),
      }),
    }
  )
);
