import { describe, expect, test } from 'bun:test';
import { normalizeConfigResponse } from '../src/services/api/transformers';

describe('v8 persisted configuration normalization', () => {
  test('uses backend AI Studio authentication default when the persisted field is absent', () => {
    expect(normalizeConfigResponse({ 'config-version': 8 }).wsAuth).toBe(true);
    expect(
      normalizeConfigResponse({ oauth: { providers: { aistudio: { 'ws-auth': false } } } }).wsAuth
    ).toBe(false);
  });

  test('reads Antigravity credits without requiring the unrelated quota-exceeded block', () => {
    expect(
      normalizeConfigResponse({
        oauth: { providers: { antigravity: { 'antigravity-credits': true } } },
      }).quotaExceeded?.antigravityCredits
    ).toBe(true);
  });

  test('does not interpret legacy root settings as v8 values', () => {
    const config = normalizeConfigResponse({
      'api-keys': ['legacy-client'],
      'codex-api-key': [{ 'api-key': 'legacy-upstream' }],
      'proxy-url': 'https://old.invalid',
      'ws-auth': false,
      requests: { 'proxy-url': 'https://current.invalid' },
    });
    expect(config.apiKeys).toEqual([]);
    expect(config.codexApiKeys).toEqual([]);
    expect(config.proxyUrl).toBe('https://current.invalid');
    expect(config.wsAuth).toBe(true);
  });
});
