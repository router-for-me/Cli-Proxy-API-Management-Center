import { describe, expect, test } from 'bun:test';
import { parse as parseYaml, stringify } from 'yaml';
import { runVisualConfig } from './helpers/visualConfig';

const providers = [
  ['antigravity', 'devin'],
  ['devin', 'antigravity'],
] as const;

describe('visual config provider sensitive words', () => {
  for (const [provider, other] of providers) {
    const field = `${provider}SensitiveWords` as const;
    const otherField = `${other}SensitiveWords` as const;

    test(`${provider}: loads sensitive-words independently from ${other}`, () => {
      const yaml = stringify({
        oauth: {
          providers: {
            [provider]: { 'sensitive-words': ['Claude Code', 'security testing'] },
            [other]: { 'sensitive-words': ['proxy'] },
          },
        },
      });
      const { visualValues } = runVisualConfig(yaml);
      expect(visualValues[field]).toEqual(['Claude Code', 'security testing']);
      expect(visualValues[otherField]).toEqual(['proxy']);
    });

    test(`${provider}: writes trimmed values preserving unknown keys, comments, and ${other}`, () => {
      const yaml = `# root comment
oauth:
  providers:
    ${provider}:
      # list comment
      sensitive-words:
        # retained item comment
        - old-word # inline item note
      # unknown comment
      future-option: true
    ${other}:
      sensitive-words:
        - proxy
`;
      const config = runVisualConfig(yaml, [{ [field]: [' old-word ', '', 'new phrase'] }]);
      const output = config.applyVisualChangesToYaml(yaml);
      expect(parseYaml(output)).toEqual({
        oauth: {
          providers: {
            [provider]: { 'sensitive-words': ['old-word', 'new phrase'], 'future-option': true },
            [other]: { 'sensitive-words': ['proxy'] },
          },
        },
      });
      for (const comment of ['root', 'list', 'unknown']) {
        expect(output).toContain(`# ${comment} comment`);
      }
      expect(output).toContain('# retained item comment');
      expect(output).toContain('- old-word # inline item note');
    });

    test(`${provider}: clearing removes the key and an otherwise empty block`, () => {
      const yaml = stringify({
        oauth: { providers: { [provider]: { 'sensitive-words': ['remove-me'] } } },
        observability: { logs: { debug: true } },
      });
      const config = runVisualConfig(yaml, [{ [field]: [] }]);
      expect(parseYaml(config.applyVisualChangesToYaml(yaml))).toEqual({
        observability: { logs: { debug: true } },
      });
    });

    test(`${provider}: restoring cancels dirty state and never marks ${other} dirty`, () => {
      const yaml = stringify({
        oauth: {
          providers: {
            [provider]: { 'sensitive-words': ['original'] },
            [other]: { 'sensitive-words': ['untouched'] },
          },
        },
      });
      const config = runVisualConfig(yaml, [{ [field]: ['changed'] }, { [field]: ['original'] }]);
      expect(config.visualDirty).toBe(false);
      expect([...config.visualDirtyFields]).toEqual([]);
      expect(config.applyVisualChangesToYaml(yaml)).toBe(yaml);
    });
  }
});
