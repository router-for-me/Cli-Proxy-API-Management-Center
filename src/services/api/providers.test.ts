import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

vi.mock('./client', () => ({
  apiClient: {
    get: mocks.get,
    put: mocks.put,
  },
}));

import { providersApi } from './providers';
import { normalizeOpenAIProvider } from './transformers';
import type { ProviderKeyConfig, OpenAIProviderConfig } from '@/types';

const claudeConfig = (overrides: Partial<ProviderKeyConfig> = {}): ProviderKeyConfig => ({
  apiKey: overrides.apiKey ?? 'sk-current',
  priority: overrides.priority,
  prefix: overrides.prefix ?? '',
  baseUrl: overrides.baseUrl ?? 'https://api.anthropic.com',
  proxyUrl: overrides.proxyUrl,
  headers: overrides.headers,
  models: overrides.models,
  excludedModels: overrides.excludedModels,
  cloak: overrides.cloak,
  websockets: overrides.websockets,
  authIndex: overrides.authIndex,
});

const lastPutBody = () => {
  expect(mocks.put).toHaveBeenCalledTimes(1);
  return mocks.put.mock.calls[0]?.[1];
};

describe('providersApi.saveClaudeConfigs raw-field preservation', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.put.mockResolvedValue(undefined);
  });

  it('preserves unknown server-side fields when identity (apiKey + baseUrl) matches', async () => {
    mocks.get.mockResolvedValue({
      'claude-api-key': [
        {
          'api-key': 'sk-current',
          'base-url': 'https://api.anthropic.com',
          priority: 5,
          'custom-experiment-flag': 'beta',
          metadata: { team: 'platform' },
        },
      ],
    });

    await providersApi.saveClaudeConfigs([claudeConfig({ priority: 10 })]);

    const body = lastPutBody();
    expect(body).toEqual([
      expect.objectContaining({
        'api-key': 'sk-current',
        'base-url': 'https://api.anthropic.com',
        priority: 10,
        'custom-experiment-flag': 'beta',
        metadata: { team: 'platform' },
      }),
    ]);
  });

  it('falls back to index match when identity differs, carrying unknown fields onto the new key', async () => {
    mocks.get.mockResolvedValue({
      'claude-api-key': [
        {
          'api-key': 'sk-old',
          'base-url': 'https://api.anthropic.com',
          'custom-experiment-flag': 'beta',
        },
      ],
    });

    await providersApi.saveClaudeConfigs([claudeConfig({ apiKey: 'sk-new' })]);

    const body = lastPutBody();
    // M3 documented behavior: index fallback keeps unknown fields with the new apiKey.
    expect(body).toEqual([
      expect.objectContaining({
        'api-key': 'sk-new',
        'custom-experiment-flag': 'beta',
      }),
    ]);
  });

  it('strips known fields from raw before applying payload so cleared values are honored', async () => {
    mocks.get.mockResolvedValue({
      'claude-api-key': [
        {
          'api-key': 'sk-current',
          'base-url': 'https://api.anthropic.com',
          prefix: 'legacy-prefix',
          headers: { 'X-Old': 'true' },
        },
      ],
    });

    // Form has no prefix and no headers -> serializeProviderKey omits them entirely.
    await providersApi.saveClaudeConfigs([claudeConfig()]);

    const body = lastPutBody();
    expect(body[0]).not.toHaveProperty('prefix');
    expect(body[0]).not.toHaveProperty('headers');
  });

  it('merges cloak sub-fields with CLOAK_FIELDS-aware semantics', async () => {
    mocks.get.mockResolvedValue({
      'claude-api-key': [
        {
          'api-key': 'sk-current',
          'base-url': 'https://api.anthropic.com',
          cloak: {
            mode: 'strict',
            'strict-mode': true,
            'sensitive-words': ['legacy'],
            'unknown-cloak-extension': 'preserved',
          },
        },
      ],
    });

    await providersApi.saveClaudeConfigs([
      claudeConfig({
        cloak: { mode: 'lenient', strictMode: false, sensitiveWords: ['fresh'] },
      }),
    ]);

    const body = lastPutBody();
    expect(body[0].cloak).toEqual(
      expect.objectContaining({
        mode: 'lenient',
        'strict-mode': false,
        'sensitive-words': ['fresh'],
        'unknown-cloak-extension': 'preserved',
      })
    );
  });

  it('falls back to payload-only save when GET /config rejects (auth/network failure)', async () => {
    mocks.get.mockRejectedValue(new Error('Request failed with status code 401'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await providersApi.saveClaudeConfigs([claudeConfig({ priority: 7 })]);
    } finally {
      warnSpy.mockRestore();
    }

    const body = lastPutBody();
    expect(body).toEqual([
      expect.objectContaining({
        'api-key': 'sk-current',
        'base-url': 'https://api.anthropic.com',
        priority: 7,
      }),
    ]);
    // No raw-preservation fields leak through when fallback is taken.
    expect(body[0]).not.toHaveProperty('custom-experiment-flag');
  });

  it('treats missing section in raw config the same as an empty list', async () => {
    mocks.get.mockResolvedValue({ 'unrelated-section': [] });

    await providersApi.saveClaudeConfigs([claudeConfig()]);

    const body = lastPutBody();
    expect(body).toEqual([
      expect.objectContaining({
        'api-key': 'sk-current',
      }),
    ]);
  });

  it('serializes authIndex as auth-index and matches raw records by auth-index', async () => {
    mocks.get.mockResolvedValue({
      'claude-api-key': [
        {
          'api-key': 'sk-old',
          'base-url': 'https://api.anthropic.com',
          auth_index: '42',
          'custom-experiment-flag': 'beta',
        },
      ],
    });

    await providersApi.saveClaudeConfigs([
      claudeConfig({ apiKey: 'sk-new', authIndex: '42' }),
    ]);

    const body = lastPutBody();
    expect(body).toEqual([
      expect.objectContaining({
        'api-key': 'sk-new',
        'auth-index': '42',
        'custom-experiment-flag': 'beta',
      }),
    ]);
    expect(body[0]).not.toHaveProperty('auth_index');
  });
});

