import { describe, expect, test } from 'bun:test';
import {
  applySmartConfigCandidate,
  fieldKindOf,
  maskApiKey,
  normalizeBaseUrl,
  parseSmartConfig,
} from '@/features/providers/smartConfig';
import type { ProviderEntryFormInput } from '@/features/providers/types';

const form = (overrides: Partial<ProviderEntryFormInput> = {}): ProviderEntryFormInput => ({
  apiKey: '',
  name: '',
  baseUrl: '',
  proxyUrl: '',
  prefix: '',
  disabled: false,
  models: [{ name: '', alias: '' }],
  headers: [{ key: '', value: '' }],
  excludedModelsText: '',
  ...overrides,
});

describe('fieldKindOf', () => {
  test('maps common English aliases', () => {
    expect(fieldKindOf('base_url')).toBe('baseUrl');
    expect(fieldKindOf('baseURL')).toBe('baseUrl');
    expect(fieldKindOf('ANTHROPIC_BASE_URL')).toBe('baseUrl');
    expect(fieldKindOf('api_base')).toBe('baseUrl');
    expect(fieldKindOf('api-key')).toBe('apiKey');
    expect(fieldKindOf('OPENAI_API_KEY')).toBe('apiKey');
    expect(fieldKindOf('AUTH_TOKEN')).toBe('apiKey');
    expect(fieldKindOf('keys')).toBe('apiKey');
    expect(fieldKindOf('models')).toBe('models');
    expect(fieldKindOf('name')).toBe('name');
    expect(fieldKindOf('prefix')).toBe('prefix');
  });

  test('maps Chinese aliases', () => {
    expect(fieldKindOf('接口地址')).toBe('baseUrl');
    expect(fieldKindOf('密钥')).toBe('apiKey');
    expect(fieldKindOf('模型列表')).toBe('models');
  });

  test('does not treat unrelated fields as credentials', () => {
    expect(fieldKindOf('website_url')).toBeNull();
    expect(fieldKindOf('wire_api')).toBeNull();
    expect(fieldKindOf('test-model')).toBeNull();
    expect(fieldKindOf('group')).toBeNull();
  });
});

describe('normalizeBaseUrl', () => {
  test('keeps a plain base URL', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1').value).toBe('https://api.example.com/v1');
  });

  test('trims endpoint suffixes and trailing slashes', () => {
    expect(normalizeBaseUrl('https://api.example.com/v1/chat/completions').value).toBe(
      'https://api.example.com/v1'
    );
    expect(normalizeBaseUrl('https://api.example.com/v1/messages').value).toBe(
      'https://api.example.com/v1'
    );
    expect(normalizeBaseUrl('https://api.example.com/v1/').value).toBe('https://api.example.com/v1');
  });

  test('adds a scheme to bare hosts', () => {
    expect(normalizeBaseUrl('api.example.com/v1').value).toBe('https://api.example.com/v1');
  });
});

