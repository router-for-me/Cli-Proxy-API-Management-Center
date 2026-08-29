import { afterEach, describe, expect, test } from 'bun:test';
import { buildOpenAIChatCompletionsEndpoint } from '../src/components/providers/utils';
import {
  ORCA_ROUTER_ANTHROPIC_BASE_URL,
  ORCA_ROUTER_BASE_URL,
  ORCA_ROUTER_OPENAI_BASE_URL,
  buildOrcaRouterRaw,
  getOrcaRouterProtocolUrls,
  isOrcaRouterClaudeProvider,
  isOrcaRouterOpenAIProvider,
  resolveOrcaRouterBaseUrl,
} from '../src/features/providers/orcaRouter';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { getSponsorProviderDefinition } from '../src/features/providers/sponsorDefinitions';
import { modelsApi } from '../src/services/api/models';
import { apiCallApi } from '../src/services/api/apiCall';

const originalApiCallRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
});

describe('OrcaRouter provider', () => {
  test('exposes OpenAI-compatible and Anthropic protocol endpoints on the shared base URL', () => {
    expect(getOrcaRouterProtocolUrls(undefined)).toEqual({
      openai: 'https://api.orcarouter.ai/v1',
      anthropic: 'https://api.orcarouter.ai',
      codex: '',
      gemini: '',
    });
    expect(getSponsorProviderDefinition('orcarouter').protocols).toEqual(['openai', 'claude']);
    expect(buildOpenAIChatCompletionsEndpoint(ORCA_ROUTER_OPENAI_BASE_URL)).toBe(
      'https://api.orcarouter.ai/v1/chat/completions'
    );
  });

  test('resolves the base URL from either protocol endpoint', () => {
    expect(resolveOrcaRouterBaseUrl(undefined)).toBe(ORCA_ROUTER_BASE_URL);
    expect(resolveOrcaRouterBaseUrl(ORCA_ROUTER_OPENAI_BASE_URL)).toBe(ORCA_ROUTER_BASE_URL);
    expect(resolveOrcaRouterBaseUrl(ORCA_ROUTER_ANTHROPIC_BASE_URL)).toBe(ORCA_ROUTER_BASE_URL);
  });

  test('discovers models through the versioned OpenAI endpoint', async () => {
    let requestedUrl = '';
    apiCallApi.request = (async (payload) => {
      requestedUrl = payload.url;
      return { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };
    }) as typeof apiCallApi.request;

    await modelsApi.fetchModelsViaApiCall(ORCA_ROUTER_OPENAI_BASE_URL, 'test-key');

    expect(requestedUrl).toBe('https://api.orcarouter.ai/v1/models');
  });

  test('uses the theme surface for its provider icon', () => {
    expect(PROVIDER_LOGOS.orcarouter.themeSurface).toBeTrue();
  });

  test('recognizes OrcaRouter configs only by supported protocol endpoint', () => {
    expect(
      isOrcaRouterOpenAIProvider({
        name: 'custom',
        baseUrl: 'https://custom.example.com',
      })
    ).toBeFalse();
    expect(
      isOrcaRouterOpenAIProvider({
        name: 'orcarouter',
        baseUrl: `${ORCA_ROUTER_OPENAI_BASE_URL}/`,
      })
    ).toBeTrue();
    expect(
      isOrcaRouterOpenAIProvider({
        name: 'orcarouter-root',
        baseUrl: ORCA_ROUTER_BASE_URL,
      })
    ).toBeTrue();
    expect(
      isOrcaRouterClaudeProvider({ apiKey: 'sk-orca-test', baseUrl: ORCA_ROUTER_ANTHROPIC_BASE_URL })
    ).toBeTrue();
    expect(
      isOrcaRouterClaudeProvider({ apiKey: 'sk-orca-test', baseUrl: ORCA_ROUTER_OPENAI_BASE_URL })
    ).toBeFalse();
  });

  test('aggregates only the OrcaRouter OpenAI-compatible and Claude configs', () => {
    const raw = buildOrcaRouterRaw({
      openaiCompatibility: [
        { name: 'orcarouter', baseUrl: ORCA_ROUTER_OPENAI_BASE_URL },
        { name: 'other', baseUrl: 'https://example.com' },
      ],
      claudeApiKeys: [
        { apiKey: 'orca-key', baseUrl: ORCA_ROUTER_ANTHROPIC_BASE_URL },
        { apiKey: 'other-key', baseUrl: 'https://api.anthropic.com' },
      ],
    });

    expect(raw.openai.map((item) => item.index)).toEqual([0]);
    expect(raw.claude.map((item) => item.index)).toEqual([0]);
    expect(raw.codex).toEqual([]);
    expect(raw.gemini).toEqual([]);
  });
});
