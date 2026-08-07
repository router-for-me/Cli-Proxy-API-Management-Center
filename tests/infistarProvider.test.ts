import { describe, expect, test } from 'bun:test';
import { infistarToResource } from '../src/features/providers/adapters';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { PROVIDER_BRAND_ORDER } from '../src/features/providers/descriptors';
import {
  INFISTAR_AFFILIATE_URL,
  INFISTAR_BASE_URL_OPTIONS,
  INFISTAR_DOMESTIC_BASE_URL,
  INFISTAR_DOMESTIC_ROOT_URL,
  INFISTAR_GLOBAL_BASE_URL,
  INFISTAR_GLOBAL_ROOT_URL,
  buildInfistarRaw,
  getInfistarProtocolUrls,
  resolveInfistarBaseUrl,
} from '../src/features/providers/infistar';
import { getSponsorProviderDefinition } from '../src/features/providers/sponsorDefinitions';

const allProtocolConfig = {
  openaiCompatibility: [
    {
      name: 'infistar',
      baseUrl: INFISTAR_DOMESTIC_BASE_URL,
      apiKeyEntries: [{ apiKey: 'openai-key' }],
    },
  ],
  claudeApiKeys: [{ apiKey: 'claude-key', baseUrl: INFISTAR_DOMESTIC_ROOT_URL }],
  codexApiKeys: [{ apiKey: 'codex-key', baseUrl: INFISTAR_DOMESTIC_BASE_URL }],
  geminiApiKeys: [{ apiKey: 'gemini-key', baseUrl: INFISTAR_DOMESTIC_ROOT_URL }],
  interactionsApiKeys: [{ apiKey: 'interactions-key', baseUrl: INFISTAR_DOMESTIC_BASE_URL }],
};

describe('Infistar sponsor provider', () => {
  test('offers the requested mainland China and global URLs', () => {
    expect(INFISTAR_AFFILIATE_URL).toBe(
      'https://infistar.ai/register?aff=FQKC6J6R&ref_source=link'
    );
    expect(
      INFISTAR_BASE_URL_OPTIONS.map(({ id, baseUrl }) => ({
        id,
        baseUrl,
      }))
    ).toEqual([
      { id: 'mainlandChina', baseUrl: 'https://coneverse.com/v1' },
      { id: 'global', baseUrl: 'https://infistar.ai/v1' },
    ]);
    expect(resolveInfistarBaseUrl(undefined)).toBe(INFISTAR_DOMESTIC_BASE_URL);
    expect(resolveInfistarBaseUrl(INFISTAR_GLOBAL_ROOT_URL)).toBe(INFISTAR_GLOBAL_BASE_URL);
  });

  test('maps both choices to all four supported protocol endpoints', () => {
    expect(getInfistarProtocolUrls(undefined)).toEqual({
      openai: 'https://coneverse.com/v1',
      codex: 'https://coneverse.com/v1',
      anthropic: 'https://coneverse.com',
      gemini: 'https://coneverse.com',
    });
    expect(getInfistarProtocolUrls(INFISTAR_GLOBAL_BASE_URL)).toEqual({
      openai: 'https://infistar.ai/v1',
      codex: 'https://infistar.ai/v1',
      anthropic: 'https://infistar.ai',
      gemini: 'https://infistar.ai',
    });

    const definition = getSponsorProviderDefinition('infistar');
    expect(definition.protocols).toEqual(['openai', 'claude', 'gemini', 'codex']);
    expect(definition.protocols).not.toContain('interactions');
  });

  test('aggregates four protocol configs without claiming Interactions API', () => {
    const raw = buildInfistarRaw(allProtocolConfig);

    expect(raw.openai.map((item) => item.index)).toEqual([0]);
    expect(raw.claude.map((item) => item.index)).toEqual([0]);
    expect(raw.codex.map((item) => item.index)).toEqual([0]);
    expect(raw.gemini.map((item) => item.index)).toEqual([0]);

    const resource = infistarToResource(raw);
    expect(resource?.brand).toBe('infistar');
    expect(resource?.name).toBe('无限星河');
    expect(resource?.flags.protocols).toEqual(['openai', 'anthropic', 'gemini', 'codexResponses']);
  });

  test('keeps custom endpoints outside the Infistar sponsor group', () => {
    const raw = buildInfistarRaw({
      openaiCompatibility: [
        {
          name: 'infistar',
          baseUrl: 'https://gateway.example.com/v1',
          apiKeyEntries: [{ apiKey: 'custom-key' }],
        },
      ],
    });

    expect(raw.openai).toEqual([]);
  });

  test('is appended to the provider catalog with the supplied logo', () => {
    expect(PROVIDER_BRAND_ORDER.at(-1)).toBe('infistar');
    expect(PROVIDER_LOGOS.infistar.src).toContain('infistar.png');
    expect(PROVIDER_LOGOS.infistar.transparent).toBeTrue();
  });
});
