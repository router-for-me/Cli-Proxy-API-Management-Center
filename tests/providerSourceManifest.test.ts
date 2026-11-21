import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  publicSourceDiscovery,
  validateSourceDiscovery,
  validateSourceManifest,
} from '../src/domain/providerSources/manifest';
import { resolveConnectionSources } from '../src/domain/providerSources/resolution';
import { loadSourceManifest } from '../server/providerSources/config';
import { generateSourceRoutes } from '../server/providerSources/routing';

const revision = 'a'.repeat(64);
const appOrigin = 'https://console.example.test';

function manifestFixture() {
  return {
    schemaVersion: 1 as const,
    defaultInstanceId: 'alpha',
    history: {
      upstreamOrigin: 'http://history.internal.test:9000',
      managementKeyFile: '/synthetic-secrets/history-key',
    },
    sources: [
      {
        instanceId: 'alpha',
        label: 'First instance',
        publicBasePath: '/alpha',
        aliases: ['', '/legacy-alpha'],
        authScope: 'shared-management',
        upstreamOrigin: 'http://alpha.internal.test:8317',
        managementKeyFile: '/synthetic-secrets/alpha-key',
      },
      {
        instanceId: 'beta',
        label: 'Second instance',
        publicBasePath: '/team/beta',
        aliases: ['/beta'],
        authScope: 'shared-management',
        upstreamOrigin: 'https://beta.internal.test:8319',
        managementKeyFile: '/synthetic-secrets/beta-key',
      },
    ],
  };
}

function discoveryFixture() {
  return publicSourceDiscovery(validateSourceManifest(manifestFixture()), revision);
}

