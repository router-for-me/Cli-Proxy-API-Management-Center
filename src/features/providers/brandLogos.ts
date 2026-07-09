import claudeLogo from '@/assets/icons/claude.svg';
import codexLogo from '@/assets/icons/codex.svg';
import geminiLogo from '@/assets/icons/gemini.svg';
import openaiLightLogo from '@/assets/icons/openai-light.svg';
import openaiDarkLogo from '@/assets/icons/openai-dark.svg';
import vertexLogo from '@/assets/icons/vertex.svg';
import claudeApiLogo from '@/assets/icons/claudeapi.png';
import apikeyFunLogo from '@/assets/icons/apikey-fun.png';
import code0Logo from '@/assets/icons/code0.png';
import fennoAILogo from '@/assets/icons/fenno-ai.png';
import qiniuCloudLogo from '@/assets/icons/qiniu-cloud.png';
import type { ProviderBrand } from './types';

export interface ProviderBrandLogo {
  src: string;
  darkSrc?: string;
  transparent?: boolean;
  invertOnDark?: boolean;
}

export const PROVIDER_LOGOS: Record<ProviderBrand, ProviderBrandLogo> = {
  gemini: { src: geminiLogo },
  claude: { src: claudeLogo },
  claudeApi: { src: claudeApiLogo },
  codex: { src: codexLogo },
  vertex: { src: vertexLogo },
  openaiCompatibility: { src: openaiLightLogo, darkSrc: openaiDarkLogo, transparent: true },
  apikeyFun: { src: apikeyFunLogo },
  code0: { src: code0Logo },
  fennoAI: { src: fennoAILogo, transparent: true },
  qiniuCloud: { src: qiniuCloudLogo, transparent: true },
};
