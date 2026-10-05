import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import type { TFunction } from 'i18next';
import type { AxiosRequestConfig } from 'axios';
import type { AuthFileItem } from '@/types';
import {
  consumeCodexRateLimitResetCredit,
  fetchCodexQuota,
} from '@/features/quota/providers/codex/data';
import {
  buildCodexResetConsumeIntent,
  createCodexResetRequestId,
  getCodexResetAccountId,
} from '@/features/quota/providers/codex/resetContract';
import { apiClient, RequestNotSentError } from '@/services/api/client';
import { apiCallApi, type ApiCallResult } from '@/services/api/apiCall';
import { authFilesApi } from '@/services/api/authFiles';
import {
  CODEX_RATE_LIMIT_RESET_CREDITS_URL,
  CODEX_SUBSCRIPTION_URL,
  CODEX_USAGE_URL,
  extractCodexChatgptAccountId,
  resolveCodexChatgptAccountId,
} from '@/utils/quota';

const t = ((key: string) => key) as TFunction;
const file: AuthFileItem = {
  name: 'fixture.json',
  type: 'codex',
  auth_index: 'fixture-index',
  chatgpt_account_id: 'fixture-account',
};
const requestId = 'f723a947-93fb-4eaa-af0f-44c5fc17a784';
const intent = buildCodexResetConsumeIntent(file, t, requestId);
const originalRequest = apiCallApi.request;
const result = (body: unknown, statusCode = 200): ApiCallResult => ({
  body,
  bodyText: JSON.stringify(body),
  statusCode,
  header: {},
});

afterEach(() => {
  apiCallApi.request = originalRequest;
});

describe('Codex reset consume classification', () => {
  test('generates request IDs when randomUUID is absent on an HTTP panel', () => {
    const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) },
    });
    try {
      expect(createCodexResetRequestId()).toBe('abababab-abab-4bab-abab-abababababab');
    } finally {
      if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor);
    }
  });

  test.each(['reset', 'already_redeemed'] as const)(
    '%s confirms success with zero windows',
    async (code) => {
      apiCallApi.request = async () => result({ code, windows_reset: 0 });
      expect(await consumeCodexRateLimitResetCredit(intent, 7)).toEqual({
        outcome: 'success',
        code,
      });
    }
  );

  test.each(['no_credit', 'nothing_to_reset'] as const)(
    '%s terminates the operation',
    async (code) => {
      apiCallApi.request = async () => result({ code });
      expect(await consumeCodexRateLimitResetCredit(intent, 7)).toEqual({
        outcome: 'terminal',
        code,
      });
    }
  );

  test.each([null, {}, [], 'not-json', { code: 'new_code' }, { windows_reset: 1 }])(
    'unrecognized body stays unknown: %j',
    async (body) => {
      apiCallApi.request = async () => result(body);
      expect(await consumeCodexRateLimitResetCredit(intent, 7)).toHaveProperty(
        'outcome',
        'unknown'
      );
    }
  );

  test.each([0, 200.5, 401, 429, 500, Number.NaN])(
    'non-success or malformed HTTP status %s stays unknown',
    async (status) => {
      apiCallApi.request = async () => result({ code: 'reset' }, status);
      expect(await consumeCodexRateLimitResetCredit(intent, 7)).toHaveProperty(
        'outcome',
        'unknown'
      );
    }
  );

  test('sent transport failure stays unknown while a local rejection remains distinguishable', async () => {
    apiCallApi.request = async () => {
      throw new Error('network disconnected');
    };
    expect(await consumeCodexRateLimitResetCredit(intent, 7)).toEqual({
      outcome: 'unknown',
      message: 'network disconnected',
    });
    const local = new RequestNotSentError();
    apiCallApi.request = async () => {
      throw local;
    };
    await expect(consumeCodexRateLimitResetCredit(intent, 7)).rejects.toBe(local);
  });

  test('sends the complete frozen original intent with the caller-supplied ID', async () => {
    const editableFile = { ...file };
    const frozenIntent = buildCodexResetConsumeIntent(editableFile, t, requestId);
    editableFile.chatgpt_account_id = 'replacement-account';
    let payload: unknown;
    let requestConfig: AxiosRequestConfig | undefined;
    apiCallApi.request = async (value, config) => {
      payload = value;
      requestConfig = config;
      return result({ code: 'reset' });
    };
    await consumeCodexRateLimitResetCredit(frozenIntent, 12);
    expect(payload).toBe(frozenIntent);
    expect(frozenIntent.header['Chatgpt-Account-Id']).toBe('fixture-account');
    expect(frozenIntent.header.Authorization).toBe('Bearer $TOKEN$');
    expect(JSON.parse(frozenIntent.data)).toEqual({ redeem_request_id: requestId });
    expect(Object.isFrozen(frozenIntent)).toBe(true);
    expect(Object.isFrozen(frozenIntent.header)).toBe(true);
    expect(requestConfig?.expectedConnectionRevision).toBe(12);
  });

  test('strict account identity refuses email and numeric fallback before consume', () => {
    expect(
      getCodexResetAccountId({ name: 'email.json', email: 'fixture@example.test' })
    ).toBeNull();
    expect(getCodexResetAccountId({ name: 'numeric.json', chatgpt_account_id: 123 })).toBeNull();
    expect(() =>
      buildCodexResetConsumeIntent(
        { name: 'email.json', auth_index: 'idx', email: 'fixture@example.test' },
        t,
        requestId
      )
    ).toThrow(RequestNotSentError);
    expect(
      getCodexResetAccountId({
        name: 'metadata.json',
        metadata: { chatgpt_account_id: ' account-2 ' },
      })
    ).toBe('account-2');
  });
});

