/**
 * 禁用模型 Hook
 * 封装禁用模型的状态管理和业务逻辑
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
import type { OpenAIProviderConfig } from '@/types';

// 不支持禁用的渠道类型（小写）
const UNSUPPORTED_PROVIDER_TYPES = ['claude', 'gemini', 'codex', 'vertex'];

/**
 * 不支持禁用的提示状态
 */
export interface UnsupportedDisableState {
  providerType: string;
  model: string;
  displayName: string;
}

export interface UseDisableModelOptions {
  providerMap: Record<string, string>;
  providerTypeMap?: Record<string, string>;
  providerModels?: Record<string, Set<string>>;
}

export interface UseDisableModelReturn {
  /** 当前禁用状态 */
  disableState: DisableState | null;
  /** 不支持禁用的提示状态 */
  unsupportedState: UnsupportedDisableState | null;
  /** 是否正在禁用中 */
  disabling: boolean;
  /** 开始禁用流程 */
  handleDisableClick: (source: string, model: string) => void;
  /** 确认禁用（需要点击3次） */
  handleConfirmDisable: () => Promise<void>;
  /** 取消禁用 */
  handleCancelDisable: () => void;
  /** 关闭不支持提示 */
  handleCloseUnsupported: () => void;
  /** 检查模型是否已禁用 */
  isModelDisabled: (source: string, model: string) => boolean;
}

/**
 * 禁用模型 Hook
 * @param options 配置选项
 * @returns 禁用模型相关的状态和方法
 */
export function useDisableModel(options: UseDisableModelOptions): UseDisableModelReturn {
  const { providerMap, providerTypeMap, providerModels } = options;
  const { t } = useTranslation();

  // 使用全局 store 管理禁用状态
  const { addDisabledModel, isDisabled } = useDisabledModelsStore();

  const [disableState, setDisableState] = useState<DisableState | null>(null);
  const [unsupportedState, setUnsupportedState] = useState<UnsupportedDisableState | null>(null);
  const [disabling, setDisabling] = useState(false);

  // 开始禁用流程
  const handleDisableClick = useCallback((source: string, model: string) => {
    // 首先检查提供商类型是否支持禁用
    const providerType = providerTypeMap?.[source] || '';
    const lowerType = providerType.toLowerCase();

    // 如果是不支持的类型，立即显示提示
    if (lowerType && UNSUPPORTED_PROVIDER_TYPES.includes(lowerType)) {
      const providerName = resolveProvider(source, providerMap);
      const displayName = providerName
        ? `${providerName} / ${model}`
        : `${source.slice(0, 8)}*** / ${model}`;
      setUnsupportedState({
        providerType,
        model,
        displayName,
      });
      return;
    }

    // 支持的类型，进入正常禁用流程
    setDisableState(createDisableState(source, model, providerMap));
  }, [providerMap, providerTypeMap]);

  // 确认禁用（需要点击3次）
  const handleConfirmDisable = useCallback(async () => {
    if (!disableState) return;

    // 前两次点击只增加步骤
    if (disableState.step < 3) {
      setDisableState({
        ...disableState,
        step: disableState.step + 1,
      });
      return;
    }

    // 第3次点击，执行禁用
    setDisabling(true);
    try {
      const providerName = resolveProvider(disableState.source, providerMap);
      if (!providerName) {
        throw new Error(t('monitor.logs.disable_error_no_provider'));
      }

      // 获取当前配置
      const providers = await providersApi.getOpenAIProviders();
      const targetProvider = providers.find(
        (p) => p.name && p.name.toLowerCase() === providerName.toLowerCase()
      );

      if (!targetProvider) {
        throw new Error(t('monitor.logs.disable_error_provider_not_found', { provider: providerName }));
      }

      const originalModels = targetProvider.models || [];
      const modelAlias = disableState.model;

      // 过滤掉匹配的模型
      const filteredModels = originalModels.filter(
        (m) => m.alias !== modelAlias && m.name !== modelAlias
      );

      // 只有当模型确实被过滤掉时才调用 API
      if (filteredModels.length < originalModels.length) {
        await providersApi.patchOpenAIProviderByName(targetProvider.name, {
          models: filteredModels,
        } as Partial<OpenAIProviderConfig>);
      }

      // 标记为已禁用（全局状态）
      addDisabledModel(disableState.source, disableState.model);
      setDisableState(null);
    } catch (err) {
      console.error('禁用模型失败：', err);
      alert(err instanceof Error ? err.message : t('monitor.logs.disable_error'));
    } finally {
      setDisabling(false);
    }
  }, [disableState, providerMap, t, addDisabledModel]);

  // 取消禁用
  const handleCancelDisable = useCallback(() => {
    setDisableState(null);
  }, []);

  // 关闭不支持提示
  const handleCloseUnsupported = useCallback(() => {
    setUnsupportedState(null);
  }, []);

  // 检查模型是否已禁用
  const isModelDisabled = useCallback((source: string, model: string): boolean => {
    // 首先检查全局状态中是否已禁用
    if (isDisabled(source, model)) {
      return true;
    }

    // 如果提供了 providerModels，检查配置中是否已移除
    if (providerModels) {
      if (!source || !model) return false;

      // 首先尝试完全匹配
      if (providerModels[source]) {
        return !providerModels[source].has(model);
      }

      // 然后尝试前缀匹配
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
    unsupportedState,
    disabling,
    handleDisableClick,
    handleConfirmDisable,
    handleCancelDisable,
    handleCloseUnsupported,
    isModelDisabled,
  };
}
