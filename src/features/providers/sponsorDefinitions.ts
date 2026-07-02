import {
  APIKEY_FUN_AFFILIATE_URL,
  APIKEY_FUN_BASE_URL_OPTIONS,
  APIKEY_FUN_DASHBOARD_URL,
  APIKEY_FUN_DISPLAY_NAME,
  APIKEY_FUN_PROTOCOLS,
  APIKEY_FUN_PROVIDER_NAME,
  getApiKeyFunProtocolUrls,
  resolveApiKeyFunBaseUrl,
} from './sponsor';
import {
  CODE0_AFFILIATE_URL,
  CODE0_BASE_URL_OPTIONS,
  CODE0_DISPLAY_NAME,
  CODE0_PROTOCOL_LABELS,
  CODE0_PROVIDER_NAME,
  getCode0ProtocolUrls,
  resolveCode0BaseUrl,
} from './code0';
import type { ProviderBrand, SponsorProtocol, SponsorProviderBrand } from './types';

export interface SponsorProtocolUrls {
  anthropic: string;
  openai: string;
  codex: string;
  gemini: string;
}

export interface SponsorBaseUrlOption {
  id: string;
  baseUrl: string;
  openaiBaseUrl: string;
  codexBaseUrl: string;
  anthropicBaseUrl: string;
  geminiBaseUrl: string;
}

export interface SponsorProviderDefinition {
  brand: SponsorProviderBrand;
  displayName: string;
  providerName: string;
  affiliateUrl: string;
  dashboardUrl?: string;
  protocols: readonly SponsorProtocol[];
  protocolLabels: readonly string[];
  defaultProtocol: SponsorProtocol;
  baseUrlOptions: readonly SponsorBaseUrlOption[];
  supportsUsageCheck: boolean;
  resolveBaseUrl: (value: string | undefined | null) => string;
  getProtocolUrls: (value: string | undefined | null) => SponsorProtocolUrls;
}

const SPONSOR_DEFINITIONS: Record<SponsorProviderBrand, SponsorProviderDefinition> = {
  apikeyFun: {
    brand: 'apikeyFun',
    displayName: APIKEY_FUN_DISPLAY_NAME,
    providerName: APIKEY_FUN_PROVIDER_NAME,
    affiliateUrl: APIKEY_FUN_AFFILIATE_URL,
    dashboardUrl: APIKEY_FUN_DASHBOARD_URL,
    protocols: ['codex', 'claude', 'openai'],
    protocolLabels: APIKEY_FUN_PROTOCOLS,
    defaultProtocol: 'codex',
    baseUrlOptions: APIKEY_FUN_BASE_URL_OPTIONS,
    supportsUsageCheck: true,
    resolveBaseUrl: resolveApiKeyFunBaseUrl,
    getProtocolUrls: getApiKeyFunProtocolUrls,
  },
  code0: {
    brand: 'code0',
    displayName: CODE0_DISPLAY_NAME,
    providerName: CODE0_PROVIDER_NAME,
    affiliateUrl: CODE0_AFFILIATE_URL,
    protocols: ['openai', 'claude', 'gemini', 'codex'],
    protocolLabels: CODE0_PROTOCOL_LABELS,
    defaultProtocol: 'openai',
    baseUrlOptions: CODE0_BASE_URL_OPTIONS,
    supportsUsageCheck: false,
    resolveBaseUrl: resolveCode0BaseUrl,
    getProtocolUrls: getCode0ProtocolUrls,
  },
};

export const isMultiProtocolSponsorBrand = (
  brand: ProviderBrand
): brand is SponsorProviderBrand => brand === 'apikeyFun' || brand === 'code0';

export const getSponsorProviderDefinition = (
  brand: SponsorProviderBrand
): SponsorProviderDefinition => SPONSOR_DEFINITIONS[brand];

export const sponsorProtocolI18nKey = (
  protocol: SponsorProtocol
): 'openai' | 'codexResponses' | 'anthropic' | 'gemini' => {
  if (protocol === 'claude') return 'anthropic';
  if (protocol === 'codex') return 'codexResponses';
  return protocol;
};

export const sponsorProtocolModelI18nKey = (
  protocol: SponsorProtocol
): 'openai' | 'codex' | 'anthropic' | 'gemini' => {
  if (protocol === 'claude') return 'anthropic';
  return protocol;
};

export const discoveryBrandForSponsorProtocol = (protocol: SponsorProtocol): ProviderBrand =>
  protocol === 'openai' ? 'openaiCompatibility' : protocol;

export const sponsorProtocolUrl = (
  urls: SponsorProtocolUrls,
  protocol: SponsorProtocol
): string => {
  if (protocol === 'claude') return urls.anthropic;
  if (protocol === 'codex') return urls.codex;
  if (protocol === 'gemini') return urls.gemini;
  return urls.openai;
};
