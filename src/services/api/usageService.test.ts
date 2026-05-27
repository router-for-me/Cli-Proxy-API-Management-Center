import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { getUsageServiceErrorCode, usageServiceApi } from './usageService';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    isAxiosError: vi.fn(() => false),
  },
}));

const mockedAxios = vi.mocked(axios);

beforeEach(() => {
  vi.clearAllMocks();
  mockedAxios.isAxiosError.mockReturnValue(false);
});

describe('usageServiceApi usage pages', () => {
  it('requests independent endpoints for each paginated monitoring section', async () => {
    mockedAxios.get.mockResolvedValue({
      data: { page: 2, page_size: 12, total_items: 24, usage: { apis: {} } },
    });

    await usageServiceApi.getUsagePage(
      'https://manage.example',
      'management-key',
      'accounts',
      { startMs: 1000, endMs: 2000, search: 'codex' },
      { page: 2, pageSize: 12, sortKey: 'lastSeenAt', sortDirection: 'desc' }
    );
    await usageServiceApi.getUsagePage(
      'https://manage.example',
      'management-key',
      'api-keys',
      { startMs: 1000, endMs: 2000 },
      { page: 1, pageSize: 20 }
    );
    await usageServiceApi.getUsagePage(
      'https://manage.example',
      'management-key',
      'realtime',
      { status: 'failed' },
      { page: 3, pageSize: 50 }
    );

    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://manage.example/v0/management/usage/accounts?start_ms=1000&end_ms=2000&search=codex&page=2&page_size=12&sort_key=lastSeenAt&sort_direction=desc',
      expect.objectContaining({
        headers: { Authorization: 'Bearer management-key' },
      })
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://manage.example/v0/management/usage/api-keys?start_ms=1000&end_ms=2000&page=1&page_size=20',
      expect.any(Object)
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      3,
      'https://manage.example/v0/management/usage/realtime?status=failed&page=3&page_size=50',
      expect.any(Object)
    );
  });

  it('falls back to legacy usage payload when summary is missing on old backends', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get
      .mockRejectedValueOnce({ response: { status: 404, data: { error: 'not found' } } })
      .mockResolvedValueOnce({ data: { total_requests: 2, apis: {} } });

    const payload = await usageServiceApi.getUsage('https://manage.example', 'management-key', {
      startMs: 1000,
      endMs: 2000,
      search: 'codex',
    });

    expect(payload.total_requests).toBe(2);
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      1,
      'https://manage.example/v0/management/usage/summary?start_ms=1000&end_ms=2000&search=codex',
      expect.any(Object)
    );
    expect(mockedAxios.get).toHaveBeenNthCalledWith(
      2,
      'https://manage.example/v0/management/usage',
      expect.objectContaining({
        headers: { Authorization: 'Bearer management-key' },
      })
    );
  });

  it('does not fall back to legacy usage when summary fails for a non-compatibility error', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValueOnce({
      response: { status: 500, data: { error: 'database unavailable' } },
    });

    await expect(
      usageServiceApi.getUsage('https://manage.example', 'management-key')
    ).rejects.toMatchObject({
      status: 500,
    });

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to legacy usage when summary fails before receiving a response', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValueOnce({ code: 'ECONNABORTED', message: 'timeout' });

    await expect(
      usageServiceApi.getUsage('https://manage.example', 'management-key')
    ).rejects.toMatchObject({
      code: 'ECONNABORTED',
    });

    expect(mockedAxios.get).toHaveBeenCalledTimes(1);
  });

  it('preserves 404 status from missing paginated APIs so callers can use legacy fallback', async () => {
    mockedAxios.isAxiosError.mockReturnValue(true);
    mockedAxios.get.mockRejectedValueOnce({
      response: { status: 404, data: { error: 'not found' } },
    });

    await expect(
      usageServiceApi.getUsagePage(
        'https://manage.example',
        'management-key',
        'accounts',
        { startMs: 1000 },
        { page: 1, pageSize: 12 }
      )
    ).rejects.toMatchObject({
      status: 404,
    });
  });
});

describe('getUsageServiceErrorCode', () => {
  it('maps old-backend method-not-allowed page responses for fallback detection', () => {
    mockedAxios.isAxiosError.mockReturnValue(true);

    expect(getUsageServiceErrorCode({ response: { status: 405 } })).toBe('method_not_allowed');
  });
});
