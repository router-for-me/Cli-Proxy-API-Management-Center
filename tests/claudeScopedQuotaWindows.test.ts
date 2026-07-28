import { describe, expect, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { buildClaudeQuotaWindows } from '../src/components/quota/quotaConfigs';
import type { ClaudeUsagePayload } from '../src/types/quota';

// Minimal translate stub: echoes the key, honouring defaultValue + {{model}}.
const t = ((key: string, options?: Record<string, unknown>) => {
  const fallback = options?.defaultValue;
  if (typeof fallback === 'string') return fallback;
  return key;
}) as unknown as TFunction;

// Shape returned by /api/oauth/usage on a Max plan: the legacy per-model keys are
// null, and the real per-model utilization lives in `limits`.
const payloadWithScopedFable: ClaudeUsagePayload = {
  five_hour: { utilization: 0, resets_at: '2026-08-01T12:00:00Z' },
  seven_day: { utilization: 73, resets_at: '2026-08-02T03:59:59Z' },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    { kind: 'session', percent: 0, resets_at: null, scope: null },
    { kind: 'weekly_all', percent: 73, resets_at: '2026-08-02T03:59:59Z', scope: null },
    {
      kind: 'weekly_scoped',
      percent: 100,
      resets_at: '2026-08-02T03:59:59Z',
      scope: { model: { id: null, display_name: 'Fable' } },
    },
  ],
};

describe('Claude per-model quota windows', () => {
  test('renders a weekly_scoped limit that has no legacy top-level key', () => {
    const windows = buildClaudeQuotaWindows(payloadWithScopedFable, t);
    const fable = windows.find((w) => w.id === 'seven-day-fable');

    expect(fable).toBeDefined();
    expect(fable?.usedPercent).toBe(100);
    expect(fable?.label).toBe('7-day Fable');
  });

  test('keeps the existing top-level windows intact', () => {
    const windows = buildClaudeQuotaWindows(payloadWithScopedFable, t);

    expect(windows.find((w) => w.id === 'five-hour')?.usedPercent).toBe(0);
    expect(windows.find((w) => w.id === 'seven-day')?.usedPercent).toBe(73);
  });

  test('does not duplicate a model already covered by a legacy key', () => {
    const windows = buildClaudeQuotaWindows(
      {
        seven_day_opus: { utilization: 40, resets_at: '2026-08-02T03:59:59Z' },
        limits: [
          {
            kind: 'weekly_scoped',
            percent: 40,
            resets_at: '2026-08-02T03:59:59Z',
            scope: { model: { id: null, display_name: 'Opus' } },
          },
        ],
      },
      t
    );

    expect(windows.filter((w) => w.id === 'seven-day-opus')).toHaveLength(1);
  });

  test('ignores non-scoped entries and entries without a model name', () => {
    const windows = buildClaudeQuotaWindows(
      {
        limits: [
          { kind: 'weekly_all', percent: 50, resets_at: null, scope: null },
          { kind: 'weekly_scoped', percent: 10, resets_at: null, scope: { model: null } },
          { kind: 'weekly_scoped', percent: 10, resets_at: null, scope: { model: { display_name: '  ' } } },
        ],
      },
      t
    );

    expect(windows).toHaveLength(0);
  });

  test('tolerates a missing limits array', () => {
    const windows = buildClaudeQuotaWindows(
      { seven_day: { utilization: 12, resets_at: '2026-08-02T03:59:59Z' } },
      t
    );

    expect(windows).toHaveLength(1);
    expect(windows[0]?.id).toBe('seven-day');
  });
});
