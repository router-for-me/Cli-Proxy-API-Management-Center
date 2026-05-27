import { describe, expect, it } from 'vitest';
import { sortAccountOverviewCardMetrics } from './accountOverviewCardMetrics';

describe('accountOverviewCardMetrics', () => {
  it('keeps only token metrics in card-grid order and leaves cost out of the grid', () => {
    const metrics = [
      { key: 'estimated-cost', label: 'Cost', value: '$1.23' },
      { key: 'cached-tokens', label: 'Cached', value: '40' },
      { key: 'output-tokens', label: 'Output', value: '30' },
      { key: 'total-tokens', label: 'Total', value: '100' },
      { key: 'input-tokens', label: 'Input', value: '70' },
    ];

    expect(sortAccountOverviewCardMetrics(metrics).map((metric) => metric.key)).toEqual([
      'total-tokens',
      'input-tokens',
      'output-tokens',
      'cached-tokens',
    ]);
  });
});