describe('parseSmartConfig', () => {
  test('parses plain labelled text', () => {
    const result = parseSmartConfig(
      ['Base URL: https://api.example.com/v1', 'API Key: sk-1234567890abcdefghij'].join('\n')
    );
    expect(result?.format).toBe('key-value');
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
    expect(result?.candidates[0].apiKeys).toEqual(['sk-1234567890abcdefghij']);
  });

  test('parses Chinese labelled text', () => {
    const result = parseSmartConfig(
      ['接口地址：https://api.example.com/v1', '密钥：sk-1234567890abcdefghij', '名称：测试渠道'].join(
        '\n'
      )
    );
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
    expect(result?.candidates[0].apiKeys).toEqual(['sk-1234567890abcdefghij']);
    expect(result?.candidates[0].name).toBe('测试渠道');
  });

  test('parses a cc-switch Claude provider', () => {
    const text = JSON.stringify({
      claude: {
        providers: {
          'uuid-1': {
            name: 'AnyRouter',
            settingsConfig: {
              env: {
                ANTHROPIC_BASE_URL: 'https://anyrouter.top/api',
                ANTHROPIC_AUTH_TOKEN: 'sk-ant-abcdefghijklmnopqrst',
              },
            },
          },
        },
      },
    });
    const result = parseSmartConfig(text);
    expect(result?.format).toBe('cc-switch');
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]).toMatchObject({
      name: 'AnyRouter',
      baseUrl: 'https://anyrouter.top/api',
      apiKeys: ['sk-ant-abcdefghijklmnopqrst'],
    });
  });

  test('parses a cc-switch Codex provider with a TOML config string', () => {
    const text = JSON.stringify({
      codex: {
        providers: {
          'server-1': {
            name: 'CodexRocks',
            settingsConfig: {
              auth: { OPENAI_API_KEY: 'sk-proj-abcdefghijklmnop' },
              config: [
                'model_provider = "custom"',
                'model = "gpt-5-codex"',
                '',
                '[model_providers.custom]',
                'name = "custom"',
                'base_url = "https://api.codexrocks.com/v1"',
                'wire_api = "responses"',
              ].join('\n'),
            },
          },
        },
      },
    });
    const result = parseSmartConfig(text);
    expect(result?.format).toBe('cc-switch');
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0].name).toBe('CodexRocks');
    expect(result?.candidates[0].baseUrl).toBe('https://api.codexrocks.com/v1');
    expect(result?.candidates[0].apiKeys).toEqual(['sk-proj-abcdefghijklmnop']);
    expect(result?.candidates[0].models).toContain('gpt-5-codex');
  });

  test('parses a new-api channel export', () => {
    const text = JSON.stringify([
      {
        id: 3,
        type: 1,
        name: 'OpenAI-Proxy',
        key: 'sk-abcdefghijklmnopqrstuvwxyz',
        base_url: 'https://proxy.example.com',
        models: 'gpt-4o,gpt-4o-mini',
        group: 'default',
        status: 1,
      },
    ]);
    const result = parseSmartConfig(text);
    expect(result?.format).toBe('new-api');
    expect(result?.candidates[0]).toMatchObject({
      name: 'OpenAI-Proxy',
      baseUrl: 'https://proxy.example.com',
      apiKeys: ['sk-abcdefghijklmnopqrstuvwxyz'],
    });
    expect(result?.candidates[0].models).toEqual(['gpt-4o', 'gpt-4o-mini']);
  });

  test('parses a new-api connection string with a url field', () => {
    const text = JSON.stringify({
      _type: 'newapi_channel_conn',
      key: 'sk-MOX-0123456789abcdefghijklmnopqrstuvwxyzABCD',
      url: 'https://newapi.example.com',
    });
    const result = parseSmartConfig(text);
    expect(result?.format).toBe('new-api');
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0]).toMatchObject({
      baseUrl: 'https://newapi.example.com',
      apiKeys: ['sk-MOX-0123456789abcdefghijklmnopqrstuvwxyzABCD'],
      models: [],
      name: null,
      warnings: [],
    });
  });

  test('parses a CLIProxyAPI openai-compatibility export', () => {
    const text = JSON.stringify([
      {
        name: 'my-openai',
        'base-url': 'https://api.example.com/v1/chat/completions',
        keys: [{ 'api-key': 'sk-aaaabbbbccccdddd1111' }, { 'api-key': 'sk-eeeeffffgggghhhh2222' }],
        models: [{ name: 'gpt-4o' }, { name: 'gpt-4o-mini' }],
      },
    ]);
    const result = parseSmartConfig(text);
    expect(result?.candidates).toHaveLength(1);
    const candidate = result?.candidates[0];
    expect(candidate?.baseUrl).toBe('https://api.example.com/v1');
    expect(candidate?.apiKeys).toEqual(['sk-aaaabbbbccccdddd1111', 'sk-eeeeffffgggghhhh2222']);
    expect(candidate?.models).toEqual(['gpt-4o', 'gpt-4o-mini']);
    expect(candidate?.warnings).toContain('normalizedBaseUrl');
  });

  test('parses a curl snippet', () => {
    const text = [
      'curl https://api.example.com/v1/chat/completions \\',
      '  -H "Authorization: Bearer sk-abcdefghijklmnopqrstuvwxyz" \\',
      '  -H "Content-Type: application/json" \\',
      `  -d '{"model":"gpt-4o-mini"}'`,
    ].join('\n');
    const result = parseSmartConfig(text);
    expect(result?.format).toBe('curl');
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
    expect(result?.candidates[0].apiKeys).toEqual(['sk-abcdefghijklmnopqrstuvwxyz']);
  });

  test('parses a bare URL followed by a bare key', () => {
    const result = parseSmartConfig(
      ['https://api.example.com/v1', 'sk-abcdefghijklmnopqrstuvwxyz123456'].join('\n')
    );
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
    expect(result?.candidates[0].apiKeys).toEqual(['sk-abcdefghijklmnopqrstuvwxyz123456']);
  });

  test('reports multiple candidates for a multi-provider export', () => {
    const text = JSON.stringify([
      { name: 'first', key: 'sk-aaaa1111bbbb2222cccc', base_url: 'https://a.example.com' },
      { name: 'second', key: 'sk-dddd3333eeee4444ffff', base_url: 'https://b.example.com' },
    ]);
    const result = parseSmartConfig(text);
    expect(result?.candidates).toHaveLength(2);
  });

  test('splits blank-line separated snippets into separate candidates', () => {
    const text = [
      'Base URL: https://a.example.com/v1',
      'API Key: sk-aaaa1111bbbb2222cccc',
      '',
      'Base URL: https://b.example.com/v1',
      'API Key: sk-dddd3333eeee4444ffff',
    ].join('\n');
    const result = parseSmartConfig(text);
    expect(result?.candidates).toHaveLength(2);
    expect(result?.candidates[0].baseUrl).toBe('https://a.example.com/v1');
    expect(result?.candidates[1].baseUrl).toBe('https://b.example.com/v1');
  });

  test('splits on horizontal rules', () => {
    const text = [
      'https://a.example.com/v1',
      'sk-aaaa1111bbbb2222cccc',
      '---',
      'https://b.example.com/v1',
      'sk-dddd3333eeee4444ffff',
    ].join('\n');
    const result = parseSmartConfig(text);
    expect(result?.candidates).toHaveLength(2);
    expect(result?.candidates[1].baseUrl).toBe('https://b.example.com/v1');
  });

  test('merges a block that only carries a bare key back into the previous block', () => {
    const text = [
      'Base URL: https://api.example.com/v1',
      '',
      'sk-abcdefghijklmnopqrstuvwxyz12',
    ].join('\n');
    const result = parseSmartConfig(text);
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
    expect(result?.candidates[0].apiKeys).toEqual(['sk-abcdefghijklmnopqrstuvwxyz12']);
  });

  test('keeps a pretty-printed TOML block with an MCP section as one candidate', () => {
    const text = [
      'model_provider = "custom"',
      'model = "gpt-5.5"',
      '',
      '[model_providers.custom]',
      'name = "custom"',
      'base_url = "https://api.example.com/v1"',
      '',
      '[mcp_servers.context7]',
      'url = "https://mcp.context7.com/mcp"',
    ].join('\n');
    const result = parseSmartConfig(text);
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
  });

  test('returns null when nothing usable is present', () => {
    expect(parseSmartConfig('hello world, just some notes')).toBeNull();
    expect(parseSmartConfig('   ')).toBeNull();
  });

  test('ignores JWT OAuth tokens so a cc-switch chatgpt export stays a single candidate', () => {
    const text = JSON.stringify({
      auth: {
        auth_mode: 'chatgpt',
        OPENAI_API_KEY: null,
        tokens: { access_token: 'eyJhbGciOiJSUzI1NiJ9.eyJhIjoiYiJ9.c2lnbmF0dXJl' },
      },
      config: ['model = "gpt-5.5"', '[model_providers.custom]', 'base_url = "https://api.example.com/v1"'].join(
        '\n'
      ),
    });
    const result = parseSmartConfig(text);
    expect(result?.candidates).toHaveLength(1);
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
    expect(result?.candidates[0].apiKeys).toEqual([]);
    expect(result?.candidates[0].warnings).toContain('noApiKey');
  });

  test('ignores MCP server URLs when choosing the base URL', () => {
    const text = [
      'model = "gpt-5.5"',
      '[model_providers.custom]',
      'base_url = "https://api.example.com/v1"',
      '',
      '[mcp_servers.context7]',
      'url = "https://mcp.context7.com/mcp"',
    ].join('\n');
    const result = parseSmartConfig(text);
    expect(result?.candidates[0].baseUrl).toBe('https://api.example.com/v1');
  });

  test('warns when the base URL was trimmed or the key is missing', () => {
    const result = parseSmartConfig('Base URL: https://api.example.com/v1/chat/completions');
    expect(result?.candidates[0].warnings).toContain('noApiKey');
    expect(result?.candidates[0].warnings).toContain('normalizedBaseUrl');
  });
});

