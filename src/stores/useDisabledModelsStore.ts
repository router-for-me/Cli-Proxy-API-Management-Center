/**
 * 禁用模型状态管理
 * 全局管理已禁用的模型，确保所有组件状态同步
 */

import { create } from 'zustand';

interface DisabledModelsState {
  /** 已禁用的模型集合，格式：`${source}|||${model}` */
  disabledModels: Set<string>;
  /** 添加禁用模型 */
  addDisabledModel: (source: string, model: string) => void;
  /** 移除禁用模型（恢复） */
  removeDisabledModel: (source: string, model: string) => void;
  /** 检查模型是否已禁用 */
  isDisabled: (source: string, model: string) => boolean;
  /** 清空所有禁用状态 */
  clearAll: () => void;
}

export const useDisabledModelsStore = create<DisabledModelsState>()((set, get) => ({
  disabledModels: new Set<string>(),

  addDisabledModel: (source, model) => {
    const key = `${source}|||${model}`;
    set((state) => {
      const newSet = new Set(state.disabledModels);
      newSet.add(key);
      return { disabledModels: newSet };
    });
  },

  removeDisabledModel: (source, model) => {
    const key = `${source}|||${model}`;
    set((state) => {
      const newSet = new Set(state.disabledModels);
      newSet.delete(key);
      return { disabledModels: newSet };
    });
  },

  isDisabled: (source, model) => {
    const key = `${source}|||${model}`;
    return get().disabledModels.has(key);
  },

  clearAll: () => {
    set({ disabledModels: new Set() });
  },
}));
