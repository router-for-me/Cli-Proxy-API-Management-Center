import { afterEach, describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '@/i18n';
import type { AuthFileItem } from '@/types';
import { DEVIN_CONFIG, getDevinQuotaSnapshotState } from '@/features/quota/providers/devin/data';
import { DevinQuotaBody } from '@/features/quota/providers/devin/DevinQuotaBody';
import { QUOTA_CLASS_KEYS, bindQuotaClasses } from '@/features/quota/types';
import { classifyQuotaFiles, buildTabCounts } from '@/features/quota/logic';
import { QUOTA_PROVIDER_TYPES } from '@/features/authFiles/constants';
import { buildTimelineLane, projectLane } from '@/features/quota/quotaTimelineModel';
import { collectQuotaRowInstants, nextRecoveryMs } from '@/features/quota/resetSchedule';
import {
  captureQuotaCacheGeneration,
  commitIfQuotaCacheCurrent,
  useQuotaStore,
} from '@/stores/useQuotaStore';

const file: AuthFileItem = {
  name: 'devin-example.json',
  provider: 'devin',
  authIndex: 'example-index',
  quota: {
    observed_at: '2099-01-01T00:00:00Z',
    signals: {
      daily_quota_remaining_percent: '0%',
      weekly_quota_remaining_percent: '80%',
      daily_quota_reset_at: '2099-01-02T00:00:00Z',
      weekly_quota_reset_at: '2099-01-08T00:00:00Z',
      plan: 'Pro',
      plan_end: '2099-01-03T00:00:00Z',
    },
  },
};
const classes = bindQuotaClasses(
  Object.fromEntries(QUOTA_CLASS_KEYS.map((key) => [key, key])),
  'test'
);
const snapshot = () => getDevinQuotaSnapshotState(file, i18n.t)!;

afterEach(() => useQuotaStore.getState().clearQuotaCache());

describe('Devin quota UI integration', () => {
  test('registers the provider, filters disabled credentials, and counts its tab', () => {
    expect(QUOTA_PROVIDER_TYPES.has('devin')).toBe(true);
    expect(DEVIN_CONFIG.filterFn(file)).toBe(true);
    expect(DEVIN_CONFIG.filterFn({ ...file, disabled: true })).toBe(false);
    expect(DEVIN_CONFIG.filterFn({ ...file, disabled: 'true' } as unknown as AuthFileItem)).toBe(
      false
    );
    const entries = classifyQuotaFiles([file, { ...file, name: 'disabled.json', disabled: true }]);
    expect(entries).toEqual([{ file, type: 'devin' }]);
    expect(buildTabCounts(entries).devin).toBe(1);
  });

  test('renders both remaining meters, independent resets, plan, and the observation time', () => {
    const markup = renderToStaticMarkup(
      createElement(DevinQuotaBody, { quota: snapshot(), classes })
    );
    expect(markup).toContain(i18n.t('devin_quota.daily'));
    expect(markup).toContain(i18n.t('devin_quota.weekly'));
    expect(markup.match(/role="meter"/g)).toHaveLength(2);
    expect(markup).toContain('aria-valuenow="0"');
    expect(markup).toContain('aria-valuenow="80"');
    expect(markup).toContain('width:0%');
    expect(markup).toContain('width:80%');
    expect(markup).toContain('Pro');
    expect(markup).toContain('01/02');
    expect(markup).toContain('01/08');
    expect(markup).toContain('01/01');
  });

  test('renders missing quota as unavailable, not a zero-percent reading', () => {
    const quota = snapshot();
    quota.windows[0] = { ...quota.windows[0], remainingPercent: null, resetAtMs: null };
    const markup = renderToStaticMarkup(createElement(DevinQuotaBody, { quota, classes }));
    expect(markup).toContain(i18n.t('devin_quota.unavailable'));
    expect(markup).toContain(i18n.t('devin_quota.reset_unknown'));
    expect(markup).not.toContain('aria-valuenow="0"');
    expect(markup.match(/role="meter"/g)).toHaveLength(1);
  });

  test('uses daily and weekly reset instants, never subscription expiry, for recovery sorting', () => {
    const quota = snapshot();
    const instants = collectQuotaRowInstants('devin', quota);
    expect(instants.map((item) => item.rowId)).toEqual(['daily', 'weekly']);
    expect(nextRecoveryMs('devin', quota, Date.parse('2099-01-01T00:00:00Z'))).toBe(
      Date.parse('2099-01-02T00:00:00Z')
    );
    expect(nextRecoveryMs('devin', quota, Date.parse('2099-01-02T01:00:00Z'))).toBe(
      Date.parse('2099-01-08T00:00:00Z')
    );
  });

  test('anchors the timeline on the fitting window without inverting remaining percent', () => {
    const quota = snapshot();
    const input = { provider: 'devin' as const, name: file.name, displayName: file.name, quota };
    const weekly = buildTimelineLane({ ...input, maxPeriodHours: 336 });
    expect(weekly.anchorMs).toBe(Date.parse('2099-01-08T00:00:00Z'));
    expect(weekly.remaining).toBe(80);
    const daily = buildTimelineLane({ ...input, maxPeriodHours: 24 });
    expect(daily.anchorMs).toBe(Date.parse('2099-01-02T00:00:00Z'));
    expect(daily.remaining).toBe(0);
    const reset = weekly.anchorMs!;
    const projected = projectLane(weekly, reset, reset + 14 * 86400000, reset + 3600000, 'weekly');
    expect(projected.every((window) => window.remaining === null)).toBe(true);
  });

  test('invalidates only the selected Devin credential, then clears the whole session', () => {
    const quota = snapshot();
    useQuotaStore.getState().setDevinQuota({ [file.name]: quota, 'other.json': quota });
    const generation = captureQuotaCacheGeneration(file.name);
    useQuotaStore.getState().clearQuotaCache([file.name]);
    expect(useQuotaStore.getState().devinQuota[file.name]).toBeUndefined();
    expect(useQuotaStore.getState().devinQuota['other.json']).toBe(quota);
    expect(commitIfQuotaCacheCurrent(generation, () => {})).toBe(false);
    useQuotaStore.getState().clearQuotaCache();
    expect(useQuotaStore.getState().devinQuota).toEqual({});
  });
});
