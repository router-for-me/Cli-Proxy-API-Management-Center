import { describe, expect, it } from 'vitest';
import { getUsageServiceBootstrapToSync } from './ConfigPage';

describe('getUsageServiceBootstrapToSync', () => {
  it('returns the normalized service base after a successful auto-load', () => {
    expect(
      getUsageServiceBootstrapToSync({
        serviceBase: 'http://usage.local:18317/',
        usageServiceEnabled: false,
        usageServiceBase: '',
      })
    ).toBe('http://usage.local:18317');
  });

  it('skips syncing when the bootstrap address is already current', () => {
    expect(
      getUsageServiceBootstrapToSync({
        serviceBase: 'http://usage.local:18317/',
        usageServiceEnabled: true,
        usageServiceBase: 'http://usage.local:18317',
      })
    ).toBe('');
  });

  it('skips syncing when the loaded service base is empty', () => {
    expect(
      getUsageServiceBootstrapToSync({
        serviceBase: '   ',
        usageServiceEnabled: false,
        usageServiceBase: '',
      })
    ).toBe('');
  });
});
