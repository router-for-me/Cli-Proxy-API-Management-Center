import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  OPEN_ROUTER_BASE_URL_OPTIONS,
  buildOpenRouterRaw,
  getOpenRouterProtocolUrls,
  isOpenRouterOpenAIProvider,
  resolveOpenRouterBaseUrl,
} from '../src/features/providers/openRouter';
import {
  getSponsorProviderDefinition,
  isMultiProtocolSponsorBrand,
} from '../src/features/providers/sponsorDefinitions';
import { PROVIDER_BRAND_ORDER, PROVIDER_DESCRIPTORS } from '../src/features/providers/descriptors';

describe('OpenRouter quick fill', () => {
  test('registers the OpenAI-compatible endpoint and the API keys page', () => {
    expect(isMultiProtocolSponsorBrand('openRouter')).toBe(true);
    const definition = getSponsorProviderDefinition('openRouter');
    expect(definition.displayName).toBe('OpenRouter');
    expect([...definition.protocols]).toEqual(['openai']);
    expect(definition.affiliateUrl).toBe('https://openrouter.ai/settings/keys');
    expect(definition.supportsUsageCheck).toBe(false);
    expect(resolveOpenRouterBaseUrl(undefined)).toBe('https://openrouter.ai/api');
    expect(getOpenRouterProtocolUrls(' HTTPS://OPENROUTER.AI/API/V1/ ').openai).toBe(
      'https://openrouter.ai/api/v1'
    );
    expect(PROVIDER_BRAND_ORDER).toContain('openRouter');
    expect(PROVIDER_DESCRIPTORS.openRouter.id).toBe('openRouter');
  });

  test('claims every OpenAI-compatible entry on openrouter.ai, including existing ones', () => {
    const raw = buildOpenRouterRaw({
      openaiCompatibility: [
        { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEntries: [] },
        { name: 'other', baseUrl: 'https://example.com/v1', apiKeyEntries: [] },
        {
          name: 'eu',
          baseUrl: 'https://eu.openrouter.ai/api/v1',
          sourceIndex: 5,
          apiKeyEntries: [],
        },
        { name: 'lookalike', baseUrl: 'https://notopenrouter.ai/api/v1', apiKeyEntries: [] },
      ],
      claudeApiKeys: [{ apiKey: 'test-claude', baseUrl: 'https://openrouter.ai/api' }],
    });
    expect(raw.openai.map((item) => item.index)).toEqual([0, 5]);
    expect(raw.claude).toEqual([]);
    expect(isOpenRouterOpenAIProvider({ name: 'x', baseUrl: 'not a url', apiKeyEntries: [] })).toBe(
      false
    );
  });

  test('handles missing configuration', () => {
    expect(buildOpenRouterRaw(null)).toEqual({ openai: [], claude: [], codex: [], gemini: [] });
  });

  test('provides name and route translations in every locale', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr']) {
      const messages = JSON.parse(readFileSync(`src/i18n/locales/${locale}.json`, 'utf8'));
      expect(messages.providersPage.providerNames.openRouter).toBe('OpenRouter');
      for (const option of OPEN_ROUTER_BASE_URL_OPTIONS) {
        expect(messages.providersPage.sponsor.urlOptions[option.id]).toBeTruthy();
      }
    }
  });
});