describe('provider brand format matrix', () => {
  const cases: Array<{
    title: string;
    text: string;
    format?: string;
    baseUrl: string | null;
    apiKeys: string[];
    name?: string | null;
    warnings?: string[];
  }> = [
    {
      title: 'gemini JSON object',
      text: JSON.stringify({
        baseUrl: 'https://generativelanguage.googleapis.com',
        apiKey: 'AIzaSyD1234567890abcdefghijklmnop',
      }),
      format: 'json',
      baseUrl: 'https://generativelanguage.googleapis.com',
      apiKeys: ['AIzaSyD1234567890abcdefghijklmnop'],
    },
    {
      title: 'gemini Chinese labelled text',
      text: [
        '接口地址：https://generativelanguage.googleapis.com/v1beta',
        'API 密钥：AIzaSyD1234567890abcdefghijklmnop',
      ].join('\n'),
      format: 'key-value',
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeys: ['AIzaSyD1234567890abcdefghijklmnop'],
    },
    {
      title: 'vertex labelled text',
      text: [
        'Base URL: https://us-central1-aiplatform.googleapis.com',
        'API Key: AIzaSyV1234567890abcdefghijklmnop',
      ].join('\n'),
      baseUrl: 'https://us-central1-aiplatform.googleapis.com',
      apiKeys: ['AIzaSyV1234567890abcdefghijklmnop'],
    },
    {
      title: 'codex OpenAI-style env export',
      text: [
        'OPENAI_BASE_URL: https://api.codex.example.com/v1',
        'OPENAI_API_KEY: sk-proj-abcdefghijklmnopqrstuvwx',
      ].join('\n'),
      format: 'openai',
      baseUrl: 'https://api.codex.example.com/v1',
      apiKeys: ['sk-proj-abcdefghijklmnopqrstuvwx'],
    },
    {
      title: 'xai labelled text',
      text: ['Base URL: https://api.x.ai/v1', 'API Key: xai-abcdefghijklmnopqrstuvwxyz123456'].join(
        '\n'
      ),
      baseUrl: 'https://api.x.ai/v1',
      apiKeys: ['xai-abcdefghijklmnopqrstuvwxyz123456'],
    },
    {
      title: 'claude ANTHROPIC_* env',
      text: [
        'ANTHROPIC_BASE_URL=https://api.anthropic.com',
        'ANTHROPIC_API_KEY=sk-ant-abcdefghijklmnopqrstuvwx',
      ].join('\n'),
      format: 'claude-code',
      baseUrl: 'https://api.anthropic.com',
      apiKeys: ['sk-ant-abcdefghijklmnopqrstuvwx'],
    },
    {
      title: 'meta labelled text',
      text: [
        'Base URL: https://api.llama.com/compat/v1',
        'API Key: LLM-abcdefghijklmnopqrstuvwxyz1234',
      ].join('\n'),
      baseUrl: 'https://api.llama.com/compat/v1',
      apiKeys: ['LLM-abcdefghijklmnopqrstuvwxyz1234'],
    },
    {
      title: 'interactions labelled text',
      text: [
        'Base URL: https://generativelanguage.googleapis.com/v1beta',
        'API Key: AIzaSyINT1234567890abcdefghijklmn',
      ].join('\n'),
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
      apiKeys: ['AIzaSyINT1234567890abcdefghijklmn'],
    },
    {
      title: 'kimi key-only (no base URL)',
      text: 'API Key: sk-kimi-abcdefghijklmnopqrstuvwxyz',
      baseUrl: null,
      apiKeys: ['sk-kimi-abcdefghijklmnopqrstuvwxyz'],
      warnings: ['noBaseUrl'],
    },
    {
      title: 'apikeyFun Chinese key-only',
      text: '密钥：sk-apikeyfun-abcdefghijklmnopqrst',
      format: 'text',
      baseUrl: null,
      apiKeys: ['sk-apikeyfun-abcdefghijklmnopqrst'],
      warnings: ['noBaseUrl'],
    },
    {
      title: 'fennoAI key-only',
      text: 'api_key = "sk-fenno-abcdefghijklmnopqrstuvwx"',
      baseUrl: null,
      apiKeys: ['sk-fenno-abcdefghijklmnopqrstuvwx'],
      warnings: ['noBaseUrl'],
    },
    {
      title: 'qiniuCloud key-only',
      text: 'API Key: sk-qiniu-abcdefghijklmnopqrstuvwx',
      baseUrl: null,
      apiKeys: ['sk-qiniu-abcdefghijklmnopqrstuvwx'],
      warnings: ['noBaseUrl'],
    },
    {
      title: 'openaiCompatibility multi-key array',
      text: JSON.stringify([
        {
          name: 'team-openai',
          'base-url': 'https://api.example.com/v1/chat/completions',
          keys: [{ 'api-key': 'sk-aaaabbbbccccdddd1111' }, { 'api-key': 'sk-eeeeffffgggghhhh2222' }],
        },
      ]),
      baseUrl: 'https://api.example.com/v1',
      apiKeys: ['sk-aaaabbbbccccdddd1111', 'sk-eeeeffffgggghhhh2222'],
      name: 'team-openai',
      warnings: ['normalizedBaseUrl'],
    },
  ];

  for (const testCase of cases) {
    test(`parses ${testCase.title}`, () => {
      const result = parseSmartConfig(testCase.text);
      expect(result).not.toBeNull();
      expect(result?.candidates).toHaveLength(1);
      const candidate = result?.candidates[0];
      expect(candidate?.baseUrl).toBe(testCase.baseUrl);
      expect(candidate?.apiKeys).toEqual(testCase.apiKeys);
      if (testCase.format) expect(result?.format).toBe(testCase.format);
      if (testCase.name !== undefined) expect(candidate?.name).toBe(testCase.name);
      if (testCase.warnings) expect(candidate?.warnings).toEqual(testCase.warnings);
    });
  }
});