describe('provider source manifest and public discovery', () => {
  test('projects only public fields, excluding internal origins and credential references', () => {
    const input = manifestFixture();
    const discovery = publicSourceDiscovery(validateSourceManifest(input), revision);
    expect(discovery).toEqual({
      schemaVersion: 1,
      revision,
      defaultInstanceId: 'alpha',
      sources: [
        {
          instanceId: 'alpha',
          label: 'First instance',
          publicBasePath: '/alpha',
          aliases: ['', '/legacy-alpha'],
          authScope: 'shared-management',
        },
        {
          instanceId: 'beta',
          label: 'Second instance',
          publicBasePath: '/team/beta',
          aliases: ['/beta'],
          authScope: 'shared-management',
        },
      ],
    });
    const serialized = JSON.stringify(discovery);
    for (const privateConfig of [input.history, ...input.sources]) {
      expect(serialized).not.toContain(privateConfig.upstreamOrigin);
      expect(serialized).not.toContain(privateConfig.managementKeyFile);
    }
  });

  test('copies and freezes validated descriptors and their nested arrays', () => {
    const input = manifestFixture();
    const manifest = validateSourceManifest(input);
    const discovery = publicSourceDiscovery(manifest, revision);
    input.sources[0].aliases.push('/later');
    input.sources[0].label = 'Changed';
    for (const value of [manifest, discovery]) {
      expect(Object.isFrozen(value)).toBe(true);
      expect(Object.isFrozen(value.sources)).toBe(true);
      expect(value.sources[0].label).toBe('First instance');
      expect(value.sources[0].aliases).toEqual(['', '/legacy-alpha']);
      for (const source of value.sources) {
        expect(Object.isFrozen(source)).toBe(true);
        expect(Object.isFrozen(source.aliases)).toBe(true);
      }
    }
    expect(Object.isFrozen(manifest.history)).toBe(true);
  });

  const invalidInventories: [string, (input: ReturnType<typeof manifestFixture>) => void][] = [
    [
      'duplicate IDs',
      (m) => {
        m.sources[1].instanceId = 'alpha';
      },
    ],
    [
      'duplicate canonical paths',
      (m) => {
        m.sources[1].publicBasePath = '/alpha';
      },
    ],
    [
      'alias matching another canonical path',
      (m) => {
        m.sources[1].aliases = ['/alpha'];
      },
    ],
    [
      'alias matching its own canonical path',
      (m) => {
        m.sources[0].aliases = ['/alpha'];
      },
    ],
    [
      'repeated aliases',
      (m) => {
        m.sources[0].aliases = ['/old', '/old'];
      },
    ],
    [
      'shared root alias',
      (m) => {
        m.sources[1].aliases = [''];
      },
    ],
    [
      'missing default',
      (m) => {
        m.defaultInstanceId = 'absent';
      },
    ],
    [
      'empty inventory',
      (m) => {
        m.sources = [];
      },
    ],
    [
      'invalid instance ID',
      (m) => {
        m.sources[0].instanceId = 'Bad_ID';
      },
    ],
    [
      'invalid auth scope',
      (m) => {
        m.sources[0].authScope = 'scope/key';
      },
    ],
  ];

  test.each(invalidInventories)('rejects %s in both manifest and discovery', (_name, mutate) => {
    const input = manifestFixture();
    mutate(input);
    expect(() => validateSourceManifest(input)).toThrow();
    expect(() => publicSourceDiscovery(input, revision)).toThrow();
  });

  test.each([
    '/',
    '//host.test',
    '/alpha/',
    '/a//b',
    '/a/../b',
    '/a/%2e%2e/b',
    '/a?query=1',
    '/a#fragment',
    '/a\\b',
    '/a b',
    '/a;return',
    '/a\n',
    'https://host.test/a',
  ])('rejects unsafe public paths and aliases: %j', (path) => {
    for (const field of ['publicBasePath', 'aliases'] as const) {
      const input = manifestFixture();
      if (field === 'aliases') input.sources[0].aliases = [path];
      else input.sources[0].publicBasePath = path;
      expect(() => validateSourceManifest(input)).toThrow();
      expect(() => publicSourceDiscovery(input, revision)).toThrow();
    }
  });

  test.each([
    'ftp://upstream.test',
    'file:///tmp/upstream',
    'javascript:alert(1)',
    'https://user:synthetic-password@upstream.test',
    'https://upstream.test/path',
    'https://upstream.test/',
    'https://upstream.test?query=1',
    'https://upstream.test#fragment',
    '//upstream.test',
    'https://upstream.test;return',
    'https://upstream.test\n',
  ])('rejects unsafe source and history origins: %j', (upstreamOrigin) => {
    for (const target of ['source', 'history']) {
      const input = manifestFixture();
      (target === 'source' ? input.sources[0] : input.history).upstreamOrigin = upstreamOrigin;
      expect(() => validateSourceManifest(input)).toThrow();
    }
  });

  test.each(['http://127.0.0.1:8317', 'https://upstream.test', 'http://[::1]:8317'])(
    'accepts a plain HTTP(S) upstream origin: %s',
    (upstreamOrigin) => {
      const input = manifestFixture();
      input.sources[0].upstreamOrigin = upstreamOrigin;
      expect(validateSourceManifest(input).sources[0].upstreamOrigin).toBe(upstreamOrigin);
    }
  );

  test.each(['relative/key', '/run/../key', '/run/key\n', ''])(
    'rejects unsafe credential file references: %j',
    (managementKeyFile) => {
      for (const target of ['source', 'history']) {
        const input = manifestFixture();
        (target === 'source' ? input.sources[0] : input.history).managementKeyFile =
          managementKeyFile;
        expect(() => validateSourceManifest(input)).toThrow();
      }
    }
  );

  test('rejects extra fields rather than accepting embedded credentials', () => {
    const input = manifestFixture();
    expect(() => validateSourceManifest({ ...input, managementKey: 'synthetic-only' })).toThrow();
    expect(() =>
      validateSourceManifest({
        ...input,
        history: { ...input.history, managementKey: 'synthetic-only' },
      })
    ).toThrow();
    expect(() =>
      validateSourceManifest({
        ...input,
        sources: [{ ...input.sources[0], managementKey: 'synthetic-only' }],
      })
    ).toThrow();
    const discovery = discoveryFixture();
    expect(() => validateSourceDiscovery({ ...discovery, history: input.history })).toThrow();
    for (const field of ['upstreamOrigin', 'managementKeyFile', 'managementKey']) {
      expect(() =>
        validateSourceDiscovery({
          ...discovery,
          sources: [{ ...discovery.sources[0], [field]: 'synthetic-only' }],
        })
      ).toThrow();
    }
  });

  test.each([[null], [[]], [{}], [{ schemaVersion: 2 }], ['manifest']])(
    'rejects malformed documents: %j',
    (input) => {
      expect(() => validateSourceManifest(input)).toThrow();
      expect(() => validateSourceDiscovery(input)).toThrow();
    }
  );

  test.each(['', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), 'A'.repeat(64)])(
    'rejects malformed discovery revision: %j',
    (invalidRevision) => {
      expect(() =>
        publicSourceDiscovery(validateSourceManifest(manifestFixture()), invalidRevision)
      ).toThrow();
    }
  );
});

