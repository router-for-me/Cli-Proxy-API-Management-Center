import { expect, test } from 'bun:test';
import { settleModelDiscovery } from '../src/features/providers/sheets/forms/useModelDiscovery';

test.each(['success', 'failure'])('old %s cannot finish the new discovery', async (outcome) => {
  let revision = 1;
  const old = Promise.withResolvers<{ name: string }[]>();
  const latest = Promise.withResolvers<{ name: string }[]>();
  const updates: unknown[] = [];
  const start = (id: number, pending: typeof old) =>
    settleModelDiscovery(
      () => pending.promise,
      () => revision === id,
      (state) => updates.push(state)
    );
  const first = start(revision, old);
  const second = start(++revision, latest);
  if (outcome === 'failure') old.reject(new Error('old upstream failed'));
  else old.resolve([{ name: 'old model' }]);
  await first;
  expect(updates).toEqual([]); // Neither results nor loading are updated.
  latest.resolve([{ name: 'new model' }]);
  await second;
  expect(updates).toEqual([
    { loading: false, hasFetched: true, error: null, models: [{ name: 'new model' }] },
  ]);
});