describe('providersApi.saveOpenAIProviders raw-field preservation', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.put.mockResolvedValue(undefined);
  });

  const openAIConfig = (overrides: Partial<OpenAIProviderConfig> = {}): OpenAIProviderConfig => ({
    name: overrides.name ?? 'router-1',
    baseUrl: overrides.baseUrl ?? 'https://openai.example.com/v1',
    apiKeyEntries: overrides.apiKeyEntries ?? [
      { apiKey: 'sk-1', proxyUrl: '', authIndex: '', headers: {} },
    ],
    prefix: overrides.prefix,
    disabled: overrides.disabled,
    headers: overrides.headers,
    models: overrides.models,
    priority: overrides.priority,
    testModel: overrides.testModel,
  });

  it('preserves apiKeyEntries unknown fields when their api-key identity matches', async () => {
    mocks.get.mockResolvedValue({
      'openai-compatibility': [
        {
          name: 'router-1',
          'base-url': 'https://openai.example.com/v1',
          'api-key-entries': [
            {
              'api-key': 'sk-1',
              'proxy-url': 'http://internal-proxy:8080',
              'custom-entry-meta': 'keep',
            },
          ],
        },
      ],
    });

    await providersApi.saveOpenAIProviders([
      openAIConfig({
        apiKeyEntries: [
          { apiKey: 'sk-1', proxyUrl: 'http://internal-proxy:8080', authIndex: '', headers: {} },
        ],
      }),
    ]);

    const body = lastPutBody();
    expect(body[0]['api-key-entries']).toEqual([
      expect.objectContaining({
        'api-key': 'sk-1',
        'proxy-url': 'http://internal-proxy:8080',
        'custom-entry-meta': 'keep',
      }),
    ]);
  });

  it('preserves provider-level extensions while overwriting known fields', async () => {
    mocks.get.mockResolvedValue({
      'openai-compatibility': [
        {
          name: 'router-1',
          'base-url': 'https://old.example.com',
          'unknown-provider-flag': true,
        },
      ],
    });

    await providersApi.saveOpenAIProviders([
      openAIConfig({ baseUrl: 'https://new.example.com/v1' }),
    ]);

    const body = lastPutBody();
    expect(body[0]).toEqual(
      expect.objectContaining({
        name: 'router-1',
        'base-url': 'https://new.example.com/v1',
        'unknown-provider-flag': true,
      })
    );
  });

  it('falls back to payload-only when GET /config fails', async () => {
    mocks.get.mockRejectedValue(new Error('network'));
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await providersApi.saveOpenAIProviders([openAIConfig()]);
    } finally {
      warnSpy.mockRestore();
    }

    const body = lastPutBody();
    expect(body[0]).toEqual(
      expect.objectContaining({ name: 'router-1', 'base-url': 'https://openai.example.com/v1' })
    );
  });

  it('serializes authIndex-only apiKeyEntries and preserves raw fields by auth-index identity', async () => {
    mocks.get.mockResolvedValue({
      'openai-compatibility': [
        {
          name: 'router-1',
          'base-url': 'https://openai.example.com/v1',
          'api-key-entries': [
            {
              'api-key': 'sk-old',
              'auth_index': '7',
              'custom-entry-meta': 'keep',
            },
          ],
        },
      ],
    });

    await providersApi.saveOpenAIProviders([
      openAIConfig({
        apiKeyEntries: [{ apiKey: '', authIndex: '7', proxyUrl: '', headers: {} }],
      }),
    ]);

    const body = lastPutBody();
    expect(body[0]['api-key-entries']).toEqual([
      expect.objectContaining({
        'auth-index': '7',
        'custom-entry-meta': 'keep',
      }),
    ]);
    expect(body[0]['api-key-entries'][0]).not.toHaveProperty('api-key');
    expect(body[0]['api-key-entries'][0]).not.toHaveProperty('auth_index');
  });

  it('normalizes OpenAI authIndex-only apiKeyEntries instead of dropping them', () => {
    const provider = normalizeOpenAIProvider({
      name: 'router-1',
      'base-url': 'https://openai.example.com/v1',
      'api-key-entries': [{ 'auth-index': '7' }],
    });

    expect(provider?.apiKeyEntries).toEqual([{ apiKey: '', authIndex: '7', headers: undefined }]);
  });
});

