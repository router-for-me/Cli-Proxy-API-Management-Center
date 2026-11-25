import { expect, it, mock, spyOn } from 'bun:test';
import { downloadAuthFiles } from '../src/features/authFiles/downloadActions';
import { apiClient, authFilesApi } from '../src/services/api';

for (const fails of [true, false]) {
  it(`does not deliver or continue an old download after switching sessions (fails=${fails})`, async () => {
    const gate = Promise.withResolvers<Blob>();
    const download = spyOn(authFilesApi, 'download').mockReturnValue(gate.promise);
    const deliver = mock(() => {});
    try {
      const batch = downloadAuthFiles(['first.json', 'second.json'], deliver);
      apiClient.setConfig({ apiBase: 'https://other.invalid', managementKey: 'fixture' });
      if (fails) gate.reject(new Error('old error'));
      else gate.resolve(new Blob(['fixture']));
      expect(await batch).toBeNull();
      expect(download).toHaveBeenCalledTimes(1);
      expect(deliver).not.toHaveBeenCalled();
    } finally {
      download.mockRestore();
      apiClient.setConfig({ apiBase: '', managementKey: '' });
    }
  });
}
