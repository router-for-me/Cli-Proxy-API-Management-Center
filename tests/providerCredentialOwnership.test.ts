import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';
import { loadSourceManifest } from '../server/providerSources/config';
import {
  publicSourceDiscovery,
  validateSourceDiscovery,
  validateSourceManifest,
} from '../src/domain/providerSources/manifest';
import {
  credentialDestination,
  misplacedCredentialOwner,
} from '../src/domain/providerSources/ownership';

const revision = 'a'.repeat(64);
const source = (instanceId: string, providers?: string[]) => ({
  instanceId,
  label: `${instanceId} label`,
  publicBasePath: `/${instanceId}`,
  aliases: [],
  authScope: 'shared',
  upstreamOrigin: 'http://proxy.internal.test:8317',
  managementKeyFile: '/synthetic-secrets/key',
  ...(providers ? { providers } : {}),
});
const manifest = (sources: ReturnType<typeof source>[]) => ({
  schemaVersion: 1 as const,
  defaultInstanceId: sources[0].instanceId,
  history: {
    upstreamOrigin: 'http://history.internal.test:9000',
    managementKeyFile: '/synthetic-secrets/history-key',
  },
  sources,
});
const view = (instanceId: string, providers?: string[]) => ({
  source: { instanceId, ...(providers ? { providers } : {}) },
});
const views = [view('codex-primary', ['codex']), view('claude-primary', ['claude']), view('misc')];

describe('credential provider ownership in the manifest', () => {
  test('publishes declared providers and omits the field otherwise', () => {
    const discovery = publicSourceDiscovery(
      validateSourceManifest(manifest([source('alpha', ['claude']), source('beta')])),
      revision
    );
    expect(discovery.sources[0].providers).toEqual(['claude']);
    expect('providers' in discovery.sources[1]).toBe(false);
    expect(validateSourceDiscovery(discovery)).toEqual(discovery);
  });

  test('rejects a provider owned twice, so a credential has exactly one home', () => {
    expect(() =>
      validateSourceManifest(manifest([source('alpha', ['claude']), source('beta', ['claude'])]))
    ).toThrow('more than one source');
  });

  test('rejects malformed provider names and the OAuth alias', () => {
    for (const bad of ['', 'Claude', 'anthropic', 'a b']) {
      expect(() => validateSourceManifest(manifest([source('alpha', [bad])]))).toThrow();
    }
  });

  test('the deployed manifest gives each owned provider its own instance', () => {
    const path = fileURLToPath(new URL('../deploy/provider-sources.json', import.meta.url));
    const { manifest: deployed } = loadSourceManifest(path);
    const owners = Object.fromEntries(
      deployed.sources.flatMap((s) => (s.providers ?? []).map((p) => [p, s.instanceId]))
    );
    expect(owners).toEqual({
      claude: 'claude-primary',
      codex: 'codex-primary',
      antigravity: 'gemini-primary',
    });
  });
});

describe('credentialDestination', () => {
  test('a Claude login started from the Codex source goes to the Claude source', () => {
    expect(credentialDestination(views, 'codex-primary', 'anthropic')?.source.instanceId).toBe(
      'claude-primary'
    );
    expect(credentialDestination(views, 'codex-primary', 'claude')?.source.instanceId).toBe(
      'claude-primary'
    );
  });

  test('a Codex login started from the Claude source goes to the Codex source', () => {
    expect(credentialDestination(views, 'claude-primary', 'codex')?.source.instanceId).toBe(
      'codex-primary'
    );
  });

  test('a provider nobody owns stays on the selected source', () => {
    expect(credentialDestination(views, 'misc', 'kimi')?.source.instanceId).toBe('misc');
  });

  test('a single external backend keeps every login', () => {
    expect(
      credentialDestination([view('external')], 'external', 'anthropic')?.source.instanceId
    ).toBe('external');
  });
});

describe('misplacedCredentialOwner', () => {
  const claude = JSON.stringify({ type: 'claude' });

  test('names the owner when a credential is uploaded to another provider source', () => {
    expect(misplacedCredentialOwner(views, 'codex-primary', claude)?.source.instanceId).toBe(
      'claude-primary'
    );
  });

  test('accepts the owning source, unowned providers and unreadable files', () => {
    expect(misplacedCredentialOwner(views, 'claude-primary', claude)).toBeNull();
    expect(misplacedCredentialOwner(views, 'misc', JSON.stringify({ type: 'kimi' }))).toBeNull();
    expect(misplacedCredentialOwner(views, 'codex-primary', 'not json')).toBeNull();
    expect(misplacedCredentialOwner(views, 'codex-primary', '{"name":"untyped"}')).toBeNull();
  });
});
