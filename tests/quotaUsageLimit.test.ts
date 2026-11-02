import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { parseDocument } from 'yaml';
import i18n from '@/i18n';
import { SectionNetwork } from '@/features/config/components/sections/SectionNetwork';
import { isQuotaUsageLimit } from '@/hooks/useVisualConfig';
import { DEFAULT_VISUAL_VALUES } from '@/types/visualConfig';
import { runVisualConfig } from './helpers/visualConfig';

const PATH = ['routing', 'cooldown', 'quota-response-mode'];
const LOCALES = ['en', 'zh-CN', 'zh-TW', 'ru', 'vi', 'ko', 'tr'];

describe('quota usage-limit switch (routing.cooldown.quota-response-mode)', () => {
  test('reads like the backend parser: only usage-limit is on', () => {
    expect(DEFAULT_VISUAL_VALUES.quotaUsageLimit).toBe(false);
    for (const raw of [undefined, null, '', 'retryable', 'Retryable']) {
      expect(isQuotaUsageLimit(raw)).toBe(false);
    }
    expect(isQuotaUsageLimit('usage-limit')).toBe(true);
    expect(isQuotaUsageLimit(' Usage-Limit ')).toBe(true);
    expect(runVisualConfig('{}').visualValues.quotaUsageLimit).toBe(false);
    expect(
      runVisualConfig('routing: {cooldown: {quota-response-mode: usage-limit}}').visualValues
        .quotaUsageLimit
    ).toBe(true);
  });

  test('on writes usage-limit to the v8 key and keeps siblings and comments', () => {
    const yaml = [
      'routing:',
      '  cooldown:',
      '    # keep me',
      '    disable-cooling: false',
      'future: 1',
      '',
    ].join('\n');
    expect(runVisualConfig(yaml).applyVisualChangesToYaml(yaml)).toBe(yaml);

    const config = runVisualConfig(yaml, [{ quotaUsageLimit: true }]);
    expect([...config.visualDirtyFields]).toEqual(['quotaUsageLimit']);
    const output = config.applyVisualChangesToYaml(yaml);
    const doc = parseDocument(output);
    expect(doc.getIn(PATH)).toBe('usage-limit');
    expect(doc.getIn(['routing', 'cooldown', 'disable-cooling'])).toBe(false);
    expect(doc.get('future')).toBe(1);
    expect(output).toContain('# keep me');
    expect(runVisualConfig(output).visualValues.quotaUsageLimit).toBe(true);
  });

  test('off removes the key instead of writing retryable', () => {
    const yaml =
      'routing:\n  cooldown:\n    disable-cooling: false\n    quota-response-mode: usage-limit\n';
    const output = runVisualConfig(yaml, [{ quotaUsageLimit: false }]).applyVisualChangesToYaml(
      yaml
    );
    const doc = parseDocument(output);
    expect(doc.hasIn(PATH)).toBe(false);
    expect(doc.getIn(['routing', 'cooldown', 'disable-cooling'])).toBe(false);
    expect(output).not.toContain('retryable');

    // Only key in the section: the now-empty maps are pruned too.
    const alone = 'routing:\n  cooldown:\n    quota-response-mode: usage-limit\nfuture: 1\n';
    const pruned = parseDocument(
      runVisualConfig(alone, [{ quotaUsageLimit: false }]).applyVisualChangesToYaml(alone)
    );
    expect(pruned.has('routing')).toBe(false);
    expect(pruned.get('future')).toBe(1);

    // Toggling back to the loaded state is not a change.
    expect(
      runVisualConfig(yaml, [{ quotaUsageLimit: false }, { quotaUsageLimit: true }]).visualDirty
    ).toBe(false);
  });

  test('an explicit retryable is left alone until the switch is turned on', () => {
    const yaml = 'routing:\n  cooldown:\n    quota-response-mode: retryable\n';
    expect(runVisualConfig(yaml).visualValues.quotaUsageLimit).toBe(false);
    expect(runVisualConfig(yaml).applyVisualChangesToYaml(yaml)).toBe(yaml);
    const on = runVisualConfig(yaml, [{ quotaUsageLimit: true }]).applyVisualChangesToYaml(yaml);
    expect(parseDocument(on).getIn(PATH)).toBe('usage-limit');
  });

  test('creates missing or null routing and cooldown maps', () => {
    for (const yaml of ['{}\n', 'routing: null\n', 'routing:\n  cooldown: null\n']) {
      const output = runVisualConfig(yaml, [{ quotaUsageLimit: true }]).applyVisualChangesToYaml(
        yaml
      );
      expect(parseDocument(output).getIn(PATH)).toBe('usage-limit');
    }
  });

  test('every locale has a label and a one-line description', async () => {
    for (const locale of LOCALES) {
      const messages = (await Bun.file(`src/i18n/locales/${locale}.json`).json()) as {
        config_management: { visual: { sections: { network: Record<string, unknown> } } };
      };
      const network = messages.config_management.visual.sections.network;
      for (const key of ['quota_usage_limit', 'quota_usage_limit_desc']) {
        expect(typeof network[key]).toBe('string');
        expect(String(network[key]).trim()).not.toBe('');
        expect(String(network[key])).not.toContain('\n');
      }
    }
  });

  test('network section renders it as a switch row, not a dropdown', () => {
    const translations = i18n.cloneInstance({ lng: 'en' });
    const markup = renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n: translations },
        createElement(SectionNetwork, {
          values: { ...DEFAULT_VISUAL_VALUES, quotaUsageLimit: true },
          disabled: false,
          onChange: () => {},
        })
      )
    );
    const start = markup.indexOf('id="cfg-field-quotaUsageLimit"');
    expect(start).toBeGreaterThan(-1);
    const row = markup.slice(start, markup.indexOf('id="cfg-field-', start + 1));
    expect(row).toContain('Report usage limit on quota exhaustion');
    expect(row).toContain('type="checkbox"');
    expect(row).toContain('checked=""');
    expect(row).not.toContain('aria-haspopup="listbox"');
    // Same row shape as its neighbour "Persist cooldown status".
    const neighbourStart = markup.indexOf('id="cfg-field-saveCooldownStatus"');
    const rowTag = (at: number) =>
      markup.slice(markup.lastIndexOf('<div', at), markup.indexOf('>', at));
    expect(rowTag(start).replace('quotaUsageLimit', 'X')).toBe(
      rowTag(neighbourStart).replace('saveCooldownStatus', 'X')
    );
  });
});
