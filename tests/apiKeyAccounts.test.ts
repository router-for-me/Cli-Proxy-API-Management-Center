import { afterEach, describe, expect, test } from 'bun:test';
import { apiClient } from '../src/services/api/client';
import { apiKeyAccountsApi } from '../src/services/api/apiKeyAccounts';
import type { ApiKeyProfile } from '../src/types/apiKeyAccounts';

const originalGet = apiClient.get;
const originalPost = apiClient.post;
const originalPut = apiClient.put;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.post = originalPost;
  apiClient.put = originalPut;
});

const profileInput = (): ApiKeyProfile => ({
  id: '',
  name: 'Alice',
  apiKey: '',
  keyFingerprint: '',
  disabled: false,
  allowedModels: ['gpt-*'],
  weekly: { requests: 25, tokens: 1000 },
  monthly: { requests: 100, tokens: 4000 },
});

describe('API key account management API', () => {
  test('maps list responses without inventing a plaintext key', async () => {
    apiClient.get = (async () => ({
      'api-key-profiles': [
        {
          id: 'alice-1234',
          name: 'Alice',
          'key-fingerprint': 'sha256:abc123',
          'allowed-models': ['gpt-*'],
          weekly: { requests: 25, tokens: 1000 },
        },
      ],
      'api-key-usage': {
        enabled: true,
        'database-path': '/var/lib/cpa/usage.db',
        'retention-days': 400,
        timezone: 'Asia/Seoul',
      },
    })) as typeof apiClient.get;

    const result = await apiKeyAccountsApi.getProfiles();

    expect(result.profiles[0]).toMatchObject({
      id: 'alice-1234',
      apiKey: '',
      keyFingerprint: 'sha256:abc123',
    });
    expect(result.settings).toEqual({
      enabled: true,
      databasePath: '/var/lib/cpa/usage.db',
      retentionDays: 400,
      timezone: 'Asia/Seoul',
    });
  });

  test('returns the generated secret from the create response once', async () => {
    let requestBody: unknown;
    apiClient.post = (async (url: string, data?: unknown) => {
      expect(url).toBe('/api-key-profiles');
      requestBody = data;
      return {
        profile: {
          id: 'alice-1234',
          name: 'Alice',
          'api-key': 'sk-cpa-generated-secret',
          'key-fingerprint': 'sha256:abc123',
        },
      };
    }) as typeof apiClient.post;

    const created = await apiKeyAccountsApi.create(profileInput());

    expect(requestBody).toMatchObject({ name: 'Alice', 'api-key': '' });
    expect(created.apiKey).toBe('sk-cpa-generated-secret');
    expect(created.keyFingerprint).toBe('sha256:abc123');
  });

  test('keeps update responses fingerprint-only when the key is unchanged', async () => {
    let requestBody: unknown;
    apiClient.put = (async (url: string, data?: unknown) => {
      expect(url).toBe('/api-key-profiles/alice%2Fteam');
      requestBody = data;
      return {
        profile: {
          id: 'alice/team',
          name: 'Alice Updated',
          'key-fingerprint': 'sha256:abc123',
          monthly: { requests: 200, tokens: 8000 },
        },
      };
    }) as typeof apiClient.put;

    const updated = await apiKeyAccountsApi.update({
      ...profileInput(),
      id: 'alice/team',
      name: 'Alice Updated',
      monthly: { requests: 200, tokens: 8000 },
    });

    expect(requestBody).toMatchObject({ id: 'alice/team', 'api-key': '' });
    expect(updated.apiKey).toBe('');
    expect(updated.keyFingerprint).toBe('sha256:abc123');
  });
});