describe('shared Codex account identity resolution', () => {
  test('reads the same string identity from direct, metadata, attribute, and token sources', () => {
    const sources: Array<Partial<AuthFileItem>> = [
      { chatgpt_account_id: ' account-2 ' },
      { chatgptAccountId: ' account-2 ' },
      { metadata: { chatgpt_account_id: ' account-2 ' } },
      { metadata: { chatgptAccountId: ' account-2 ' } },
      { attributes: { chatgpt_account_id: ' account-2 ' } },
      { attributes: { chatgptAccountId: ' account-2 ' } },
      { id_token: { chatgpt_account_id: ' account-2 ' } },
      { metadata: { id_token: JSON.stringify({ chatgptAccountId: ' account-2 ' }) } },
      { attributes: { id_token: { chatgpt_account_id: ' account-2 ' } } },
    ];
    for (const source of sources) {
      const credential = { name: 'identity.json', ...source };
      expect(resolveCodexChatgptAccountId(credential)).toBe('account-2');
      expect(getCodexResetAccountId(credential)).toBe('account-2');
    }
  });

  test('preserves source precedence when credential identity fields disagree', () => {
    const credential: AuthFileItem = {
      name: 'identity.json',
      chatgpt_account_id: 'direct-account',
      metadata: {
        chatgptAccountId: 'metadata-account',
        id_token: { chatgpt_account_id: 'metadata-token' },
      },
      attributes: { chatgpt_account_id: 'attribute-account' },
      id_token: { chatgpt_account_id: 'file-token' },
    };
    for (const expected of [
      'direct-account',
      'metadata-account',
      'attribute-account',
      'file-token',
    ]) {
      expect(resolveCodexChatgptAccountId(credential)).toBe(expected);
      expect(getCodexResetAccountId(credential)).toBe(expected);
      if (expected === 'direct-account') delete credential.chatgpt_account_id;
      else if (expected === 'metadata-account') credential.metadata = {};
      else if (expected === 'attribute-account') credential.attributes = {};
    }
  });

  test('strict extraction changes numeric acceptance without changing token field selection', () => {
    const numericToken = { chatgpt_account_id: 123 };
    expect(extractCodexChatgptAccountId(numericToken)).toBe('123');
    expect(extractCodexChatgptAccountId(numericToken, { stringsOnly: true })).toBeNull();
    const ambiguousToken = { chatgpt_account_id: '', chatgptAccountId: 'alternate-account' };
    expect(extractCodexChatgptAccountId(ambiguousToken)).toBeNull();
    expect(extractCodexChatgptAccountId(ambiguousToken, { stringsOnly: true })).toBeNull();
    const credential = {
      name: 'identity.json',
      chatgpt_account_id: 123,
      metadata: { chatgpt_account_id: 'string-account' },
    };
    expect(resolveCodexChatgptAccountId(credential)).toBe('123');
    expect(getCodexResetAccountId(credential)).toBe('string-account');
  });

  test('ordinary quota reads keep numeric account IDs while resets reject them', async () => {
    const credential = { name: 'numeric.json', auth_index: 'idx', chatgpt_account_id: 123 };
    const accountHeaders: Array<string | undefined> = [];
    apiCallApi.request = async (payload) => {
      accountHeaders.push(payload.header?.['Chatgpt-Account-Id']);
      if (payload.url === CODEX_USAGE_URL) return result({ rate_limit: {} });
      if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL)
        return result({ available_count: 0, credits: [] });
      expect(payload.url).toBe(`${CODEX_SUBSCRIPTION_URL}?account_id=123`);
      return result({});
    };
    await fetchCodexQuota(credential, t);
    expect(accountHeaders).toEqual(['123', '123', '123']);
    expect(() => buildCodexResetConsumeIntent(credential, t, requestId)).toThrow(
      RequestNotSentError
    );
  });
});

