import { describe, expect, test } from 'bun:test';
import type { AuthFileItem, OpenCodeUsagePayload } from '@/types';
import {
  attachOpenAICompatBaseUrls,
  buildOpenCodeQuotaWindows,
  clampPercent,
  extractAuthFileBaseUrl,
  isOpenCodeGoBaseUrl,
  isOpenCodeGoFile,
  mergeOpenCodeCompatAuthFiles,
  parseOpenCodeUsagePayload,
  remainingFromUsedPercent,
} from '@/utils/quota/opencode';
import { classifyQuotaFiles, resolveQuotaProviderType } from '@/features/quota/logic';
import { QUOTA_TAB_ORDER } from '@/features/quota/constants';
import { QUOTA_ADAPTERS } from '@/features/quota/providers';
import { OPENCODE_CONFIG } from '@/features/quota/providers/opencode/data';

const file = (name: string, extra: Partial<AuthFileItem> = {}): AuthFileItem =>
  ({ name, ...extra }) as AuthFileItem;

describe('OpenCode Go strict URL matcher', () => {
  test('accepts official base URLs with normalization', () => {
    const positives = [
      'https://opencode.ai/zen/go',
      'https://opencode.ai/zen/go/',
      'https://opencode.ai/zen/go/v1',
      'https://opencode.ai/zen/go/v1/',
      'HTTPS://OpenCode.AI/zen/go/v1/',
      'https://opencode.ai/zen/go/v1/?ignored=1',
    ];
    for (const url of positives) {
      expect(isOpenCodeGoBaseUrl(url)).toBe(true);
    }
  });

  test('rejects spoofed, generic, and misleading URLs', () => {
    const negatives = [
      'https://openrouter.ai/api/v1',
      'https://api.openai.com/v1',
      'https://example.com/v1',
      'https://opencode.ai.example.com/zen/go',
      'https://evil.com/zen/go?host=opencode.ai',
      'https://example.com/path/opencode.ai/zen/go',
      'https://opencode.ai/zen',
      'https://opencode.ai/zen/go/v2',
      'https://opencode.ai/not-zen/go',
      '',
      'not-a-url',
    ];
    for (const url of negatives) {
      expect(isOpenCodeGoBaseUrl(url)).toBe(false);
    }
  });
});

