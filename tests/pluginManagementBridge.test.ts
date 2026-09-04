import { describe, expect, test } from 'bun:test';
import {
  normalizePluginManagementBridgeRequest,
  PLUGIN_MANAGEMENT_BRIDGE_VERSION,
  PLUGIN_MANAGEMENT_REQUEST_TYPE,
  resolvePluginManagementBridgeContext,
} from '../src/features/plugins/pluginManagementBridge';

const request = (overrides: Record<string, unknown> = {}) => ({
  type: PLUGIN_MANAGEMENT_REQUEST_TYPE,
  version: PLUGIN_MANAGEMENT_BRIDGE_VERSION,
  requestId: 'request-1',
  method: 'GET',
  path: '/v0/management/plugins/gpt56-policy/status',
  ...overrides,
});

describe('plugin management bridge', () => {
  test('enables the bridge only for the active plugin resource origin', () => {
    expect(
      resolvePluginManagementBridgeContext(
        'gpt56-policy',
        'https://proxy.example/v0/resource/plugins/gpt56-policy/policy',
        'https://proxy.example/v0/management'
      )
    ).toEqual({ origin: 'https://proxy.example', pluginID: 'gpt56-policy' });
    expect(
      resolvePluginManagementBridgeContext(
        'gpt56-policy',
        'https://plugins.example/v0/resource/plugins/gpt56-policy/policy',
        'https://proxy.example/v0/management'
      )
    ).toBeNull();
    expect(
      resolvePluginManagementBridgeContext(
        'gpt56-policy',
        'https://proxy.example/v0/resource/plugins/other-plugin/policy',
        'https://proxy.example/v0/management'
      )
    ).toBeNull();
  });

  test('accepts a request scoped to the active plugin', () => {
    expect(normalizePluginManagementBridgeRequest(request(), 'gpt56-policy')).toEqual({
      requestID: 'request-1',
      method: 'GET',
      apiPath: '/plugins/gpt56-policy/status',
      headers: {},
    });
  });

  test('accepts JSON mutations and preserves the query string', () => {
    expect(
      normalizePluginManagementBridgeRequest(
        request({
          method: 'POST',
          path: '/v0/management/plugins/gpt56-policy/speed?source=panel',
          headers: { 'Content-Type': 'application/json' },
          body: '{"mode":"fast"}',
        }),
        'gpt56-policy'
      )
    ).toEqual({
      requestID: 'request-1',
      method: 'POST',
      apiPath: '/plugins/gpt56-policy/speed?source=panel',
      headers: { 'content-type': 'application/json' },
      body: '{"mode":"fast"}',
    });
  });

  test('rejects requests outside the active plugin namespace', () => {
    expect(
      normalizePluginManagementBridgeRequest(
        request({ path: '/v0/management/config.yaml' }),
        'gpt56-policy'
      )
    ).toBeNull();
    expect(
      normalizePluginManagementBridgeRequest(
        request({ path: '/v0/management/plugins/other-plugin/status' }),
        'gpt56-policy'
      )
    ).toBeNull();
  });

  test('rejects traversal, encoded separators, fragments, and absolute URLs', () => {
    for (const path of [
      '/v0/management/plugins/gpt56-policy/../other',
      '/v0/management/plugins/gpt56-policy/%2e%2e/other',
      '/v0/management/plugins/gpt56-policy/%2fconfig',
      '/v0/management/plugins/gpt56-policy/status#secret',
      'https://example.com/v0/management/plugins/gpt56-policy/status',
    ]) {
      expect(normalizePluginManagementBridgeRequest(request({ path }), 'gpt56-policy')).toBeNull();
    }
  });

  test('rejects unsafe methods, headers, and GET bodies', () => {
    expect(
      normalizePluginManagementBridgeRequest(request({ method: 'TRACE' }), 'gpt56-policy')
    ).toBeNull();
    expect(
      normalizePluginManagementBridgeRequest(
        request({ headers: { Authorization: 'Bearer secret' } }),
        'gpt56-policy'
      )
    ).toBeNull();
    expect(
      normalizePluginManagementBridgeRequest(request({ body: '{}' }), 'gpt56-policy')
    ).toBeNull();
  });

  test('enforces request identifiers, header values, and mutation body limits', () => {
    expect(
      normalizePluginManagementBridgeRequest(
        request({ requestId: 'contains a space' }),
        'gpt56-policy'
      )
    ).toBeNull();
    expect(
      normalizePluginManagementBridgeRequest(
        request({ headers: { Accept: `text/plain${'x'.repeat(8192)}` } }),
        'gpt56-policy'
      )
    ).toBeNull();

    const largestBody = 'x'.repeat(1024 * 1024);
    expect(
      normalizePluginManagementBridgeRequest(
        request({ method: 'PUT', body: largestBody }),
        'gpt56-policy'
      )?.body
    ).toHaveLength(1024 * 1024);
    expect(
      normalizePluginManagementBridgeRequest(
        request({ method: 'PUT', body: `${largestBody}x` }),
        'gpt56-policy'
      )
    ).toBeNull();
    expect(
      normalizePluginManagementBridgeRequest(
        request({ method: 'PATCH', body: '界'.repeat(350_000) }),
        'gpt56-policy'
      )
    ).toBeNull();
  });
});
