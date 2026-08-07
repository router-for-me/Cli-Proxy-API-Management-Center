import { describe, expect, test } from 'bun:test';
import { readAnthropicLoginMode } from '../src/features/oauth/loginMode';
import { buildOAuthStartParams } from '../src/services/api/oauth';

describe('Anthropic login mode', () => {
  test('keeps a persisted mode and falls back to the local callback otherwise', () => {
    expect(readAnthropicLoginMode('manual')).toBe('manual');
    expect(readAnthropicLoginMode('local')).toBe('local');
    expect(readAnthropicLoginMode(null)).toBe('local');
    expect(readAnthropicLoginMode(undefined)).toBe('local');
    expect(readAnthropicLoginMode('')).toBe('local');
    expect(readAnthropicLoginMode('bogus')).toBe('local');
  });
});

describe('OAuth start parameters', () => {
  test('sends an explicit manual flag for Anthropic in both directions', () => {
    expect(buildOAuthStartParams('anthropic', { manual: true })).toEqual({
      is_webui: true,
      manual: true,
    });
    expect(buildOAuthStartParams('anthropic', { manual: false })).toEqual({
      is_webui: true,
      manual: false,
    });
  });

  test('omits the manual flag when unset so the server default applies', () => {
    expect(buildOAuthStartParams('anthropic')).toEqual({ is_webui: true });
    expect(buildOAuthStartParams('anthropic', {})).toEqual({ is_webui: true });
  });

  test('ignores the manual flag for providers that do not support it', () => {
    expect(buildOAuthStartParams('codex', { manual: true })).toEqual({ is_webui: true });
    expect(buildOAuthStartParams('kimi', { manual: true })).toEqual({});
  });
});
