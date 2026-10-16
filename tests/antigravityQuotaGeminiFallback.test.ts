import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { TFunction } from 'i18next';
import { ANTIGRAVITY_CONFIG } from '@/features/quota/providers/antigravity/data';
import { apiCallApi, antigravitySubscriptionApi } from '@/services/api';
import type { AuthFileItem } from '@/types';

const t = ((key: string) => key) as TFunction;

const mockFile: AuthFileItem = {
  name: 'antigravity-test.json',
  auth_index: 'idx-1234',
  project_id: 'aicode-consumers',
  type: 'antigravity',
  disabled: false,
};

const mocks: Array<{ mockRestore(): void }> = [];

afterEach(() => {
  for (const m of mocks.splice(0)) m.mockRestore();
});

describe('Antigravity quota Gemini fallback', () => {
  test('keeps existing Gemini group when upstream includes both Gemini and 3P models', async () => {
    const subSpy = spyOn(antigravitySubscriptionApi, 'get').mockResolvedValue(null);
    mocks.push(subSpy);

    const quotaResponse = {
      groups: [
        {
          displayName: 'Gemini Models',
          buckets: [
            {
              bucketId: 'gemini-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0.95,
              resetTime: '2026-10-23T02:00:00Z',
            },
          ],
        },
        {
          displayName: 'Claude and GPT models',
          buckets: [
            {
              bucketId: '3p-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0.8,
              resetTime: '2026-10-21T03:00:00Z',
            },
          ],
        },
      ],
    };

    let fetchModelsCalled = false;
    const reqSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
      if (req.url.includes(':fetchAvailableModels')) {
        fetchModelsCalled = true;
      }
      return {
        statusCode: 200,
        body: quotaResponse,
        bodyText: JSON.stringify(quotaResponse),
        header: {},
      };
    });
    mocks.push(reqSpy);

    const result = await ANTIGRAVITY_CONFIG.fetchQuota(mockFile, t);

    expect(fetchModelsCalled).toBeFalse();
    expect(result.groups.length).toBe(2);
    expect(result.groups.some((g) => g.label === 'Gemini Models')).toBeTrue();
    expect(result.groups.some((g) => g.label === 'Claude and GPT models')).toBeTrue();
  });

  test('replenishes Gemini models group from fetchAvailableModels when upstream omits Gemini group', async () => {
    const subSpy = spyOn(antigravitySubscriptionApi, 'get').mockResolvedValue(null);
    mocks.push(subSpy);

    const quotaResponseOnly3P = {
      groups: [
        {
          displayName: 'Claude and GPT models',
          buckets: [
            {
              bucketId: '3p-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0.83,
              resetTime: '2026-10-21T03:00:00Z',
            },
          ],
        },
      ],
    };

    const modelsResponse = {
      models: {
        'gemini-3.8-flash-high': {
          quotaInfo: {
            remainingFraction: 0.89,
            resetTime: '2026-10-16T07:10:00Z',
          },
        },
      },
    };

    const reqSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
      if (req.url.includes(':fetchAvailableModels')) {
        return {
          statusCode: 200,
          body: modelsResponse,
          bodyText: JSON.stringify(modelsResponse),
          header: {},
        };
      }
      return {
        statusCode: 200,
        body: quotaResponseOnly3P,
        bodyText: JSON.stringify(quotaResponseOnly3P),
        header: {},
      };
    });
    mocks.push(reqSpy);

    const result = await ANTIGRAVITY_CONFIG.fetchQuota(mockFile, t);

    expect(result.groups.length).toBe(2);
    const geminiGroup = result.groups.find((g) => /gemini/i.test(g.label));
    expect(geminiGroup).toBeDefined();
    expect(geminiGroup?.buckets[0].remainingFraction).toBe(0.89);
    expect(geminiGroup?.buckets[0].window).toBe('5h');
  });

  test('does not fail if fetchAvailableModels fails when Gemini group is missing', async () => {
    const subSpy = spyOn(antigravitySubscriptionApi, 'get').mockResolvedValue(null);
    mocks.push(subSpy);

    const quotaResponseOnly3P = {
      groups: [
        {
          displayName: 'Claude and GPT models',
          buckets: [
            {
              bucketId: '3p-weekly',
              displayName: 'Weekly Limit Remaining',
              window: 'weekly',
              remainingFraction: 0.83,
            },
          ],
        },
      ],
    };

    const reqSpy = spyOn(apiCallApi, 'request').mockImplementation(async (req) => {
      if (req.url.includes(':fetchAvailableModels')) {
        return {
          statusCode: 500,
          body: { error: 'Internal Error' },
          bodyText: '{"error": "Internal Error"}',
          header: {},
        };
      }
      return {
        statusCode: 200,
        body: quotaResponseOnly3P,
        bodyText: JSON.stringify(quotaResponseOnly3P),
        header: {},
      };
    });
    mocks.push(reqSpy);

    const result = await ANTIGRAVITY_CONFIG.fetchQuota(mockFile, t);

    // Still returns the 3P group without crashing
    expect(result.groups.length).toBe(1);
    expect(result.groups[0].label).toBe('Claude and GPT models');
  });
});