describe('applySmartConfigCandidate per brand', () => {
  const candidate = {
    baseUrl: 'https://api.example.com/v1',
    apiKeys: ['sk-1234567890abcdefghij'],
    models: ['gpt-4o', 'gpt-4o-mini'],
    name: 'Team Relay',
    prefix: 'relay',
    warnings: [],
  };

  test('fills every supported field for a key-based brand (gemini)', () => {
    const { next, summary } = applySmartConfigCandidate('gemini', form(), candidate);
    expect(next.baseUrl).toBe('https://api.example.com/v1');
    expect(next.apiKey).toBe('sk-1234567890abcdefghij');
    expect(next.models).toEqual([
      { name: 'gpt-4o', alias: '' },
      { name: 'gpt-4o-mini', alias: '' },
    ]);
    expect(next.prefix).toBe('relay');
    expect(next.name).toBe('');
    expect(summary).toMatchObject({ baseUrl: true, apiKeys: 1, models: 2, prefix: true, name: false });
  });

  test('stores multiple keys as entries and a name for openaiCompatibility', () => {
    const multi = { ...candidate, apiKeys: ['sk-aaaabbbbccccdddd1111', 'sk-eeeeffffgggghhhh2222'] };
    const { next, summary } = applySmartConfigCandidate('openaiCompatibility', form(), multi);
    expect(next.apiKey).toBe('');
    expect(next.name).toBe('Team Relay');
    expect(next.apiKeyEntries).toEqual([
      { apiKey: 'sk-aaaabbbbccccdddd1111', proxyUrl: '', weight: undefined },
      { apiKey: 'sk-eeeeffffgggghhhh2222', proxyUrl: '', weight: undefined },
    ]);
    expect(summary).toMatchObject({ apiKeys: 2, name: true, extraApiKeys: 0 });
  });

  test('drops the base URL for brands that do not support it (kimi)', () => {
    const { next, summary } = applySmartConfigCandidate('kimi', form(), candidate);
    expect(next.baseUrl).toBe('');
    expect(next.apiKey).toBe('sk-1234567890abcdefghij');
    // kimi does not support models, so the untouched placeholder stays as-is.
    expect(next.models).toEqual([{ name: '', alias: '' }]);
    expect(summary).toMatchObject({ baseUrl: false, apiKeys: 1, models: 0 });
  });

  test('keeps only the first key and reports the extras for single-key brands', () => {
    const multi = { ...candidate, apiKeys: ['sk-firstkey1234567890', 'sk-secondkey123456789'] };
    const { next, summary } = applySmartConfigCandidate('claude', form(), multi);
    expect(next.apiKey).toBe('sk-firstkey1234567890');
    expect(summary).toMatchObject({ apiKeys: 1, extraApiKeys: 1 });
  });
});

