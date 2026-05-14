import { describe, expect, it } from 'vitest';
import { buildCodexUsageRequestHeaders } from './codexQuota';

describe('buildCodexUsageRequestHeaders', () => {
  it('does not include Chatgpt-Account-Id when account id is missing', () => {
    const headers = buildCodexUsageRequestHeaders(null);

    expect(headers).not.toHaveProperty('Chatgpt-Account-Id');
    expect(headers.Authorization).toBe('Bearer $TOKEN$');
  });

  it('includes trimmed account id when available', () => {
    const headers = buildCodexUsageRequestHeaders(' account-123 ');

    expect(headers['Chatgpt-Account-Id']).toBe('account-123');
  });

  it('allows Codex inspection to override User-Agent', () => {
    const headers = buildCodexUsageRequestHeaders('account-123', {
      userAgent: 'codex-test-agent',
    });

    expect(headers['User-Agent']).toBe('codex-test-agent');
  });
});
