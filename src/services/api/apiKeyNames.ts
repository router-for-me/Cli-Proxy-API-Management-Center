import { apiClient } from './client';

export function normalizeSharedApiKeyNames(payload: unknown): Record<string, string> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid key name metadata');
  }
  const names = (payload as { names?: unknown }).names;
  if (!names || typeof names !== 'object' || Array.isArray(names)) {
    throw new Error('Invalid key name metadata');
  }
  const entries = Object.entries(names);
  if (
    entries.length > 10_000 ||
    entries.some(
      ([fingerprint, name]) =>
        !/^[a-f0-9]{64}$/.test(fingerprint) ||
        typeof name !== 'string' ||
        Array.from(name).length > 128 ||
        /[\p{Cc}\p{Cf}]/u.test(name)
    )
  )
    throw new Error('Invalid key name metadata');
  return Object.fromEntries(entries);
}

export const sharedApiKeyNamesApi = {
  async list(): Promise<Record<string, string>> {
    return normalizeSharedApiKeyNames(await apiClient.get('/access/api-key-names'));
  },
  async update(
    names: Record<string, string>,
    onlyIfAbsent = false
  ): Promise<Record<string, string>> {
    return normalizeSharedApiKeyNames(
      await apiClient.patch('/access/api-key-names', {
        names,
        ...(onlyIfAbsent ? { only_if_absent: true } : {}),
      })
    );
  },
};
