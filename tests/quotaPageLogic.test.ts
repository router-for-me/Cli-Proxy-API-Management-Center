import { describe, expect, test } from 'bun:test';
import { QUOTA_PAGE_SIZE } from '@/features/quota/constants';
import {
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  isGlmOpenAICompatibleProvider,
  isQuotaRefreshDisabled,
  mergeGlmConfigQuotaFiles,
  paginate,
  resolveQuotaProviderType,
  sortQuotaEntries,
  type QuotaFileEntry,
} from '@/features/quota/logic';
import type { AuthFileItem, OpenAIProviderConfig } from '@/types';

const file = (name: string, provider: string, extra: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({ name, provider, ...extra }) as AuthFileItem;

const FILES: AuthFileItem[] = [
  file('codex-a.json', 'codex'),
  file('claude-a.json', 'claude'),
  file('glm-a.json', 'openai-compatible-glm'),
  file('kimi-a.json', 'kimi'),
  file('codex-b.json', 'codex'),
  file('grok-a.json', 'grok'), // 别名归一到 xai
  file('gemini-a.json', 'gemini'), // 不支持额度
  file('claude-off.json', 'claude', { disabled: true }), // 停用
];

const glmProvider = (overrides: Partial<OpenAIProviderConfig> = {}): OpenAIProviderConfig => ({
  name: 'GLM',
  baseUrl: 'https://api.z.ai/api/coding/paas/v4',
  apiKeyEntries: [{ apiKey: 'must-not-leak', authIndex: 'glm-auth-1' }],
  ...overrides,
});

describe('mergeGlmConfigQuotaFiles', () => {
  test('recognizes GLM by provider name or official API host', () => {
    expect(isGlmOpenAICompatibleProvider(glmProvider())).toBe(true);
    expect(
      isGlmOpenAICompatibleProvider(
        glmProvider({ name: 'custom', baseUrl: 'https://open.bigmodel.cn/api/paas/v4' })
      )
    ).toBe(true);
    expect(
      isGlmOpenAICompatibleProvider(
        glmProvider({ name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' })
      )
    ).toBe(false);
  });

  test('adds one quota item for a GLM config credential without exposing its API key', () => {
    const merged = mergeGlmConfigQuotaFiles([], [glmProvider()]);
    expect(merged).toEqual([
      {
        name: 'GLM #1',
        provider: 'openai-compatible-glm',
        type: 'openai-compatible-glm',
        authIndex: 'glm-auth-1',
        runtimeOnly: true,
        disabled: undefined,
      },
    ]);
    expect(JSON.stringify(merged)).not.toContain('must-not-leak');
  });

  test('uses each API-key entry auth index and skips entries missing one', () => {
    const merged = mergeGlmConfigQuotaFiles(
      [],
      [
        glmProvider({
          apiKeyEntries: [
            { apiKey: 'secret-1', authIndex: 'glm-auth-1' },
            { apiKey: 'secret-2', authIndex: 'glm-auth-2' },
            { apiKey: 'secret-3' },
          ],
        }),
      ]
    );
    expect(merged.map((item) => item.authIndex)).toEqual(['glm-auth-1', 'glm-auth-2']);
    expect(merged.map((item) => item.name)).toEqual(['GLM #1', 'GLM #2']);
  });

  test('keeps disabled providers out of classified quota entries', () => {
    const merged = mergeGlmConfigQuotaFiles([], [glmProvider({ disabled: true })]);
    expect(merged).toHaveLength(1);
    expect(classifyQuotaFiles(merged)).toEqual([]);
  });

  test('deduplicates config credentials already returned by auth-files', () => {
    const existing = file('glm.json', 'openai-compatible-glm', { authIndex: 'glm-auth-1' });
    expect(mergeGlmConfigQuotaFiles([existing], [glmProvider()])).toEqual([existing]);
  });

  test('uses the provider auth index when no API-key entries are present', () => {
    const merged = mergeGlmConfigQuotaFiles(
      [],
      [glmProvider({ apiKeyEntries: [], authIndex: 'glm-provider-auth' })]
    );
    expect(merged.map((item) => item.authIndex)).toEqual(['glm-provider-auth']);
  });
});

describe('resolveQuotaProviderType', () => {
  test('maps provider aliases and rejects unsupported or disabled files', () => {
    expect(resolveQuotaProviderType(file('a', 'grok'))).toBe('xai');
    expect(resolveQuotaProviderType(file('a', 'antigravity'))).toBe('antigravity');
    expect(resolveQuotaProviderType(file('a', 'openai-compatible-glm'))).toBe('glm');
    expect(resolveQuotaProviderType(file('a', 'gemini'))).toBeNull();
    expect(resolveQuotaProviderType(file('a', 'claude', { disabled: true }))).toBeNull();
  });
});

describe('classifyQuotaFiles', () => {
  test('drops unsupported and disabled files', () => {
    const entries = classifyQuotaFiles(FILES);
    expect(entries.map((entry) => entry.file.name)).not.toContain('gemini-a.json');
    expect(entries.map((entry) => entry.file.name)).not.toContain('claude-off.json');
    expect(entries).toHaveLength(6);
  });

  test('orders entries by provider tab order', () => {
    const entries = classifyQuotaFiles(FILES);
    expect(entries.map((entry) => entry.type)).toEqual([
      'claude',
      'codex',
      'codex',
      'glm',
      'xai',
      'kimi',
    ]);
  });
});

describe('buildTabCounts', () => {
  test('counts per provider plus an all total, zero-filling empty tabs', () => {
    expect(buildTabCounts(classifyQuotaFiles(FILES))).toEqual({
      all: 6,
      claude: 1,
      antigravity: 0,
      codex: 2,
      glm: 1,
      xai: 1,
      kimi: 1,
    });
  });
});

describe('filterEntriesByTab', () => {
  const entries = classifyQuotaFiles(FILES);

  test("passes everything through on the 'all' tab", () => {
    expect(filterEntriesByTab(entries, 'all')).toHaveLength(6);
  });

  test('filters to a single provider', () => {
    expect(filterEntriesByTab(entries, 'codex').map((entry) => entry.file.name)).toEqual([
      'codex-a.json',
      'codex-b.json',
    ]);
    expect(filterEntriesByTab(entries, 'antigravity')).toEqual([]);
  });
});

describe('isQuotaRefreshDisabled', () => {
  test('blocks a single-card refresh while the same quota is resetting', () => {
    expect(isQuotaRefreshDisabled(true, false, true)).toBe(true);
    expect(isQuotaRefreshDisabled(true, false, false)).toBe(false);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 45 }, (_, index) => index);

  test('uses the configured 20-item page size', () => {
    expect(QUOTA_PAGE_SIZE).toBe(20);
    expect(paginate(items, 2, QUOTA_PAGE_SIZE)).toEqual({
      pageItems: items.slice(20, 40),
      currentPage: 2,
      totalPages: 3,
    });
  });

  test('clamps an out-of-range page instead of returning an empty slice', () => {
    expect(paginate(items, 9, QUOTA_PAGE_SIZE).currentPage).toBe(3);
    expect(paginate(items, 9, QUOTA_PAGE_SIZE).pageItems).toEqual(items.slice(40));
    expect(paginate(items, 0, QUOTA_PAGE_SIZE).currentPage).toBe(1);
  });

  test('keeps at least one page when the list is empty', () => {
    expect(paginate([], 1, QUOTA_PAGE_SIZE)).toEqual({
      pageItems: [],
      currentPage: 1,
      totalPages: 1,
    });
  });
});

describe('sortQuotaEntries', () => {
  const entries = classifyQuotaFiles(FILES);
  const byName = (list: QuotaFileEntry[]) => list.map((entry) => entry.file.name);

  /** Recovery instants keyed by file name; anything absent resolves to null. */
  const resolver = (instants: Record<string, number>) => (entry: QuotaFileEntry) =>
    instants[entry.file.name] ?? null;

  test('default mode preserves order but returns a new array', () => {
    const sorted = sortQuotaEntries(entries, 'default', () => 1);
    expect(byName(sorted)).toEqual(byName(entries));
    expect(sorted).not.toBe(entries);
  });

  test('orders loaded credentials by how soon they recover, across providers', () => {
    const sorted = sortQuotaEntries(
      entries,
      'soonest',
      resolver({
        'codex-a.json': 300,
        'claude-a.json': 100,
        'kimi-a.json': 200,
        'codex-b.json': 400,
        'grok-a.json': 50,
      })
    );
    expect(byName(sorted)).toEqual([
      'grok-a.json',
      'claude-a.json',
      'kimi-a.json',
      'codex-a.json',
      'codex-b.json',
      'glm-a.json',
    ]);
  });

  test('sinks credentials with no instant, keeping their provider-grouped order', () => {
    // Loading is click-to-fetch, so an unloaded tail is the normal case.
    const sorted = sortQuotaEntries(
      entries,
      'soonest',
      resolver({ 'codex-b.json': 200, 'kimi-a.json': 100 })
    );
    expect(byName(sorted)).toEqual([
      'kimi-a.json',
      'codex-b.json',
      // unresolved tail, in the order classifyQuotaFiles produced
      'claude-a.json',
      'codex-a.json',
      'glm-a.json',
      'grok-a.json',
    ]);
  });

  test('leaves the order untouched when nothing has loaded', () => {
    expect(byName(sortQuotaEntries(entries, 'soonest', () => null))).toEqual(byName(entries));
  });

  test('breaks ties on the original position, so equal instants stay stable', () => {
    const sorted = sortQuotaEntries(entries, 'soonest', () => 500);
    expect(byName(sorted)).toEqual(byName(entries));
  });

  test('does not mutate the input', () => {
    const input = [...entries];
    sortQuotaEntries(input, 'soonest', resolver({ 'codex-b.json': 1 }));
    expect(input).toEqual(entries);
  });

  test('sorts before paginating, so the globally soonest lands on page one', () => {
    // Last in the default order, first to recover.
    const last = entries[entries.length - 1].file.name;
    const sorted = sortQuotaEntries(entries, 'soonest', resolver({ [last]: 1 }));
    expect(paginate(sorted, 1, 2).pageItems[0].file.name).toBe(last);
  });
});
