import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { apiClient } from '@/services/api/client';
import { sharedApiKeyNamesApi } from '@/services/api/apiKeyNames';
import { obfuscatedStorage } from '@/services/storage/secureStorage';

const STORAGE_PREFIX = 'api-key-names:v1:';

/** Names persist across sessions, but the credentials used to identify them must not. */
export function apiKeyNameFingerprint(apiBase: string, apiKey: string): string {
  const input = JSON.stringify(['api-key-name', apiBase, apiKey]);
  // Pure JS hashing also works when the panel is served over non-localhost HTTP.
  return bytesToHex(sha256(new TextEncoder().encode(input)));
}

export function readApiKeyNames(apiBase: string): Record<string, string> {
  try {
    const stored = obfuscatedStorage.getItem<unknown>(STORAGE_PREFIX + apiBase);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, string] =>
          /^[a-f0-9]{64}$/.test(entry[0]) && typeof entry[1] === 'string' && !!entry[1].trim()
      )
    );
  } catch {
    return {};
  }
}

/** Merge with current storage so edits do not discard names saved by another editor. */
export function saveApiKeyName(apiBase: string, apiKey: string, name: string): boolean {
  try {
    const names = new Map(Object.entries(readApiKeyNames(apiBase)));
    const fingerprint = apiKeyNameFingerprint(apiBase, apiKey);
    if (name.trim()) names.set(fingerprint, name.trim());
    else names.delete(fingerprint);
    if (names.size) {
      obfuscatedStorage.setItem(STORAGE_PREFIX + apiBase, Object.fromEntries(names));
    } else {
      obfuscatedStorage.removeItem(STORAGE_PREFIX + apiBase);
    }
    return true;
  } catch {
    return false;
  }
}

export function sharedApiKeyFingerprint(apiKey: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(apiKey)));
}

export interface ApiKeyNameState {
  names: Record<string, string>;
  shared: boolean;
}

const assertRevision = (revision: number) => {
  if (revision !== apiClient.getConnectionRevision()) throw new Error('Connection changed');
};

export async function loadApiKeyNameState(
  apiBase: string,
  apiKeys: string[]
): Promise<ApiKeyNameState> {
  const revision = apiClient.getConnectionRevision();
  let names: Record<string, string>;
  try {
    names = await sharedApiKeyNamesApi.list();
  } catch (error) {
    assertRevision(revision);
    if (!(error instanceof Error) || (error as { status?: number }).status !== 404) throw error;
    const local = readApiKeyNames(apiBase);
    return {
      shared: false,
      names: Object.fromEntries(
        apiKeys.map((key) => [
          sharedApiKeyFingerprint(key),
          local[apiKeyNameFingerprint(apiBase, key)] ?? '',
        ])
      ),
    };
  }
  assertRevision(revision);
  const local = readApiKeyNames(apiBase);
  const imports: Record<string, string> = {};
  for (const key of apiKeys) {
    const fingerprint = sharedApiKeyFingerprint(key);
    const name = local[apiKeyNameFingerprint(apiBase, key)];
    if (name && !Object.prototype.hasOwnProperty.call(names, fingerprint))
      imports[fingerprint] = name;
  }
  if (Object.keys(imports).length) {
    names = await sharedApiKeyNamesApi.update(imports, true);
    assertRevision(revision);
  }
  return { names, shared: true };
}

export async function loadSharedApiKeyNames(
  apiBase: string,
  apiKeys: string[]
): Promise<Record<string, string>> {
  return (await loadApiKeyNameState(apiBase, apiKeys)).names;
}

export async function saveSharedApiKeyName(
  apiKey: string,
  name: string
): Promise<Record<string, string>> {
  const revision = apiClient.getConnectionRevision();
  const names = await sharedApiKeyNamesApi.update({
    [sharedApiKeyFingerprint(apiKey)]: name.trim(),
  });
  assertRevision(revision);
  return names;
}
