import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { apiClient } from '../src/services/api/client';
import {
  loadApiKeyNameState,
  loadSharedApiKeyNames,
  saveSharedApiKeyName,
  saveApiKeyName,
  sharedApiKeyFingerprint,
} from '../src/features/config/apiKeyNames';

const originalGet = apiClient.get;
const originalPatch = apiClient.patch;
const originalRevision = apiClient.getConnectionRevision;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let names: Record<string, string>;
type NameUpdate = { names: Record<string, string>; only_if_absent?: boolean };
let writes: NameUpdate[];
let revision: number;
beforeEach(() => {
  names = {};
  writes = [];
  revision = 1;
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  apiClient.getConnectionRevision = () => revision;
  apiClient.get = (async () => ({ names: { ...names } })) as typeof apiClient.get;
  apiClient.patch = (async (path: string, body: NameUpdate) => {
    expect(path).toBe('/access/api-key-names');
    writes.push(body);
    for (const [key, value] of Object.entries(body.names))
      if (!body.only_if_absent || !Object.hasOwn(names, key)) names[key] = value as string;
    return { names: { ...names } };
  }) as typeof apiClient.patch;
});
afterEach(() => {
  apiClient.get = originalGet;
  apiClient.patch = originalPatch;
  apiClient.getConnectionRevision = originalRevision;
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});
test('fingerprints match CPA and Keeper independently of browser address', () => {
  expect(sharedApiKeyFingerprint('fixture-key')).toBe(
    createHash('sha256').update('fixture-key').digest('hex')
  );
});
test('imports missing local names once and preserves shared names and clear tombstones', async () => {
  for (const key of ['one', 'two', 'three']) saveApiKeyName('server', key, 'Local ' + key);
  names[sharedApiKeyFingerprint('two')] = 'Shared Team';
  names[sharedApiKeyFingerprint('three')] = '';
  const result = await loadSharedApiKeyNames('server', ['one', 'two', 'three']);
  expect(result[sharedApiKeyFingerprint('one')]).toBe('Local one');
  expect(result[sharedApiKeyFingerprint('two')]).toBe('Shared Team');
  expect(result[sharedApiKeyFingerprint('three')]).toBe('');
  expect(writes).toHaveLength(1);
  expect(writes[0].only_if_absent).toBe(true);
  await loadSharedApiKeyNames('server', ['one', 'two', 'three']);
  expect(writes).toHaveLength(1);
  expect(JSON.stringify(writes)).not.toContain('"one"');
});
test('renames and clears shared names without replacing other keys', async () => {
  names[sharedApiKeyFingerprint('other')] = 'Other';
  await saveSharedApiKeyName('one', ' Team ✓ ');
  expect(names[sharedApiKeyFingerprint('one')]).toBe('Team ✓');
  await saveSharedApiKeyName('one', '');
  expect(names[sharedApiKeyFingerprint('one')]).toBe('');
  expect(names[sharedApiKeyFingerprint('other')]).toBe('Other');
});
test('connection changes prevent importing names into another server', async () => {
  saveApiKeyName('server', 'one', 'Local');
  apiClient.get = (async () => {
    revision++;
    return { names: {} };
  }) as typeof apiClient.get;
  await expect(loadSharedApiKeyNames('server', ['one'])).rejects.toThrow('Connection changed');
  expect(writes).toHaveLength(0);
});
test('management failure is surfaced without claiming local save success', async () => {
  apiClient.patch = (async () => {
    throw new Error('offline');
  }) as typeof apiClient.patch;
  await expect(saveSharedApiKeyName('one', 'Team')).rejects.toThrow('offline');
});

test('older servers keep browser-local names editable without importing them', async () => {
  saveApiKeyName('server', 'one', 'Local');
  apiClient.get = (async () => {
    throw Object.assign(new Error('not found'), { status: 404 });
  }) as typeof apiClient.get;
  const result = await loadApiKeyNameState('server', ['one']);
  expect(result.shared).toBe(false);
  expect(result.names[sharedApiKeyFingerprint('one')]).toBe('Local');
  expect(writes).toHaveLength(0);
  saveApiKeyName('server', 'one', 'Edited');
  expect((await loadApiKeyNameState('server', ['one'])).names[sharedApiKeyFingerprint('one')]).toBe(
    'Edited'
  );
});

test('server failures do not downgrade shared metadata to browser-local writes', async () => {
  apiClient.get = (async () => {
    throw Object.assign(new Error('unavailable'), { status: 503 });
  }) as typeof apiClient.get;
  await expect(loadApiKeyNameState('server', ['one'])).rejects.toThrow('unavailable');
  expect(writes).toHaveLength(0);
});

test('late old-server errors after a connection change cannot select local fallback', async () => {
  apiClient.get = (async () => {
    revision++;
    throw Object.assign(new Error('not found'), { status: 404 });
  }) as typeof apiClient.get;
  await expect(loadApiKeyNameState('server', ['one'])).rejects.toThrow('Connection changed');
});

test('late successful writes cannot update a new connection', async () => {
  apiClient.patch = (async () => {
    revision++;
    return { names: {} };
  }) as typeof apiClient.patch;
  await expect(saveSharedApiKeyName('one', 'Team')).rejects.toThrow('Connection changed');
});
