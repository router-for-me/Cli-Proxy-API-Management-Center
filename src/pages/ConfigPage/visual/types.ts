export type AmpModelMappingEntry = { id: string; from: string; to: string };

export type OauthModelMappingEntry = { id: string; name: string; alias: string; fork: boolean };

export type OauthChannelMappings = {
  id: string;
  channel: string;
  originalChannel: string;
  entries: OauthModelMappingEntry[];
};

export type VisualConfigValues = {
  host: string;
  port: string;
  tlsEnable: boolean;
  tlsCert: string;
  tlsKey: string;
  rmAllowRemote: boolean;
  rmSecretKey: string;
  rmDisableControlPanel: boolean;
  rmPanelRepo: string;
  authDir: string;
  apiKeysText: string;
  debug: boolean;
  commercialMode: boolean;
  loggingToFile: boolean;
  logsMaxTotalSizeMb: string;
  usageStatisticsEnabled: boolean;
  proxyUrl: string;
  forceModelPrefix: boolean;
  requestRetry: string;
  maxRetryInterval: string;
  quotaSwitchProject: boolean;
  quotaSwitchPreviewModel: boolean;
  routingStrategy: 'round-robin' | 'fill-first';
  wsAuth: boolean;
  ampUpstreamUrl: string;
  ampUpstreamApiKey: string;
  ampRestrictManagementToLocalhost: boolean;
  ampForceModelMappings: boolean;
  ampModelMappings: AmpModelMappingEntry[];
  oauthModelMappings: OauthChannelMappings[];
};

export const makeClientId = () => {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
};

export const DEFAULT_VISUAL_VALUES: VisualConfigValues = {
  host: '',
  port: '',
  tlsEnable: false,
  tlsCert: '',
  tlsKey: '',
  rmAllowRemote: false,
  rmSecretKey: '',
  rmDisableControlPanel: false,
  rmPanelRepo: '',
  authDir: '',
  apiKeysText: '',
  debug: false,
  commercialMode: false,
  loggingToFile: false,
  logsMaxTotalSizeMb: '',
  usageStatisticsEnabled: false,
  proxyUrl: '',
  forceModelPrefix: false,
  requestRetry: '',
  maxRetryInterval: '',
  quotaSwitchProject: true,
  quotaSwitchPreviewModel: true,
  routingStrategy: 'round-robin',
  wsAuth: false,
  ampUpstreamUrl: '',
  ampUpstreamApiKey: '',
  ampRestrictManagementToLocalhost: false,
  ampForceModelMappings: false,
  ampModelMappings: [],
  oauthModelMappings: [],
};
