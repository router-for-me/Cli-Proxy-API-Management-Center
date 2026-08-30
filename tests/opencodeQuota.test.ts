import { describe, expect, test } from 'bun:test';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { collectQuotaRowInstants, pickSoonestRowId } from '@/features/quota/resetSchedule';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import type { AuthFileItem } from '@/types';
import { buildOpencodeQuotaRows, parseOpencodeUsagePayload, isOpencodeFile } from '@/utils/quota';

/** A live `GET /zen/go/v1/usage` body, trimmed to the fields the card reads. */
const SAMPLE = {
  usage: {
    rolling: { status: 'ok', percent: 16, resetsAt: '2099-08-30T19:55:45.422Z' },
    weekly: { status: 'ok', percent: 77, resetsAt: '2099-08-31T00:00:00.422Z' },
    monthly: { status: 'ok', percent: 38, resetsAt: '2099-09-25T04:37:48.422Z' },
  },
};

describe('OpenCode quota rows', () => {
  test('reports remaining percent from the used percent the API sends', () => {
    const rows = buildOpencodeQuotaRows(SAMPLE);

    expect(rows.map(({ id }) => id)).toEqual(['rolling', 'weekly', 'monthly']);
    expect(rows.map(({ remainingPercent }) => remainingPercent)).toEqual([84, 23, 62]);
    expect(rows.map(({ rateLimited }) => rateLimited)).toEqual([false, false, false]);
  });

  test('labels each window and periods all but the monthly one', () => {
    const rows = buildOpencodeQuotaRows(SAMPLE);

    expect(rows.map(({ labelKey }) => labelKey)).toEqual([
      'opencode_quota.five_hour_limit',
      'opencode_quota.weekly_limit',
      'opencode_quota.monthly_limit',
    ]);
    // The monthly window anchors on the subscription anniversary, so it has no
    // fixed span for the timeline to project.
    expect(rows.map(({ periodHours }) => periodHours)).toEqual([5, 168, null]);
  });

  test('reads a rate-limited window as fully spent', () => {
    const rows = buildOpencodeQuotaRows({
      usage: { rolling: { status: 'rate-limited', percent: 100, resetsAt: '2099-01-01T00:00:00Z' } },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.rateLimited).toBe(true);
    expect(rows[0]?.remainingPercent).toBe(0);
  });

  test('skips malformed windows instead of dropping the whole card', () => {
    const rows = buildOpencodeQuotaRows({
      usage: {
        rolling: { status: 'ok', percent: 140, resetsAt: '2099-01-01T00:00:00Z' },
        weekly: { status: 'ok', resetsAt: '2099-01-01T00:00:00Z' },
        monthly: { status: 'ok', percent: 38, resetsAt: '2099-09-25T04:37:48.422Z' },
      },
    });

    expect(rows.map(({ id }) => id)).toEqual(['monthly']);
  });

  test('returns no rows when the payload carries no usage object', () => {
    expect(buildOpencodeQuotaRows({})).toEqual([]);
    expect(buildOpencodeQuotaRows({ usage: null })).toEqual([]);
  });

  test('parses the response body whether it arrives as text or as an object', () => {
    expect(parseOpencodeUsagePayload(JSON.stringify(SAMPLE))).toEqual(SAMPLE);
    expect(parseOpencodeUsagePayload(SAMPLE)).toEqual(SAMPLE);
    expect(parseOpencodeUsagePayload('not json')).toBeNull();
    expect(parseOpencodeUsagePayload(null)).toBeNull();
  });
});

describe('OpenCode credential detection', () => {
  test('matches on either provider or type, and nothing else', () => {
    expect(isOpencodeFile({ name: 'a.json', provider: 'opencode' })).toBe(true);
    expect(isOpencodeFile({ name: 'b.json', type: 'opencode' })).toBe(true);
    expect(isOpencodeFile({ name: 'c.json', provider: 'codex' })).toBe(false);
  });
});

describe('OpenCode on the quota page', () => {
  const file = (name: string, provider: string, extra: Partial<AuthFileItem> = {}): AuthFileItem =>
    ({ name, provider, ...extra }) as AuthFileItem;

  test('classifies an OpenCode credential and skips a disabled one', () => {
    expect(resolveQuotaProviderType(file('opencode-go.json', 'opencode'))).toBe('opencode');
    expect(
      resolveQuotaProviderType(file('opencode-off.json', 'opencode', { disabled: true }))
    ).toBeNull();
  });

  test('places OpenCode last in the provider tab order', () => {
    const entries = classifyQuotaFiles([
      file('opencode-go.json', 'opencode'),
      file('claude-a.json', 'claude'),
    ]);
    expect(entries.map((entry) => entry.type)).toEqual(['claude', 'opencode']);
  });
});

describe('OpenCode quota scheduling', () => {
  test('feeds every window reset to the soonest-recovery ranking', () => {
    const rows = buildOpencodeQuotaRows(SAMPLE);
    const instants = collectQuotaRowInstants('opencode', { status: 'success', rows });

    expect(instants.map(({ rowId }) => rowId)).toEqual(['rolling', 'weekly', 'monthly']);
    expect(pickSoonestRowId(instants, Date.parse('2099-08-30T00:00:00Z'))).toBe('rolling');
  });

  test('anchors the timeline lane on the longest window that fits the span', () => {
    const rows = buildOpencodeQuotaRows(SAMPLE).map((row) => ({ ...row, label: row.labelKey }));
    const lane = buildTimelineLane({
      name: 'opencode-go.json',
      displayName: 'OpenCode Go',
      provider: 'opencode',
      quota: { status: 'success', rows },
      maxPeriodHours: 5,
    });

    expect(lane.anchorMs).toBe(rows[0]?.resetAtMs);
    expect(lane.periodHours).toBe(5);
    expect(lane.remaining).toBe(84);
    expect(lane.limits).toHaveLength(3);
  });
});
