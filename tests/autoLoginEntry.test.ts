import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { resolveLoginRedirect } from '@/router/loginRedirect';
import { shouldAttemptAutoLogin, useAuthStore } from '@/stores/useAuthStore';
import {
  LOGIN_TRANSITION_TIMINGS,
  LOGIN_TRANSITION_TIMINGS_REDUCED,
} from '@/stores/useLoginTransitionStore';

const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
let values: Map<string, string>;

beforeEach(() => {
  values = new Map();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  useAuthStore.setState({ isAuthenticated: false, apiBase: '', managementKey: '' });
});

afterEach(() => {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else Reflect.deleteProperty(globalThis, 'localStorage');
});

describe('auto-login entry (plan A)', () => {
  test('protected routes no longer verify in place behind a spinner', async () => {
    const source = await Bun.file('src/router/ProtectedRoute.tsx').text();
    expect(source).not.toContain('checkAuth');
    expect(source).not.toContain('LoadingSpinner');
    expect(source).toMatch(/<Navigate to="\/login" replace state=\{state\} \/>/);
    expect(source).toContain('search: location.search');
    // 已通过本次会话验证时直接渲染子路由
    expect(source).toMatch(/if \(!isAuthenticated\) \{[\s\S]*?\}\s*return children;/);
  });

  test('returns to the original page, query included, but never back to /login', () => {
    expect(resolveLoginRedirect({ from: { pathname: '/ai-providers', search: '?tab=x' } })).toBe(
      '/ai-providers?tab=x'
    );
    expect(resolveLoginRedirect({ from: { pathname: '/logs' } })).toBe('/logs');
    expect(resolveLoginRedirect({ from: { pathname: '/login', search: '' } })).toBe('/');
    expect(resolveLoginRedirect(null)).toBe('/');
    expect(resolveLoginRedirect(undefined)).toBe('/');
  });
});

describe('restorable session detection', () => {
  test('requires a remembered, not-logged-out session with a saved key', () => {
    expect(shouldAttemptAutoLogin(true, 'http://a', 'k')).toBe(true);
    expect(shouldAttemptAutoLogin(false, 'http://a', 'k')).toBe(false);
    expect(shouldAttemptAutoLogin(true, 'http://a', '')).toBe(false);
    expect(shouldAttemptAutoLogin(true, '', 'k')).toBe(false);
  });

  test('hasRestorableSession mirrors restoreSession without side effects', () => {
    const { hasRestorableSession } = useAuthStore.getState();
    useAuthStore.setState({ apiBase: 'http://proxy.example.com', managementKey: 'sk-demo' });
    expect(hasRestorableSession()).toBe(false); // 已登出 / 未记住密码：无 isLoggedIn 标记

    values.set('isLoggedIn', 'true');
    expect(hasRestorableSession()).toBe(true);

    useAuthStore.setState({ managementKey: '' });
    expect(hasRestorableSession()).toBe(false);
    expect(values.get('isLoggedIn')).toBe('true'); // 只读判断，不改存储
  });

  test('the login page only shows the splash when it will actually auto-login', async () => {
    const source = await Bun.file('src/pages/LoginPage.tsx').text();
    expect(source).toMatch(
      /useState\(\(\) =>\s*useAuthStore\.getState\(\)\.hasRestorableSession\(\)\s*\)/
    );
    // 首帧即用已保存信息填表，不等 restoreSession
    expect(source).toContain('useState(() => useAuthStore.getState().apiBase || detectedBase)');
  });
});

describe('splash pacing', () => {
  test('auto-login holds the splash just long enough to read, not a fixed 1.5s', async () => {
    expect(LOGIN_TRANSITION_TIMINGS.splashMin).toBeGreaterThanOrEqual(500);
    expect(LOGIN_TRANSITION_TIMINGS.splashMin).toBeLessThanOrEqual(900);
    expect(LOGIN_TRANSITION_TIMINGS_REDUCED.splashMin).toBe(LOGIN_TRANSITION_TIMINGS.splashMin);
    const source = await Bun.file('src/pages/LoginPage.tsx').text();
    expect(source).not.toContain('1500');
    expect(source).toContain('Math.max(0, splashMin - elapsed)');
  });
});
