import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { useVisualConfig } from '../src/hooks/useVisualConfig';

function unwrapPre(markup: string): string {
  return markup.slice('<pre>'.length, -'</pre>'.length);
}

describe('visual config Antigravity sensitive words', () => {
  test('loads antigravity.sensitive-words from YAML', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [loaded, setLoaded] = useState(false);

      if (!loaded) {
        visualConfig.loadVisualValuesFromYaml(
          'oauth:\n  providers:\n    antigravity:\n      sensitive-words:\n        - Hermes\n        - Nous Research\n'
        );
        setLoaded(true);
        return null;
      }

      return createElement(
        'pre',
        null,
        visualConfig.visualValues.antigravitySensitiveWords.join('|')
      );
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    expect(unwrapPre(markup)).toBe('Hermes|Nous Research');
  });

  test('appends trimmed values while preserving item comments and other Antigravity settings', () => {
    const yaml = `oauth:
  providers:
    antigravity:
      sensitive-words:
        - Hermes # keep this note
      future-option: true
`;
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.loadVisualValuesFromYaml(yaml);
        setPhase(1);
      } else if (phase === 1) {
        visualConfig.setVisualValues({
          antigravitySensitiveWords: [' Hermes ', '', 'Nous Research'],
        });
        setPhase(2);
      } else {
        return createElement('pre', null, visualConfig.applyVisualChangesToYaml(yaml));
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const output = unwrapPre(markup);
    expect(output).toContain('- Hermes # keep this note');
    expect(parseYaml(output)).toEqual({
      oauth: {
        providers: {
          antigravity: {
            'sensitive-words': ['Hermes', 'Nous Research'],
            'future-option': true,
          },
        },
      },
    });
  });

  test('removes an empty Antigravity block after clearing the list', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.loadVisualValuesFromYaml(
          'oauth:\n  providers:\n    antigravity:\n      sensitive-words:\n        - proxy\nobservability:\n  logs:\n    debug: true\n'
        );
        setPhase(1);
      } else if (phase === 1) {
        visualConfig.setVisualValues({ antigravitySensitiveWords: [] });
        setPhase(2);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml(
            'oauth:\n  providers:\n    antigravity:\n      sensitive-words:\n        - proxy\nobservability:\n  logs:\n    debug: true\n'
          )
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    expect(parseYaml(unwrapPre(markup))).toEqual({ observability: { logs: { debug: true } } });
  });
});
