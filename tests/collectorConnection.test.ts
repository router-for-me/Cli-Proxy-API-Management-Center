import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCollectorApiUrl,
  buildCollectorQuery,
  normalizeCollectorBase,
} from '../src/utils/collectorConnection.ts';

test('normalizes collector base URLs without management suffixes', () => {
  assert.equal(normalizeCollectorBase('127.0.0.1:8320'), 'http://127.0.0.1:8320');
  assert.equal(
    normalizeCollectorBase('http://localhost:8320/v0/collector/'),
    'http://localhost:8320'
  );
  assert.equal(
    normalizeCollectorBase(' https://collector.example.com/// '),
    'https://collector.example.com'
  );
});

test('builds collector management API URLs from a normalized base', () => {
  assert.equal(
    buildCollectorApiUrl('http://localhost:8320', '/call-records'),
    'http://localhost:8320/v0/collector/call-records'
  );
  assert.equal(
    buildCollectorApiUrl('http://localhost:8320/', 'usage/summary'),
    'http://localhost:8320/v0/collector/usage/summary'
  );
});

test('drops empty query parameters and preserves valid filters', () => {
  assert.deepEqual(
    buildCollectorQuery({
      page: 2,
      pageSize: 50,
      apiKey: '  ',
      model: 'gpt-5.3',
      status: undefined,
      startTime: '2026-04-28T00:00:00Z',
    }),
    {
      page: 2,
      page_size: 50,
      model: 'gpt-5.3',
      start_time: '2026-04-28T00:00:00Z',
    }
  );
});
