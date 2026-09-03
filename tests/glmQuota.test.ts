import { afterEach, describe, expect, test } from 'bun:test';
import { GLM_CONFIG } from '@/features/quota/providers/glm/data';
import { buildTimelineLane } from '@/features/quota/quotaTimelineModel';
import { apiCallApi } from '@/services/api';
import {
  GLM_CODING_QUOTA_URL,
  buildGlmQuotaData,
  isGlmFile,
  parseGlmQuotaPayload,
} from '@/utils/quota';
import type { AuthFileItem } from '@/types';

const originalRequest = apiCallApi.request;
const t = ((key: string) => key) as never;

afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('GLM Coding Plan quota', () => {
  test('recognizes GLM OpenAI-compatible credentials', () => {
    expect(isGlmFile({ name: 'glm', provider: 'openai-compatible-glm' })).toBe(true);
    expect(isGlmFile({ name: 'zai', provider: 'openai-compatible-zai' })).toBe(true);
    expect(isGlmFile({ name: 'other', provider: 'openai-compatible-openrouter' })).toBe(false);
  });

  test('queries the Z.AI monitor endpoint with the selected auth index', async () => {
    let captured: unknown = null;
    apiCallApi.request = (async (request: unknown) => {
      captured = request;
      return {
        statusCode: 200,
        header: {},
        bodyText: '',
        body: {
          code: 200,
          success: true,
          data: {
            planName: 'GLM Coding Pro',
            limits: [
              {
                type: 'CREDIT_LIMIT',
                unit: 3,
                number: 5,
                usage: 1000,
                currentValue: 250,
                nextResetTime: 4_102_444_800_000,
              },
            ],
          },
        },
      };
    }) as typeof apiCallApi.request;

    const file = {
      name: 'openai-compatible-glm-1',
      provider: 'openai-compatible-glm',
      auth_index: 'glm-auth-index',
    } as AuthFileItem;
    const data = await GLM_CONFIG.fetchQuota(file, t);

    expect(captured).toEqual({
      authIndex: 'glm-auth-index',
      method: 'GET',
      url: GLM_CODING_QUOTA_URL,
      header: {
        Authorization: 'Bearer $TOKEN$',
        Accept: 'application/json',
      },
    });
    expect(data.planName).toBe('GLM Coding Pro');
    expect(data.rows[0]).toMatchObject({
      labelKey: 'glm_quota.five_hour_limit',
      used: 250,
      limit: 1000,
      periodHours: 5,
    });
  });

  test('builds ordered 5-hour and weekly windows and exposes them to the timeline', () => {
    const payload = parseGlmQuotaPayload({
      code: 200,
      data: {
        limits: [
          {
            type: 'CREDIT_LIMIT',
            unit: 6,
            number: 1,
            percentage: 40,
            nextResetTime: 4_102_444_800_000,
          },
          {
            type: 'CREDIT_LIMIT',
            unit: 3,
            number: 5,
            percentage: 20,
            nextResetTime: 4_102_012_800_000,
          },
          { type: 'TIME_LIMIT', percentage: 10 },
        ],
      },
    });
    expect(payload).not.toBeNull();

    const data = buildGlmQuotaData(payload!);
    expect(data.rows.map((row) => row.labelKey)).toEqual([
      'glm_quota.five_hour_limit',
      'glm_quota.weekly_limit',
    ]);
    expect(data.rows.map((row) => row.used)).toEqual([20, 40]);

    const lane = buildTimelineLane({
      name: 'glm',
      displayName: 'GLM',
      provider: 'glm',
      quota: { status: 'success', rows: data.rows },
      maxPeriodHours: 5,
    });
    expect(lane.anchorMs).toBe(data.rows[0]?.resetAtMs);
    expect(lane.periodHours).toBe(5);
    expect(lane.remaining).toBe(80);
  });

  test('parses the live GLM Coding Plan credit-limit contract', () => {
    const payload = parseGlmQuotaPayload({
      code: 200,
      success: true,
      data: {
        planName: null,
        limits: [
          {
            type: 'CREDIT_LIMIT',
            unit: 3,
            number: 5,
            usage: 28_000,
            currentValue: 1_530,
            remaining: 26_469,
            percentage: 5,
            nextResetTime: 1_788_434_439_948,
          },
          {
            type: 'CREDIT_LIMIT',
            unit: 6,
            number: 1,
            usage: 140_000,
            currentValue: 15_283,
            remaining: 124_716,
            percentage: 10,
            nextResetTime: 1_788_933_551_979,
          },
        ],
      },
    });

    const data = buildGlmQuotaData(payload!);
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toMatchObject({
      labelKey: 'glm_quota.five_hour_limit',
      used: 1_530,
      limit: 28_000,
      periodHours: 5,
    });
    expect(data.rows[1]).toMatchObject({
      labelKey: 'glm_quota.weekly_limit',
      used: 15_283,
      limit: 140_000,
      periodHours: 168,
    });
  });

  test('surfaces HTTP 200 business errors instead of showing empty quota', async () => {
    apiCallApi.request = (async () => ({
      statusCode: 200,
      header: {},
      bodyText: '',
      body: { code: 401, success: false, msg: 'invalid token' },
    })) as typeof apiCallApi.request;

    const file = {
      name: 'glm',
      provider: 'openai-compatible-glm',
      auth_index: 'glm-auth-index',
    } as AuthFileItem;
    expect(GLM_CONFIG.fetchQuota(file, t)).rejects.toThrow('invalid token');
  });
});
