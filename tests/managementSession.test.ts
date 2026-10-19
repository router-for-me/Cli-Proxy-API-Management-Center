import { afterEach, describe, expect, test } from 'bun:test';
import type { AxiosAdapter } from 'axios';
import { apiClient } from '@/services/api/client';
import en from '@/i18n/locales/en.json';
import ko from '@/i18n/locales/ko.json';
import ru from '@/i18n/locales/ru.json';
import vi from '@/i18n/locales/vi.json';
import zhCN from '@/i18n/locales/zh-CN.json';
import zhTW from '@/i18n/locales/zh-TW.json';
import {
  canUseManagementSession,
  discoverManagementSession,
  endManagementSession,
  getManagementLoginUrl,
} from '@/services/api/managementSession';

const originalFetch = globalThis.fetch;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

function setWindowOrigin(origin: string) {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: { origin } },
  });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('same-origin Management API sessions', () => {
  test('discovers OIDC and authenticated browser sessions without a management key', async () => {
    setWindowOrigin('https://admin.example');
    globalThis.fetch = async (url, init) => {
      expect(url).toBe('https://admin.example/v8/management/oidc/session');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.cache).toBe('no-store');
      return Response.json({ oidcEnabled: true, authenticated: true });
    };

    expect(await discoverManagementSession('https://admin.example')).toEqual({
      oidcEnabled: true,
      authenticated: true,
    });
  });

  test('leaves key login available for unavailable or malformed discovery endpoints', async () => {
    setWindowOrigin('https://admin.example');
    for (const response of [
      new Response('', { status: 404 }),
      Response.json({ oidcEnabled: 'true', authenticated: true }),
    ]) {
      globalThis.fetch = async () => response;
      expect(await discoverManagementSession('https://admin.example')).toBeNull();
    }
    globalThis.fetch = async () => {
      throw new TypeError('Network unavailable');
    };
    expect(await discoverManagementSession('https://admin.example')).toBeNull();
  });

  test('only offers browser sessions for the current origin', async () => {
    setWindowOrigin('https://admin.example');
    expect(canUseManagementSession('https://admin.example')).toBe(true);
    expect(getManagementLoginUrl('https://admin.example')).toBe(
      'https://admin.example/v8/management/oidc/login'
    );
    expect(canUseManagementSession('https://other.example')).toBe(false);
    expect(getManagementLoginUrl('https://other.example')).toBeNull();
    expect(await discoverManagementSession('https://other.example')).toBeNull();
  });

  test('provides the sign-in and logout labels in every supported locale', () => {
    for (const locale of [en, zhCN, zhTW, ru, vi, ko]) {
      expect(locale.login.sso_button.trim()).not.toBe('');
      expect(locale.login.logout_failed.trim()).not.toBe('');
    }
  });

  test('logout posts the CSRF header to the v8 endpoint', async () => {
    setWindowOrigin('https://admin.example');
    globalThis.fetch = async (url, init) => {
      expect(url).toBe('https://admin.example/v8/management/oidc/logout');
      expect(init?.method).toBe('POST');
      expect(init?.credentials).toBe('same-origin');
      expect(init?.headers).toEqual({ 'X-Management-CSRF': '1' });
      return new Response(null, { status: 204 });
    };
    await endManagementSession('https://admin.example');
  });

  test('the API client sends the browser cookie and CSRF header without a key', async () => {
    setWindowOrigin('https://admin.example');
    apiClient.setConfig({
      apiBase: 'https://admin.example',
      managementKey: '',
      sessionAuthenticated: true,
    });
    const adapter: AxiosAdapter = async (config) => {
      expect(config.withCredentials).toBe(true);
      expect(config.headers['X-Management-CSRF']).toBe('1');
      expect(config.headers.Authorization).toBeUndefined();
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config };
    };
    await apiClient.get('/config', { adapter });
  });

  test('rejects a cross-origin browser session before changing client configuration', () => {
    setWindowOrigin('https://admin.example');
    apiClient.setConfig({ apiBase: 'https://admin.example', managementKey: 'fixture-key' });
    expect(() =>
      apiClient.setConfig({
        apiBase: 'https://other.example',
        managementKey: '',
        sessionAuthenticated: true,
      })
    ).toThrow('same-origin API');
    expect(() =>
      apiClient.setConfig({ apiBase: '', managementKey: '', sessionAuthenticated: true })
    ).toThrow('same-origin API');
  });
});
