/**
 * Claude provider editor draft state.
 *
 * Why this exists:
 * - The app uses `PageTransition` with iOS-style stacked routes for `/ai-providers/*`.
 * - Entering `/ai-providers/claude/.../models` creates a new route layer, so component-local state
 *   inside the Claude edit layout is not shared between the edit screen and the model picker screen.
 * - This store makes the Claude edit draft shared across route layers keyed by provider index/new.
 */

import type { SetStateAction } from 'react';
import { create } from 'zustand';
import type { ProviderFormState } from '@/components/providers/types';

export type ClaudeTestStatus = 'idle' | 'loading' | 'success' | 'error';

type ClaudeEditDraft = {
  initialized: boolean;
  form: ProviderFormState;
  testModel: string;
  testStatus: ClaudeTestStatus;
  testMessage: string;
};

interface ClaudeEditDraftState {
  drafts: Record<string, ClaudeEditDraft>;
  ensureDraft: (key: string) => void;
  initDraft: (
    key: string,
    draft: Omit<ClaudeEditDraft, 'initialized'>
  ) => void;
  setDraftForm: (
    key: string,
    action: SetStateAction<ProviderFormState>
  ) => void;
  setDraftTestModel: (key: string, action: SetStateAction<string>) => void;
  setDraftTestStatus: (
    key: string,
    action: SetStateAction<ClaudeTestStatus>
  ) => void;
  setDraftTestMessage: (key: string, action: SetStateAction<string>) => void;
  clearDraft: (key: string) => void;
}

const resolveAction = <T,>(action: SetStateAction<T>, prev: T): T =>
  typeof action === 'function' ? (action as (previous: T) => T)(prev) : action;

const buildEmptyForm = (): ProviderFormState => ({
  apiKey: '',
  prefix: '',
  baseUrl: '',
  proxyUrl: '',
  headers: [],
  models: [],
  excludedModels: [],
  modelEntries: [{ name: '', alias: '' }],
  excludedText: '',
});

const buildEmptyDraft = (): ClaudeEditDraft => ({
  initialized: false,
  form: buildEmptyForm(),
  testModel: '',
  testStatus: 'idle',
  testMessage: '',
});

export const useClaudeEditDraftStore = create<ClaudeEditDraftState>((set, get) => ({
  drafts: {},

  ensureDraft: (key) => {
    if (!key) return;
    const existing = get().drafts[key];
    if (existing) return;
    set((state) => ({
      drafts: { ...state.drafts, [key]: buildEmptyDraft() },
    }));
  },

  initDraft: (key, draft) => {
    if (!key) return;
    const existing = get().drafts[key];
    if (existing?.initialized) return;
    set((state) => ({
      drafts: {
        ...state.drafts,
        [key]: { ...draft, initialized: true },
      },
    }));
  },

  setDraftForm: (key, action) => {
    if (!key) return;
    set((state) => {
      const existing = state.drafts[key] ?? buildEmptyDraft();
      const nextForm = resolveAction(action, existing.form);
      return {
        drafts: {
          ...state.drafts,
          [key]: { ...existing, initialized: true, form: nextForm },
        },
      };
    });
  },

  setDraftTestModel: (key, action) => {
    if (!key) return;
    set((state) => {
      const existing = state.drafts[key] ?? buildEmptyDraft();
      const nextValue = resolveAction(action, existing.testModel);
      return {
        drafts: {
          ...state.drafts,
          [key]: { ...existing, initialized: true, testModel: nextValue },
        },
      };
    });
  },

  setDraftTestStatus: (key, action) => {
    if (!key) return;
    set((state) => {
      const existing = state.drafts[key] ?? buildEmptyDraft();
      const nextValue = resolveAction(action, existing.testStatus);
      return {
        drafts: {
          ...state.drafts,
          [key]: { ...existing, initialized: true, testStatus: nextValue },
        },
      };
    });
  },

  setDraftTestMessage: (key, action) => {
    if (!key) return;
    set((state) => {
      const existing = state.drafts[key] ?? buildEmptyDraft();
      const nextValue = resolveAction(action, existing.testMessage);
      return {
        drafts: {
          ...state.drafts,
          [key]: { ...existing, initialized: true, testMessage: nextValue },
        },
      };
    });
  },

  clearDraft: (key) => {
    if (!key) return;
    set((state) => {
      if (!state.drafts[key]) return state;
      const next = { ...state.drafts };
      delete next[key];
      return { drafts: next };
    });
  },
}));