describe('Codex reset guard propagation', () => {
  test('credential lookup and cooldown retain the expected connection revision', async () => {
    const get = spyOn(apiClient, 'get').mockResolvedValue({ files: [] });
    const post = spyOn(apiClient, 'post').mockResolvedValue({
      status: 'ok',
      auth_index: 'idx',
      models: [],
    });
    try {
      await authFilesApi.list(
        { name: 'fixture.json', authIndex: 'idx' },
        { expectedConnectionRevision: 17 }
      );
      await authFilesApi.resetCooldown('idx', { expectedConnectionRevision: 17 });
      expect(get).toHaveBeenCalledWith('/credentials', {
        params: { name: 'fixture.json', auth_index: 'idx' },
        expectedConnectionRevision: 17,
      });
      expect(post).toHaveBeenCalledWith(
        '/routing/cooldown/reset',
        { auth_index: 'idx' },
        { expectedConnectionRevision: 17 }
      );
    } finally {
      get.mockRestore();
      post.mockRestore();
    }
  });

  test('quota usage, subscription, and subsequent credit reads share the guard', async () => {
    const seen: Array<{ url: string; revision: number | undefined }> = [];
    apiCallApi.request = async (payload, config) => {
      seen.push({ url: payload.url, revision: config?.expectedConnectionRevision });
      if (payload.url === CODEX_USAGE_URL)
        return result({ rate_limit: { primary_window: { used_percent: 1 } } });
      if (payload.url === CODEX_RATE_LIMIT_RESET_CREDITS_URL)
        return result({ available_count: 0, credits: [] });
      return result({ active_until: '2026-10-06' });
    };
    await fetchCodexQuota(file, t, { expectedConnectionRevision: 29 });
    expect(seen).toEqual([
      { url: CODEX_USAGE_URL, revision: 29 },
      { url: `${CODEX_SUBSCRIPTION_URL}?account_id=fixture-account`, revision: 29 },
      { url: CODEX_RATE_LIMIT_RESET_CREDITS_URL, revision: 29 },
    ]);
  });

  test('ordinary quota reads still work without an account ID or guard', async () => {
    const revisions: unknown[] = [];
    apiCallApi.request = async (payload, config) => {
      revisions.push(config?.expectedConnectionRevision);
      return payload.url === CODEX_USAGE_URL
        ? result({ rate_limit: { primary_window: { used_percent: 1 } } })
        : result({ available_count: 0, credits: [] });
    };
    await fetchCodexQuota({ name: 'fixture.json', auth_index: 'idx' }, t);
    expect(revisions).toEqual([undefined, undefined]);
  });
});
