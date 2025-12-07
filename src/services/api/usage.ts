/**
 * 使用统计相关 API
 */

import { apiClient } from './client';
import { computeKeyStats, KeyStats } from '@/utils/usage';

export const usageApi = {
  /**
   * 获取使用统计原始数据
   */
  getUsage: () => apiClient.get('/usage'),

  /**
   * 计算密钥成功/失败统计，必要时会先获取 usage 数据
   */
  async getKeyStats(usageData?: any): Promise<KeyStats> {
    let payload = usageData;
    if (!payload) {
      const response = await apiClient.get('/usage');
      payload = response?.usage ?? response;
    }
    return computeKeyStats(payload);
  }
};
