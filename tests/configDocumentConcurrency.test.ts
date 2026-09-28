import { describe, expect, test } from 'bun:test';
import { parse as parseYaml, parseDocument } from 'yaml';
import {
  buildConfigSaveDraft,
  selectVisualMergeBase,
  shouldReloadVisualDraft,
} from '../src/features/config/hooks/useConfigDocument';

function applyProxyEdit(yaml: string): string {
  const document = parseDocument(yaml);
  document.setIn(['requests', 'proxy-url'], 'http://local-proxy.example');
  return document.toString();
}

describe('config document concurrency policy', () => {
  test('a visual/source mode round trip keeps merging visual edits onto the latest server YAML', () => {
    const synchronizedSource =
      'source-only: draft\nrequests:\n  proxy-url: http://local-proxy.example\nobservability:\n  logs:\n    debug: false\n';
    const latestServer =
      'source-only: server\nrequests:\n  proxy-url: http://old-proxy.example\nobservability:\n  logs:\n    debug: true\n';

    expect(shouldReloadVisualDraft(false, null)).toBe(false);

    const merged = applyProxyEdit(selectVisualMergeBase(latestServer, synchronizedSource, false));
    expect(parseYaml(merged)).toEqual({
      observability: { logs: { debug: true } },
      requests: { 'proxy-url': 'http://local-proxy.example' },
      'source-only': 'server',
    });
  });

  test('a real source edit keeps the local draft as the visual merge base', () => {
    const sourceDraft =
      'source-only: local-draft\nrequests:\n  proxy-url: http://old-proxy.example\nobservability:\n  logs:\n    debug: false\n';
    const latestServer =
      'source-only: server\nrequests:\n  proxy-url: http://old-proxy.example\nobservability:\n  logs:\n    debug: true\n';

    expect(shouldReloadVisualDraft(true, null)).toBe(true);

    const merged = applyProxyEdit(selectVisualMergeBase(latestServer, sourceDraft, true));
    expect(parseYaml(merged)).toEqual({
      observability: { logs: { debug: false } },
      requests: { 'proxy-url': 'http://local-proxy.example' },
      'source-only': 'local-draft',
    });
  });

  test('visual edits after a real source edit are applied on top of the source draft', () => {
    const source = 'source-only: local\nobservability:\n  logs:\n    debug: false\n';
    const server = 'source-only: server\nobservability:\n  logs:\n    debug: true\n';
    const result = buildConfigSaveDraft(server, source, true, 'visual', applyProxyEdit);
    expect(parseYaml(result)).toEqual({
      observability: { logs: { debug: false } },
      'source-only': 'local',
      requests: { 'proxy-url': 'http://local-proxy.example' },
    });
    expect(buildConfigSaveDraft(server, source, true, 'source', applyProxyEdit)).toBe(source);
  });

  test('viewing generated source retains the visual-origin save strategy', () => {
    const result = buildConfigSaveDraft(
      'observability:\n  logs:\n    debug: true\n',
      'observability:\n  logs:\n    debug: false\n',
      false,
      'source',
      applyProxyEdit
    );
    expect(parseYaml(result)).toEqual({
      observability: { logs: { debug: true } },
      requests: { 'proxy-url': 'http://local-proxy.example' },
    });
  });

  test('retries parsing after a YAML error even without a source edit', () => {
    expect(shouldReloadVisualDraft(false, 'Invalid YAML')).toBe(true);
  });
});
