import { afterEach, describe, expect, test } from 'bun:test';
import { getProviderUsageKey } from '../src/components/providers/utils';
import { commandCodeToResource } from '../src/features/providers/adapters';
import { PROVIDER_BRAND_ORDER, PROVIDER_DESCRIPTORS } from '../src/features/providers/descriptors';
import { getProviderKeyCounts } from '../src/features/dashboard/hooks/useDashboardOverview';
import { MODEL_DISCOVERY_BRANDS } from '../src/features/providers/sheets/forms/useModelDiscovery';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { normalizeConfigResponse } from '../src/services/api/transformers';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
const originalDelete = apiClient.delete;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
  apiClient.delete = originalDelete;
});

describe('Command Code Go provider', () => {
  test('normalizes the backend commandcode-api-key contract and exposes a workbench resource', () => {
    const config = normalizeConfigResponse({
      'commandcode-api-key': [
        {
          'api-key': 'cmdc-secret-key-123',
          priority: 5,
          weight: 2,
          prefix: 'cmdc-go',
          'base-url': 'https://api.commandcode.ai/alpha',
          'proxy-url': 'http://127.0.0.1:17893',
          headers: { 'X-Custom-Header': 'custom-val' },
          models: [
            {
              name: 'claude-3-5-sonnet-20241022',
              alias: 'claude-3-5-sonnet',
            },
          ],
          'excluded-models': ['gpt-4o-mini'],
          'disable-cooling': true,
          'auth-index': 'commandcode:apikey:0',
        },
      ],
    });

    expect(config.commandCodeApiKeys).toEqual([
      {
        apiKey: 'cmdc-secret-key-123',
        priority: 5,
        weight: 2,
        prefix: 'cmdc-go',
        baseUrl: 'https://api.commandcode.ai/alpha',
        proxyUrl: 'http://127.0.0.1:17893',
        headers: { 'X-Custom-Header': 'custom-val' },
        models: [
          {
            name: 'claude-3-5-sonnet-20241022',
            alias: 'claude-3-5-sonnet',
          },
        ],
        excludedModels: ['gpt-4o-mini'],
        disableCooling: true,
        authIndex: 'commandcode:apikey:0',
      },
    ]);

    const resource = commandCodeToResource(config.commandCodeApiKeys![0], 0);
    expect(resource.brand).toBe('commandCode');
    expect(resource.baseUrl).toBe('https://api.commandcode.ai/alpha');
    expect(resource.proxyUrl).toBe('http://127.0.0.1:17893');
    expect(resource.prefix).toBe('cmdc-go');
    expect(resource.models).toEqual(['claude-3-5-sonnet-20241022']);
    expect(resource.priority).toBe(5);
    expect(resource.headerCount).toBe(1);
    expect(resource.excludedModelCount).toBe(1);
    expect(resource.disabled).toBe(false);
    expect(resource.flags.websockets).toBeUndefined();
    expect(resource.flags.cloakEnabled).toBeUndefined();
    expect(resource.selector).toEqual({
      brand: 'commandCode',
      apiKey: 'cmdc-secret-key-123',
      baseUrl: 'https://api.commandcode.ai/alpha',
      index: 0,
    });

    // Descriptor checks
    expect(PROVIDER_DESCRIPTORS.commandCode).toBeDefined();
    expect(PROVIDER_DESCRIPTORS.commandCode.supportsApiKey).toBe(true);
    expect(PROVIDER_DESCRIPTORS.commandCode.supportsBaseUrl).toBe(true);
    expect(PROVIDER_DESCRIPTORS.commandCode.baseUrlRequired).toBe(false);
    expect(PROVIDER_DESCRIPTORS.commandCode.supportsTestModel).toBe(false);
    expect(PROVIDER_DESCRIPTORS.commandCode.supportsWebsockets).toBe(false);
    expect(PROVIDER_DESCRIPTORS.commandCode.supportsCloak).toBe(false);
    expect(PROVIDER_BRAND_ORDER).toContain('commandCode');

    // Not in form-level model discovery brands (upstream /alpha does not expose a /v1/models query route;
    // CLIProxyAPI backend manages the dynamic catalog via remote provider models endpoint/CLI)
    expect(MODEL_DISCOVERY_BRANDS).not.toContain('commandCode');

    // Usage key mapping
    expect(getProviderUsageKey('commandCode')).toBe('commandcode');

    // Dashboard metrics key counts
    const counts = getProviderKeyCounts({
      commandCodeApiKeys: [{ apiKey: 'k1' }, { apiKey: 'k2' }],
    });
    expect(counts.commandCode).toBe(2);
  });

  test('creates, updates and deletes Command Code keys through the backend management contract', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = [];
    apiClient.get = (async (url: string) => {
      calls.push({ method: 'GET', url });
      return {
        'commandcode-api-key': [
          {
            'api-key': 'existing-key',
            'base-url': 'https://api.commandcode.ai/alpha',
            'future-field': 'preserved',
          },
        ],
      };
    }) as typeof apiClient.get;
    apiClient.put = (async (url: string, data?: unknown) => {
      calls.push({ method: 'PUT', url, data });
      return undefined;
    }) as typeof apiClient.put;
    apiClient.delete = (async (url: string) => {
      calls.push({ method: 'DELETE', url });
      return undefined;
    }) as typeof apiClient.delete;

    // Create
    await providersApi.createCommandCodeConfig({
      apiKey: 'new-key',
      priority: 2,
      weight: 1,
      prefix: 'go',
      baseUrl: 'https://api.commandcode.ai/alpha',
      proxyUrl: 'direct',
      models: [{ name: 'claude-3-5-sonnet' }],
      excludedModels: ['gpt-4o'],
      disableCooling: true,
    });

    expect(calls).toEqual([
      { method: 'GET', url: '/config' },
      {
        method: 'PUT',
        url: '/commandcode-api-key',
        data: [
          {
            'api-key': 'existing-key',
            'base-url': 'https://api.commandcode.ai/alpha',
            'future-field': 'preserved',
          },
          {
            'api-key': 'new-key',
            priority: 2,
            weight: 1,
            prefix: 'go',
            'base-url': 'https://api.commandcode.ai/alpha',
            'proxy-url': 'direct',
            models: [{ name: 'claude-3-5-sonnet' }],
            'excluded-models': ['gpt-4o'],
            'disable-cooling': true,
          },
        ],
      },
    ]);

    // Update
    calls.length = 0;
    await providersApi.updateCommandCodeConfig(
      'existing-key',
      'https://api.commandcode.ai/alpha',
      {
        apiKey: 'existing-key',
        priority: 10,
        baseUrl: 'https://api.commandcode.ai/alpha',
        proxyUrl: 'http://127.0.0.1:17893',
      }
    );

    expect(calls).toEqual([
      { method: 'GET', url: '/config' },
      {
        method: 'PUT',
        url: '/commandcode-api-key',
        data: [
          {
            'api-key': 'existing-key',
            'base-url': 'https://api.commandcode.ai/alpha',
            'future-field': 'preserved',
            priority: 10,
            'proxy-url': 'http://127.0.0.1:17893',
          },
        ],
      },
    ]);

    // Delete
    calls.length = 0;
    await providersApi.deleteCommandCodeConfig('existing-key', 'https://api.commandcode.ai/alpha');

    expect(calls).toEqual([
      {
        method: 'DELETE',
        url: '/commandcode-api-key?api-key=existing-key&base-url=https%3A%2F%2Fapi.commandcode.ai%2Falpha',
      },
    ]);
  });

  test('preserves unknown backend fields and strips auth-index upon update', async () => {
    let putPayload: unknown = null;
    apiClient.get = (async () => ({
      'commandcode-api-key': [
        {
          'api-key': 'cmdc-key',
          'base-url': 'https://api.commandcode.ai/alpha',
          'request-retry': 3,
          'request-scoped-errors': [{ code: 429, retry: 5 }],
          'auth-index': 'commandcode:apikey:0',
        },
      ],
    })) as typeof apiClient.get;
    apiClient.put = (async (_url: string, data?: unknown) => {
      putPayload = data;
      return undefined;
    }) as typeof apiClient.put;

    await providersApi.updateCommandCodeConfig(
      'cmdc-key',
      'https://api.commandcode.ai/alpha',
      {
        apiKey: 'cmdc-key',
        priority: 8,
        baseUrl: 'https://api.commandcode.ai/alpha',
      }
    );

    expect(putPayload).toEqual([
      {
        'api-key': 'cmdc-key',
        'base-url': 'https://api.commandcode.ai/alpha',
        'request-retry': 3,
        'request-scoped-errors': [{ code: 429, retry: 5 }],
        priority: 8,
      },
    ]);
  });
});