describe('OpenCode Go file detection', () => {
  test('requires strict base URL and ignores name-only hints', () => {
    expect(
      isOpenCodeGoFile(file('a', { provider: 'opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' }))
    ).toBe(true);
    expect(isOpenCodeGoFile(file('b', { provider: 'opencode-go' }))).toBe(false);
    expect(
      isOpenCodeGoFile(
        file('c', { provider: 'opencode-go', baseUrl: 'https://openrouter.ai/api/v1' })
      )
    ).toBe(false);
    expect(
      isOpenCodeGoFile(
        file('d', {
          provider: 'openai-compatible-custom',
          'base-url': 'https://opencode.ai/zen/go',
        })
      )
    ).toBe(true);
  });

  test('mergeOpenCodeCompatAuthFiles synthesizes missing OpenCode Go API-key rows with runtime_only flag', () => {
    const files = [file('codex-a', { authIndex: 'codex-1', provider: 'codex' })];
    const merged = mergeOpenCodeCompatAuthFiles(files, [
      {
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKeyEntries: [{ authIndex: 'oc-auth-1' }],
      },
      {
        name: 'OpenRouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKeyEntries: [{ authIndex: 'or-1' }],
      },
    ]);
    const oc = merged.filter((f) => isOpenCodeGoFile(f));
    expect(oc).toHaveLength(1);
    expect(oc[0]?.authIndex).toBe('oc-auth-1');
    expect(extractAuthFileBaseUrl(oc[0]!)).toBe('https://opencode.ai/zen/go/v1');
    expect(oc[0]?.runtime_only).toBe(true);
    // non-OpenCode compat providers are not synthesized
    expect(merged.some((f) => f.authIndex === 'or-1')).toBe(false);
  });

  test('multi-key isolation: synthesizes distinct rows for multiple keys under one OpenCode Go config', () => {
    const compatConfig = [
      {
        name: 'OpenCode Go Team',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKeyEntries: [
          { authIndex: 'oc-key-alpha' },
          { authIndex: 'oc-key-beta' },
        ],
      },
    ];
    const merged = mergeOpenCodeCompatAuthFiles([], compatConfig);
    const ocEntries = merged.filter((f) => isOpenCodeGoFile(f));
    expect(ocEntries).toHaveLength(2);

    const [first, second] = ocEntries;
    expect(first?.authIndex).toBe('oc-key-alpha');
    expect(second?.authIndex).toBe('oc-key-beta');
    expect(first?.name).not.toEqual(second?.name);
    expect(first?.name).toBe('openai-compat:OpenCode Go Team:oc-key-alpha');
    expect(second?.name).toBe('openai-compat:OpenCode Go Team:oc-key-beta');

    // Classification should assign both to opencode provider with distinct card identities
    const classified = classifyQuotaFiles(merged);
    const opencodeCards = classified.filter((e) => e.type === 'opencode');
    expect(opencodeCards).toHaveLength(2);
    expect(opencodeCards[0]?.file.name).toBe('openai-compat:OpenCode Go Team:oc-key-alpha');
    expect(opencodeCards[1]?.file.name).toBe('openai-compat:OpenCode Go Team:oc-key-beta');

    // Runtime-only flag set on both to suppress destructive file operations
    expect(first?.runtime_only).toBe(true);
    expect(second?.runtime_only).toBe(true);
  });

  test('attachOpenAICompatBaseUrls joins auth_index to base URL', () => {
    const files = [
      file('oc-1', { authIndex: 'idx-1', provider: 'openai-compatible-opencode-go' }),
      file('other', { authIndex: 'idx-2', provider: 'openai-compatible-openrouter' }),
    ];
    const enriched = attachOpenAICompatBaseUrls(files, [
      {
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKeyEntries: [{ authIndex: 'idx-1' }],
      },
      {
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKeyEntries: [{ authIndex: 'idx-2' }],
      },
    ]);
    expect(extractAuthFileBaseUrl(enriched[0]!)).toBe('https://opencode.ai/zen/go/v1');
    expect(isOpenCodeGoFile(enriched[0]!)).toBe(true);
    expect(isOpenCodeGoFile(enriched[1]!)).toBe(false);
  });
});

describe('OpenCode Go payload parsing', () => {
  const payload: OpenCodeUsagePayload = {
    useBalance: false,
    rollingUsage: { percent: 12.5, resetsAt: '2026-08-16T10:00:00.000Z' },
    weeklyUsage: { percent: 40, resetsAt: '2026-08-18T00:00:00.000Z' },
    monthlyUsage: { percent: 70, resetsAt: '2026-09-01T00:00:00.000Z' },
  };

  test('maps rolling/weekly/monthly to fixed 5H → Week → Month order', () => {
    const windows = buildOpenCodeQuotaWindows(payload);
    expect(windows.map((w) => w.id)).toEqual(['5h', 'weekly', 'monthly']);
    expect(windows.map((w) => w.labelKey)).toEqual([
      'opencode_quota.window_5h',
      'opencode_quota.window_week',
      'opencode_quota.window_month',
    ]);
    expect(windows[0]?.usedPercent).toBe(12.5);
    expect(windows[0]?.remainingPercent).toBe(87.5);
    expect(windows[1]?.remainingPercent).toBe(60);
    expect(windows[2]?.remainingPercent).toBe(30);
  });

  test('clamps percent bounds and handles unexpected values', () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(0)).toBe(0);
    expect(clampPercent(100)).toBe(100);
    expect(clampPercent(140)).toBe(100);
    expect(clampPercent('nope')).toBeNull();
    expect(remainingFromUsedPercent(0)).toBe(100);
    expect(remainingFromUsedPercent(100)).toBe(0);
    expect(remainingFromUsedPercent(null)).toBeNull();
  });

  test('rejects malformed payloads', () => {
    expect(parseOpenCodeUsagePayload(null)).toBeNull();
    expect(parseOpenCodeUsagePayload({})).toBeNull();
    expect(parseOpenCodeUsagePayload({ foo: 1 })).toBeNull();
    expect(parseOpenCodeUsagePayload(payload)).not.toBeNull();
  });

  test('accepts nested usage.rolling shape from live OpenCode Go endpoint', () => {
    const nested = {
      usage: {
        rolling: { status: 'ok', percent: 2, resetsAt: '2026-08-15T18:05:45.783Z' },
        weekly: { status: 'ok', percent: 16, resetsAt: '2026-08-17T00:00:00.783Z' },
        monthly: { status: 'ok', percent: 54, resetsAt: '2026-09-03T11:42:09.783Z' },
      },
    };
    const parsed = parseOpenCodeUsagePayload(nested);
    expect(parsed).not.toBeNull();
    const windows = buildOpenCodeQuotaWindows(parsed!);
    expect(windows.map((w) => w.id)).toEqual(['5h', 'weekly', 'monthly']);
    expect(windows[0]?.usedPercent).toBe(2);
    expect(windows[0]?.remainingPercent).toBe(98);
    expect(windows[1]?.remainingPercent).toBe(84);
    expect(windows[2]?.remainingPercent).toBe(46);
  });
});