describe('providersApi.saveGeminiKeys uses GEMINI_KEY_FIELDS (no websockets/cloak)', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.put.mockReset();
    mocks.put.mockResolvedValue(undefined);
  });

  it('keeps a server-side cloak block on gemini sections because GEMINI_KEY_FIELDS excludes cloak', async () => {
    mocks.get.mockResolvedValue({
      'gemini-api-key': [
        {
          'api-key': 'g-key',
          'base-url': 'https://generativelanguage.googleapis.com',
          cloak: { mode: 'strict' },
        },
      ],
    });

    await providersApi.saveGeminiKeys([
      {
        apiKey: 'g-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
      } as never,
    ]);

    const body = lastPutBody();
    // cloak is not in GEMINI_KEY_FIELDS, so cloneWithoutKnownFields keeps the server-side value.
    expect(body[0]).toEqual(
      expect.objectContaining({
        'api-key': 'g-key',
        cloak: { mode: 'strict' },
      })
    );
  });

  it('serializes authIndex as auth-index for Gemini keys', async () => {
    mocks.get.mockResolvedValue({ 'gemini-api-key': [] });

    await providersApi.saveGeminiKeys([
      {
        apiKey: 'g-key',
        baseUrl: 'https://generativelanguage.googleapis.com',
        authIndex: '9',
      },
    ]);

    const body = lastPutBody();
    expect(body).toEqual([
      expect.objectContaining({
        'api-key': 'g-key',
        'auth-index': '9',
      }),
    ]);
  });
});
