import { apiClient } from './client';

export interface BackupConfig {
  enabled: boolean;
  schedule: string;
  storage: 'local' | 's3' | 'webdav' | '';
  'local-dir': string;
  'max-backups': number;
  s3: {
    endpoint: string;
    region: string;
    bucket: string;
    path: string;
    'access-key': string;
    'secret-key': string;
    'use-ssl': boolean;
  };
  webdav: {
    url: string;
    username: string;
    password: string;
    path: string;
  };
}

export interface BackupInfo {
  name: string;
  timestamp: string;
  size: number;
  storage: string;
  location: string;
}

export interface BackupListResponse {
  backups: BackupInfo[];
}

export const backupApi = {
  /**
   * Get backup configuration
   */
  getConfig: async (): Promise<BackupConfig> => {
    return await apiClient.get<BackupConfig>('/backup/config');
  },

  /**
   * Update backup configuration
   */
  updateConfig: async (config: BackupConfig): Promise<void> => {
    await apiClient.put('/backup/config', config);
  },

  /**
   * Create backup (upload to storage)
   */
  createBackup: async (): Promise<{ message: string; backup: BackupInfo }> => {
    return await apiClient.post<{ message: string; backup: BackupInfo }>('/backup/create');
  },

  /**
   * Create and download backup immediately
   */
  downloadNewBackup: async (): Promise<Blob> => {
    return await apiClient.post<Blob>('/backup/create?download=true', null, {
      responseType: 'blob',
    });
  },

  /**
   * List all backups
   */
  listBackups: async (): Promise<BackupInfo[]> => {
    const response = await apiClient.get<BackupListResponse>('/backup/list');
    return response.backups || [];
  },

  /**
   * Download a specific backup
   */
  downloadBackup: async (name: string): Promise<Blob> => {
    return await apiClient.get<Blob>('/backup/download', {
      params: { name },
      responseType: 'blob',
    });
  },

  /**
   * Delete a backup
   */
  deleteBackup: async (name: string): Promise<void> => {
    await apiClient.delete('/backup', {
      params: { name },
    });
  },

  /**
   * Test storage connection
   */
  testConnection: async (): Promise<{ message: string }> => {
    return await apiClient.post<{ message: string }>('/backup/test-connection');
  },
};
