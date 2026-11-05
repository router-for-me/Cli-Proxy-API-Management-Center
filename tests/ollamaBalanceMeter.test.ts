import { expect, test } from 'bun:test';
import { includedRemainingPercent } from '../src/features/quota/providers/ollama/balanceMeter';

test('included credit bar uses the full allowance as its denominator', () => {
  expect(includedRemainingPercent(12.5, 20)).toBe(62.5);
  expect(includedRemainingPercent(0, 20)).toBe(0);
  expect(includedRemainingPercent(20, 20)).toBe(100);
});

test('absent or zero allowance cannot manufacture a quota percentage', () => {
  for (const [balance, allowance] of [
    [null, 20],
    [12, null],
    [0, 0],
    [12, -1],
    [NaN, 20],
    [12, Infinity],
  ]) {
    expect(includedRemainingPercent(balance, allowance)).toBeNull();
  }
});

test('visual percentage stays within bounds without changing displayed balances', () => {
  expect(includedRemainingPercent(-1, 20)).toBe(0);
  expect(includedRemainingPercent(25, 20)).toBe(100);
});
