import type { KimiKeyConfig, KimiRegion, KimiService } from '@/types';

export const KIMI_PROVIDER_NAME = 'kimi';
export const KIMI_DISPLAY_NAME = 'Kimi';
export const KIMI_SERVICE_OPEN_PLATFORM: KimiService = 'open-platform';
export const KIMI_SERVICE_CODING_PLAN: KimiService = 'coding-plan';
export const KIMI_REGION_DOMESTIC: KimiRegion = 'domestic';
export const KIMI_REGION_INTERNATIONAL: KimiRegion = 'international';
export const KIMI_DOMESTIC_BASE_URL = 'https://api.moonshot.cn';
export const KIMI_INTERNATIONAL_BASE_URL = 'https://api.moonshot.ai';
export const KIMI_CODING_PLAN_BASE_URL = 'https://api.kimi.com/coding';
export const KIMI_CHINESE_AFFILIATE_URL = 'https://platform.kimi.com/?aff=cliproxyapi';
export const KIMI_INTERNATIONAL_AFFILIATE_URL = 'https://platform.kimi.ai/?aff=cliproxyapi';

export const getKimiAffiliateUrl = (language: string | undefined | null): string =>
  language?.toLowerCase().startsWith('zh')
    ? KIMI_CHINESE_AFFILIATE_URL
    : KIMI_INTERNATIONAL_AFFILIATE_URL;

export const kimiDisplayBaseUrl = (
  service: KimiService | undefined | null,
  region?: KimiRegion | string | null
): string => {
  if (service === KIMI_SERVICE_CODING_PLAN) {
    return KIMI_CODING_PLAN_BASE_URL;
  }
  if (region === KIMI_REGION_INTERNATIONAL) {
    return KIMI_INTERNATIONAL_BASE_URL;
  }
  return KIMI_DOMESTIC_BASE_URL;
};

export const kimiOpenAIBaseUrl = (
  service: KimiService | undefined | null,
  region?: KimiRegion | string | null
): string => `${kimiDisplayBaseUrl(service, region).replace(/\/+$/, '')}/v1`;

export const isKimiCodingPlanKey = (config: KimiKeyConfig | undefined | null): boolean =>
  config?.service === KIMI_SERVICE_CODING_PLAN;

export const kimiDiscoveredModelEntries = (
  models: Array<{ name?: string | null }>
): Array<{ name: string; alias: string }> => {
  const seen = new Set<string>();
  const out: Array<{ name: string; alias: string }> = [];
  models.forEach((model) => {
    const name = String(model?.name ?? '').trim();
    const key = name.toLowerCase();
    if (!name || seen.has(key)) return;
    seen.add(key);
    out.push({ name, alias: '' });
  });
  return out;
};
