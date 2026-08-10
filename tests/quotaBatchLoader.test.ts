import { describe, expect, test } from 'bun:test';
import { fetchQuotaGroup } from '@/features/quota/hooks/useQuotaBatchLoader';
import type { QuotaFileEntry } from '@/features/quota/logic';

const entries: QuotaFileEntry[] = ['one', 'two', 'three'].map((name) => ({
  type: 'codex',
  file: { name, type: 'codex' },
}));

describe('quota batch loading', () => {
  test('serializes Codex quota requests', async () => {
    const events: string[] = [];
    await fetchQuotaGroup('codex', entries, async ({ file }) => {
      events.push(`start:${file.name}`);
      await Promise.resolve();
      events.push(`finish:${file.name}`);
      return file.name;
    });

    expect(events).toEqual([
      'start:one',
      'finish:one',
      'start:two',
      'finish:two',
      'start:three',
      'finish:three',
    ]);
  });

  test('keeps other providers parallel', async () => {
    const events: string[] = [];
    await fetchQuotaGroup('claude', entries, async ({ file }) => {
      events.push(`start:${file.name}`);
      await Promise.resolve();
      events.push(`finish:${file.name}`);
      return file.name;
    });

    expect(events.slice(0, 3)).toEqual(['start:one', 'start:two', 'start:three']);
  });
});
