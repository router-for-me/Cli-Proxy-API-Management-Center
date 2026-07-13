import { describe, expect, test } from 'bun:test';
import {
  getCodexAccountStatus,
  getCodexPlanSortRank,
  matchesCodexPlanFilter,
  matchesCodexStatusFilter,
  type CodexRefreshState,
} from '@/features/authFiles/codexStatus';

const file = { name: 'codex.json', type: 'codex', plan_type: 'plus' };

describe('Codex auth-file status', () => {
  test('uses a refreshed plan ahead of the stored plan for filtering and sorting', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'pro',
      windows: [],
    };

    expect(matchesCodexPlanFilter(file, 'pro', refreshed)).toBe(true);
    expect(matchesCodexPlanFilter(file, 'plus', refreshed)).toBe(false);
    expect(getCodexPlanSortRank(file, refreshed)).toBe(50);
  });

  test('recognizes the K12 plan type', () => {
    const k12File = { ...file, plan_type: 'k12' };

    expect(matchesCodexPlanFilter(k12File, 'k12')).toBe(true);
    expect(getCodexPlanSortRank(k12File)).toBe(10);
  });

  test('classifies full quota windows and reauthentication', () => {
    const refreshed: CodexRefreshState = {
      status: 'success',
      planType: 'plus',
      windows: [
        { id: 'five-hour', label: '5h', usedPercent: 100, resetLabel: 'later' },
        { id: 'weekly', label: 'Week', usedPercent: 30, resetLabel: 'later' },
      ],
    };

    expect(getCodexAccountStatus(refreshed).fiveHourLimited).toBe(true);
    expect(matchesCodexStatusFilter('quota_limited', refreshed)).toBe(true);
    expect(matchesCodexStatusFilter('weekly_limited', refreshed)).toBe(false);
    expect(matchesCodexStatusFilter('reauth', { ...refreshed, errorStatus: 401 })).toBe(true);
  });
});
