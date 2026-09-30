import { obfuscatedStorage } from '@/services/storage/secureStorage';

const STORAGE_PREFIX = 'api-key-names:v1:';

export function readApiKeyNames(apiBase: string): Record<string, string> {
  try {
    const stored = obfuscatedStorage.getItem<unknown>(STORAGE_PREFIX + apiBase);
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(
      Object.entries(stored).filter(
        (entry): entry is [string, string] => typeof entry[1] === 'string' && !!entry[1].trim()
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
    if (name.trim()) names.set(apiKey, name.trim());
    else names.delete(apiKey);
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
