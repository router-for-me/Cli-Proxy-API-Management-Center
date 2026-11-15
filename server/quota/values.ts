export function sumKnown(values: (number | null)[]): number | null {
  return values.some((value) => value === null)
    ? null
    : values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
}

/**
 * Accounts whose newest successful reading has a weekly balance and an explicit missing five-hour
 * one. The collector writes both lanes from the same response, so equal timestamps mean the
 * provider answered with an account-wide weekly window and no five-hour window. A failed poll
 * writes no sample, and a reading with no weekly balance proves nothing.
 */
export function weeklyOnlyAccountIds(
  samples: readonly { accountId: string; window: string; observedAtMs: number; remainingPercent: number | null }[],
  nowMs = Infinity
): Set<string> {
  const newest = new Map<string, { observedAtMs: number; remainingPercent: number | null }>();
  for (const sample of samples) {
    if (sample.observedAtMs > nowMs) continue;
    const key = `${sample.accountId}\0${sample.window}`;
    const held = newest.get(key);
    if (!held || sample.observedAtMs > held.observedAtMs) newest.set(key, sample);
  }
  const ids = new Set<string>();
  for (const [key, weekly] of newest) {
    const [accountId, window] = key.split('\0');
    if (window !== 'weekly' || weekly.remainingPercent === null) continue;
    const fiveHour = newest.get(`${accountId}\0five-hour`);
    if (fiveHour && fiveHour.remainingPercent === null && fiveHour.observedAtMs === weekly.observedAtMs)
      ids.add(accountId);
  }
  return ids;
}
