import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { estimateCost } from '../server/usage/pricing';
import { parseRateBook } from '../server/usage/rates';
import { RECORD_KIND, USAGE_FLAG } from '../server/usage/types';

const book = parseRateBook(
  JSON.parse(readFileSync(new URL('../deploy/usage-rates.json', import.meta.url), 'utf8'))
);
const complete = Object.values(USAGE_FLAG).reduce((a, b) => a | b, 0);
// 1M of each component, so each cost term equals its per-million rate.
const million = (model: string, tier = '', contextThreshold: number | null = null) =>
  estimateCost(
    {
      model,
      tier,
      contextThreshold,
      usageFlags: complete,
      recordKind: RECORD_KIND.execution,
      tokens: {
        inputTotal: 3_000_000,
        inputUncached: 1_000_000,
        cacheRead: 1_000_000,
        cacheWrite: 1_000_000,
        outputTotal: 1_000_000,
        reasoning: 0,
        total: 4_000_000,
      },
    },
    book
  );

test('deployed book validates and no model is left pending D5', () => {
  const pending = Object.entries(book.models).filter(([, m]) => m.source === 'pending D5');
  expect(pending).toEqual([]);
});

test('claude-fable-5-2 is priced at the published rates, including fast mode', () => {
  // Anthropic: $8 in, $10 5m write, $0.20 read, $40 out; fast mode $16/$80, cache multipliers on top.
  expect(million('claude-fable-5-2')).toMatchObject({ usd: 8 + 0.2 + 10 + 40, status: 'estimated' });
  expect(million('claude-fable-5-2', 'priority')).toMatchObject({
    usd: 16 + 0.4 + 20 + 80,
    status: 'estimated',
  });
});

test('gpt-6.1-terra is priced at the published rates, including long context and Fast', () => {
  // OpenAI: $1 in, $0.05 cached, $5 out; >272K input $2/$0.10/$7.50; Fast (ex-Priority) 2x.
  expect(million('gpt-6.1-terra')).toMatchObject({ usd: 1 + 0.05 + 1.25 + 5, status: 'estimated' });
  expect(million('gpt-6.1-terra', '', 272_000)).toMatchObject({ usd: 2 + 0.1 + 2.5 + 7.5 });
  expect(million('gpt-6.1-terra', 'fast')).toMatchObject({ usd: 2 + 0.1 + 2.5 + 10 });
  // OpenAI offers no Ultrafast tier for Terra: base price, flagged as not explicit.
  expect(million('gpt-6.1-terra', 'ultrafast').reasons).toContain('service-tier-rate-not-explicit');
});

test('gpt-6.2-sol and gpt-6.2-astra are priced at the published rates, Ultrafast at the 3x promo', () => {
  // OpenAI: Sol $2 in, $0.10 cached, $2.50 write, $10 out; >272K input $4/$0.20/$5/$15.
  expect(million('gpt-6.2-sol')).toMatchObject({ usd: 2 + 0.1 + 2.5 + 10, status: 'estimated' });
  expect(million('gpt-6.2-sol', '', 272_000)).toMatchObject({ usd: 4 + 0.2 + 5 + 15 });
  expect(million('gpt-6.2-sol', 'fast')).toMatchObject({ usd: 4 + 0.2 + 5 + 20 });
  // Ultrafast on 6.2 is 3x Standard through 2027-02-28 (6x from 2027-03-01).
  expect(million('gpt-6.2-sol', 'ultrafast')).toMatchObject({ usd: 6 + 0.3 + 7.5 + 30 });
  // Astra: $8 in, $0.40 cached, $10 write, $40 out; >272K input $16/$0.80/$20/$60.
  expect(million('gpt-6.2-astra')).toMatchObject({ usd: 8 + 0.4 + 10 + 40, status: 'estimated' });
  expect(million('gpt-6.2-astra', '', 272_000)).toMatchObject({ usd: 16 + 0.8 + 20 + 60 });
  expect(million('gpt-6.2-astra', 'priority')).toMatchObject({ usd: 16 + 0.8 + 20 + 80 });
  expect(million('gpt-6.2-astra', 'ultrafast')).toMatchObject({ usd: 24 + 1.2 + 30 + 120 });
});
