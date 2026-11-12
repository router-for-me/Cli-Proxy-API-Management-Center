import { describe, expect, test } from 'bun:test';
import { getVersionCheckResult } from '../src/pages/systemVersion';

describe('system version check feedback', () => {
  test('treats an available release as information, not a warning', () => {
    expect(getVersionCheckResult('v8.0.68', 'v8.0.67')).toEqual({
      type: 'info',
      messageKey: 'system_info.version_update_available',
      version: 'v8.0.68',
    });
  });

  test('compares numeric segments instead of lexical ordering', () => {
    expect(getVersionCheckResult('8.0.10', 'v8.0.9').type).toBe('info');
    expect(getVersionCheckResult('v8.1.0', '8.0.99').type).toBe('info');
  });

  test('confirms that an equal or newer current build needs no update', () => {
    for (const current of ['v8.0.68', '8.0.68', 'v8.0.69', 'v8.1.0']) {
      expect(getVersionCheckResult('v8.0.68', current)).toEqual({
        type: 'success',
        messageKey: 'system_info.version_is_latest',
      });
    }
  });

  test('does not claim an update when the current version is unavailable', () => {
    expect(getVersionCheckResult('v8.0.68', null)).toEqual({
      type: 'warning',
      messageKey: 'system_info.version_current_missing',
    });
  });

  test.each(['', 'unknown'])('rejects a missing or invalid latest release (%s)', (latest) => {
    expect(getVersionCheckResult(latest, 'v8.0.67')).toEqual({
      type: 'error',
      messageKey: 'system_info.version_check_error',
    });
  });
});