describe('maskApiKey', () => {
  test('masks long keys', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-123…cdef');
  });

  test('masks short keys', () => {
    expect(maskApiKey('123456')).toBe('123…');
  });
});

describe('applySmartConfigCandidate', () => {
  test('fills base URL, key and models for a Gemini entry', () => {
    const candidate = {
      baseUrl: 'https://api.example.com/v1',
      apiKeys: ['sk-1234567890abcdefghij'],
      models: ['gpt-4o'],
      name: null,
      prefix: 'team',
      warnings: [],
    };
    const { next, summary } = applySmartConfigCandidate('gemini', form(), candidate);
    expect(next.baseUrl).toBe('https://api.example.com/v1');
    expect(next.apiKey).toBe('sk-1234567890abcdefghij');
    expect(next.models).toEqual([{ name: 'gpt-4o', alias: '' }]);
    expect(next.prefix).toBe('team');
    expect(summary.models).toBe(1);
    expect(summary.extraApiKeys).toBe(0);
  });

  test('only stores the first key for single-key providers', () => {
    const candidate = {
      baseUrl: 'https://api.example.com/v1',
      apiKeys: ['sk-firstkey1234567890', 'sk-secondkey123456789'],
      models: [],
      name: null,
      prefix: null,
      warnings: [],
    };
    const { next, summary } = applySmartConfigCandidate('gemini', form(), candidate);
    expect(next.apiKey).toBe('sk-firstkey1234567890');
    expect(summary.apiKeys).toBe(1);
    expect(summary.extraApiKeys).toBe(1);
  });

  test('creates multiple key entries for openai-compatibility', () => {
    const candidate = {
      baseUrl: 'https://api.example.com/v1',
      apiKeys: ['sk-aaaabbbbccccdddd1111', 'sk-eeeeffffgggghhhh2222'],
      models: [],
      name: 'my-openai',
      prefix: null,
      warnings: [],
    };
    const { next, summary } = applySmartConfigCandidate('openaiCompatibility', form(), candidate);
    expect(next.name).toBe('my-openai');
    expect(next.apiKeyEntries).toEqual([
      { apiKey: 'sk-aaaabbbbccccdddd1111', proxyUrl: '', weight: undefined },
      { apiKey: 'sk-eeeeffffgggghhhh2222', proxyUrl: '', weight: undefined },
    ]);
    expect(summary.apiKeys).toBe(2);
  });

  test('does not overwrite a non-empty model list', () => {
    const candidate = {
      baseUrl: null,
      apiKeys: [],
      models: ['gpt-4o'],
      name: null,
      prefix: null,
      warnings: [],
    };
    const { next, summary } = applySmartConfigCandidate(
      'gemini',
      form({ models: [{ name: 'keep-me', alias: '' }] }),
      candidate
    );
    expect(next.models).toEqual([{ name: 'keep-me', alias: '' }]);
    expect(summary.models).toBe(0);
  });
});
