import { describe, expect, test } from 'bun:test';
import { lmuAIToResource } from '../src/features/providers/adapters';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { PROVIDER_BRAND_ORDER } from '../src/features/providers/descriptors';
import {
  LMU_AI_AFFILIATE_URL,
  LMU_AI_BASE_URL,
  LMU_AI_OPENAI_BASE_URL,
  buildLmuAIRaw,
  getLmuAIProtocolUrls,
} from '../src/features/providers/lmuAI';
import { getSponsorProviderDefinition } from '../src/features/providers/sponsorDefinitions';

const allProtocolConfig = {
  openaiCompatibility: [
    {
      name: 'lmuAI',
      baseUrl: LMU_AI_OPENAI_BASE_URL,
      apiKeyEntries: [{ apiKey: 'openai-key' }],
    },
  ],
  claudeApiKeys: [{ apiKey: 'claude-key', baseUrl: LMU_AI_BASE_URL }],
  codexApiKeys: [{ apiKey: 'codex-key', baseUrl: LMU_AI_OPENAI_BASE_URL }],
  geminiApiKeys: [{ apiKey: 'gemini-key', baseUrl: LMU_AI_BASE_URL }],
  interactionsApiKeys: [{ apiKey: 'interactions-key', baseUrl: LMU_AI_BASE_URL }],
};

describe('LMU AI provider', () => {
  test('uses the official URL for all four supported protocols', () => {
    expect(LMU_AI_AFFILIATE_URL).toBe('https://api.lmuai.com/register?ref=yJ6Kwg9g');
    expect(getLmuAIProtocolUrls(undefined)).toEqual({
      openai: 'https://api.lmuai.com/v1',
      codex: 'https://api.lmuai.com/v1',
      anthropic: 'https://api.lmuai.com',
      gemini: 'https://api.lmuai.com',
    });

    const definition = getSponsorProviderDefinition('lmuAI');
    expect(definition.protocols).toEqual(['openai', 'claude', 'gemini', 'codex']);
    expect(definition.protocols).not.toContain('interactions');
  });

  test('aggregates the four protocol configs without claiming Interactions API', () => {
    const raw = buildLmuAIRaw(allProtocolConfig);

    expect(raw.openai.map((item) => item.index)).toEqual([0]);
    expect(raw.claude.map((item) => item.index)).toEqual([0]);
    expect(raw.codex.map((item) => item.index)).toEqual([0]);
    expect(raw.gemini.map((item) => item.index)).toEqual([0]);

    const resource = lmuAIToResource(raw);
    expect(resource?.brand).toBe('lmuAI');
    expect(resource?.name).toBe('LMU AI（灵眸AI）');
    expect(resource?.flags.protocols).toEqual(['openai', 'anthropic', 'gemini', 'codexResponses']);
  });

  test('keeps custom endpoints outside the LMU AI sponsor group', () => {
    const raw = buildLmuAIRaw({
      openaiCompatibility: [
        {
          name: 'lmuAI',
          baseUrl: 'https://gateway.example.com/v1',
          apiKeyEntries: [{ apiKey: 'custom-key' }],
        },
      ],
    });

    expect(raw.openai).toEqual([]);
  });

  test('remains in the provider catalog with the sponsor logo', () => {
    expect(PROVIDER_BRAND_ORDER).toContain('lmuAI');
    expect(PROVIDER_BRAND_ORDER.indexOf('lmuAI')).toBeLessThan(
      PROVIDER_BRAND_ORDER.indexOf('infistar')
    );
    expect(PROVIDER_LOGOS.lmuAI.src).toContain('lmu-ai.png');
  });
});
