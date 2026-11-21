import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(import.meta.dir, '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

// Every file that reads the management key on homelab. The nightly and parity scripts are
// compiled into the deployed job bundles, so a stale path there survives a quadlet fix.
const KEY_READERS = [
  'deploy/prox-history.container',
  'deploy/prox-usage.container',
  'deploy/prox-usage-job.sh',
  'scripts/deploy-homelab.sh',
  'scripts/usage-nightly.ts',
  'scripts/usage-parity.ts',
  'docs/PROX-SETUP.md',
];

// These name the upstream Management Center or its plugin store and repository, not the hub.
const UPSTREAM_KEYS = new Set([
  'title.login',
  'system_info.about_title',
  'system_info.link_main_repo_desc',
  'plugin_store.cli_proxy_api_source',
]);

function strings(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, child]) =>
    strings(child, path ? `${path}.${key}` : key)
  );
}

describe('ProxD names', () => {
  test.each(KEY_READERS)('%s reads the management key from ~/.config/proxd', (path) => {
    const text = read(path);
    expect(text).toContain('.config/proxd/management-key');
    expect(text).not.toContain('cli-proxy-rerank');
  });

  const locales = readdirSync(join(root, 'src/i18n/locales')).filter((f) => f.endsWith('.json'));
  test.each(locales)('%s calls the hub ProxD', (file) => {
    const stale = strings(JSON.parse(read(`src/i18n/locales/${file}`)))
      .filter(([key, text]) => !UPSTREAM_KEYS.has(key))
      // `CPA-<ShortID>` is a literal the backend generates, not a name for the hub.
      .filter(([, text]) => /CLI ?Proxy ?API|\bCPA\b(?!-)/.test(text))
      .map(([key]) => key);
    expect(stale).toEqual([]);
  });
});
