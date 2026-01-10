import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { IconEye, IconEyeOff } from '@/components/ui/icons';
import { useAuthStore, useLanguageStore, useNotificationStore } from '@/stores';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const language = useLanguageStore((state) => state.language);
  const toggleLanguage = useLanguageStore((state) => state.toggleLanguage);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const storedBase = useAuthStore((state) => state.apiBase);
  const storedKey = useAuthStore((state) => state.managementKey);
  const storedRememberPassword = useAuthStore((state) => state.rememberPassword);

  const [apiBase, setApiBase] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [showCustomBase, setShowCustomBase] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [error, setError] = useState('');

  const detectedBase = useMemo(() => detectApiBaseFromLocation(), []);
  const nextLanguageLabel = language === 'zh-CN' ? t('language.english') : t('language.chinese');

  useEffect(() => {
    const init = async () => {
      try {
        const autoLoggedIn = await restoreSession();
        if (!autoLoggedIn) {
          setApiBase(storedBase || detectedBase);
          setManagementKey(storedKey || '');
          setRememberPassword(storedRememberPassword || Boolean(storedKey));
        }
      } finally {
        setAutoLoading(false);
      }
    };

    init();
  }, [detectedBase, restoreSession, storedBase, storedKey, storedRememberPassword]);

  const handleSubmit = async () => {
    if (!managementKey.trim()) {
      setError(t('login.error_required'));
      return;
    }

    const baseToUse = apiBase ? normalizeApiBase(apiBase) : detectedBase;
    setLoading(true);
    setError('');
    try {
      await login({
        apiBase: baseToUse,
        managementKey: managementKey.trim(),
        rememberPassword
      });
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

  const handleSubmitKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !loading) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [loading, handleSubmit]
  );

  if (isAuthenticated) {
    const redirect = (location.state as any)?.from?.pathname || '/';
    return <Navigate to={redirect} replace />;
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-title-row">
            <div className="title">{t('title.login')}</div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="login-language-btn"
              onClick={toggleLanguage}
              title={t('language.switch')}
              aria-label={t('language.switch')}
            >
              {nextLanguageLabel}
            </Button>
          </div>
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
          autoFocus
          label={t('login.management_key_label')}
          placeholder={t('login.management_key_placeholder')}
          type={showKey ? 'text' : 'password'}
          value={managementKey}
          onChange={(e) => setManagementKey(e.target.value)}
          onKeyDown={handleSubmitKeyDown}
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

        <div className="toggle-advanced">
          <input
            id="remember-password-toggle"
            type="checkbox"
            checked={rememberPassword}
            onChange={(e) => setRememberPassword(e.target.checked)}
          />
          <label htmlFor="remember-password-toggle">{t('login.remember_password_label')}</label>
        </div>

        <Button fullWidth onClick={handleSubmit} loading={loading}>
          {loading ? t('login.submitting') : t('login.submit_button')}
        </Button>

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
