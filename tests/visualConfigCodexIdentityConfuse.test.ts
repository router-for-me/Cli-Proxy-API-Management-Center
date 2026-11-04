import { describe, expect, test } from 'bun:test';
import { createElement, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parse as parseYaml } from 'yaml';
import { CONFIG_FIELD_SEARCH_INDEX } from '../src/features/config/searchIndex';
import { useVisualConfig } from '../src/hooks/useVisualConfig';

describe('visual config Codex identity-confuse', () => {
  test('loads and saves the nested flag while preserving unrelated YAML', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.loadVisualValuesFromYaml(
          [
            'oauth:',
            '  providers:',
            '    codex:',
            '      identity-confuse: true',
            '      existing-setting: keep-me',
            'unrelated:',
            '  nested: preserved',
            '',
          ].join('\n')
        );
        setPhase(1);
      } else if (phase === 1) {
        if (!visualConfig.visualValues.codexIdentityConfuse) {
          return createElement('pre', null, 'load-failed');
        }
        visualConfig.setVisualValues({ codexIdentityConfuse: false });
        setPhase(2);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml(
            [
              'oauth:',
              '  providers:',
              '    codex:',
              '      identity-confuse: true',
              '      existing-setting: keep-me',
              'unrelated:',
              '  nested: preserved',
              '',
            ].join('\n')
          )
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const merged = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(merged).not.toBe('load-failed');
    expect(parseYaml(merged)).toEqual({
      oauth: {
        providers: {
          codex: {
            'identity-confuse': false,
            'existing-setting': 'keep-me',
          },
        },
      },
      unrelated: {
        nested: 'preserved',
      },
    });
  });

  test('adds the nested flag without replacing the existing Codex map', () => {
    function Harness() {
      const visualConfig = useVisualConfig();
      const [phase, setPhase] = useState(0);

      if (phase === 0) {
        visualConfig.loadVisualValuesFromYaml(
          'oauth:\n  providers:\n    codex:\n      existing-setting: keep-me\n'
        );
        setPhase(1);
      } else if (phase === 1) {
        visualConfig.setVisualValues({ codexIdentityConfuse: true });
        setPhase(2);
      } else {
        return createElement(
          'pre',
          null,
          visualConfig.applyVisualChangesToYaml(
            'oauth:\n  providers:\n    codex:\n      existing-setting: keep-me\n'
          )
        );
      }

      return null;
    }

    const markup = renderToStaticMarkup(createElement(Harness));
    const merged = markup.slice('<pre>'.length, -'</pre>'.length);

    expect(parseYaml(merged)).toEqual({
      oauth: {
        providers: {
          codex: {
            'existing-setting': 'keep-me',
            'identity-confuse': true,
          },
        },
      },
    });
  });

  test('indexes the visual control using its actual YAML path', () => {
    expect(
      CONFIG_FIELD_SEARCH_INDEX.find((entry) => entry.fieldId === 'codexIdentityConfuse')
    ).toMatchObject({
      sectionId: 'advanced',
      yamlKeys: ['oauth', 'providers', 'codex', 'identity-confuse'],
    });
  });
});
