import { describe, expect, it } from 'vitest';
import { resolveUsageServiceLoginMode } from './loginMode';

describe('resolveUsageServiceLoginMode', () => {
  it('keeps CPA-hosted panels on the regular login flow', () => {
    expect(resolveUsageServiceLoginMode(undefined)).toEqual({
      hostedByUsageService: false,
      usageServiceNeedsSetup: false,
    });
    expect(resolveUsageServiceLoginMode({ service: 'cli-proxy-api' })).toEqual({
      hostedByUsageService: false,
      usageServiceNeedsSetup: false,
    });
  });

  it('uses setup only for unconfigured Usage Service hosted panels', () => {
    expect(resolveUsageServiceLoginMode({ service: 'cpa-manager', configured: false })).toEqual({
      hostedByUsageService: true,
      usageServiceNeedsSetup: true,
    });
  });

  it('uses regular login for configured Usage Service hosted panels', () => {
    expect(resolveUsageServiceLoginMode({ service: 'cpa-manager', configured: true })).toEqual({
      hostedByUsageService: true,
      usageServiceNeedsSetup: false,
    });
  });
});
