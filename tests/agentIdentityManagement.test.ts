import { describe, expect, test } from 'bun:test';
import {
  AGENT_IDENTITY_PLUGIN_ID,
  AGENT_IDENTITY_MANAGEMENT_API_PATH,
  AGENT_IDENTITY_MANAGEMENT_ROUTE,
  buildAgentIdentityManagementURL,
  hardenAgentIdentityManagementDocument,
  isAgentIdentityManagementHTMLContentType,
} from '../src/features/plugins/agentIdentityManagement';

describe('Agent Identity management entry', () => {
  test('targets the authenticated CPA Management route and preserves its port', () => {
    expect(buildAgentIdentityManagementURL('https://cpa.example.test:9443')).toBe(
      'https://cpa.example.test:9443/v0/management/codex-agent-identity/open'
    );
    expect(AGENT_IDENTITY_MANAGEMENT_API_PATH).toBe('/codex-agent-identity/open');
    expect(AGENT_IDENTITY_MANAGEMENT_ROUTE).toBe('/v0/management/codex-agent-identity/open');
  });

  test('deliberately targets the origin-root Management route', () => {
    expect(buildAgentIdentityManagementURL('https://cpa.example.test/proxy/cpa')).toBe(
      'https://cpa.example.test/v0/management/codex-agent-identity/open'
    );
  });

  test('fails closed for missing, malformed, credentialed, and non-http bases', () => {
    for (const value of [
      '',
      'not a URL',
      'javascript:alert(1)',
      'file:///tmp/cpa',
      'https://user:password@cpa.example.test',
    ]) {
      expect(buildAgentIdentityManagementURL(value)).toBeNull();
    }
  });

  test('matches only the canonical plugin identifier', () => {
    expect(AGENT_IDENTITY_PLUGIN_ID).toBe('codex-agent-identity');
    expect(AGENT_IDENTITY_PLUGIN_ID).not.toBe('codex-agent-identity-preview');
  });

  test('requires an explicit text/html media type', () => {
    expect(isAgentIdentityManagementHTMLContentType('text/html; charset=utf-8')).toBe(true);
    expect(isAgentIdentityManagementHTMLContentType('')).toBe(false);
    expect(isAgentIdentityManagementHTMLContentType('application/json; note=text/html')).toBe(
      false
    );
  });

  test('preserves the authenticated response CSP when rendering the management document', () => {
    const html = hardenAgentIdentityManagementDocument(
      '<!doctype html><html><head><title>Identity</title></head><body></body></html>',
      "default-src 'none'; frame-src 'self'",
      'no-referrer'
    );
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    expect(html).toContain("default-src 'none'; frame-src 'self'");
    expect(html).toContain('<meta name="referrer" content="no-referrer">');
  });

  test('rejects non-HTML management responses', () => {
    expect(() =>
      hardenAgentIdentityManagementDocument(
        '{"error":"unauthorized"}',
        "default-src 'none'",
        'no-referrer'
      )
    ).toThrow();
  });

  test('fails closed when the authenticated response omits CSP', () => {
    expect(() =>
      hardenAgentIdentityManagementDocument(
        '<!doctype html><html><head></head><body></body></html>',
        '',
        'no-referrer'
      )
    ).toThrow(/Content-Security-Policy/);
  });

  test('rejects oversized HTML and CSP responses', () => {
    expect(() =>
      hardenAgentIdentityManagementDocument(
        `<!doctype html><html><head></head><body>${'x'.repeat(512 * 1024)}</body></html>`,
        "default-src 'none'",
        'no-referrer'
      )
    ).toThrow(/size/);
    expect(() =>
      hardenAgentIdentityManagementDocument(
        '<!doctype html><html><head></head><body></body></html>',
        'x'.repeat(16 * 1024 + 1),
        'no-referrer'
      )
    ).toThrow(/Content-Security-Policy/);
  });
});
