import type { AuthFileItem } from '@/types';
import { normalizeRecentRequestAuthIndex } from '@/utils/recentRequests';
import { isPluginQuotaAuthFile } from './pluginQuota';
import { isDevinFile } from './validators';

const QUOTA_IDENTITY_SEPARATOR = '\0';

/**
 * Whether one physical file can hold more than one quota identity.
 *
 * Devin exposes several credentials per file, distinguished by auth_index, and a
 * plugin provider can too: the generic adapter fetches quota per auth_index, and
 * nothing stops a plugin's auth file from carrying more than one credential.
 * Keying those by filename alone made two credentials share a cache entry, so
 * they shared one card's quota and one timeline lane.
 */
const hasCredentialIdentities = (file: AuthFileItem): boolean =>
  isDevinFile(file) || isPluginQuotaAuthFile(file);

/**
 * Cache identity is filename-based for every other provider.
 */
export function getQuotaCacheKey(file: AuthFileItem): string {
  if (!hasCredentialIdentities(file)) return file.name;
  const authIndex = normalizeRecentRequestAuthIndex(file.authIndex);
  return `${file.name}${QUOTA_IDENTITY_SEPARATOR}${authIndex ?? ''}`;
}

/** Disambiguate same-name Devin and plugin cards without ever falling back to account (a secret). */
export function getQuotaDisplayName(file: AuthFileItem): string {
  if (!hasCredentialIdentities(file)) return file.name;
  const identity = file.email?.trim() || normalizeRecentRequestAuthIndex(file.authIndex);
  return identity ? `${file.name} · ${identity}` : file.name;
}

/** Resolve a cache identity back to the physical filename used by file mutations. */
export function getQuotaCacheFileName(key: string): string {
  const separatorIndex = key.indexOf(QUOTA_IDENTITY_SEPARATOR);
  return separatorIndex === -1 ? key : key.slice(0, separatorIndex);
}
