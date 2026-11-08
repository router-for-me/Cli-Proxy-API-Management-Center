import { describe, expect, test } from 'bun:test';
import { AxiosHeaders, type InternalAxiosRequestConfig } from 'axios';
import {
  MemoryStorage,
  isolateStorage,
} from '@/features/quota/preview/codexCreditOverageLab/isolation';
import {
  MockTransport,
  MOCK_A,
  MOCK_KEY,
} from '@/features/quota/preview/codexCreditOverageLab/transport';
import { findScenario, SCENARIOS } from '@/features/quota/preview/codexCreditOverageLab/scenarios';

const request = (value: boolean): InternalAxiosRequestConfig => ({
  baseURL: `${MOCK_A}/v8/management`,
  url: '/requests/api-call',
  method: 'post',
  timeout: 30000,
  headers: new AxiosHeaders({ Authorization: `Bearer ${MOCK_KEY}` }),
  data: JSON.stringify({
    authIndex: 'mock-a',
    method: 'PATCH',
    url: `https://chatgpt.com/backend-api/settings/account_user_setting?feature=can_consume_personal_credits_chatpass&value=${value}`,
    header: { Authorization: 'Bearer $TOKEN$', 'Chatgpt-Account-Id': 'mock-account-a' },
  }),
});

describe('temporary Codex overage lab isolation', () => {
  test('replaces storage before application imports without reading or mutating original data', () => {
    const original = new MemoryStorage();
    original.setItem('management', 'fixture-sentinel');
    const target = { localStorage: original, sessionStorage: original } as unknown as Window;
    isolateStorage(target);
    expect(target.localStorage.getItem('management')).toBeNull();
    target.localStorage.setItem('management', 'mock-only');
    expect(original.getItem('management')).toBe('fixture-sentinel');
    expect(target.sessionStorage.getItem('management')).toBeNull();
  });

  test('each browser realm has independent nonpersistent storage', () => {
    const a = {} as Window;
    const b = {} as Window;
    isolateStorage(a);
    isolateStorage(b);
    a.localStorage.setItem('state', 'a');
    expect(b.localStorage.getItem('state')).toBeNull();
  });

  test('terminal mock adapter rejects non-fixture destinations instead of forwarding', async () => {
    const transport = new MockTransport();
    await expect(
      transport.adapter({ ...request(true), baseURL: 'https://real.example.invalid' })
    ).rejects.toThrow('non-fixture');
    expect(transport.traces).toHaveLength(0);
  });

  test('models the delayed write that made opposite-value retries dangerous', async () => {
    const transport = new MockTransport();
    transport.configure(findScenario('timeout'));
    await expect(transport.adapter(request(true))).rejects.toThrow('timeout');
    await transport.adapter(request(false));
    const key = 'A / mock-account-a / review@example.invalid';
    expect(transport.serverValues[key]).toBe(false);
    expect(transport.lateCount).toBe(1);
    transport.applyLate();
    expect(transport.serverValues[key]).toBe(true);
    expect(transport.lateCount).toBe(0);
  });

  test('held responses remain controlled and preserve the original destination', async () => {
    const transport = new MockTransport();
    transport.configure(findScenario('hold'));
    const pending = transport.adapter(request(true));
    expect(transport.pendingCount).toBe(1);
    transport.release({ kind: 'management', status: 401 });
    await expect(pending).rejects.toMatchObject({ response: { status: 401 } });
    expect(transport.pendingCount).toBe(0);
    expect(transport.traces[0].backend).toBe(`${MOCK_A}/v8/management`);
  });

  test('shared missing-email fixtures model one upstream user without conflating workspace members', async () => {
    const transport = new MockTransport();
    transport.configure(findScenario('no-email'));
    const first = transport.adapter(request(true));
    transport.release({ kind: 'success' });
    await first;
    const copy = request(false);
    const payload = JSON.parse(copy.data);
    payload.authIndex = 'mock-copy';
    copy.data = JSON.stringify(payload);
    const next = transport.adapter(copy);
    transport.release({ kind: 'success' });
    await next;
    expect(transport.serverValues['A / mock-account-a / review@example.invalid']).toBe(false);
    transport.configure(findScenario('workspace'));
    expect(Object.keys(transport.serverValues)).toContain(
      'A / mock-account-a / workspace-member@example.invalid'
    );
  });

  test('every selectable scenario is reproducible and unknown query strings fall back safely', () => {
    expect(new Set(SCENARIOS.map((scene) => scene.id)).size).toBe(SCENARIOS.length);
    expect(SCENARIOS.length).toBeGreaterThanOrEqual(55);
    for (const scene of SCENARIOS) {
      expect(scene.expected.length).toBeGreaterThan(0);
      expect(scene.steps.length).toBeGreaterThan(0);
      expect(scene.replies.length).toBeGreaterThan(0);
    }
    expect(findScenario('untrusted-missing-scenario')).toBe(SCENARIOS[0]);
  });
});
