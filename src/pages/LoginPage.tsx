import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { useAuthStore, useNotificationStore } from '@/stores';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
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

  if (isAuthenticated) {
    const redirect = (location.state as any)?.from?.pathname || '/';
    return <Navigate to={redirect} replace />;
  }

  const handleUseCurrent = () => {
    setApiBase(detectedBase);
  };

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
      navigate('/', { replace: true });
    } catch (err: any) {
      const message = err?.message || t('login.error_invalid');
      setError(message);
      showNotification(`${t('notification.login_failed')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="title">{t('title.login')}</div>
          <div className="subtitle">{t('login.subtitle')}</div>
        </div>

        <div className="connection-box">
          <div className="label">{t('login.connection_current')}</div>
          <div className="value">{apiBase || detectedBase}</div>
          <div className="hint">{t('login.connection_auto_hint')}</div>
        </div>

        <div className="toggle-advanced">
          <input
            id="custom-connection-toggle"
            type="checkbox"
            checked={showCustomBase}
            onChange={(e) => setShowCustomBase(e.target.checked)}
          />
          <label htmlFor="custom-connection-toggle">{t('login.custom_connection_label')}</label>
        </div>

        {showCustomBase && (
          <Input
            label={t('login.custom_connection_label')}
            placeholder={t('login.custom_connection_placeholder')}
            value={apiBase}
            onChange={(e) => setApiBase(e.target.value)}
            hint={t('login.custom_connection_hint')}
          />
        )}

        <Input
          label={t('login.management_key_label')}
          placeholder={t('login.management_key_placeholder')}
          type={showKey ? 'text' : 'password'}
          value={managementKey}
          onChange={(e) => setManagementKey(e.target.value)}
          rightElement={
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setShowKey((prev) => !prev)}
              aria-label={
                showKey
                  ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                  : t('login.show_key', { defaultValue: '显示密钥' })
              }
              title={
                showKey
                  ? t('login.hide_key', { defaultValue: '隐藏密钥' })
                  : t('login.show_key', { defaultValue: '显示密钥' })
              }
            >
              {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
            </button>
          }
        />

        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Button variant="secondary" onClick={handleUseCurrent}>
            {t('login.use_current_address')}
          </Button>
          <Button fullWidth onClick={handleSubmit} loading={loading}>
            {loading ? t('login.submitting') : t('login.submit_button')}
          </Button>
        </div>

        {error && <div className="error-box">{error}</div>}

        {autoLoading && (
          <div className="connection-box">
            <div className="label">{t('auto_login.title')}</div>
            <div className="value">{t('auto_login.message')}</div>
          </div>
        )}
      </div>
    </div>
  );
}
