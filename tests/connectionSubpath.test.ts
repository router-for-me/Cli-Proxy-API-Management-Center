import { describe, expect, test } from 'bun:test';
import { normalizeApiBase, resolvePanelBasePath } from '../src/utils/connection';

describe('reverse-proxy panel path detection', () => {
  test('preserves extensionless mount paths with and without a trailing slash', () => {
    expect(resolvePanelBasePath('/proxy')).toBe('/proxy');
    expect(resolvePanelBasePath('/proxy/')).toBe('/proxy');
    expect(resolvePanelBasePath('/tenants/acme')).toBe('/tenants/acme');
  });

  test('strips a served filename without misclassifying its directory', () => {
    expect(resolvePanelBasePath('/proxy/management.html')).toBe('/proxy');
    expect(resolvePanelBasePath('/proxy/index.htm')).toBe('/proxy');
    expect(resolvePanelBasePath('/assets/dashboard.js')).toBe('/assets');
    expect(resolvePanelBasePath('/proxy/static/dashboard.json')).toBe('/proxy/static');
    expect(resolvePanelBasePath('/management.html')).toBe('');
  });

  test('preserves dotted mount paths instead of treating every dot as a file extension', () => {
    expect(resolvePanelBasePath('/tenant.v1/')).toBe('/tenant.v1');
    expect(resolvePanelBasePath('/tenant.v1')).toBe('/tenant.v1');
    expect(resolvePanelBasePath('/tenant.json')).toBe('/tenant.json');
    expect(resolvePanelBasePath('/proxy/dashboard.js')).toBe('/proxy/dashboard.js');
    expect(resolvePanelBasePath('/groups/acme.prod/')).toBe('/groups/acme.prod');
  });

  test('keeps normalized management paths stable', () => {
    expect(normalizeApiBase('https://example.test/proxy/v8/management/')).toBe(
      'https://example.test/proxy'
    );
  });
});
