import { describe, expect, test } from 'bun:test';
import {
  buildTabCounts,
  classifyQuotaFiles,
  filterEntriesByTab,
  paginate,
  resolveQuotaProviderType,
} from '@/features/quota/logic';
import type { AuthFileItem } from '@/types';

const file = (name: string, provider: string, extra: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({ name, provider, ...extra }) as AuthFileItem;

const FILES: AuthFileItem[] = [
  file('codex-a.json', 'codex'),
  file('claude-a.json', 'claude'),
  file('kimi-a.json', 'kimi'),
  file('codex-b.json', 'codex'),
  file('grok-a.json', 'grok'), // 别名归一到 xai
  file('gemini-a.json', 'gemini'), // 不支持额度
  file('claude-off.json', 'claude', { disabled: true }), // 停用
];

describe('resolveQuotaProviderType', () => {
  test('maps provider aliases and rejects unsupported or disabled files', () => {
    expect(resolveQuotaProviderType(file('a', 'grok'))).toBe('xai');
    expect(resolveQuotaProviderType(file('a', 'antigravity'))).toBe('antigravity');
    expect(resolveQuotaProviderType(file('a', 'gemini'))).toBeNull();
    expect(resolveQuotaProviderType(file('a', 'claude', { disabled: true }))).toBeNull();
  });
});

describe('classifyQuotaFiles', () => {
  test('drops unsupported and disabled files', () => {
    const entries = classifyQuotaFiles(FILES);
    expect(entries.map((entry) => entry.file.name)).not.toContain('gemini-a.json');
    expect(entries.map((entry) => entry.file.name)).not.toContain('claude-off.json');
    expect(entries).toHaveLength(5);
  });

  test('orders entries by provider tab order', () => {
    const entries = classifyQuotaFiles(FILES);
    expect(entries.map((entry) => entry.type)).toEqual(['claude', 'codex', 'codex', 'xai', 'kimi']);
  });
});

describe('buildTabCounts', () => {
  test('counts per provider plus an all total, zero-filling empty tabs', () => {
    expect(buildTabCounts(classifyQuotaFiles(FILES))).toEqual({
      all: 5,
      claude: 1,
      antigravity: 0,
      codex: 2,
      xai: 1,
      kimi: 1,
    });
  });
});

describe('filterEntriesByTab', () => {
  const entries = classifyQuotaFiles(FILES);

  test("passes everything through on the 'all' tab", () => {
    expect(filterEntriesByTab(entries, 'all')).toHaveLength(5);
  });

  test('filters to a single provider', () => {
    expect(filterEntriesByTab(entries, 'codex').map((entry) => entry.file.name)).toEqual([
      'codex-a.json',
      'codex-b.json',
    ]);
    expect(filterEntriesByTab(entries, 'antigravity')).toEqual([]);
  });
});

describe('paginate', () => {
  const items = Array.from({ length: 26 }, (_, index) => index);

  test('slices the requested page', () => {
    expect(paginate(items, 2, 12)).toEqual({
      pageItems: items.slice(12, 24),
      currentPage: 2,
      totalPages: 3,
    });
  });

  test('clamps an out-of-range page instead of returning an empty slice', () => {
    expect(paginate(items, 9, 12).currentPage).toBe(3);
    expect(paginate(items, 9, 12).pageItems).toEqual(items.slice(24));
    expect(paginate(items, 0, 12).currentPage).toBe(1);
  });

  test('keeps at least one page when the list is empty', () => {
    expect(paginate([], 1, 12)).toEqual({ pageItems: [], currentPage: 1, totalPages: 1 });
  });
});
