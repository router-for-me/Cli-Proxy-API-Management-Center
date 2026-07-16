import { afterEach, describe, expect, test } from 'bun:test';
import { buildOpenAIChatCompletionsEndpoint } from '../src/components/providers/utils';
import {
  KIMI_ANTHROPIC_BASE_URL,
  KIMI_CHINESE_AFFILIATE_URL,
  KIMI_INTERNATIONAL_AFFILIATE_URL,
  KIMI_LEGACY_OPENAI_BASE_URL,
  KIMI_OPENAI_BASE_URL,
  buildKimiRaw,
  getKimiAffiliateUrl,
  getKimiProtocolUrls,
  isKimiClaudeProvider,
  isKimiOpenAIProvider,
} from '../src/features/providers/kimi';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { PROVIDER_BRAND_ORDER } from '../src/features/providers/descriptors';
import { getSponsorProviderDefinition } from '../src/features/providers/sponsorDefinitions';
import { apiCallApi } from '../src/services/api/apiCall';
import { modelsApi } from '../src/services/api/models';

const originalApiCallRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
});

describe('Kimi provider', () => {
  test('maps OpenAI-compatible and Claude protocols to their exact endpoints', () => {
    expect(getKimiProtocolUrls(undefined)).toEqual({
      openai: 'https://api.moonshot.ai/v1',
      anthropic: 'https://api.moonshot.ai/anthropic',
      codex: '',
      gemini: '',
    });
    expect(buildOpenAIChatCompletionsEndpoint(KIMI_OPENAI_BASE_URL)).toBe(
      'https://api.moonshot.ai/v1/chat/completions'
    );
    expect(getSponsorProviderDefinition('kimi').protocols).toEqual(['openai', 'claude']);
  });

  test('discovers models through the versioned OpenAI endpoint', async () => {
    let requestedUrl = '';
    apiCallApi.request = (async (payload) => {
      requestedUrl = payload.url;
      return { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };
    }) as typeof apiCallApi.request;

    await modelsApi.fetchModelsViaApiCall(KIMI_OPENAI_BASE_URL, 'test-key');

    expect(requestedUrl).toBe('https://api.moonshot.ai/v1/models');
  });

  test('uses the domestic registration link for Chinese and the international link otherwise', () => {
    expect(getKimiAffiliateUrl('zh-CN')).toBe(KIMI_CHINESE_AFFILIATE_URL);
    expect(getKimiAffiliateUrl('zh-TW')).toBe(KIMI_CHINESE_AFFILIATE_URL);
    expect(getKimiAffiliateUrl('en')).toBe(KIMI_INTERNATIONAL_AFFILIATE_URL);
    expect(getKimiAffiliateUrl('ru')).toBe(KIMI_INTERNATIONAL_AFFILIATE_URL);
  });

  test('uses the OAuth-style theme surface for its provider icon', () => {
    expect(PROVIDER_LOGOS.kimi.themeSurface).toBeTrue();
  });

  test('is the first provider in the catalog', () => {
    expect(PROVIDER_BRAND_ORDER[0]).toBe('kimi');
  });

  test('recognizes Kimi configs only by supported protocol endpoint', () => {
    expect(
      isKimiOpenAIProvider({
        name: 'Kimi',
        baseUrl: 'https://custom.example.com',
      })
    ).toBeFalse();
    expect(
      isKimiOpenAIProvider({
        name: 'moonshot',
        baseUrl: `${KIMI_OPENAI_BASE_URL}/`,
      })
    ).toBeTrue();
    expect(
      isKimiOpenAIProvider({
        name: 'legacy-moonshot',
        baseUrl: KIMI_LEGACY_OPENAI_BASE_URL,
      })
    ).toBeTrue();
    expect(
      isKimiClaudeProvider({ apiKey: 'sk-test', baseUrl: KIMI_ANTHROPIC_BASE_URL })
    ).toBeTrue();
  });

  test('aggregates only the Kimi OpenAI-compatible and Claude configs', () => {
    const raw = buildKimiRaw({
      openaiCompatibility: [
        { name: 'kimi', baseUrl: KIMI_OPENAI_BASE_URL },
        { name: 'other', baseUrl: 'https://example.com' },
      ],
      claudeApiKeys: [
        { apiKey: 'kimi-key', baseUrl: KIMI_ANTHROPIC_BASE_URL },
        { apiKey: 'other-key', baseUrl: 'https://api.anthropic.com' },
      ],
    });

    expect(raw.openai.map((item) => item.index)).toEqual([0]);
    expect(raw.claude.map((item) => item.index)).toEqual([0]);
    expect(raw.codex).toEqual([]);
    expect(raw.gemini).toEqual([]);
  });
});
