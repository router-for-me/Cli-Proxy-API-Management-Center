import { useEffect, useRef, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconChevronDown, IconCopy, IconExternalLink, IconPlay, IconSend, IconX } from '@/components/ui/icons';
import { useNotificationStore } from '@/stores';
import { oauthApi, type OAuthProvider, type IFlowCookieAuthResponse } from '@/services/api/oauth';
import { isLocalhost } from '@/utils/connection';
import { cn } from '@/lib/utils';
import iconOpenai from '@/assets/icons/openai.png';
import iconClaude from '@/assets/icons/claude-color.png';
import iconGoogle from '@/assets/icons/google-color.png';
import iconGemini from '@/assets/icons/gemini-color.png';
import iconQwen from '@/assets/icons/qwen-color.png';
import iconCloudflare from '@/assets/icons/cloudflare-color.png';

interface ProviderState {
  url?: string;
  state?: string;
  status?: 'idle' | 'waiting' | 'success' | 'error';
  error?: string;
  polling?: boolean;
  callbackUrl?: string;
  submittingCallback?: boolean;
  showCallback?: boolean;
}

interface IFlowCookieState {
  cookie: string;
  loading: boolean;
  result?: IFlowCookieAuthResponse;
  error?: string;
  errorType?: 'error' | 'warning';
}

const PROVIDERS: { id: OAuthProvider; titleKey: string; hintKey: string; urlLabelKey: string; icon: string; hasProjectId?: boolean }[] = [
  { id: 'codex', titleKey: 'auth_login.codex_oauth_title', hintKey: 'auth_login.codex_oauth_hint', urlLabelKey: 'auth_login.codex_oauth_url_label', icon: iconOpenai },
  { id: 'anthropic', titleKey: 'auth_login.anthropic_oauth_title', hintKey: 'auth_login.anthropic_oauth_hint', urlLabelKey: 'auth_login.anthropic_oauth_url_label', icon: iconClaude },
  { id: 'antigravity', titleKey: 'auth_login.antigravity_oauth_title', hintKey: 'auth_login.antigravity_oauth_hint', urlLabelKey: 'auth_login.antigravity_oauth_url_label', icon: iconGoogle },
  { id: 'gemini-cli', titleKey: 'auth_login.gemini_cli_oauth_title', hintKey: 'auth_login.gemini_cli_oauth_hint', urlLabelKey: 'auth_login.gemini_cli_oauth_url_label', icon: iconGemini, hasProjectId: true },
  { id: 'qwen', titleKey: 'auth_login.qwen_oauth_title', hintKey: 'auth_login.qwen_oauth_hint', urlLabelKey: 'auth_login.qwen_oauth_url_label', icon: iconQwen },
  { id: 'iflow', titleKey: 'auth_login.iflow_oauth_title', hintKey: 'auth_login.iflow_oauth_hint', urlLabelKey: 'auth_login.iflow_oauth_url_label', icon: iconCloudflare }
];

