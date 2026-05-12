import { describe, expect, it } from 'vitest';
import {
  convertAuthJsonInput,
  getDefaultSessionAuthFileName,
} from '@/features/authFiles/sessionAuthConverter';

const encodeBase64UrlJson = (value: unknown) =>
  btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');

const buildJwt = (
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'none', typ: 'JWT' }
) => `${encodeBase64UrlJson(header)}.${encodeBase64UrlJson(payload)}.`;

const buildSignedJwt = (
  payload: Record<string, unknown>,
  header: Record<string, unknown> = { alg: 'HS256', typ: 'JWT' },
  signature = 'signature'
) => `${encodeBase64UrlJson(header)}.${encodeBase64UrlJson(payload)}.${signature}`;

describe('convertAuthJsonInput', () => {
  it('keeps a CPA auth JSON object unchanged', () => {
    const input = {
      type: 'codex',
      email: 'user@example.com',
      access_token: 'existing-access-token',
    };

    const result = convertAuthJsonInput(JSON.stringify(input), 'cpa');

    expect(result).toEqual(input);
  });

  it('converts a ChatGPT session object to CPA Codex auth JSON', () => {
    const accessToken = buildJwt({
      exp: 1_800_000_000,
      email: 'token@example.com',
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acc-from-token',
        chatgpt_plan_type: 'plus',
        chatgpt_user_id: 'user-from-token',
      },
    });

    const result = convertAuthJsonInput(
      JSON.stringify({
        user: { email: 'session@example.com', id: 'session-user' },
        account: { id: 'session-account', planType: 'pro' },
        accessToken,
        sessionToken: 'session-token',
      }),
      'session',
      new Date('2026-05-11T08:00:00.000Z')
    );

    expect(result).toMatchObject({
      type: 'codex',
      account_id: 'session-account',
      chatgpt_account_id: 'session-account',
      email: 'session@example.com',
      name: 'session@example.com',
      plan_type: 'pro',
      chatgpt_plan_type: 'pro',
      access_token: accessToken,
      session_token: 'session-token',
      last_refresh: '2026-05-11T08:00:00.000Z',
      expired: '2027-01-15T08:00:00.000Z',
    });
  });

  it('omits id_token instead of synthesizing an unsigned token when idToken is missing', () => {
    const result = convertAuthJsonInput(
      JSON.stringify({
        user: { email: 'session@example.com' },
        account: { id: 'session-account' },
        accessToken: 'access-token',
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'session@example.com',
      account_id: 'session-account',
      access_token: 'access-token',
    });
    expect(result).not.toHaveProperty('id_token');
    expect(result).not.toHaveProperty('id_token_synthetic');
  });

  it('uses access-token exp as fallback but does not treat token identity claims as canonical metadata', () => {
    const forgedAccessToken = buildJwt(
      {
        exp: 1_900_000_000,
        email: 'attacker@example.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'attacker-account',
          chatgpt_plan_type: 'enterprise',
        },
      },
      { alg: 'none' }
    );

    const result = convertAuthJsonInput(
      JSON.stringify({
        user: {},
        accessToken: forgedAccessToken,
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      access_token: forgedAccessToken,
      name: 'ChatGPT Account',
      expired: '2030-03-17T17:46:40.000Z',
    });
    expect(result).not.toHaveProperty('email');
    expect(result).not.toHaveProperty('account_id');
    expect(result).not.toHaveProperty('chatgpt_account_id');
    expect(result).not.toHaveProperty('plan_type');
    expect(result).not.toHaveProperty('chatgpt_plan_type');
  });

    it('omits unsigned idToken values and does not treat forged idToken payload claims as canonical metadata', () => {
    const forgedIdToken = buildJwt(
      {
        email: 'attacker-id@example.com',
        'https://api.openai.com/auth': {
          chatgpt_account_id: 'attacker-id-account',
          chatgpt_plan_type: 'enterprise',
        },
      },
      { alg: 'none' }
    );

    const result = convertAuthJsonInput(
      JSON.stringify({
        user: {},
        accessToken: 'access-token',
        idToken: forgedIdToken,
      }),
      'session'
    );

      expect(result).toMatchObject({
        type: 'codex',
        access_token: 'access-token',
        name: 'ChatGPT Account',
      });
      expect(result).not.toHaveProperty('id_token');
      expect(result).not.toHaveProperty('email');
      expect(result).not.toHaveProperty('account_id');
      expect(result).not.toHaveProperty('chatgpt_account_id');
      expect(result).not.toHaveProperty('plan_type');
      expect(result).not.toHaveProperty('chatgpt_plan_type');
    });

    it('omits JWT-shaped idToken values when the signature segment is empty', () => {
      const emptySignatureIdToken = buildJwt(
        {
          email: 'untrusted-id@example.com',
        },
        { alg: 'HS256', typ: 'JWT' }
      );

      const result = convertAuthJsonInput(
        JSON.stringify({
          user: {},
          accessToken: 'access-token',
          idToken: emptySignatureIdToken,
        }),
        'session'
      );

      expect(result).toMatchObject({
        type: 'codex',
        access_token: 'access-token',
      });
      expect(result).not.toHaveProperty('id_token');
    });

    it('preserves a non-none idToken JWT string when the signature segment is present', () => {
      const signedLikeIdToken = buildSignedJwt(
        {
          email: 'trusted-id@example.com',
        },
        { alg: 'HS256', typ: 'JWT' }
      );

      const result = convertAuthJsonInput(
        JSON.stringify({
          user: {},
          accessToken: 'access-token',
          idToken: signedLikeIdToken,
        }),
        'session'
      );

      expect(result).toMatchObject({
        type: 'codex',
        access_token: 'access-token',
        id_token: signedLikeIdToken,
      });
    });

    it.each([
    {
      alias: 'expires',
      sessionValue: '2026-06-01T00:00:00.000Z',
    },
    {
      alias: 'expired',
      sessionValue: '2026-07-01T00:00:00.000Z',
    },
    {
      alias: 'expires_at',
      sessionValue: '2026-08-01T00:00:00.000Z',
    },
  ])(
    'prefers explicit session expiration alias "$alias" over access token exp',
    ({ alias, sessionValue }) => {
      const accessToken = buildJwt({
        exp: 1_800_000_000,
      });

      const result = convertAuthJsonInput(
        JSON.stringify({
          user: { email: 'session@example.com' },
          account: { id: 'session-account' },
          accessToken,
          [alias]: sessionValue,
        }),
        'session'
      );

      expect(result.expired).toBe(sessionValue);
    }
  );

  it('converts session JSON with token and user data split across nested objects', () => {
      const idToken = buildSignedJwt(
        {
          email: 'id-token@example.com',
          'https://api.openai.com/auth': {
            chatgpt_account_id: 'account-from-id-token',
            chatgpt_plan_type: 'team',
            chatgpt_user_id: 'user-from-id-token',
          },
        },
        { alg: 'HS256', typ: 'JWT' }
      );

    const result = convertAuthJsonInput(
      JSON.stringify({
        session: {
          tokens: {
            accessToken: 'access-token',
            idToken,
            sessionToken: 'session-token',
          },
        },
        profile: {
          user: { email: 'profile@example.com', id: 'profile-user' },
          account: { id: 'profile-account', planType: 'pro' },
        },
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'profile@example.com',
      account_id: 'profile-account',
      chatgpt_account_id: 'profile-account',
      plan_type: 'pro',
      chatgpt_plan_type: 'pro',
      access_token: 'access-token',
      id_token: idToken,
      session_token: 'session-token',
    });
  });

  it('converts a one-item array-wrapped split session object', () => {
    const result = convertAuthJsonInput(
      JSON.stringify([
        {
          session: {
            tokens: {
              accessToken: 'array-access-token',
            },
          },
          profile: {
            user: { email: 'array@example.com' },
            account: { id: 'array-account', planType: 'plus' },
          },
        },
      ]),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'array@example.com',
      account_id: 'array-account',
      chatgpt_account_id: 'array-account',
      plan_type: 'plus',
      chatgpt_plan_type: 'plus',
      access_token: 'array-access-token',
    });
  });

  it('rejects array-wrapped input when it contains multiple split session objects', () => {
    const input = [
      {
        session: { tokens: { accessToken: 'array-access-token-a' } },
        profile: {
          user: { email: 'array-a@example.com' },
          account: { id: 'array-account-a' },
        },
      },
      {
        session: { tokens: { accessToken: 'array-access-token-b' } },
        profile: {
          user: { email: 'array-b@example.com' },
          account: { id: 'array-account-b' },
        },
      },
    ];

    expect(() => convertAuthJsonInput(JSON.stringify(input), 'session')).toThrow(
      'Multiple ChatGPT session objects found; paste one session only'
    );
  });

    it('preserves nested explicit expiration when split-session data is aggregated', () => {
      const nestedExpiry = '2026-08-01T00:00:00.000Z';
      const result = convertAuthJsonInput(
        JSON.stringify({
        session: {
          tokens: {
            accessToken: 'access-token',
          },
          expires_at: nestedExpiry,
        },
        profile: {
          user: { email: 'profile@example.com' },
          account: { id: 'profile-account' },
        },
      }),
      'session'
    );

      expect(result).toMatchObject({
        access_token: 'access-token',
        expired: nestedExpiry,
      });
    });

    it('prefers explicit session expires_at over nested token-container expires_at during aggregation', () => {
      const explicitSessionExpiry = '2026-08-01T00:00:00.000Z';
      const nestedTokenExpiry = '2026-01-01T00:00:00.000Z';
      const result = convertAuthJsonInput(
        JSON.stringify({
          session: {
            tokens: {
              accessToken: 'access-token',
              expires_at: nestedTokenExpiry,
            },
            expires_at: explicitSessionExpiry,
          },
          profile: {
            user: { email: 'profile@example.com' },
            account: { id: 'profile-account' },
          },
        }),
        'session'
      );

      expect(result).toMatchObject({
        access_token: 'access-token',
        expired: explicitSessionExpiry,
      });
    });

    it('prefers numeric-string expires_at over access-token exp fallback', () => {
      const accessToken = buildJwt({ exp: 1_700_000_000 });
      const result = convertAuthJsonInput(
        JSON.stringify({
          user: { email: 'profile@example.com' },
          account: { id: 'profile-account' },
          accessToken,
          expires_at: '1800000000',
        }),
        'session'
      );

      expect(result).toMatchObject({
        access_token: accessToken,
        expired: '2027-01-15T08:00:00.000Z',
      });
    });

  it('uses a nested access token even when a parent session object has only session metadata', () => {
        const result = convertAuthJsonInput(
          JSON.stringify({
        session: {
          sessionToken: 'parent-session-token',
          token: {
            accessToken: 'nested-access-token',
          },
        },
        profile: {
          user: { email: 'profile@example.com' },
          account: { id: 'profile-account' },
        },
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'profile@example.com',
      account_id: 'profile-account',
      access_token: 'nested-access-token',
      session_token: 'parent-session-token',
        });
      });

  it('preserves nested user identity when aggregated data.session provides accessToken directly', () => {
    const result = convertAuthJsonInput(
      JSON.stringify({
        data: {
          session: {
            accessToken: 'wrapped-access-token',
            user: { email: 'wrapped@example.com' },
            account: { id: 'wrapped-account' },
          },
        },
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'wrapped@example.com',
      account_id: 'wrapped-account',
      chatgpt_account_id: 'wrapped-account',
      access_token: 'wrapped-access-token',
    });
  });

  it('preserves nested user identity when aggregated data.session token container uses access_token', () => {
    const result = convertAuthJsonInput(
      JSON.stringify({
        data: {
          session: {
            token: { access_token: 'wrapped-token-access-token' },
            user: { email: 'wrapped-token@example.com' },
            account: { id: 'wrapped-token-account' },
          },
        },
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'wrapped-token@example.com',
      account_id: 'wrapped-token-account',
      chatgpt_account_id: 'wrapped-token-account',
      access_token: 'wrapped-token-access-token',
    });
  });

  it('merges sibling profile account data when a nested session already has token and user fields', () => {
      const result = convertAuthJsonInput(
        JSON.stringify({
          session: {
            accessToken: 'nested-access-token',
            user: { email: 'nested@example.com' },
          },
          profile: {
            account: { id: 'profile-account', planType: 'pro' },
          },
        }),
        'session'
      );

      expect(result).toMatchObject({
        type: 'codex',
        email: 'nested@example.com',
        account_id: 'profile-account',
        chatgpt_account_id: 'profile-account',
        plan_type: 'pro',
        chatgpt_plan_type: 'pro',
        access_token: 'nested-access-token',
      });
    });

    it('merges sibling profile account data for one-item array-wrapped direct session inputs', () => {
      const result = convertAuthJsonInput(
        JSON.stringify([
          {
            session: {
              accessToken: 'nested-access-token',
              user: { email: 'nested@example.com' },
            },
            profile: {
              account: { id: 'profile-account', planType: 'pro' },
            },
          },
        ]),
        'session'
      );

      expect(result).toMatchObject({
        type: 'codex',
        email: 'nested@example.com',
        account_id: 'profile-account',
        chatgpt_account_id: 'profile-account',
        plan_type: 'pro',
        chatgpt_plan_type: 'pro',
        access_token: 'nested-access-token',
      });
    });

    it('merges nested profile account data when root user and token fields are present', () => {
      const result = convertAuthJsonInput(
        JSON.stringify({
        user: { email: 'root@example.com' },
        token: { accessToken: 'root-access-token' },
        profile: {
          account: { id: 'profile-account', planType: 'pro' },
        },
      }),
      'session'
    );

      expect(result).toMatchObject({
        type: 'codex',
        email: 'root@example.com',
        account_id: 'profile-account',
        chatgpt_account_id: 'profile-account',
        plan_type: 'pro',
        chatgpt_plan_type: 'pro',
        access_token: 'root-access-token',
      });
    });

    it('preserves nested account.account_id and account.chatgpt_plan_type aliases', () => {
      const result = convertAuthJsonInput(
        JSON.stringify({
          session: {
            token: {
              accessToken: 'root-access-token',
            },
          },
          user: { email: 'root@example.com' },
          account: {
            account_id: 'root-account-id-alias',
            chatgpt_plan_type: 'team',
          },
        }),
        'session'
      );

      expect(result).toMatchObject({
        type: 'codex',
        email: 'root@example.com',
        account_id: 'root-account-id-alias',
        chatgpt_account_id: 'root-account-id-alias',
        plan_type: 'team',
        chatgpt_plan_type: 'team',
        access_token: 'root-access-token',
      });
    });

    it('preserves nested account and profile.account chatgpt aliases when id fields are absent', () => {
      const result = convertAuthJsonInput(
        JSON.stringify({
          session: {
            tokens: {
              accessToken: 'profile-access-token',
            },
          },
          profile: {
            user: { email: 'profile@example.com' },
            account: {
              chatgpt_account_id: 'profile-account-alias',
              chatgpt_plan_type: 'pro',
            },
          },
          account: {
            chatgpt_account_id: 'root-account-alias',
            chatgpt_plan_type: 'team',
          },
        }),
        'session'
      );

      expect(result).toMatchObject({
        type: 'codex',
        email: 'profile@example.com',
        account_id: 'root-account-alias',
        chatgpt_account_id: 'root-account-alias',
        plan_type: 'team',
        chatgpt_plan_type: 'team',
        access_token: 'profile-access-token',
      });
    });

    it('rejects split session JSON when multiple token branches could be aggregated', () => {
      const input = {
      profile: {
        user: { email: 'profile@example.com' },
        account: { id: 'profile-account' },
      },
      tokenA: {
        accessToken: 'access-token-a',
      },
      tokenB: {
        accessToken: 'access-token-b',
      },
    };

    expect(() => convertAuthJsonInput(JSON.stringify(input), 'session')).toThrow(
      'Multiple token candidates found in split session JSON; paste one account/session only'
    );
  });

  it('rejects pasted JSON that exceeds the input size limit', () => {
    const oversized = JSON.stringify({
      type: 'codex',
      access_token: 'existing-access-token',
      padding: 'x'.repeat(3_000_000),
    });

    expect(() => convertAuthJsonInput(oversized, 'cpa')).toThrow(
      'Auth JSON input exceeds size limit'
    );
  });

  it('rejects session JSON that exceeds traversal depth limits', () => {
    const root: Record<string, unknown> = {};
    let cursor = root;
    for (let index = 0; index < 80; index += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    cursor.user = { email: 'deep@example.com' };
    cursor.accessToken = 'deep-access-token';

    expect(() => convertAuthJsonInput(JSON.stringify(root), 'session')).toThrow(
      'Auth JSON nesting exceeds depth limit'
    );
  });

  it('rejects session JSON that exceeds traversal record limits', () => {
    const items = Array.from({ length: 6_000 }, (_, index) => ({
      id: `record-${index}`,
      value: `v${index}`,
    }));
    const input = JSON.stringify({
      nodes: items,
      session: {
        user: { email: 'records@example.com' },
        accessToken: 'record-access-token',
      },
    });

    expect(() => convertAuthJsonInput(input, 'session')).toThrow(
      'Auth JSON traversal exceeds record limit'
    );
  });

  it('rejects CPA auth JSON without a minimal auth-file shape', () => {
    expect(() => convertAuthJsonInput(JSON.stringify({ foo: 'bar' }), 'cpa')).toThrow(
      'CPA auth JSON is missing required auth fields'
    );
  });

  it('rejects Codex CPA auth JSON when credential containers are empty', () => {
    const invalidInputs = [
      { type: 'codex', credentials: {} },
      { type: 'codex', auth: {} },
      { type: 'codex', cookies: {} },
    ];

    invalidInputs.forEach((input) => {
      expect(() => convertAuthJsonInput(JSON.stringify(input), 'cpa')).toThrow(
        'CPA auth JSON is missing required auth fields'
      );
    });
  });

  it('keeps Codex CPA auth JSON unchanged when nested credentials include a real token', () => {
    const input = {
      type: 'codex',
      credentials: {
        access_token: 'nested-access-token',
      },
    };

    const result = convertAuthJsonInput(JSON.stringify(input), 'cpa');

    expect(result).toEqual(input);
  });

  it('keeps unknown-provider CPA auth JSON unchanged when credentials include provider-specific keys', () => {
    const input = {
      type: 'custom-provider',
      credentials: {
        sessionSecret: 'provider-secret',
      },
    };

    const result = convertAuthJsonInput(JSON.stringify(input), 'cpa');

    expect(result).toEqual(input);
  });

  it('keeps unknown-provider CPA auth JSON unchanged when top-level credential-like fields are present', () => {
    const validInputs = [
      { type: 'custom-provider', token: 'provider-secret' },
      { type: 'custom-provider', apiKey: 'provider-api-key' },
      { type: 'custom-provider', sessionSecret: 'provider-session-secret' },
    ];

    validInputs.forEach((input) => {
      const result = convertAuthJsonInput(JSON.stringify(input), 'cpa');
      expect(result).toEqual(input);
    });
  });

  it('keeps known-provider CPA auth JSON unchanged when top-level auth header or cookie credentials are present', () => {
    const validInputs = [
      { type: 'openai', authorization: 'Bearer provider-token' },
      { type: 'openai', bearer: 'provider-token' },
      { type: 'chatgpt', cookie: '__Secure-next-auth.session-token=token' },
      { type: 'chatgpt', cookies: '__Secure-next-auth.session-token=token' },
    ];

    validInputs.forEach((input) => {
      const result = convertAuthJsonInput(JSON.stringify(input), 'cpa');
      expect(result).toEqual(input);
    });
  });

  it('keeps Vertex service-account CPA auth JSON unchanged', () => {
    const input = {
      type: 'service_account',
      project_id: 'vertex-project',
      private_key: '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n',
      client_email: 'vertex-service@vertex-project.iam.gserviceaccount.com',
    };

    const result = convertAuthJsonInput(JSON.stringify(input), 'cpa');

    expect(result).toEqual(input);
  });

  it('rejects unknown-provider CPA auth JSON when top-level fields are not credential-like', () => {
    const input = {
      type: 'custom-provider',
      note: 'provider-secret',
    };

    expect(() => convertAuthJsonInput(JSON.stringify(input), 'cpa')).toThrow(
      'CPA auth JSON is missing required auth fields'
    );
  });

  it('rejects unknown-provider CPA auth JSON when credential-like fields only appear in unrelated nested metadata', () => {
    const invalidInputs = [
      { type: 'custom-provider', token: { note: 'browser export' } },
      { type: 'custom-provider', apiKey: { value: 'metadata-api-key' } },
      { type: 'custom-provider', profile: { password: 'metadata-password' } },
      { type: 'custom-provider', metadata: { clientSecret: 'metadata-secret' } },
      { type: 'custom-provider', account: { token: 'metadata-token' } },
    ];

    invalidInputs.forEach((input) => {
      expect(() => convertAuthJsonInput(JSON.stringify(input), 'cpa')).toThrow(
        'CPA auth JSON is missing required auth fields'
      );
    });
  });

  it('rejects unknown-provider CPA auth JSON when only broad secret fields are present', () => {
    const invalidInputs = [
      { type: 'custom-provider', password: 'personal-password' },
      { type: 'custom-provider', passphrase: 'personal-passphrase' },
      { type: 'custom-provider', secret: 'personal-secret' },
    ];

    invalidInputs.forEach((input) => {
      expect(() => convertAuthJsonInput(JSON.stringify(input), 'cpa')).toThrow(
        'CPA auth JSON is missing required auth fields'
      );
    });
  });

  it('rejects pasted CPA JSON content with invisible control characters', () => {
    expect(() =>
      convertAuthJsonInput(
        JSON.stringify({
          type: 'codex',
          access_token: 'existing-access-token',
          note: 'safe\u202Egnp.exe',
        }),
        'cpa'
      )
    ).toThrow('Auth JSON contains unsupported invisible characters');
  });

  it('rejects pasted CPA JSON keys with invisible control characters', () => {
    expect(() =>
      convertAuthJsonInput(
        JSON.stringify({
          type: 'codex',
          access_token: 'existing-access-token',
          'display\u202Ename': 'misleading-key',
        }),
        'cpa'
      )
    ).toThrow('Auth JSON contains unsupported invisible characters');
  });

  it('rejects pasted session JSON content with invisible control characters', () => {
    expect(() =>
      convertAuthJsonInput(
        JSON.stringify({
          user: { email: 'session@example.com' },
          account: { id: 'session-account' },
          accessToken: 'access-token',
          note: 'zero\u200Bwidth',
        }),
        'session'
      )
    ).toThrow('Auth JSON contains unsupported invisible characters');
  });

  it('keeps CPA auth JSON unchanged for auth/cookies containers across provider families', () => {
    const validInputs = [
      {
        provider: 'openai',
        auth: { access_token: 'provider-auth-token' },
      },
      {
        provider: 'chatgpt',
        cookies: { session_token: 'provider-cookie-token' },
      },
      {
        type: 'openai',
        auth: { refresh_token: 'openai-refresh-token' },
      },
      {
        type: 'chatgpt',
        cookies: { id_token: 'chatgpt-id-token' },
      },
      {
        type: 'custom-provider',
        auth: { refresh_token: 'custom-refresh-token' },
      },
      {
        type: 'custom-provider',
        cookies: { session_token: 'custom-session-token' },
      },
    ];

    validInputs.forEach((input) => {
      const result = convertAuthJsonInput(JSON.stringify(input), 'cpa');
      expect(result).toEqual(input);
    });
  });

  it('rejects known-provider auth containers when credential keys do not match provider contract', () => {
    const invalidInputs = [
      { provider: 'openai', auth: { token: 'ambiguous-openai-token' } },
      { provider: 'chatgpt', cookies: { api_key: 'unexpected-chatgpt-api-key' } },
      { provider: 'openai', auth: { nested: [{ id_token: 'unexpected-openai-id-token' }] } },
      { provider: 'chatgpt', cookies: { nested: [{ api_key: 'unexpected-chatgpt-api-key' }] } },
    ];

    invalidInputs.forEach((input) => {
      expect(() => convertAuthJsonInput(JSON.stringify(input), 'cpa')).toThrow(
        'CPA auth JSON is missing required auth fields'
      );
    });
  });

  it('rejects nested auth/cookies containers without usable credential keys', () => {
    const invalidInputs = [
      { provider: 'openai', auth: {} },
      { provider: 'chatgpt', cookies: {} },
      { type: 'custom-provider', auth: {} },
      { type: 'custom-provider', cookies: {} },
      { type: 'openai', auth: { access_token: '   ' } },
      { type: 'openai', auth: { access_token: { note: 'browser export' } } },
      { type: 'chatgpt', cookies: { id_token: '\n\t' } },
      { provider: 'openai', auth: { nested: { foo: 'bar' } } },
      { type: 'chatgpt', cookies: { nested: [{ x: 'y' }] } },
      { type: 'custom-provider', auth: { note: 'hello' } },
      { type: 'custom-provider', credentials: { sessionSecret: { value: 'metadata-secret' } } },
      { type: 'custom-provider', credentials: { nested: [{ note: 'hello' }] } },
    ];

    invalidInputs.forEach((input) => {
      expect(() => convertAuthJsonInput(JSON.stringify(input), 'cpa')).toThrow(
        'CPA auth JSON is missing required auth fields'
      );
    });
  });

  it('rejects CPA auth JSON with unsigned or empty-signature id_token values', () => {
    const invalidInputs = [
      {
        type: 'codex',
        access_token: 'existing-access-token',
        id_token: buildJwt({ sub: 'user' }),
      },
      {
        type: 'codex',
        access_token: 'existing-access-token',
        credentials: {
          idToken: buildJwt({ sub: 'user' }, { alg: 'HS256', typ: 'JWT' }),
        },
      },
    ];

    invalidInputs.forEach((input) => {
      expect(() => convertAuthJsonInput(JSON.stringify(input), 'cpa')).toThrow(
        'CPA auth JSON contains unsupported id_token'
      );
    });
  });

  it('converts explicit session fields when JWT-shaped payloads are malformed', () => {
    const result = convertAuthJsonInput(
      JSON.stringify({
        user: { email: 'session@example.com', id: 'session-user' },
        account: { id: 'session-account', planType: 'plus' },
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.%%%bad%%%.sig',
        idToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.bm90LWpzb24.sig',
        expires_at: '2026-06-01T00:00:00.000Z',
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'session@example.com',
      account_id: 'session-account',
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.%%%bad%%%.sig',
      id_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.bm90LWpzb24.sig',
      expired: '2026-06-01T00:00:00.000Z',
    });
  });

  it('omits expired when malformed JWT-shaped access token is the only expiration source', () => {
    const result = convertAuthJsonInput(
      JSON.stringify({
        user: { email: 'session@example.com', id: 'session-user' },
        account: { id: 'session-account', planType: 'plus' },
        accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.%%%bad%%%.sig',
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'session@example.com',
      account_id: 'session-account',
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.%%%bad%%%.sig',
    });
    expect(result).not.toHaveProperty('expired');
  });

  it('ignores oversized JWT payload segments without crashing conversion', () => {
    const header = encodeBase64UrlJson({ alg: 'HS256', typ: 'JWT' });
    const oversizedPayload = 'a'.repeat(25_000);
    const tokenWithHugePayload = `${header}.${oversizedPayload}.sig`;

    const result = convertAuthJsonInput(
      JSON.stringify({
        user: { email: 'session@example.com' },
        account: { id: 'session-account', planType: 'plus' },
        accessToken: tokenWithHugePayload,
        expires_at: '2026-06-01T00:00:00.000Z',
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      email: 'session@example.com',
      account_id: 'session-account',
      plan_type: 'plus',
      access_token: tokenWithHugePayload,
      expired: '2026-06-01T00:00:00.000Z',
    });
  });

  it('omits optional token fields when their values are not strings', () => {
    const result = convertAuthJsonInput(
      JSON.stringify({
        user: { email: 'session@example.com' },
        account: { id: 'session-account' },
        accessToken: 'access-token',
        sessionToken: true,
        refreshToken: 123,
        idToken: false,
      }),
      'session'
    );

    expect(result).not.toHaveProperty('session_token');
    expect(result).not.toHaveProperty('refresh_token');
    expect(result).not.toHaveProperty('id_token');
  });

  it('preserves optional token fields when string values are present', () => {
    const result = convertAuthJsonInput(
      JSON.stringify({
        user: { email: 'session@example.com' },
        account: { id: 'session-account' },
        accessToken: 'access-token',
        sessionToken: 'session-token',
        refreshToken: 'refresh-token',
        idToken: 'id-token',
      }),
      'session'
    );

    expect(result).toMatchObject({
      type: 'codex',
      access_token: 'access-token',
      session_token: 'session-token',
      refresh_token: 'refresh-token',
      id_token: 'id-token',
    });
  });

  it('rejects a session object with a non-string access token', () => {
    expect(() =>
      convertAuthJsonInput(
        JSON.stringify({
          user: { email: 'session@example.com' },
          accessToken: true,
        }),
        'session'
      )
    ).toThrow('No ChatGPT session object with accessToken was found');
  });

  it('builds a safe default file name from converted account identity', () => {
    const authJson = {
      type: 'codex',
      email: 'User.Name+tag@example.com',
    };

    expect(getDefaultSessionAuthFileName(authJson)).toBe('user-name-tag-example-com.codex.json');
  });

  it.each(['con', 'AUX', 'lpt1'])(
    'does not build a Windows reserved default file name from %s',
    (identity) => {
      const authJson = {
        type: 'codex',
        email: identity,
      };

      expect(getDefaultSessionAuthFileName(authJson)).toBe(
        `${identity.toLowerCase()}-account.codex.json`
      );
    }
  );
});
