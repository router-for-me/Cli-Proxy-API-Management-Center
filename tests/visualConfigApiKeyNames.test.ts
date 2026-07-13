import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseDocument, isSeq, isScalar } from 'yaml';
import {
  parseApiKeyEntries,
  serializeApiKeyEntries,
  useVisualConfig,
} from '../src/hooks/useVisualConfig';

describe('visual config api key names', () => {
  test('serialize/parse round-trips key and name via tab separator', () => {
    const text = serializeApiKeyEntries([
      { key: 'sk-prod', name: 'production' },
      { key: 'sk-dev', name: '' },
      { key: 'sk-stage', name: 'staging box' },
    ]);
    expect(parseApiKeyEntries(text)).toEqual([
      { key: 'sk-prod', name: 'production' },
      { key: 'sk-dev', name: '' },
      { key: 'sk-stage', name: 'staging box' },
    ]);
  });

  test('loads YAML EOL comments as names and writes them back', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.loadVisualValuesFromYaml(
          [
            'debug: false',
            'api-keys:',
            '  - "sk-aaa" # prod',
            '  - sk-bbb # staging',
            '  - "sk-ccc"',
            '',
          ].join('\n')
        );
        setPhase(1);
      } else if (phase === 1) {
        visualConfig.setVisualValues({
          apiKeysText: serializeApiKeyEntries([
            { key: 'sk-aaa', name: 'prod-renamed' },
            { key: 'sk-bbb', name: 'staging' },
            { key: 'sk-new', name: 'fresh' },
          ]),
        });
        setPhase(2);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml(
            [
              'debug: true',
              'api-keys:',
              '  - "sk-aaa" # prod',
              '  - sk-bbb # staging',
              '  - "sk-ccc"',
              '',
            ].join('\n')
          )
        );
      }

      return null;
    }

    // Phase 0 load
    renderToStaticMarkup(createElement(Harness));
    // Phase 1 mutate + phase 2 render merged yaml
    const markup = renderToStaticMarkup(createElement(Harness));
    const merged = markup.slice('<pre>'.length, -'</pre>'.length);
    const doc = parseDocument(merged);
    const seq = doc.getIn(['api-keys'], true);
    expect(isSeq(seq)).toBe(true);
    if (!isSeq(seq)) return;

    const loaded = seq.items.map((item) => {
      expect(isScalar(item)).toBe(true);
      if (!isScalar(item)) return { key: '', name: '' };
      return {
        key: String(item.value ?? ''),
        name: String(item.comment ?? '')
          .replace(/^\s*/, '')
          .trim(),
      };
    });

    expect(loaded).toEqual([
      { key: 'sk-aaa', name: 'prod-renamed' },
      { key: 'sk-bbb', name: 'staging' },
      { key: 'sk-new', name: 'fresh' },
    ]);
    // Unrelated fields from the latest server YAML are preserved.
    expect(doc.get('debug')).toBe(true);
  });
});
