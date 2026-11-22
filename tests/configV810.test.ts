import { describe, expect, test } from 'bun:test';
import { parseDocument } from 'yaml';
import { createErrorRule } from '@/features/providers/errorRules';
import { normalizeConfigResponse } from '@/services/api/transformers';
import { ConfigDraftConflictError } from '@/services/api/configPatch';
import { runVisualConfig } from './helpers/visualConfig';

const yaml = `oauth:
  request-scoped-errors:
    copilot:
      - status: 400
        match-regexr: ['^context_limit']
        action: stop
        future: retained
      - status: 429
        match: [rate_limit]
        action: continue
    acme-plugin:
      - {status: 503, match: [unavailable], action: stop}
`;

describe('v8.1.0 configuration', () => {
  test('deployment UUID validation allows blank regeneration and rejects malformed or nil IDs', () => {
    const id = '172AAC37-C4AC-4488-998E-652D91001340';
    const source = `server: {server-id: ${id}}`;
    expect(normalizeConfigResponse(parseDocument(source).toJS()).serverId).toBe(id);
    expect(normalizeConfigResponse({ server: {} }).serverId).toBeUndefined();
    for (const invalid of ['123', id.replaceAll('-', ''), '00000000-0000-0000-0000-000000000000']) {
      expect(runVisualConfig(source, [{ serverId: invalid }]).visualValidationErrors.serverId).toBe(
        'invalid_server_id'
      );
    }
    for (const value of [id.toLowerCase(), '']) {
      const editor = runVisualConfig(source, [{ serverId: value }]);
      expect(editor.visualValidationErrors.serverId).toBeUndefined();
      expect(
        parseDocument(editor.applyVisualChangesToYaml(source)).getIn(['server', 'server-id'])
      ).toBe(value);
    }
  });

  test('edits and reorders Copilot rules while retaining metadata, regex spelling and concurrent plugin edits', () => {
    const groups = runVisualConfig(yaml).visualValues.oauthErrorRules;
    const [first, second] = groups[0].rules;
    const oauthErrorRules = [
      { channel: 'copilot', rules: [second, { ...first, status: '422' }] },
      groups[1],
    ];
    const editor = runVisualConfig(yaml, [{ oauthErrorRules }]);
    const latest = yaml.replace('unavailable', 'maintenance');
    const result = parseDocument(editor.applyVisualChangesToYaml(latest)).toJS().oauth[
      'request-scoped-errors'
    ];
    expect(result.copilot).toEqual([
      { status: 429, match: ['rate_limit'], action: 'continue' },
      { status: 422, 'match-regexr': ['^context_limit'], action: 'stop', future: 'retained' },
    ]);
    expect(result['acme-plugin'][0].match).toEqual(['maintenance']);
    expect(() => editor.applyVisualChangesToYaml(yaml.replace('rate_limit', 'concurrent'))).toThrow(
      ConfigDraftConflictError
    );
    const cleared = runVisualConfig(yaml, [{ oauthErrorRules: [groups[1]] }]);
    expect(
      parseDocument(cleared.applyVisualChangesToYaml(yaml)).toJS().oauth['request-scoped-errors']
    ).toEqual({
      'acme-plugin': [{ status: 503, match: ['unavailable'], action: 'stop' }],
    });
  });

  test('creates plugin channel below a null parent and rejects empty OAuth match conditions', () => {
    const source = 'oauth: null';
    const rule = { ...createErrorRule('new'), status: '429' };
    const edit = (value: string) =>
      runVisualConfig(source, [
        {
          oauthErrorRules: [
            {
              channel: 'test-plugin',
              rules: [{ ...rule, matches: [{ id: 'm', kind: 'regex', value }] }],
            },
          ],
        },
      ]);
    expect(edit('   ').visualValidationErrors.oauthErrorRules).toBe('invalid_oauth_error_rules');
    const valid = edit('^quota');
    expect(valid.visualValidationErrors.oauthErrorRules).toBeUndefined();
    expect(
      parseDocument(valid.applyVisualChangesToYaml(source)).toJS().oauth['request-scoped-errors'][
        'test-plugin'
      ]
    ).toEqual([{ status: 429, 'match-regexr': ['^quota'], action: 'continue' }]);
  });

  test('omitted Antigravity pool limit stays omitted and explicit nonpositive limits round-trip', () => {
    const path = [
      'oauth',
      'providers',
      'antigravity',
      'connection-pool',
      'max-idle-conns-per-host',
    ];
    expect(parseDocument(runVisualConfig('{}').applyVisualChangesToYaml('{}')).hasIn(path)).toBe(
      false
    );
    for (const value of ['0', '-1']) {
      const editor = runVisualConfig('{}', [
        { antigravityConnectionPoolMaxIdleConnsPerHost: value },
      ]);
      expect(
        editor.visualValidationErrors.antigravityConnectionPoolMaxIdleConnsPerHost
      ).toBeUndefined();
      expect(parseDocument(editor.applyVisualChangesToYaml('{}')).getIn(path)).toBe(Number(value));
    }
  });
});
