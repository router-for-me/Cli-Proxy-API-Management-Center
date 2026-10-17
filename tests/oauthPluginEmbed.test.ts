import { describe, expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import en from '@/i18n/locales/en.json';
import { OAuthFlowDialog } from '@/features/oauth/components/OAuthFlowDialog';
import { resolveEmbeddedLoginUrl } from '@/features/oauth/flowView';
import type { ProviderFlowState } from '@/features/oauth/hooks/useOAuthFlows';

const PANEL = 'https://cpa.example.test';
const LOGIN = '/v0/resource/plugins/kiro/login#state=abc123';

describe('plugin login embed URL', () => {
  test('embeds a plugin login page served by the panel origin', () => {
    expect(resolveEmbeddedLoginUrl(LOGIN, '', PANEL)).toBe(`${PANEL}${LOGIN}`);
    expect(resolveEmbeddedLoginUrl(LOGIN, PANEL, PANEL)).toBe(`${PANEL}${LOGIN}`);
    expect(resolveEmbeddedLoginUrl(`${PANEL}${LOGIN}`, PANEL, PANEL)).toBe(`${PANEL}${LOGIN}`);
  });

  test('keeps cross-origin and third-party pages on the new-tab path', () => {
    // 连接远端后端：资源页与面板不同源，frame-ancestors 'self' 会拒绝嵌入
    expect(resolveEmbeddedLoginUrl(LOGIN, 'https://remote.example.test', PANEL)).toBe('');
    expect(resolveEmbeddedLoginUrl('https://accounts.google.com/o/oauth2/auth', '', PANEL)).toBe(
      ''
    );
    expect(resolveEmbeddedLoginUrl('javascript:alert(1)', '', PANEL)).toBe('');
  });

  test('embeds nothing without a URL or a known panel origin', () => {
    expect(resolveEmbeddedLoginUrl(undefined, '', PANEL)).toBe('');
    expect(resolveEmbeddedLoginUrl('   ', '', PANEL)).toBe('');
    expect(resolveEmbeddedLoginUrl(LOGIN, '', '')).toBe('');
  });
});

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

const renderDialog = (state: ProviderFlowState, embedUrl?: string) =>
  renderToStaticMarkup(
    createElement(
      I18nextProvider,
      { i18n },
      createElement(OAuthFlowDialog, {
        open: true,
        providerId: 'kiro',
        heading: { title: 'Kiro OAuth', caption: 'Plugin', icon: '' },
        state,
        text: (suffix: string) => i18n.t(`auth_login.plugin_${suffix}`, { name: 'Kiro' }),
        supportsCallback: true,
        embedUrl,
        onStart: () => {},
        onCancel: () => {},
        onCallbackChange: () => {},
        onCallbackSubmit: () => {},
        onViewAuthFiles: () => {},
        onClose: () => {},
      })
    )
  );

describe('plugin login dialog', () => {
  const waiting: ProviderFlowState = { status: 'waiting', url: LOGIN, state: 'abc123' };

  test('shows the plugin page inside the dialog with a new-tab fallback', () => {
    const markup = renderDialog(waiting, `${PANEL}${LOGIN}`);
    expect(markup).toContain('<iframe');
    expect(markup).toContain(`src="${PANEL}${LOGIN}"`);
    expect(markup).toContain('title="Kiro OAuth"');
    expect(markup).toContain('Open in a new tab');
    // 内嵌后不再要求用户自己打开链接或粘贴回调
    expect(markup).not.toContain('Open Link');
  });

  test('keeps the link steps when the page cannot be embedded', () => {
    const markup = renderDialog(waiting);
    expect(markup).not.toContain('<iframe');
    expect(markup).toContain('Open Link');
  });

  test('drops the frame once the login succeeds', () => {
    const markup = renderDialog({ ...waiting, status: 'success' }, `${PANEL}${LOGIN}`);
    expect(markup).not.toContain('<iframe');
    expect(markup).toContain('Authentication successful!');
  });
});
