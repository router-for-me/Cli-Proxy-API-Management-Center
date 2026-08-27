import { afterEach, describe, expect, test } from 'bun:test';
import {
  KIMI_CHINESE_AFFILIATE_URL,
  KIMI_CODING_PLAN_BASE_URL,
  KIMI_DOMESTIC_BASE_URL,
  KIMI_INTERNATIONAL_AFFILIATE_URL,
  KIMI_INTERNATIONAL_BASE_URL,
  KIMI_REGION_DOMESTIC,
  KIMI_REGION_INTERNATIONAL,
  KIMI_SERVICE_CODING_PLAN,
  KIMI_SERVICE_OPEN_PLATFORM,
  getKimiAffiliateUrl,
  isKimiCodingPlanKey,
  kimiDiscoveredModelEntries,
  kimiDisplayBaseUrl,
  kimiOpenAIBaseUrl,
} from '../src/features/providers/kimi';
import { PROVIDER_LOGOS } from '../src/features/providers/brandLogos';
import { PROVIDER_BRAND_ORDER } from '../src/features/providers/descriptors';
import { isMultiProtocolSponsorBrand } from '../src/features/providers/sponsorDefinitions';
import { apiCallApi } from '../src/services/api/apiCall';
import { modelsApi } from '../src/services/api/models';

const originalApiCallRequest = apiCallApi.request;

afterEach(() => {
  apiCallApi.request = originalApiCallRequest;
});

describe('Kimi provider', () => {
  test('derives a single host from service and region', () => {
    expect(kimiDisplayBaseUrl(KIMI_SERVICE_CODING_PLAN)).toBe(KIMI_CODING_PLAN_BASE_URL);
    expect(kimiDisplayBaseUrl(KIMI_SERVICE_OPEN_PLATFORM, KIMI_REGION_DOMESTIC)).toBe(
      KIMI_DOMESTIC_BASE_URL
    );
    expect(kimiDisplayBaseUrl(KIMI_SERVICE_OPEN_PLATFORM, KIMI_REGION_INTERNATIONAL)).toBe(
      KIMI_INTERNATIONAL_BASE_URL
    );
    expect(kimiOpenAIBaseUrl(KIMI_SERVICE_CODING_PLAN)).toBe(`${KIMI_CODING_PLAN_BASE_URL}/v1`);
    expect(kimiOpenAIBaseUrl(KIMI_SERVICE_OPEN_PLATFORM, KIMI_REGION_DOMESTIC)).toBe(
      `${KIMI_DOMESTIC_BASE_URL}/v1`
    );
    expect(kimiOpenAIBaseUrl(KIMI_SERVICE_OPEN_PLATFORM, KIMI_REGION_INTERNATIONAL)).toBe(
      `${KIMI_INTERNATIONAL_BASE_URL}/v1`
    );
  });

  test('maps discovered models to request names without aliases', () => {
    expect(
      kimiDiscoveredModelEntries([
        { name: ' k3 ' },
        { name: 'k3' },
        { name: 'kimi-for-coding', alias: 'ignored' },
        { name: '' },
      ])
    ).toEqual([
      { name: 'k3', alias: '' },
      { name: 'kimi-for-coding', alias: '' },
    ]);
  });

  test('discovers models through the versioned OpenAI endpoint', async () => {
    let requestedUrl = '';
    apiCallApi.request = (async (payload) => {
      requestedUrl = payload.url;
      return { statusCode: 200, header: {}, bodyText: '', body: { data: [] } };
    }) as typeof apiCallApi.request;

    await modelsApi.fetchModelsViaApiCall(
      kimiOpenAIBaseUrl(KIMI_SERVICE_OPEN_PLATFORM, KIMI_REGION_INTERNATIONAL),
      'test-key'
    );

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

  test('is a native catalog brand, not a multi-protocol sponsor', () => {
    expect(PROVIDER_BRAND_ORDER[0]).toBe('kimi');
    expect(isMultiProtocolSponsorBrand('kimi')).toBe(false);
    expect(isKimiCodingPlanKey({ apiKey: 'sk-code', service: KIMI_SERVICE_CODING_PLAN })).toBe(
      true
    );
    expect(
      isKimiCodingPlanKey({
        apiKey: 'sk-open',
        service: KIMI_SERVICE_OPEN_PLATFORM,
        region: KIMI_REGION_DOMESTIC,
      })
    ).toBe(false);
  });
});