describe('OpenCode Go adapter registration / classification', () => {
  test('registers opencode in tab order and adapters', () => {
    expect(QUOTA_TAB_ORDER).toContain('opencode');
    expect(QUOTA_ADAPTERS.opencode.type).toBe('opencode');
    expect(QUOTA_ADAPTERS.opencode.i18nPrefix).toBe('opencode_quota');
  });

  test('classifies only OpenCode Go base-url credentials and keeps multi-account isolation keys', () => {
    const files: AuthFileItem[] = [
      file('oc-a', { provider: 'openai-compatible-opencode-go', baseUrl: 'https://opencode.ai/zen/go/v1' }),
      file('oc-b', { provider: 'openai-compatible-opencode-go', baseUrl: 'https://opencode.ai/zen/go' }),
      file('or-a', { provider: 'openai-compatible-openrouter', baseUrl: 'https://openrouter.ai/api/v1' }),
      file('codex-a', { provider: 'codex' }),
      file('oc-off', {
        provider: 'openai-compatible-opencode-go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        disabled: true,
      }),
    ];
    const entries = classifyQuotaFiles(files);
    const opencode = entries.filter((e) => e.type === 'opencode');
    expect(opencode.map((e) => e.file.name)).toEqual(['oc-a', 'oc-b']);
    expect(resolveQuotaProviderType(files[0]!)).toBe('opencode');
    expect(resolveQuotaProviderType(files[2]!)).toBeNull();
    expect(resolveQuotaProviderType(files[3]!)).toBe('codex');
  });

  test('does not reclassify existing providers', () => {
    expect(resolveQuotaProviderType(file('c', { provider: 'claude' }))).toBe('claude');
    expect(resolveQuotaProviderType(file('x', { provider: 'xai' }))).toBe('xai');
    expect(resolveQuotaProviderType(file('k', { provider: 'kimi' }))).toBe('kimi');
    expect(resolveQuotaProviderType(file('a', { provider: 'antigravity' }))).toBe('antigravity');
    expect(resolveQuotaProviderType(file('d', { provider: 'codex' }))).toBe('codex');
  });
});

describe('Synthetic vs native auth file behavior', () => {
  test('synthetic OpenCode row marks runtime_only to suppress file actions while preserving quota identity', () => {
    const synthetic = mergeOpenCodeCompatAuthFiles([], [
      {
        name: 'OpenCode Go',
        baseUrl: 'https://opencode.ai/zen/go/v1',
        apiKeyEntries: [{ authIndex: 'oc-live-1' }],
      },
    ])[0]!;

    expect(synthetic.runtime_only).toBe(true);
    expect(isOpenCodeGoFile(synthetic)).toBe(true);
    expect(resolveQuotaProviderType(synthetic)).toBe('opencode');
    expect(OPENCODE_CONFIG.filterFn(synthetic)).toBe(true);
  });

  test('native auth file rows keep runtime_only false and support file actions', () => {
    const nativeFile = file('claude-work.json', {
      provider: 'claude',
      type: 'claude',
      authIndex: 'claude-idx-1',
    });

    expect(nativeFile.runtime_only).toBeUndefined();
    expect(resolveQuotaProviderType(nativeFile)).toBe('claude');
    expect(isOpenCodeGoFile(nativeFile)).toBe(false);
  });
});
