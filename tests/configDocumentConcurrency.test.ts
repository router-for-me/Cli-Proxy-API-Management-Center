import { describe, expect, mock, spyOn, test } from 'bun:test';
import { parse as parseYaml, parseDocument } from 'yaml';
import {
  blockingVisualParseError,
  confirmSourceDraft,
  buildConfigSaveDraft,
  shouldReloadVisualDraft,
} from '../src/features/config/hooks/useConfigDocument';
import { buildConfigPatch } from '../src/services/api/configPatch';

import { apiClient } from '../src/services/api/client';

function applyProxyEdit(yaml: string): string {
  const document = parseDocument(yaml);
  document.setIn(['requests', 'proxy-url'], 'http://local-proxy.example');
  return document.toString();
}

describe('config document concurrency policy', () => {
  test('a visual/source round trip preserves field dirty state and patches only local edits', () => {
    const synchronizedSource =
      'requests:\n  proxy-url: http://local-proxy.example\nobservability:\n  logs:\n    debug: false\n';
    const latestServer =
      'requests:\n  proxy-url: http://old-proxy.example\nobservability:\n  logs:\n    debug: true\n';

    expect(shouldReloadVisualDraft(false, null)).toBe(false);
    const merged = buildConfigSaveDraft(
      latestServer,
      synchronizedSource,
      false,
      'visual',
      applyProxyEdit
    );
    expect(parseYaml(merged)).toEqual({
      observability: { logs: { debug: true } },
      requests: { 'proxy-url': 'http://local-proxy.example' },
    });
    expect(buildConfigPatch(latestServer, merged)).toEqual({
      patch: { requests: { 'proxy-url': 'http://local-proxy.example' } },
      deletions: [],
    });
  });

  test('real source edits cannot be submitted from visual mode (decision A)', () => {
    expect(() =>
      buildConfigSaveDraft(
        'server: {port: 8317}',
        'server: {port: 9000}',
        true,
        'visual',
        applyProxyEdit
      )
    ).toThrow('Unsaved source edits');
  });

  test('source saves preserve the complete draft, including comments, without rebuilding it', () => {
    const source = '# intentional source formatting\nserver: {port: 9000}\n';
    expect(
      buildConfigSaveDraft('server: {port: 8317}', source, true, 'source', () => {
        throw new Error('Do not apply visual values to a source draft');
      })
    ).toBe(source);
  });

  test('a source repair previews the corrected text despite an invalid visual baseline', () => {
    const broken = 'server: [\n';
    const fixed = '# repaired\nserver: {port: 8317}\n';
    const parseError = 'Invalid YAML';
    expect(blockingVisualParseError('visual', true, parseError)).toBe(parseError);
    expect(blockingVisualParseError('source', false, parseError)).toBe(parseError);
    expect(blockingVisualParseError('source', true, parseError)).toBeNull();
    const preview = (draft: string) =>
      buildConfigSaveDraft(broken, draft, true, 'source', applyProxyEdit);
    expect(() => preview('server: {')).toThrow();
    expect(preview(fixed)).toBe(fixed);
  });

  test.each(['\n', '\r\n'])('source edits preserve server line endings (%j)', (eol) => {
    const lines = Array.from({ length: 165 }, (_, i) => `key${i}: ${i}`);
    const server = lines.join(eol);
    const save = (draft: string) =>
      buildConfigSaveDraft(server, draft, true, 'source', applyProxyEdit);

    expect(save(lines.join('\n'))).toBe(server); // An edit followed by undo is a no-op.
    lines.splice(103, 0, ...Array.from({ length: 13 }, (_, i) => `extra${i}: true`));
    expect(save(lines.join('\n'))).toBe(lines.join(eol));
    expect(save(lines.join('\n') + '\n')).toBe(lines.join(eol) + eol);
  });

  test('viewing generated source still builds on latest server values before a full source save', () => {
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

test('a racing source PUT invalidates the preview and only writes the draft after new confirmation', async () => {
  const read = spyOn(apiClient, 'getRaw');
  const put = spyOn(apiClient, 'put');
  const snapshot = (data: string, etag: string) =>
    ({ data, headers: { etag } }) as Awaited<ReturnType<typeof apiClient.getRaw>>;
  const invalidate = mock(() => {});
  const draft = '# keep my formatting\nport: 3\n';
  try {
    read
      .mockResolvedValueOnce(snapshot('port: 1', '"first"'))
      .mockResolvedValueOnce(snapshot('port: 2', '"racing"'))
      .mockResolvedValueOnce(snapshot('port: 2', '"final"'));
    put
      .mockRejectedValueOnce(Object.assign(new Error('precondition_failed'), { status: 412 }))
      .mockResolvedValueOnce({});
    const confirm = (preview: string) => confirmSourceDraft(preview, draft, () => true, invalidate);
    expect(await confirm('port: 1')).toEqual({ yaml: 'port: 2', review: true });
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0]?.[2]?.headers?.['If-Match']).toBe('"first"');
    expect(await confirm('port: 2')).toEqual({ yaml: 'port: 2', review: false });
    expect(put.mock.calls[1]?.[1]).toBe(draft);
    expect(put.mock.calls[1]?.[2]?.headers?.['If-Match']).toBe('"final"');
  } finally {
    read.mockRestore();
    put.mockRestore();
  }
});
