import { afterEach, describe, expect, test } from 'bun:test';
import { kimiToResource } from '../src/features/providers/adapters';
import { PROVIDER_DESCRIPTORS } from '../src/features/providers/descriptors';
import { isMultiProtocolSponsorBrand } from '../src/features/providers/sponsorDefinitions';
import { apiClient } from '../src/services/api/client';
import { providersApi } from '../src/services/api/providers';
import { normalizeConfigResponse } from '../src/services/api/transformers';
import { KIMI_CONFIG, mergeKimiQuotaFiles } from '../src/features/quota/providers/kimi/data';

const originalGet = apiClient.get;
const originalPut = apiClient.put;
const originalDelete = apiClient.delete;

afterEach(() => {
  apiClient.get = originalGet;
  apiClient.put = originalPut;
  apiClient.delete = originalDelete;
});

describe('Kimi API key provider', () => {
  test('normalizes the backend kimi-api-key contract and exposes a workbench resource', () => {
    const config = normalizeConfigResponse({
      'kimi-api-key': [
        {
          'api-key': 'sk-open',
          service: 'open-platform',
          region: 'domestic',
          name: 'office',
          weight: 2,
          prefix: 'kimi',
          'proxy-url': 'http://proxy.local',
          headers: { 'X-Custom': 'value' },
          priority: 2,
          'disable-cooling': true,
          models: [{ name: 'k3', alias: 'kimi-k3' }],
          'auth-index': 'kimi:apikey:1',
        },
        {
          'api-key': 'sk-code',
          service: 'coding-plan',
          'auth-index': 'kimi:apikey:2',
        },
      ],
    });

    expect(config.kimiApiKeys).toEqual([
      {
        apiKey: 'sk-open',
        service: 'open-platform',
        region: 'domestic',
        name: 'office',
        weight: 2,
        prefix: 'kimi',
        proxyUrl: 'http://proxy.local',
        headers: { 'X-Custom': 'value' },
        priority: 2,
        disableCooling: true,
        models: [{ name: 'k3', alias: 'kimi-k3' }],
        authIndex: 'kimi:apikey:1',
      },
      {
        apiKey: 'sk-code',
        service: 'coding-plan',
        authIndex: 'kimi:apikey:2',
      },
    ]);

    const resource = kimiToResource(config.kimiApiKeys![0], 0);
    expect(resource.brand).toBe('kimi');
    expect(resource.name).toBe('office');
    expect(resource.baseUrl).toBe('https://api.moonshot.cn');
    expect(resource.modelCount).toBe(1);
    expect(resource.models).toEqual(['k3']);
    expect(PROVIDER_DESCRIPTORS.kimi.supportsModels).toBe(true);
    expect(PROVIDER_DESCRIPTORS.kimi.supportsTestModel).toBe(true);
    expect(PROVIDER_DESCRIPTORS.kimi.supportsExcludedModels).toBe(false);
    expect(resource.selector).toEqual({
      brand: 'kimi',
      apiKey: 'sk-open',
      service: 'open-platform',
      region: 'domestic',
      index: 0,
    });
    expect(PROVIDER_DESCRIPTORS.kimi.supportsName).toBe(true);
    expect(isMultiProtocolSponsorBrand('kimi')).toBe(false);
    expect(kimiToResource(config.kimiApiKeys![1], 1).baseUrl).toBe('https://api.kimi.com/coding');
  });

  test('creates and deletes Kimi keys through the backend management contract', async () => {
    const calls: Array<{ method: string; url: string; data?: unknown }> = [];
    apiClient.get = (async (url: string) => {
      calls.push({ method: 'GET', url });
      return {
        'kimi-api-key': [
          {
            'api-key': 'existing',
            service: 'coding-plan',
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

    await providersApi.createKimiConfig({
      apiKey: 'sk-new',
      service: 'open-platform',
      region: 'international',
      name: 'travel',
      weight: 3,
      prefix: 'kimi',
      proxyUrl: 'direct',
      headers: { 'X-Custom': 'value' },
      models: [{ name: 'k3', alias: 'kimi-k3' }],
    });
    await providersApi.deleteKimiConfig(
      'sk-new',
      'open-platform',
      'international',
      1,
      'kimi',
      'direct'
    );

    expect(calls).toEqual([
      { method: 'GET', url: '/config' },
      {
        method: 'PUT',
        url: '/kimi-api-key',
        data: [
          {
            'api-key': 'existing',
            service: 'coding-plan',
            'future-field': 'preserved',
          },
          {
            'api-key': 'sk-new',
            service: 'open-platform',
            region: 'international',
            name: 'travel',
            weight: 3,
            prefix: 'kimi',
            'proxy-url': 'direct',
            headers: { 'X-Custom': 'value' },
            models: [{ name: 'k3', alias: 'kimi-k3' }],
          },
        ],
      },
      {
        method: 'DELETE',
        url: '/kimi-api-key?api-key=sk-new&service=open-platform&region=international&prefix=kimi&proxy-url=direct&index=1',
      },
    ]);
  });

  test('quota lists OAuth files and coding-plan keys, not open-platform keys', () => {
    const oauth = { name: 'kimi-oauth.json', provider: 'kimi', authIndex: '1' };
    const openPlatform = {
      name: 'kimi-open',
      provider: 'kimi',
      runtimeOnly: true,
      kimiService: 'open-platform',
      authIndex: '2',
    };
    const merged = mergeKimiQuotaFiles([oauth, openPlatform], [
      {
        apiKey: 'sk-code',
        service: 'coding-plan',
        name: 'plan',
        authIndex: '3',
      },
      {
        apiKey: 'sk-open',
        service: 'open-platform',
        region: 'domestic',
        authIndex: '4',
      },
    ]);

    expect(merged.filter((file) => KIMI_CONFIG.filterFn(file)).map((file) => file.authIndex)).toEqual(
      ['1', '3']
    );
    expect(merged.find((file) => file.authIndex === '3')?.name).toContain('plan');
  });

  test('quota skips disabled coding-plan keys and keeps unique names', () => {
    const merged = mergeKimiQuotaFiles([], [
      {
        apiKey: 'sk-a',
        service: 'coding-plan',
        name: 'desk',
        authIndex: 'aaaa1111bbbb2222',
        excludedModels: ['*'],
      },
      {
        apiKey: 'sk-b',
        service: 'coding-plan',
        name: 'desk',
        authIndex: 'cccc3333dddd4444',
      },
    ]);
    expect(merged.filter((file) => KIMI_CONFIG.filterFn(file)).map((file) => file.authIndex)).toEqual(
      ['cccc3333dddd4444']
    );
    expect(merged[0].name).toBe('desk · cccc3333dddd4444');
  });
});
