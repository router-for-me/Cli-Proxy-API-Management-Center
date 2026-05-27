import { describe, expect, it } from 'vitest';

import {
  buildModelPriceIndex,
  calculateCost,
  collectUsageDetails,
  collectUsageDetailsWithEndpoint,
  lookupModelPrice,
} from './usage';

describe('usage detail collection', () => {
  it('copies project id snapshots into normalized usage details', () => {
    const usageData = {
      apis: {
        'POST /v1/chat/completions': {
          models: {
            'gemini-2.5-pro': {
              details: [
                {
                  timestamp: '2026-05-09T01:12:43.000Z',
                  source: 'alice@example.com',
                  auth_index: 'auth-1',
                  auth_project_id_snapshot: 'vertex-project-42',
                  tokens: {
                    input_tokens: 10,
                    output_tokens: 5,
                  },
                  failed: false,
                },
              ],
            },
          },
        },
      },
    };

    expect(collectUsageDetails(usageData)[0].auth_project_id_snapshot).toBe(
      'vertex-project-42'
    );
    expect(collectUsageDetailsWithEndpoint(usageData)[0].auth_project_id_snapshot).toBe(
      'vertex-project-42'
    );
  });

  it('accepts camelCase project id snapshots from usage details', () => {
    const usageData = {
      apis: {
        'POST /v1/chat/completions': {
          models: {
            'gemini-2.5-pro': {
              details: [
                {
                  timestamp: '2026-05-09T01:12:43.000Z',
                  source: 'alice@example.com',
                  authIndex: 'auth-1',
                  authProjectIdSnapshot: 'camel-project-42',
                  tokens: {},
                  failed: false,
                },
              ],
            },
          },
        },
      },
    };

    expect(collectUsageDetails(usageData)[0].auth_project_id_snapshot).toBe('camel-project-42');
    expect(collectUsageDetailsWithEndpoint(usageData)[0].auth_project_id_snapshot).toBe(
      'camel-project-42'
    );
  });

  it('extracts resolved_model alongside the requested model name', () => {
    const usageData = {
      apis: {
        'POST /v1/chat/completions': {
          models: {
            'gpt-5.4': {
              details: [
                {
                  timestamp: '2026-05-19T10:00:00Z',
                  source: 'alice@example.com',
                  auth_index: 'auth-1',
                  resolved_model: 'gpt-5.5',
                  tokens: { input_tokens: 1 },
                  failed: false,
                },
              ],
            },
          },
        },
      },
    };

    const detail = collectUsageDetails(usageData)[0];
    expect(detail.__modelName).toBe('gpt-5.4');
    expect(detail.__resolvedModel).toBe('gpt-5.5');
    expect(collectUsageDetailsWithEndpoint(usageData)[0].__resolvedModel).toBe('gpt-5.5');
  });
});

describe('calculateCost model price preference', () => {
  const prices = {
    'gpt-5.5': { prompt: 5, completion: 10, cache: 1 },
    'gpt-5.4': { prompt: 50, completion: 100, cache: 10 },
  };

  it('prefers resolved upstream model when present', () => {
    const cost = calculateCost(
      {
        tokens: { input_tokens: 1_000_000, output_tokens: 0 },
        __modelName: 'gpt-5.4',
        __resolvedModel: 'gpt-5.5',
      },
      prices
    );
    // gpt-5.5 prompt rate is 5 / 1M tokens => 5
    expect(cost).toBeCloseTo(5);
  });

  it('falls back to requested alias when resolved is absent', () => {
    const cost = calculateCost(
      {
        tokens: { input_tokens: 1_000_000, output_tokens: 0 },
        __modelName: 'gpt-5.4',
      },
      prices
    );
    expect(cost).toBeCloseTo(50);
  });

  it('falls back to requested alias when resolved has no price entry', () => {
    const cost = calculateCost(
      {
        tokens: { input_tokens: 1_000_000, output_tokens: 0 },
        __modelName: 'gpt-5.4',
        __resolvedModel: 'unknown-upstream',
      },
      prices
    );
    expect(cost).toBeCloseTo(50);
  });
});

describe('model price index fallback matching', () => {
  const prices = {
    'gpt-4o-2024-08-06': { prompt: 2.5, completion: 10, cache: 0.25 },
    'anthropic/claude-3.5-sonnet': { prompt: 3, completion: 15, cache: 0.3 },
    'openrouter/anthropic/claude-3.5-sonnet': { prompt: 3.1, completion: 15.1, cache: 0.31 },
    'gemini/gemini-2.5-flash': { prompt: 0.075, completion: 0.3, cache: 0.01 },
    'claude-sonnet-4-5-20250929': { prompt: 3.2, completion: 16, cache: 0.32 },
  };

  it('returns exact match before any fallback', () => {
    const index = buildModelPriceIndex(prices);
    expect(lookupModelPrice(index, 'gpt-4o-2024-08-06')?.prompt).toBe(2.5);
  });

  it('matches case-insensitively', () => {
    const index = buildModelPriceIndex(prices);
    expect(lookupModelPrice(index, 'GEMINI/Gemini-2.5-Flash')?.prompt).toBe(0.075);
  });

  it('matches by basename and prefers shortest prefix', () => {
    const index = buildModelPriceIndex(prices);
    // 'claude-3.5-sonnet' should resolve to anthropic/* (shorter) over openrouter/*.
    expect(lookupModelPrice(index, 'claude-3.5-sonnet')?.prompt).toBe(3);
  });

  it('strips dated version suffixes when looking up', () => {
    const index = buildModelPriceIndex(prices);
    expect(lookupModelPrice(index, 'claude-sonnet-4-5')?.prompt).toBe(3.2);
  });

  it('returns undefined for unknown models', () => {
    const index = buildModelPriceIndex(prices);
    expect(lookupModelPrice(index, 'nonexistent-model')).toBeUndefined();
  });

  it('calculateCost uses fallback matching for free-form model names', () => {
    const cost = calculateCost(
      {
        tokens: { input_tokens: 1_000_000, output_tokens: 0 },
        __modelName: 'claude-sonnet-4-5-20250929',
        __resolvedModel: 'claude-sonnet-4-5-20250929',
      },
      prices
    );
    expect(cost).toBeCloseTo(3.2);
  });

  it('calculateCost accepts a prebuilt ModelPriceIndex', () => {
    const index = buildModelPriceIndex(prices);
    const cost = calculateCost(
      {
        tokens: { input_tokens: 1_000_000, output_tokens: 0 },
        __modelName: 'CLAUDE-3.5-Sonnet',
      },
      index
    );
    expect(cost).toBeCloseTo(3);
  });
});
