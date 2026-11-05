import { beforeAll, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import { OllamaQuotaBody } from '@/features/quota/providers/ollama/OllamaQuotaBody';
import { bindQuotaClasses, QUOTA_CLASS_KEYS } from '@/features/quota/types';

beforeAll(async () => { await i18n.changeLanguage('en'); });

test('Ollama uses shared limit headers, meters and reset labels without body action buttons', () => {
  const classes = bindQuotaClasses(Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])), 'test');
  const markup = renderToStaticMarkup(createElement(OllamaQuotaBody, {
    classes,
    quota: { status: 'success', data: {
      connection_id: 'fixture', range: '7d', fetched_at: '2026-11-05T00:00:00Z',
      balance: { included: {
        session: { remaining_percent: 75, resets_at: '2026-11-06T00:00:00Z' },
        weekly: { remaining_percent: 50, resets_at: '2026-11-12T00:00:00Z' },
      }, purchased: { balance_usd: 0 } },
    } },
  }));
  expect(markup.match(/role="progressbar"/g)?.length).toBe(2);
  expect(markup).toContain('class="quotaMeta"');
  expect(markup).toContain('class="quotaPercent">75%');
  expect(markup).toContain('class="quotaBar"');
  expect(markup).toContain('<details>');
  expect(markup).not.toContain('<button');
  expect(markup).not.toContain('2026-11-06T00:00:00Z</span>');
});
