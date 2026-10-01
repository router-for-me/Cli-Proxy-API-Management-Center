import { describe, expect, test } from 'bun:test';
import axios from 'axios';
import { demoFiles, installDemoTransport } from './claude-reset-mocks';

describe('original-app demo transport', () => {
  test('lists only synthetic accounts and rejects unimplemented requests', async () => {
    const client = axios.create({ adapter: installDemoTransport() });
    expect((await client.get('/credentials')).data.files).toEqual(demoFiles);
    await expect(client.get('https://example.invalid/real-api')).rejects.toThrow('blocked');
    await expect(client.delete('/credentials')).rejects.toThrow('blocked');
  });

  test('unknown outcome requires the same request identity; refresh reflects a single spend', async () => {
    const client = axios.create({ adapter: installDemoTransport() });
    const call = async (path: string, data?: string) =>
      (
        await client.post('/requests/api-call', {
          authIndex: 'demo-ambiguous',
          method: data ? 'POST' : 'GET',
          url: `https://api.anthropic.com${path}`,
          data,
        })
      ).data.body;
    const path = '/api/organizations/00000000-0000-4000-8000-000000000001/reset_rate_limits';
    const claim = JSON.stringify({ grant_id: 'demo_grant', request_id: 'same-request' });
    await expect(call(path, claim)).rejects.toThrow('unknown outcome');
    await expect(
      call(path, JSON.stringify({ grant_id: 'demo_grant', request_id: 'different' }))
    ).rejects.toThrow('identity changed');
    expect(await call(path, claim)).toEqual({ result: 'reset' });
    expect(await call(path, claim)).toEqual({ result: 'already_used' });
    const usage = await call('/api/oauth/usage');
    expect(usage.five_hour.utilization).toBe(0);
    expect(usage.cedar_ember.grants[0].resets_left).toBe(1);
  });
});
