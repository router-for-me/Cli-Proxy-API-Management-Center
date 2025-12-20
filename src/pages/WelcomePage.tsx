import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { IconEye, IconEyeOff, IconGithub, IconBookOpen, IconExternalLink, IconCode } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore } from '@/stores';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

export function WelcomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();

  // Get the path to redirect to after login (from router state or localStorage)
  const getRedirectPath = () => {
    const fromState = (location.state as { from?: { pathname: string } })?.from?.pathname;
    const savedPath = localStorage.getItem('cli-proxy-last-path');
    return fromState || savedPath || '/api-keys';
  };
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const storedBase = useAuthStore((state) => state.apiBase);
  const storedKey = useAuthStore((state) => state.managementKey);

  const [apiBase, setApiBase] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [showCustomBase, setShowCustomBase] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [error, setError] = useState('');

  const detectedBase = useMemo(() => detectApiBaseFromLocation(), []);

  useEffect(() => {
    const init = async () => {
      try {
        const autoLoggedIn = await restoreSession();
        if (!autoLoggedIn) {
          setApiBase(storedBase || detectedBase);
          setManagementKey(storedKey || '');
        }
      } finally {
        setAutoLoading(false);
      }
    };
    init();
  }, [detectedBase, restoreSession, storedBase, storedKey]);

  useEffect(() => {
    if (isAuthenticated) {
      navigate(getRedirectPath(), { replace: true });
    }
  }, [isAuthenticated, navigate]);

  const handleSubmit = async () => {
    if (!managementKey.trim()) {
      setError(t('login.error_required'));
      return;
    }
    const baseToUse = apiBase ? normalizeApiBase(apiBase) : detectedBase;
    setLoading(true);
    setError('');
    try {
      await login({ apiBase: baseToUse, managementKey: managementKey.trim() });
      showNotification(t('common.connected_status'), 'success');
      navigate(getRedirectPath(), { replace: true });
    } catch (err: any) {
      const message = err?.message || t('login.error_invalid');
      setError(message);
      showNotification(`${t('notification.login_failed')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full overflow-auto flex items-center justify-center">
      <div className="max-w-4xl w-full mx-auto px-4">
        {/* Welcome Title */}
        <div className="mb-6 -mt-12">
          <h2 className="text-2xl font-light text-foreground mb-2">{t('title.login')}</h2>
          <p className="text-sm text-muted-foreground">{t('login.subtitle')}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Left Column - Connect */}
          <div className="space-y-4">
            <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
              <span className="w-1 h-4 bg-primary" />
              {t('login.connection_current')}
            </h3>
            
            <div className="bg-muted/30 border border-border p-3 rounded">
              <div className="text-xs text-muted-foreground mb-1">{t('login.connection_current')}</div>
              <div className="text-sm font-mono break-all">{apiBase || detectedBase}</div>
            </div>

            <div className="flex items-center gap-2">
              <Switch id="custom-base" checked={showCustomBase} onCheckedChange={setShowCustomBase} />
              <Label htmlFor="custom-base" className="text-sm cursor-pointer">{t('login.custom_connection_label')}</Label>
            </div>

            {showCustomBase && (
              <Input
                placeholder={t('login.custom_connection_placeholder')}
                value={apiBase}
                onChange={(e) => setApiBase(e.target.value)}
                hint={t('login.custom_connection_hint')}
              />
            )}

            <div className="border-t border-border pt-4 space-y-4">
              <Input
                label={t('login.management_key_label')}
                placeholder={t('login.management_key_placeholder')}
                type={showKey ? 'text' : 'password'}
                value={managementKey}
                onChange={(e) => setManagementKey(e.target.value)}
                rightElement={
                  <Button
                    variant="ghost"
                    size="sm"
                    className="size-7 p-0"
                    onClick={() => setShowKey((prev) => !prev)}
                  >
                    {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                  </Button>
                }
              />

              <Button fullWidth onClick={handleSubmit} loading={loading}>
                {loading ? t('login.submitting') : t('login.submit_button')}
              </Button>

              {error && (
                <div className="bg-destructive/10 text-destructive text-sm p-3 rounded">
                  {error}
                </div>
              )}

              {autoLoading && (
                <div className="bg-muted/30 border border-border p-3 rounded">
                  <div className="text-xs text-muted-foreground">{t('auto_login.title')}</div>
                  <div className="text-sm mt-1">{t('auto_login.message')}</div>
                </div>
              )}
            </div>
          </div>

          {/* Right Column - Help & Links */}
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                <span className="w-1 h-4 bg-primary" />
                {t('welcome.help')}
              </h3>
              <div className="space-y-2">
                <a
                  href="https://github.com/router-for-me/CLIProxyAPI"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 border border-border rounded hover:bg-muted/50 transition-colors group"
                >
                  <IconGithub size={18} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm flex items-center gap-1">
                      {t('welcome.main_repo_title')}
                      <IconExternalLink size={12} className="text-muted-foreground" />
                    </div>
                    <div className="text-xs text-muted-foreground">{t('welcome.main_repo_desc')}</div>
                  </div>
                </a>
                <a
                  href="https://github.com/router-for-me/Cli-Proxy-API-Management-Center"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 border border-border rounded hover:bg-muted/50 transition-colors group"
                >
                  <IconCode size={18} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm flex items-center gap-1">
                      {t('welcome.webui_repo_title')}
                      <IconExternalLink size={12} className="text-muted-foreground" />
                    </div>
                    <div className="text-xs text-muted-foreground">{t('welcome.webui_repo_desc')}</div>
                  </div>
                </a>
                <a
                  href="https://help.router-for.me/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 p-3 border border-border rounded hover:bg-muted/50 transition-colors group"
                >
                  <IconBookOpen size={18} className="text-muted-foreground group-hover:text-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm flex items-center gap-1">
                      {t('welcome.docs_title')}
                      <IconExternalLink size={12} className="text-muted-foreground" />
                    </div>
                    <div className="text-xs text-muted-foreground">{t('welcome.docs_desc')}</div>
                  </div>
                </a>
              </div>
            </div>

            <div>
              <h3 className="text-sm font-medium text-foreground mb-4 flex items-center gap-2">
                <span className="w-1 h-4 bg-primary" />
                {t('welcome.about')}
              </h3>
              <div className="text-xs text-muted-foreground">
                <p>{t('welcome.description')}</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
