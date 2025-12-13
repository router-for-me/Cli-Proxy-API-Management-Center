/**
 * Amp CLI Integration (ampcode) 配置
 */

export interface AmpcodeModelMapping {
  from: string;
  to: string;
}

export interface AmpcodeConfig {
  upstreamUrl?: string;
  upstreamApiKey?: string;
  restrictManagementToLocalhost?: boolean;
  modelMappings?: AmpcodeModelMapping[];
  forceModelMappings?: boolean;
}