export function OAuthPage() {
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [states, setStates] = useState<Record<OAuthProvider, ProviderState>>({} as Record<OAuthProvider, ProviderState>);
  const [iflowCookie, setIflowCookie] = useState<IFlowCookieState>({ cookie: '', loading: false });
  const [geminiProjectId, setGeminiProjectId] = useState('');
  const timers = useRef<Record<string, number>>({});
  const isLocal = useMemo(() => isLocalhost(window.location.hostname), []);

  useEffect(() => { return () => { Object.values(timers.current).forEach((timer) => window.clearInterval(timer)); }; }, []);

  const startPolling = (provider: OAuthProvider, state: string) => {
    if (timers.current[provider]) clearInterval(timers.current[provider]);
    const timer = window.setInterval(async () => {
      try {
        const res = await oauthApi.getAuthStatus(state);
        if (res.status === 'ok') {
          setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'success', polling: false } }));
          showNotification(t('auth_login.codex_oauth_status_success'), 'success');
          window.clearInterval(timer);
          delete timers.current[provider];
        } else if (res.status === 'error') {
          setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'error', error: res.error, polling: false } }));
          showNotification(`${t('auth_login.codex_oauth_status_error')} ${res.error || ''}`, 'error');
          window.clearInterval(timer);
          delete timers.current[provider];
        }
      } catch (err: any) {
        setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'error', error: err?.message, polling: false } }));
        window.clearInterval(timer);
        delete timers.current[provider];
      }
    }, 3000);
    timers.current[provider] = timer;
  };

  const startAuth = async (provider: OAuthProvider) => {
    setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'waiting', polling: true, error: undefined } }));
    try {
      const options = provider === 'gemini-cli' && geminiProjectId.trim() ? { projectId: geminiProjectId.trim() } : undefined;
      const res = await oauthApi.startAuth(provider, options);
      setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], url: res.url, state: res.state, status: 'waiting', polling: true } }));
      if (res.state) startPolling(provider, res.state);
    } catch (err: any) {
      setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'error', error: err?.message, polling: false } }));
      showNotification(`${t('auth_login.codex_oauth_start_error')} ${err?.message || ''}`, 'error');
    }
  };

  const submitCallbackUrl = async (provider: OAuthProvider) => {
    const state = states[provider];
    const callbackUrl = state?.callbackUrl?.trim();
    if (!callbackUrl || !state?.state) {
      showNotification(t('auth_login.callback_url_required'), 'warning');
      return;
    }
    setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], submittingCallback: true } }));
    try {
      const res = await oauthApi.submitCallback(state.state, callbackUrl);
      if (res.status === 'ok') {
        setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'success', polling: false, submittingCallback: false } }));
        showNotification(t('auth_login.codex_oauth_status_success'), 'success');
        if (timers.current[provider]) {
          clearInterval(timers.current[provider]);
          delete timers.current[provider];
        }
      } else {
        setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'error', error: res.error, submittingCallback: false } }));
        showNotification(`${t('auth_login.codex_oauth_status_error')} ${res.error || ''}`, 'error');
      }
    } catch (err: any) {
      setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], status: 'error', error: err?.message, submittingCallback: false } }));
      showNotification(`${t('auth_login.callback_submit_error')} ${err?.message || ''}`, 'error');
    }
  };

  const updateCallbackUrl = (provider: OAuthProvider, url: string) => {
    setStates((prev) => ({ ...prev, [provider]: { ...prev[provider], callbackUrl: url } }));
  };

  const copyLink = async (url?: string) => {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); showNotification(t('notification.link_copied'), 'success'); } catch { showNotification('Copy failed', 'error'); }
  };

  const submitIflowCookie = async () => {
    const cookie = iflowCookie.cookie.trim();
    if (!cookie) { showNotification(t('auth_login.iflow_cookie_required'), 'warning'); return; }
    setIflowCookie((prev) => ({ ...prev, loading: true, error: undefined, errorType: undefined, result: undefined }));
    try {
      const res = await oauthApi.iflowCookieAuth(cookie);
      if (res.status === 'ok') {
        setIflowCookie((prev) => ({ ...prev, loading: false, result: res }));
        showNotification(t('auth_login.iflow_cookie_status_success'), 'success');
      } else {
        setIflowCookie((prev) => ({ ...prev, loading: false, error: res.error, errorType: 'error' }));
        showNotification(`${t('auth_login.iflow_cookie_status_error')} ${res.error || ''}`, 'error');
      }
    } catch (err: any) {
      if (err?.status === 409) {
        const message = t('auth_login.iflow_cookie_config_duplicate');
        setIflowCookie((prev) => ({ ...prev, loading: false, error: message, errorType: 'warning' }));
        showNotification(message, 'warning');
        return;
      }
      setIflowCookie((prev) => ({ ...prev, loading: false, error: err?.message, errorType: 'error' }));
      showNotification(`${t('auth_login.iflow_cookie_start_error')} ${err?.message || ''}`, 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {PROVIDERS.map((provider) => {
          const state = states[provider.id] || {};
          const isDisabled = !isLocal;
          const isGeminiCli = provider.id === 'gemini-cli';
          const hasUrl = !!state.url;
          const isActive = hasUrl || state.polling;
          return (
            <div key={provider.id} className={cn("border border-border rounded-md bg-card overflow-hidden", isDisabled && "opacity-60 pointer-events-none")}>
              {/* 默认折叠状态 */}
              {!isActive && (
                <div className="flex items-center gap-3 p-4">
                  <img src={provider.icon} alt="" className="w-8 h-8 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-medium text-sm">{t(provider.titleKey)}</h3>
                    <p className="text-xs text-muted-foreground">{isDisabled ? t('auth_login.remote_access_disabled') : t(provider.hintKey)}</p>
                  </div>
                  {isGeminiCli && !isDisabled && (
                    <Input
                      value={geminiProjectId}
                      onChange={(e) => setGeminiProjectId(e.target.value)}
                      placeholder={t('auth_login.gemini_cli_project_id_placeholder')}
                      className="h-8 text-xs w-48"
                      required
                    />
                  )}
                  <Button variant="secondary" size="sm" onClick={() => startAuth(provider.id)} disabled={isDisabled || state.polling || (isGeminiCli && !geminiProjectId.trim())} title={t('common.login')} className="size-8 p-0 flex-shrink-0">
                    <IconPlay size={14} />
                  </Button>
                </div>
              )}
              
              {/* 展开状态 - 有 URL 时显示 */}
              {isActive && (
                <div className="p-4 space-y-4">
                  {/* 头部 */}
                  <div className="flex items-center gap-3">
                    <img src={provider.icon} alt="" className="w-8 h-8 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <h3 className="font-medium text-sm">{t(provider.titleKey)}</h3>
                      <p className="text-xs text-muted-foreground">{t(provider.hintKey)}</p>
                    </div>
                    {state.status && (
                      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", state.status === 'success' ? "bg-green-500" : state.status === 'error' ? "bg-red-500" : "bg-blue-500 animate-pulse")} />
                    )}
                    <Button variant="secondary" size="sm" onClick={() => startAuth(provider.id)} disabled={state.polling || (isGeminiCli && !geminiProjectId.trim())} title={t('common.login')} className="size-8 p-0 flex-shrink-0">
                      <IconPlay size={14} />
                    </Button>
                  </div>
                  
                  {/* 授权链接 */}
                  <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                    <code className="min-w-0 text-xs text-muted-foreground px-3 py-2.5 rounded-lg bg-muted/30 border border-border/60 truncate">{state.url}</code>
                    <Button variant="ghost" size="sm" onClick={() => copyLink(state.url!)} title={t('auth_login.copy_link')} className="size-8 p-0 flex-shrink-0">
                      <IconCopy size={16} />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => window.open(state.url, '_blank', 'noopener,noreferrer')} title={t('auth_login.open_link')} className="size-8 p-0 flex-shrink-0">
                      <IconExternalLink size={16} />
                    </Button>
                  </div>
                  
                  {/* 回调 URL - 可折叠 */}
                  <div className="pt-2 mt-1 border-t border-dashed border-border/40">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setStates((prev) => ({ ...prev, [provider.id]: { ...prev[provider.id], showCallback: !prev[provider.id]?.showCallback } }))}
                      className="h-auto p-0 flex items-center gap-1.5 text-xs text-muted-foreground/70 hover:text-muted-foreground"
                    >
                      <IconChevronDown size={12} className={cn("transition-transform", state.showCallback && "rotate-180")} />
                      <span>{t('auth_login.callback_url_summary')}</span>
                    </Button>
                    {state.showCallback && (
                      <div className="flex items-center gap-1.5 mt-2">
                        <input
                          type="text"
                          value={state.callbackUrl || ''}
                          onChange={(e) => updateCallbackUrl(provider.id, e.target.value)}
                          placeholder={t('auth_login.callback_url_placeholder')}
                          className="flex-1 min-w-0 h-8 px-3 text-xs rounded-md border border-border bg-background text-foreground outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
                        />
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => submitCallbackUrl(provider.id)}
                          disabled={state.submittingCallback || !state.callbackUrl?.trim()}
                          className="size-8 p-0"
                        >
                          <IconSend size={14} />
                        </Button>
                      </div>
                    )}
                  </div>
                  
                  {/* 错误信息 */}
                  {state.status === 'error' && (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-md bg-red-500/10 text-red-600 dark:text-red-400">
                      <IconX size={14} className="flex-shrink-0" />
                      <span className="text-xs">{state.error}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
        
        {/* iFlow Cookie */}
        <div className="border border-border rounded-md bg-card overflow-hidden">
          <div className="flex items-center gap-3 p-4">
            <img src={iconCloudflare} alt="" className="w-8 h-8 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <h3 className="font-medium text-sm">{t('auth_login.iflow_cookie_title')}</h3>
              <p className="text-xs text-muted-foreground">{t('auth_login.iflow_cookie_hint')}</p>
            </div>
            {iflowCookie.result?.status === 'ok' && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />}
            <Input 
              value={iflowCookie.cookie} 
              onChange={(e) => setIflowCookie((prev) => ({ ...prev, cookie: e.target.value }))} 
              placeholder={t('auth_login.iflow_cookie_placeholder')} 
              className="h-8 text-xs w-64" 
            />
            <Button variant="secondary" size="sm" onClick={submitIflowCookie} disabled={iflowCookie.loading} title="Submit" className="size-8 p-0 flex-shrink-0">
              <IconPlay size={14} />
            </Button>
          </div>
          {(iflowCookie.error || iflowCookie.result?.status === 'ok') && (
            <div className="border-t border-border px-4 py-2">
              {iflowCookie.error && <p className={cn("text-xs", iflowCookie.errorType === 'warning' ? "text-yellow-600" : "text-red-500")}>{iflowCookie.error}</p>}
              {iflowCookie.result?.status === 'ok' && (
                <p className="text-xs text-green-600">
                  {iflowCookie.result.email && <span>Email: {iflowCookie.result.email}</span>}
                  {iflowCookie.result.email && iflowCookie.result.expired && <span className="mx-2">|</span>}
                  {iflowCookie.result.expired && <span>Expires: {iflowCookie.result.expired}</span>}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