describe('provider source configuration loading', () => {
  test('validates the checked-in deployment inventory and projects its discovery', () => {
    const path = fileURLToPath(new URL('../deploy/provider-sources.json', import.meta.url));
    const loaded = loadSourceManifest(path);
    expect(loaded.manifest.sources.map((source) => source.instanceId)).toEqual([
      'codex-primary',
      'claude-primary',
      'gemini-primary',
    ]);
    expect(loaded.manifest.defaultInstanceId).toBe('codex-primary');
    expect(loaded.discovery).toEqual(publicSourceDiscovery(loaded.manifest, loaded.revision));
    expect(loaded.revision).toBe(
      createHash('sha256').update(JSON.stringify(loaded.manifest)).digest('hex')
    );
  });

  test('reads analytics from loopback prox-usage with a key the history container mounts', () => {
    const path = fileURLToPath(new URL('../deploy/provider-sources.json', import.meta.url));
    const unit = readFileSync(
      fileURLToPath(new URL('../deploy/prox-history.container', import.meta.url)),
      'utf8'
    );
    const { analytics, history } = loadSourceManifest(path).manifest;
    expect(analytics?.upstreamOrigin).toBe('http://127.0.0.1:18320');
    // prox-usage checks the management key, which history already mounts.
    expect(analytics?.adminKeyFile).toBe(history.managementKeyFile);
    expect(unit).toContain(`:${history.managementKeyFile}:ro`);
    expect(unit).toContain('Network=host');
    expect(unit).not.toContain('cpa-admin-key');
  });

  test('hashes validated content consistently and surfaces file, JSON, and validation errors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'provider-source-manifest-'));
    const path = join(directory, 'manifest.json');
    try {
      expect(() => loadSourceManifest(path)).toThrow();
      const input = manifestFixture();
      writeFileSync(path, JSON.stringify(input));
      const first = loadSourceManifest(path);
      writeFileSync(path, JSON.stringify(input, null, 2));
      expect(loadSourceManifest(path)).toEqual(first);
      input.sources[0].upstreamOrigin = 'http://replacement.internal.test:8317';
      writeFileSync(path, JSON.stringify(input));
      expect(loadSourceManifest(path).revision).not.toBe(first.revision);
      writeFileSync(path, '{');
      expect(() => loadSourceManifest(path)).toThrow();
      writeFileSync(path, JSON.stringify({ ...input, defaultInstanceId: 'missing' }));
      expect(() => loadSourceManifest(path)).toThrow('Default source is not configured');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});

describe('provider connection resolution', () => {
  test.each([
    ['', 'alpha'],
    ['/alpha', 'alpha'],
    ['/legacy-alpha', 'alpha'],
    ['/team/beta', 'beta'],
    ['/beta', 'beta'],
    ['/beta/v8/management///', 'beta'],
  ])('resolves %j to %s with one canonical entry per instance', (path, selectedInstanceId) => {
    const discovery = discoveryFixture();
    const result = resolveConnectionSources(`${appOrigin}${path}`, appOrigin, discovery);
    expect(result).toEqual({
      mode: 'deployment',
      revision,
      selectedInstanceId,
      sources: discovery.sources.map((source) => ({
        ...source,
        apiBase: `${appOrigin}${source.publicBasePath}`,
      })),
    });
    expect(new Set(result.sources.map((source) => source.instanceId)).size).toBe(2);
  });

  test.each([
    ['https://external.example.test/alpha/v8/management/', 'https://external.example.test/alpha'],
    [`${appOrigin}/unlisted`, `${appOrigin}/unlisted`],
    [`${appOrigin}/alpha/child`, `${appOrigin}/alpha/child`],
    [`${appOrigin}/alphabet`, `${appOrigin}/alphabet`],
    ['http://console.example.test/alpha', 'http://console.example.test/alpha'],
    ['https://console.example.test:8443/alpha', 'https://console.example.test:8443/alpha'],
    ['external.example.test:8317', 'http://external.example.test:8317'],
  ])('keeps unrecognized connection %s as a single external source', (input, base) => {
    expect(resolveConnectionSources(input, appOrigin, discoveryFixture())).toEqual({
      mode: 'external',
      revision: base,
      selectedInstanceId: 'external',
      sources: [
        {
          instanceId: 'external',
          label: new URL(base).host,
          publicBasePath: '',
          aliases: [],
          authScope: 'external',
          apiBase: base,
        },
      ],
    });
  });

  test('falls back without discovery even when the path would otherwise match', () => {
    const result = resolveConnectionSources(`${appOrigin}/alpha`, appOrigin, null);
    expect(result.mode).toBe('external');
    expect(result.sources).toHaveLength(1);
    expect(result.sources[0].apiBase).toBe(`${appOrigin}/alpha`);
  });

  test.each([
    '',
    'https://user:synthetic-password@external.example.test',
    'https://external.example.test?query=1',
    'https://external.example.test#fragment',
    'ftp://external.example.test',
    'file:///tmp/provider',
  ])('rejects unsafe management connections: %j', (input) => {
    expect(() => resolveConnectionSources(input, appOrigin, discoveryFixture())).toThrow();
  });
});

describe('generated provider source routes', () => {
  test('routes every canonical path and alias to its own management/catalog and shared history', () => {
    const manifest = validateSourceManifest(manifestFixture());
    const output = generateSourceRoutes(manifest, revision);
    const blocks = [...output.matchAll(/location ([^\n]+) \{\s*([^}]+)\}/g)].map((match) => [
      match[1],
      match[2].trim(),
    ]);
    const expected: string[][] = [['= /prox/sources.json', 'try_files /prox/sources.json =404;']];
    const cases = [
      ['', 'http://alpha.internal.test:8317'],
      ['/alpha', 'http://alpha.internal.test:8317'],
      ['/legacy-alpha', 'http://alpha.internal.test:8317'],
      ['/team/beta', 'https://beta.internal.test:8319'],
      ['/beta', 'https://beta.internal.test:8319'],
    ];
    for (const [base, upstream] of cases) {
      expected.push(
        [`^~ ${base}/v8/management/prox/`, 'proxy_pass http://history.internal.test:9000/v1/;'],
        [`^~ ${base}/v8/management/`, `proxy_pass ${upstream}/v8/management/;`],
        [`= ${base}/v1/models`, `proxy_pass ${upstream}/v1/models;`]
      );
    }
    expect(blocks.sort()).toEqual(expected.sort());
    expect(new Set(blocks.map(([location]) => location)).size).toBe(expected.length);
    expect(output).toContain(`revision ${revision}`);
    expect(output).not.toContain('/v0/');
    expect(output).not.toContain('$');
    expect(output).not.toMatch(/proxy_set_header\s+Authorization/i);
    for (const config of [manifest.history, ...manifest.sources]) {
      expect(output).not.toContain(config.managementKeyFile);
    }
  });
});
