import { describe, expect, spyOn, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { apiClient } from '@/services/api/client';
import { oauthApi } from '@/services/api/oauth';

const response = { status: 'ok', url: 'https://auth.openai.com/oauth/authorize', state: 's' };

describe('OAuth login proxy', () => {
  test('posts the session proxy in the JSON body when provided', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(response);
    const get = spyOn(apiClient, 'get').mockResolvedValue(response);
    try {
      expect(
        await oauthApi.startAuth('codex', undefined, '  socks5://u:p@127.0.0.1:1080  ')
      ).toEqual(response);
      expect(post).toHaveBeenCalledWith(
        '/oauth/auth-url',
        { provider: 'codex', is_webui: true, proxy_url: 'socks5://u:p@127.0.0.1:1080' },
        undefined
      );
      expect(get).not.toHaveBeenCalled();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test('never puts the proxy in the query string', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(response);
    try {
      await oauthApi.startAuth('kimi', undefined, 'http://127.0.0.1:8080');
      expect(post).toHaveBeenCalledWith(
        '/oauth/auth-url',
        { provider: 'kimi', proxy_url: 'http://127.0.0.1:8080' },
        undefined
      );
    } finally {
      post.mockRestore();
    }
  });

  test('keeps the GET contract when the proxy is empty', async () => {
    const post = spyOn(apiClient, 'post').mockResolvedValue(response);
    const get = spyOn(apiClient, 'get').mockResolvedValue(response);
    try {
      await oauthApi.startAuth('codex', undefined, '   ');
      expect(get).toHaveBeenCalledWith('/oauth/auth-url', {
        params: { provider: 'codex', is_webui: true },
      });
      expect(post).not.toHaveBeenCalled();
    } finally {
      post.mockRestore();
      get.mockRestore();
    }
  });

  test('every locale translates the login proxy field', () => {
    for (const locale of ['en', 'zh-CN', 'zh-TW', 'ru', 'ko', 'vi', 'tr']) {
      const messages = JSON.parse(
        readFileSync(new URL(`../src/i18n/locales/${locale}.json`, import.meta.url), 'utf8')
      );
      expect(typeof messages.auth_login.login_proxy_label).toBe('string');
      expect(typeof messages.auth_login.login_proxy_hint).toBe('string');
    }
  });
});
