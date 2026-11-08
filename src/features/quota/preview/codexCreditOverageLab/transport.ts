import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { buildFiles, findScenario, type Reply, type Scenario } from './scenarios';

export const MOCK_KEY = 'MOCK_ONLY_NOT_A_REAL_KEY';
export const MOCK_A = 'https://cpa-a.mock.invalid';
export const MOCK_B = 'https://cpa-b.mock.invalid';
const FEATURE = 'can_consume_personal_credits_chatpass';
export interface Trace {
  id: number;
  path: string;
  backend: string;
  method: string;
  upstreamMethod?: string;
  authIndex?: string;
  accountId?: string;
  value?: boolean;
  url?: string;
  valid?: boolean;
  result: string;
}
export class MockTransport {
  scenario: Scenario = findScenario(null);
  files = buildFiles(this.scenario);
  traces: Trace[] = [];
  serverValues: Record<string, boolean> = {};
  private sequence = 0;
  private pending = new Map<number, (reply: Reply) => void>();
  private lateWrites = new Map<number, () => void>();
  private listeners = new Set<() => void>();
  get pendingCount() {
    return this.pending.size;
  }
  get lateCount() {
    return this.lateWrites.size;
  }
  configure(scenario: Scenario) {
    this.scenario = scenario;
    this.files = buildFiles(scenario);
    this.traces = [];
    this.sequence = 0;
    this.serverValues = {};
    for (const backend of ['A', 'B']) {
      for (const file of this.files) {
        const account =
          file.chatgpt_account_id ??
          (file.id_token as { chatgpt_account_id?: string } | undefined)?.chatgpt_account_id;
        const owner = file.email?.trim().toLowerCase() || 'review@example.invalid';
        if (account)
          this.serverValues[`${backend} / ${account} / ${owner}`] = [
            'allowed',
            'yesterday',
          ].includes(scenario.initial ?? '');
      }
    }
  }
  subscribe(callback: () => void) {
    this.listeners.add(callback);
    return () => {
      this.listeners.delete(callback);
    };
  }
  private emit() {
    this.listeners.forEach((callback) => callback());
  }
  release(reply: Reply) {
    [...this.pending.values()].forEach((finish) => finish(reply));
  }
  applyLate() {
    [...this.lateWrites.values()].forEach((apply) => apply());
    this.lateWrites.clear();
    this.emit();
  }
  adapter: AxiosAdapter = async (config) => {
    const base = config.baseURL ?? '';
    if (![MOCK_A, MOCK_B].some((origin) => base === `${origin}/v8/management`)) {
      throw new AxiosError('Mock refuses every non-fixture destination', 'ERR_NETWORK', config);
    }
    const path = config.url ?? '';
    const trace: Trace = {
      id: this.traces.length + 1,
      path,
      backend: base,
      method: String(config.method).toUpperCase(),
      result: '读取中',
    };
    this.traces.push(trace);
    const response = (data: unknown): AxiosResponse => ({
      status: 200,
      statusText: 'OK',
      config,
      headers: {
        'x-cpa-version': base.includes('cpa-a') ? 'mock-a' : 'mock-b',
        'x-cpa-support-plugin': 'false',
      },
      data,
    });
    if (path === '/config') {
      trace.result = '模拟配置 200';
      this.emit();
      return response({});
    }
    if (path !== '/requests/api-call') {
      trace.result = '拒绝未知路由';
      this.emit();
      throw new AxiosError('Unknown mock management route', 'ERR_BAD_REQUEST', config, undefined, {
        ...response({ error: 'mock route not found' }),
        status: 404,
      });
    }
    const payload = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
    trace.upstreamMethod = payload.method;
    trace.url = payload.url;
    trace.authIndex = String(payload.authIndex ?? '');
    const credential = this.files.find(
      (file) => String(file.auth_index ?? file.authIndex ?? '') === trace.authIndex
    );
    trace.accountId = payload.header?.['Chatgpt-Account-Id'];
    if (payload.method !== 'PATCH') {
      let body: unknown;
      if (String(payload.url).includes('account_user_setting')) {
        trace.result = 'GET 405（客户端不应探测）';
        this.emit();
        return response({ status_code: 405, body: '{}' });
      }
      if (String(payload.url).includes('/wham/usage')) {
        body = {
          plan_type: 'pro',
          credits:
            this.scenario.credits === 'missing'
              ? undefined
              : {
                  balance: this.scenario.credits === 'zero' ? '0' : '1250',
                  unlimited: this.scenario.credits === 'unlimited',
                },
          rate_limit: {
            primary_window: {
              used_percent: 15,
              limit_window_seconds: 18000,
              reset_after_seconds: 7200,
            },
            secondary_window: {
              used_percent: 35,
              limit_window_seconds: 604800,
              reset_after_seconds: 86400,
            },
          },
        };
      } else if (String(payload.url).includes('/subscriptions'))
        body = { active_until: new Date(Date.now() + 20 * 86400000).toISOString() };
      else if (String(payload.url).includes('rate-limit-reset-credits'))
        body = { credits: [], available_count: 0 };
      else throw new AxiosError('Unknown mock upstream read', 'ERR_NETWORK', config);
      trace.result = '读取 200（未写入）';
      this.emit();
      return response({ status_code: 200, body: JSON.stringify(body) });
    }
    const target = new URL(payload.url);
    const expectedAccount =
      credential?.chatgpt_account_id ??
      (credential?.id_token as { chatgpt_account_id?: string } | undefined)?.chatgpt_account_id;
    const value = target.searchParams.get('value') === 'true';
    trace.value = value;
    trace.valid = Boolean(
      credential &&
      target.origin === 'https://chatgpt.com' &&
      target.pathname === '/backend-api/settings/account_user_setting' &&
      target.searchParams.get('feature') === FEATURE &&
      ['true', 'false'].includes(target.searchParams.get('value') ?? '') &&
      payload.header?.Authorization === 'Bearer $TOKEN$' &&
      trace.accountId === expectedAccount &&
      !('data' in payload) &&
      config.headers.Authorization === `Bearer ${MOCK_KEY}`
    );
    const account = trace.accountId ?? 'missing';
    const owner = credential?.email?.trim().toLowerCase() || 'review@example.invalid';
    const serverKey = `${base.includes('cpa-a') ? 'A' : 'B'} / ${account} / ${owner}`;
    const apply = () => {
      this.serverValues[serverKey] = value;
      this.emit();
    };
    const answer = (reply: Reply): AxiosResponse => {
      if (reply.kind === 'timeout') {
        this.lateWrites.set(trace.id, apply);
        trace.result = '客户端超时；模拟上游仍可延迟生效';
        this.emit();
        throw new AxiosError(`timeout of ${config.timeout}ms exceeded`, 'ECONNABORTED', config);
      }
      if (reply.kind === 'network') {
        trace.result = '连接中断，结果未知';
        this.emit();
        throw new AxiosError('Mock network disconnected', 'ERR_NETWORK', config);
      }
      if (reply.kind === 'management') {
        trace.result = `CPA 外层 ${reply.status}`;
        this.emit();
        throw new AxiosError(
          `Mock management ${reply.status}`,
          'ERR_BAD_RESPONSE',
          config,
          undefined,
          { ...response({ error: `Mock management ${reply.status}` }), status: reply.status }
        );
      }
      if (reply.kind === 'upstream') {
        trace.result = `ChatGPT 上游 ${reply.status}`;
        this.emit();
        return response({
          status_code: reply.status,
          body: JSON.stringify({ error: { message: `Mock ChatGPT ${reply.status}` } }),
        });
      }
      apply();
      trace.result = reply.kind === 'success' ? `200 确认 ${value}` : `异常响应 ${reply.kind}`;
      this.emit();
      if (reply.kind === 'missing-status') return response({ body: '{}' });
      if (reply.kind === 'empty') return response({ status_code: 204, body: '' });
      if (reply.kind === 'invalid') return response({ status_code: 200, body: '{not-json' });
      const bodyValue =
        reply.kind === 'mismatch' ? !value : reply.kind === 'string' ? String(value) : value;
      return response({ status_code: 200, body: JSON.stringify({ [FEATURE]: bodyValue }) });
    };
    const reply =
      this.scenario.replies[Math.min(this.sequence++, this.scenario.replies.length - 1)];
    if (reply.kind === 'hold') {
      trace.result = '已挂起，等待控制台放行';
      this.emit();
      return new Promise<AxiosResponse>((resolve, reject) => {
        this.pending.set(trace.id, (next) => {
          this.pending.delete(trace.id);
          try {
            resolve(answer(next));
          } catch (error) {
            reject(error);
          }
          this.emit();
        });
        this.emit();
      });
    }
    return answer(reply);
  };
}
export const mockTransport = new MockTransport();
