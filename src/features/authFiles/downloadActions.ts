import { apiClient, authFilesApi } from '@/services/api';
import { downloadBlob } from '@/utils/download';

/** Stop the batch, including local blob delivery, when its management session ends. */
export async function downloadAuthFiles(names: string[], deliver = downloadBlob) {
  const revision = apiClient.getConnectionRevision();
  let success = 0;
  const failures: unknown[] = [];
  for (const name of new Set(names)) {
    try {
      const blob = await authFilesApi.download(name);
      if (revision !== apiClient.getConnectionRevision()) return null;
      deliver({ filename: name, blob });
      success++;
    } catch (error) {
      if (revision !== apiClient.getConnectionRevision()) return null;
      failures.push(error);
    }
  }
  return { success, failures };
}
