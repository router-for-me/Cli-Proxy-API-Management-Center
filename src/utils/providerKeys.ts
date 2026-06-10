const OAUTH_PROVIDER_ALIASES: Record<string, string> = {
  'anti-gravity': 'antigravity',
  gemini: 'gemini-cli',
  grok: 'xai',
  'x-ai': 'xai',
  'x.ai': 'xai',
};

export const normalizeOAuthProviderKey = (value: string): string => {
  const key = value.trim().toLowerCase().replace(/_/g, '-');
  return OAUTH_PROVIDER_ALIASES[key] ?? key;
};
