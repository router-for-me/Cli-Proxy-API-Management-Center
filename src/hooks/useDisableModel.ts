/**
 * 禁用模型 Hook
 * 仅支持 OpenAI 兼容提供商：从 models 列表中移除模型映射
 */

import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { providersApi } from '@/services/api';
import { useDisabledModelsStore } from '@/stores';
import {
  resolveProvider,
  createDisableState,
  type DisableState,
} from '@/utils/monitor';
import type { SourceInfo } from '@/types/sourceInfo';
import type { OpenAIProviderConfig } from '@/types';

export interface UseDisableModelOptions {
  providerMap: Record<string, string>;
  sourceInfoMap?: Map<string, SourceInfo>;
  providerModels?: Record<string, Set<string>>;
}

export interface UseDisableModelReturn {
  disableState: DisableState | null;
  disabling: boolean;
  handleDisableClick: (source: string, model: string) => void;
  handleConfirmDisable: () => Promise<void>;
  handleCancelDisable: () => void;
  isModelDisabled: (source: string, model: string) => boolean;
}

export function useDisableModel(options: UseDisableModelOptions): UseDisableModelReturn {
  const { providerMap, providerModels } = options;
  const { t } = useTranslation();

  const { addDisabledModel, isDisabled } = useDisabledModelsStore();

  const [disableState, setDisableState] = useState<DisableState | null>(null);
  const [disabling, setDisabling] = useState(false);

  const handleDisableClick = useCallback((source: string, model: string) => {
    setDisableState(createDisableState(source, model, providerMap));
  }, [providerMap]);

  const handleConfirmDisable = useCallback(async () => {
    if (!disableState) return;

    if (disableState.step < 3) {
      setDisableState({
        ...disableState,
        step: disableState.step + 1,
      });
      return;
    }

    setDisabling(true);
    try {
      const { source, model } = disableState;

      const providerName = resolveProvider(source, providerMap);
      const matchSource = (value?: string) => {
        if (!value || !source) return false;
        return source === value;
      };

      const providers = await providersApi.getOpenAIProviders();
      const targetProvider = providers.find(
        (p) =>
          matchSource(p.name) ||
          matchSource(p.prefix) ||
          matchSource(p.headers?.['X-Provider']) ||
          (p.apiKeyEntries || []).some((entry) => matchSource(entry.apiKey))
      );

      if (!targetProvider) {
        if (!providerName) {
          throw new Error(t('monitor.logs.disable_error_no_provider'));
        }
        throw new Error(t('monitor.logs.disable_error_provider_not_found', { provider: providerName }));
      }

      const originalModels = targetProvider.models || [];
      const filteredModels = originalModels.filter(
        (m) => m.alias !== model && m.name !== model
      );

      if (filteredModels.length < originalModels.length) {
        await providersApi.patchOpenAIProviderByName(targetProvider.name, {
          models: filteredModels,
        } as Partial<OpenAIProviderConfig>);
      }

      addDisabledModel(source, model);
      setDisableState(null);
    } catch (err) {
      console.error('禁用模型失败：', err);
      alert(err instanceof Error ? err.message : t('monitor.logs.disable_error'));
    } finally {
      setDisabling(false);
    }
  }, [disableState, providerMap, t, addDisabledModel]);

  const handleCancelDisable = useCallback(() => {
    setDisableState(null);
  }, []);

  const isModelDisabled = useCallback((source: string, model: string): boolean => {
    if (isDisabled(source, model)) {
      return true;
    }

    if (providerModels) {
      if (!source || !model) return false;

      if (providerModels[source]) {
        return !providerModels[source].has(model);
      }

      const entries = Object.entries(providerModels);
      for (const [key, modelSet] of entries) {
        if (source.startsWith(key) || key.startsWith(source)) {
          return !modelSet.has(model);
        }
      }
    }

    return false;
  }, [isDisabled, providerModels]);

  return {
    disableState,
    disabling,
    handleDisableClick,
    handleConfirmDisable,
    handleCancelDisable,
    isModelDisabled,
  };
}
