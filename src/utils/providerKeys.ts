const OAUTH_PROVIDER_ALIASES: Record<string, string> = {
  'anti-gravity': 'antigravity',
  grok: 'xai',
  'x-ai': 'xai',
  'x.ai': 'xai',
};

const MANAGEMENT_OAUTH_PROVIDER_PATTERN = /^[a-z0-9-]+$/;

export const normalizeOAuthProviderKey = (value: string): string => {
  const key = value.trim().toLowerCase().replace(/_/g, '-');
  return OAUTH_PROVIDER_ALIASES[key] ?? key;
};

export const normalizeManagementOAuthProviderKey = (value: string): string =>
  value.trim().toLowerCase();

export const isManagementOAuthProviderKey = (value: string): boolean =>
  MANAGEMENT_OAUTH_PROVIDER_PATTERN.test(value);
