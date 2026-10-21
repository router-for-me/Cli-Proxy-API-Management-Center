import { describe, expect, test } from 'bun:test';
import type { AuthFileItem } from '@/types';
import type { ApiCallRequest } from '@/services/api';
import {
  greetingTargets,
  pickGreetingModel,
  sendGreeting,
  type GreetingDependencies,
} from '@/features/quota/usageWindowTrigger';

const file = (name: string, type: 'claude' | 'codex', extras: Partial<AuthFileItem> = {}) => ({
  name,
  type,
  email: 'user@example.com',
  authIndex: '0123456789abcdef',
  ...extras,
});

describe('usage-window greeting trigger', () => {
  test('targets every active OAuth account independently of the visible quota page', () => {
    const candidates = [
      file('claude-one.json', 'claude'),
      file('codex-one.json', 'codex'),
      file('claude-disabled.json', 'claude', { disabled: true }),
      file('codex-runtime.json', 'codex', { runtimeOnly: true }),
      file('codex-siwc.json', 'codex', { useSiwc: true }),
      file('claude-api-key.json', 'claude', { email: undefined }),
    ];
    expect(greetingTargets(candidates).map(({ file: item }) => item.name)).toEqual([
      'claude-one.json',
      'codex-one.json',
    ]);
  });

  test('selects an available small model, with a same-family fallback', () => {
    expect(
      pickGreetingModel('claude', [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-5-5' }])
    ).toBe('claude-haiku-5-5');
    expect(pickGreetingModel('codex', [{ id: 'gpt-7-luna' }])).toBe('gpt-7-luna');
    expect(pickGreetingModel('codex', [{ id: 'gpt-image-2' }])).toBeNull();
  });

  test('uses the selected Claude credential for one short message without resetting quota', async () => {
    let sent: ApiCallRequest | undefined;
    const dependencies: GreetingDependencies = {
      getModels: async () => [{ id: 'claude-haiku-4-5-20251001' }],
      request: async (payload) => {
        sent = payload;
        return { statusCode: 200, header: {}, bodyText: '', body: { type: 'message' } };
      },
    };
    const result = await sendGreeting(
      { file: file('claude-one.json', 'claude'), provider: 'claude' },
      undefined,
      dependencies
    );
    expect(result.success).toBe(true);
    expect(sent?.authIndex).toBe('0123456789abcdef');
    expect(sent?.url).toBe('https://api.anthropic.com/v1/messages?beta=true');
    expect(sent?.header?.Authorization).toBe('Bearer $TOKEN$');
    expect(JSON.parse(sent?.data ?? '{}')).toEqual({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'selam' }],
    });
    expect(sent?.url).not.toContain('reset');
  });

  test('requires a completed Codex response, rather than treating HTTP 200 as success', async () => {
    let sent: ApiCallRequest | undefined;
    let bodyText = 'data: {"type":"response.failed"}\n\n';
    const dependencies: GreetingDependencies = {
      getModels: async () => [{ id: 'gpt-6-luna' }],
      request: async (payload) => {
        sent = payload;
        return { statusCode: 200, header: {}, bodyText, body: bodyText };
      },
    };
    const target = {
      file: file('codex-one.json', 'codex', { chatgpt_account_id: 'account-one' }),
      provider: 'codex' as const,
    };
    expect((await sendGreeting(target, undefined, dependencies)).success).toBe(false);
    bodyText = 'event: response.completed\ndata: {"type":"response.completed"}\n\n';
    expect((await sendGreeting(target, undefined, dependencies)).success).toBe(true);
    expect(sent?.authIndex).toBe('0123456789abcdef');
    expect(sent?.header?.['ChatGPT-Account-ID']).toBe('account-one');
    expect(JSON.parse(sent?.data ?? '{}').input[0].content[0].text).toBe('selam');
  });

  test('does not send a request when the account has no usable model', async () => {
    let calls = 0;
    const dependencies: GreetingDependencies = {
      getModels: async () => [{ id: 'claude-opus-5-5' }],
      request: async () => {
        calls += 1;
        return { statusCode: 200, header: {}, bodyText: '', body: { type: 'message' } };
      },
    };
    const result = await sendGreeting(
      { file: file('claude-one.json', 'claude'), provider: 'claude' },
      undefined,
      dependencies
    );
    expect(result.success).toBe(false);
    expect(calls).toBe(0);
  });

  test('checks the management connection again after model lookup', async () => {
    let calls = 0;
    const dependencies: GreetingDependencies = {
      getModels: async () => [{ id: 'claude-haiku-4-5-20251001' }],
      request: async () => {
        calls += 1;
        return { statusCode: 200, header: {}, bodyText: '', body: { type: 'message' } };
      },
    };
    await expect(
      sendGreeting(
        { file: file('claude-one.json', 'claude'), provider: 'claude' },
        undefined,
        dependencies,
        () => {
          throw new DOMException('The management connection changed.', 'AbortError');
        }
      )
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(calls).toBe(0);
  });
});
