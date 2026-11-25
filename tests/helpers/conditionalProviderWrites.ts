import { afterEach, beforeEach } from 'bun:test';
import { apiClient } from '@/services/api/client';

/** Expose a suite's mock config GET and PUT through the captured connection too. */
export function mockConditionalProviderWrites() {
  const { captureConnection, getRaw } = apiClient;
  beforeEach(() => {
    apiClient.captureConnection = () => apiClient;
    apiClient.getRaw = (async (url) => ({
      data: await apiClient.get(url),
      headers: { etag: '"fixture"' },
    })) as typeof getRaw;
  });
  afterEach(() => Object.assign(apiClient, { captureConnection, getRaw }));
}
