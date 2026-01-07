/**
 * 备份管理相关 API
 */

import { apiClient } from './client';
import type {
  BackupListResponse,
  BackupCreateRequest,
  BackupCreateResponse,
  BackupRestoreRequest,
  BackupRestoreResponse
} from '@/types/backup';

export const backupApi = {
  /**
   * 获取备份列表
   */
  list: () => apiClient.get<BackupListResponse>('/backups'),

  /**
   * 创建备份
   */
  create: (request: BackupCreateRequest) =>
    apiClient.post<BackupCreateResponse>('/backups', request),

  /**
   * 删除备份
   */
  delete: (name: string) =>
    apiClient.delete(`/backups?name=${encodeURIComponent(name)}`),

  /**
   * 下载备份 (获取 blob)
   */
  download: async (name: string): Promise<Blob> => {
    const response = await apiClient.getRaw(`/backups/download?name=${encodeURIComponent(name)}`, {
      responseType: 'blob'
    });
    return response.data as Blob;
  },

  /**
   * 恢复备份
   */
  restore: (request: BackupRestoreRequest) =>
    apiClient.post<BackupRestoreResponse>('/backups/restore', request),

  /**
   * 上传并恢复备份
   */
  uploadAndRestore: (file: File, authsMode: 'overwrite' | 'incremental' = 'overwrite') => {
    const formData = new FormData();
    formData.append('file', file, file.name);
    formData.append('authsMode', authsMode);
    return apiClient.postForm<BackupRestoreResponse>('/backups/upload', formData);
  }
};
