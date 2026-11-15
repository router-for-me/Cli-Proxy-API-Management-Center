/**
 * Prints the dashboards /v1/pools answers for a Codex Pro account whose provider reports only a
 * weekly window, built by the real server code (buildDashboard, weeklyOnlyAccountIds) from
 * synthetic samples. `scripts/visual/fake_hub.py` (served-no-five-hour) serves them to the page.
 *
 *   bun run scripts/visual/no-five-hour-pools.ts <nowMs>
 *
 * Synthetic identities only. Prints {"weekly": ..., "five-hour": ...}.
 */
import { buildDashboard, type DashboardOptions } from '../../server/quota/domain';
import type { QuotaSample, StoredAccount } from '../../server/quota/types';
import { weeklyOnlyAccountIds } from '../../server/quota/values';

const now = Number(process.argv[2] ?? Date.now());
const MIN = 60_000;
const source = { instanceId: 'beta', sourceLabel: 'GPT hub fixture' };
const account = (id: string, email: string, plan: string): StoredAccount => ({
  id,
  provider: 'codex',
  name: `${id}.json`,
  email,
  plan,
  disabled: false,
  retired: false,
  lastSeenAtMs: now - MIN,
  lastErrorAtMs: null,
  instanceId: 'beta',
});
const accounts = [
  account('pro', 'codex-pro@example.invalid', 'pro'),
  account('plus-1', 'codex-plus-1@example.invalid', 'plus'),
  account('plus-2', 'codex-plus-2@example.invalid', 'plus'),
];
const samples: QuotaSample[] = [];
for (const at of [now - 20 * MIN, now - 10 * MIN, now - MIN]) {
  const step = (now - at) / MIN;
  // Pro: one successful reading per poll, a weekly window and no five-hour one (secondary_window null).
  samples.push(
    { accountId: 'pro', window: 'weekly', observedAtMs: at, remainingPercent: 17 + step / 10, resetAtMs: now + 3 * 86_400_000, periodHours: 168 },
    { accountId: 'pro', window: 'five-hour', observedAtMs: at, remainingPercent: null, resetAtMs: null, periodHours: null }
  );
  for (const [index, id] of ['plus-1', 'plus-2'].entries()) {
    samples.push(
      { accountId: id, window: 'weekly', observedAtMs: at, remainingPercent: 60 - index * 10 + step / 10, resetAtMs: now + 2 * 86_400_000, periodHours: 168 },
      { accountId: id, window: 'five-hour', observedAtMs: at, remainingPercent: 80 - index * 25 + step / 5, resetAtMs: now + 3 * 3_600_000, periodHours: 5 }
    );
  }
}
const collection = {
  historyStartedAtMs: now - 20 * MIN,
  lastRefreshAtMs: now - MIN,
  nextRefreshAtMs: now + 3 * MIN,
  refreshing: false,
  issues: [],
  sources: [source],
  // The server builds /v1/pools from one window's samples and hands over the account set itself.
  weeklyOnly: weeklyOnlyAccountIds(samples),
};
const view = (window: DashboardOptions['window']) =>
  buildDashboard(
    accounts,
    samples.filter((sample) => sample.window === window),
    { nowMs: now, window, lookbackHours: 3, multiplier: 1, offsetDays: 0, reveal: false },
    collection
  );
console.log(JSON.stringify({ weekly: view('weekly'), 'five-hour': view('five-hour') }));
