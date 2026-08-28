import { describe, expect, test } from 'bun:test';
import { getProviderKeyCounts } from '../src/features/dashboard/hooks/useDashboardOverview';
import type { Config } from '../src/types/config';

describe('Sidebar AI Providers badge count calculation', () => {
  test('calculates cumulative badge count reactively as providers are added or removed', () => {
    const config: Config = {};
    const getCount = (cfg: Config) => {
      const counts = getProviderKeyCounts(cfg);
      return Object.values(counts).reduce((sum, count) => sum + count, 0);
    };

    // 0. 初始空配置
    expect(getCount(config)).toBe(0);

    // 1. 添加 1 个 Command Code (Go)
    config.commandCodeApiKeys = [{ apiKey: 'cmdc-1' }];
    expect(getCount(config)).toBe(1);

    // 2. 添加 1 个 Gemini (+1)
    config.geminiApiKeys = [{ apiKey: 'gemini-1' }];
    expect(getCount(config)).toBe(2);

    // 3. 添加 2 个 Claude (+2)
    config.claudeApiKeys = [{ apiKey: 'claude-1' }, { apiKey: 'claude-2' }];
    expect(getCount(config)).toBe(4);

    // 4. 添加 1 个 Codex (+1)
    config.codexApiKeys = [{ apiKey: 'codex-1' }];
    expect(getCount(config)).toBe(5);

    // 5. 添加 1 个 xAI (+1)
    config.xaiApiKeys = [{ apiKey: 'xai-1' }];
    expect(getCount(config)).toBe(6);

    // 6. 添加 1 个 Vertex (+1)
    config.vertexApiKeys = [{ apiKey: 'vertex-1' }];
    expect(getCount(config)).toBe(7);

    // 7. 添加 1 个 Interactions API (+1)
    config.interactionsApiKeys = [{ apiKey: 'interactions-1' }];
    expect(getCount(config)).toBe(8);

    // 8. 添加 1 个 OpenAI 兼容提供商 (+1)
    config.openaiCompatibility = [
      { name: 'openrouter', apiKeyEntries: [{ apiKey: 'sk-1' }] },
    ];
    expect(getCount(config)).toBe(9);

    // 9. 删除 1 个 Claude Key (-1)
    config.claudeApiKeys.pop();
    expect(getCount(config)).toBe(8);
  });
});
