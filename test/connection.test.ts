import assert from 'node:assert/strict';
import test from 'node:test';

import {
  detectApiBaseFromHref,
  normalizeApiBase,
  resolveApiBase,
  shouldPreferDetectedApiBase,
} from '../src/utils/connection';

test('normalizeApiBase strips management control panel routes', () => {
  assert.equal(normalizeApiBase('https://example.com/management.html'), 'https://example.com');
  assert.equal(normalizeApiBase('https://example.com/v0/management'), 'https://example.com');
  assert.equal(normalizeApiBase('example.com/management.html/'), 'http://example.com');
  assert.equal(
    normalizeApiBase('https://example.com/management.html?foo=bar#/login'),
    'https://example.com'
  );
});

test('detectApiBaseFromHref preserves reverse proxy path prefixes', () => {
  const href =
    'https://example.com/ws-123/project-456/user-789/vscode/abc/def/proxy/8317/management.html';

  assert.equal(
    detectApiBaseFromHref(href),
    'https://example.com/ws-123/project-456/user-789/vscode/abc/def/proxy/8317'
  );
});

test('detectApiBaseFromHref ignores query strings and hashes', () => {
  const href = 'https://example.com/ws-123/project-456/proxy/8317/management.html?foo=bar#/login';

  assert.equal(detectApiBaseFromHref(href), 'https://example.com/ws-123/project-456/proxy/8317');
});

test('resolveApiBase prefers the detected proxy path over stale origin-only cache', () => {
  const savedBase = 'https://example.com';
  const detectedBase = 'https://example.com/ws-123/project-456/proxy/8317';

  assert.equal(resolveApiBase(savedBase, detectedBase), detectedBase);
  assert.equal(shouldPreferDetectedApiBase(savedBase, detectedBase), true);
});

test('resolveApiBase keeps explicit custom bases that already include a path', () => {
  const savedBase = 'https://example.com/custom-gateway';
  const detectedBase = 'https://example.com/ws-123/project-456/proxy/8317';

  assert.equal(resolveApiBase(savedBase, detectedBase), savedBase);
  assert.equal(shouldPreferDetectedApiBase(savedBase, detectedBase), false);
});
