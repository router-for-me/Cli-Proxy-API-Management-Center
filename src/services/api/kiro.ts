/**
 * Kiro credential import API
 */

import { apiClient } from './client';

export interface KiroImportResponse {
  status: 'ok';
  provider: 'kiro';
  'auth-file'?: string;
  auth_file?: string;
  id?: string;
  label?: string;
  email?: string;
}

export const kiroApi = {
  importCredential: (fileOrJson: File | string) => {
    if (typeof fileOrJson === 'string') {
      return apiClient.post<KiroImportResponse>('/oauth/import?provider=kiro', {
        json: fileOrJson,
      });
    }
    const formData = new FormData();
    formData.append('file', fileOrJson);
    return apiClient.postForm<KiroImportResponse>('/oauth/import?provider=kiro', formData);
  },
};
