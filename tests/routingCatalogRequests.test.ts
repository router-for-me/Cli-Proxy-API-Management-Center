import { expect, spyOn, test } from 'bun:test';
import { authFilesApi } from '../src/services/api/authFiles';
import { apiClient } from '../src/services/api/client';
import { routingApi } from '../src/services/api/routing';

for (const [load, method] of [
  ['loadCredentialModels', 'getModelsForAuthFile'],
  ['loadChannelModels', 'getModelDefinitions'],
] as const) {
  test(`${load} abandons queued requests and results on connection change`, async () => {
    const revision = spyOn(apiClient, 'getConnectionRevision').mockReturnValue(1);
    const gate = Promise.withResolvers<{ id: string }[]>();
    const request = spyOn(authFilesApi, method).mockImplementation(() => gate.promise);
    try {
      const names = Array.from({ length: 12 }, (_, i) => `fixture-${i}`);
      const results: string[] = [];
      const pending = routingApi[load](names, (name) => results.push(name));
      const dispatched = request.mock.calls.length;
      expect(dispatched).toBeGreaterThan(0);
      expect(dispatched).toBeLessThan(names.length);
      revision.mockReturnValue(2);
      gate.resolve([]);
      await pending;
      expect(request).toHaveBeenCalledTimes(dispatched);
      expect(results).toEqual([]);
    } finally {
      request.mockRestore();
      revision.mockRestore();
    }
  });
}
