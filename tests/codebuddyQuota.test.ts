import { describe, expect, test } from 'bun:test';
import { buildCodeBuddyQuotaRows } from '@/utils/quota/builders';
import type { CodeBuddyAccount } from '@/types';

const account = (partial: Partial<CodeBuddyAccount>): CodeBuddyAccount =>
  partial as CodeBuddyAccount;

describe('buildCodeBuddyQuotaRows', () => {
  test('labels a refill pack by cadence and uses Cycle capacity', () => {
    const rows = buildCodeBuddyQuotaRows([
      account({
        PackageName: '基础体验包',
        CycleStartTime: 1700000000,
        CycleEndTime: 1700000000 + 30 * 24 * 3600,
        DeductionEndTime: 1700000000 + 365 * 24 * 3600,
        CycleCapacitySizePrecise: '1000',
        CycleCapacityUsedPrecise: '250',
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].label).toBe('Monthly');
    expect(rows[0].used).toBe(250);
    expect(rows[0].total).toBe(1000);
    expect(rows[0].periodHours).toBe(30 * 24);
  });

  test('suffixes repeated refill cadences and sorts bonus packs by expiry', () => {
    const rows = buildCodeBuddyQuotaRows([
      account({
        PackageName: 'a',
        CycleStartTime: 1700000000,
        CycleEndTime: 1700000000 + 7 * 24 * 3600,
        DeductionEndTime: 1700000000 + 365 * 24 * 3600,
        CycleCapacitySize: '100',
        CycleCapacityUsed: '10',
      }),
      account({
        PackageName: 'b',
        CycleStartTime: 1700000000,
        CycleEndTime: 1700000000 + 7 * 24 * 3600,
        DeductionEndTime: 1700000000 + 365 * 24 * 3600,
        CycleCapacitySize: '200',
        CycleCapacityUsed: '20',
      }),
      account({
        PackageName: '活动赠送包',
        CycleStartTime: 1700000000,
        CycleEndTime: 1700000000 + 24 * 3600,
        DeductionEndTime: 1700000000 + 24 * 3600, // one-shot: no refill gap
        CapacitySize: '50',
        CapacityUsed: '5',
      }),
    ]);

    const labels = rows.map((row) => row.labelKey ? `${row.labelKey}:${row.labelParams?.index}` : row.label);
    expect(labels).toEqual(['Weekly', 'Weekly 2', 'codebuddy_quota.bonus_pack:1']);
  });

  test('empty input yields no rows', () => {
    expect(buildCodeBuddyQuotaRows([])).toEqual([]);
  });
});
