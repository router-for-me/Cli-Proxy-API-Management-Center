import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useNotificationStore } from '@/stores';
import { oauthApi, type OAuthProvider } from '@/services/api/oauth';
import { isLocalhost } from '@/utils/connection';

interface ProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
}

const PROVIDERS: { id: OAuthProvider; titleKey: string; hintKey: string; urlLabelKey: string }[] = [
  { id: 'codex', titleKey: 'auth_login.codex_oauth_title', hintKey: 'auth_login.codex_oauth_hint', urlLabelKey: 'auth_login.codex_oauth_url_label' },
  { id: 'anthropic', titleKey: 'auth_login.anthropic_oauth_title', hintKey: 'auth_login.anthropic_oauth_hint', urlLabelKey: 'auth_login.anthropic_oauth_url_label' },
  { id: 'antigravity', titleKey: 'auth_login.antigravity_oauth_title', hintKey: 'auth_login.antigravity_oauth_hint', urlLabelKey: 'auth_login.antigravity_oauth_url_label' },
  { id: 'gemini-cli', titleKey: 'auth_login.gemini_cli_oauth_title', hintKey: 'auth_login.gemini_cli_oauth_hint', urlLabelKey: 'auth_login.gemini_cli_oauth_url_label' },
  { id: 'qwen', titleKey: 'auth_login.qwen_oauth_title', hintKey: 'auth_login.qwen_oauth_hint', urlLabelKey: 'auth_login.qwen_oauth_url_label' },
  { id: 'iflow', titleKey: 'auth_login.iflow_oauth_title', hintKey: 'auth_login.iflow_oauth_hint', urlLabelKey: 'auth_login.iflow_oauth_url_label' }
];

export function OAuthPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [states, setStates] = useState<Record<OAuthProvider, ProviderState>>({} as Record<OAuthProvider, ProviderState>);
  const timers = useRef<Record<string, number>>({});

  const isLocal = useMemo(() => isLocalhost(window.location.hostname), []);

  useEffect(() => {
    return () => {
      Object.values(timers.current).forEach((timer) => window.clearInterval(timer));
    };
  }, []);

  const startPolling = (provider: OAuthProvider, state: string) => {
    if (timers.current[provider]) {
      clearInterval(timers.current[provider]);
    }
    const timer = window.setInterval(async () => {
      try {
        const res = await oauthApi.getAuthStatus(state);
        if (res.status === 'ok') {
          setStates((prev) => ({
            ...prev,
            [provider]: { ...prev[provider], status: 'success', polling: false }
          }));
          showNotification(t('auth_login.codex_oauth_status_success'), 'success');
          window.clearInterval(timer);
          delete timers.current[provider];
        } else if (res.status === 'error') {
          setStates((prev) => ({
            ...prev,
            [provider]: { ...prev[provider], status: 'error', error: res.error, polling: false }
          }));
          showNotification(`${t('auth_login.codex_oauth_status_error')} ${res.error || ''}`, 'error');
          window.clearInterval(timer);
          delete timers.current[provider];
        }
      } catch (err: any) {
        setStates((prev) => ({
          ...prev,
          [provider]: { ...prev[provider], status: 'error', error: err?.message, polling: false }
        }));
        window.clearInterval(timer);
        delete timers.current[provider];
      }
    }, 3000);
    timers.current[provider] = timer;
  };

  const startAuth = async (provider: OAuthProvider) => {
    setStates((prev) => ({
      ...prev,
      [provider]: { ...prev[provider], status: 'waiting', polling: true, error: undefined }
    }));
    try {
      const res = await oauthApi.startAuth(provider);
      setStates((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], url: res.url, state: res.state, status: 'waiting', polling: true }
      }));
      if (res.state) {
        startPolling(provider, res.state);
      }
    } catch (err: any) {
      setStates((prev) => ({
        ...prev,
        [provider]: { ...prev[provider], status: 'error', error: err?.message, polling: false }
      }));
      showNotification(`${t('auth_login.codex_oauth_start_error')} ${err?.message || ''}`, 'error');
    }
  };

  const copyLink = async (url?: string) => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showNotification(t('notification.link_copied'), 'success');
    } catch {
      showNotification('Copy failed', 'error');
    }
  };

  if (!isLocal) {
    return <Card title="OAuth">OAuth is only available on localhost.</Card>;
  }

  return (
    <div className="stack">
      {PROVIDERS.map((provider) => {
        const state = states[provider.id] || {};
        return (
          <Card
            key={provider.id}
            title={t(provider.titleKey)}
            extra={
              <Button onClick={() => startAuth(provider.id)} loading={state.polling}>
                {t('common.login')}
              </Button>
            }
          >
            <div className="hint">{t(provider.hintKey)}</div>
            {state.url && (
              <div className="connection-box">
                <div className="label">{t(provider.urlLabelKey)}</div>
                <div className="value">{state.url}</div>
                <div className="item-actions" style={{ marginTop: 8 }}>
                  <Button variant="secondary" size="sm" onClick={() => copyLink(state.url!)}>
                    {t('auth_login.codex_copy_link')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => window.open(state.url, '_blank', 'noopener,noreferrer')}
                  >
                    {t('auth_login.codex_open_link')}
                  </Button>
                </div>
              </div>
            )}
            <div className="status-badge" style={{ marginTop: 8 }}>
              {state.status === 'success'
                ? t('auth_login.codex_oauth_status_success')
                : state.status === 'error'
                  ? `${t('auth_login.codex_oauth_status_error')} ${state.error || ''}`
                  : state.status === 'waiting'
                    ? t('auth_login.codex_oauth_status_waiting')
                    : t('common.info')}
            </div>
          </Card>
        );
      })}
    </div>
  );
}
