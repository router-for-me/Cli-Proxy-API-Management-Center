import type { Config, ProviderKeyConfig } from '@/types';
import type { SponsorProviderBrand, SponsorProviderRaw } from './types';
import { buildApiKeyFunRaw } from './sponsor';
import { buildAiCodeMirrorRaw } from './aiCodeMirror';
import { buildQiniuCloudRaw } from './qiniuCloud';
import { buildFennoAIRaw } from './fennoAI';
import { buildKimiRaw } from './kimi';

const candidates = {
  apikeyFun: buildApiKeyFunRaw,
  aiCodeMirror: buildAiCodeMirrorRaw,
  qiniuCloud: buildQiniuCloudRaw,
  fennoAI: buildFennoAIRaw,
  kimi: buildKimiRaw,
};

// A partner form owns at most one credential per protocol. A native group is indivisible:
// never claim one member while the native editor owns its siblings (including opaque keys).
function single<T>(rows: T[]): T[] {
  return rows.length === 1 ? rows : [];
}

function singletonGroup(config: Pick<ProviderKeyConfig, 'source'>) {
  const keys = config.source?.group.keys;
  return !config.source || (Array.isArray(keys) && keys.length === 1);
}

export function buildSponsorBundle(
  brand: SponsorProviderBrand,
  config?: Config | null
): SponsorProviderRaw {
  const raw = candidates[brand](config);
  const eligible = ({ config }: { config: ProviderKeyConfig }) =>
    !!config.apiKey.trim() && singletonGroup(config);
  return {
    openai: single(
      raw.openai.filter(
        ({ config }) =>
          singletonGroup(config) &&
          config.apiKeyEntries?.length === 1 &&
          config.apiKeyEntries[0].apiKey.trim()
      )
    ),
    codex: single(raw.codex.filter(eligible)),
    claude: single(raw.claude.filter(eligible)),
    gemini: single(raw.gemini.filter(eligible)),
  };
}

export const hasApiKeyFunConfig = (config: Config | null | undefined): boolean => {
  const raw = buildSponsorBundle('apikeyFun', config);
  return raw.openai.length > 0 || raw.claude.length > 0 || raw.codex.length > 0;
};
