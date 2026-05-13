import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconInfo,
  IconKey,
  IconShield,
  IconTimer,
} from '@/components/ui/icons';
import { useAuthStore, useLanguageStore, useNotificationStore, useUsageServiceStore } from '@/stores';
import {
  LEGACY_USAGE_SERVICE_LAST_CPA_BASE_KEY,
  USAGE_SERVICE_LAST_CPA_BASE_KEY,
  getUsageServiceErrorCode,
  isUsageServiceId,
  usageServiceApi
} from '@/services/api/usageService';
import { detectApiBaseFromLocation, normalizeApiBase } from '@/utils/connection';
import { LANGUAGE_LABEL_KEYS, LANGUAGE_ORDER } from '@/utils/constants';
import { isSupportedLanguage } from '@/utils/language';
import { INLINE_LOGO_JPEG } from '@/assets/logoInline';
import type { ApiError } from '@/types';
import styles from './LoginPage.module.scss';

/**
 * 将 API 错误转换为本地化的用户友好消息
 */
type RedirectState = { from?: { pathname?: string } };
type UsageSetupStep = 'connection' | 'auth' | 'monitoring' | 'polling' | 'review';

function getLocalizedErrorMessage(
  error: unknown,
  t: (key: string, options?: Record<string, unknown>) => string
): string {
  const usageServiceCode = getUsageServiceErrorCode(error);
  if (usageServiceCode) {
    return t(`usage_service_errors.${usageServiceCode}`, {
      defaultValue: t('usage_service_errors.request_failed'),
    });
  }

  const apiError = error as Partial<ApiError>;
  const status = typeof apiError.status === 'number' ? apiError.status : undefined;
  const code = typeof apiError.code === 'string' ? apiError.code : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof apiError.message === 'string'
        ? apiError.message
        : typeof error === 'string'
          ? error
          : '';

  // 根据 HTTP 状态码判断
  if (status === 401) {
    return t('login.error_unauthorized');
  }
  if (status === 403) {
    return t('login.error_forbidden');
  }
  if (status === 404) {
    return t('login.error_not_found');
  }
  if (status && status >= 500) {
    return t('login.error_server');
  }

  // 根据 axios 错误码判断
  if (code === 'ECONNABORTED' || message.toLowerCase().includes('timeout')) {
    return t('login.error_timeout');
  }
  if (code === 'ERR_NETWORK' || message.toLowerCase().includes('network error')) {
    return t('login.error_network');
  }
  if (code === 'ERR_CERT_AUTHORITY_INVALID' || message.toLowerCase().includes('certificate')) {
    return t('login.error_ssl');
  }

  // 检查 CORS 错误
  if (message.toLowerCase().includes('cors') || message.toLowerCase().includes('cross-origin')) {
    return t('login.error_cors');
  }

  // 默认错误消息
  return t('login.error_invalid');
}

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotification } = useNotificationStore();
  const language = useLanguageStore((state) => state.language);
  const setLanguage = useLanguageStore((state) => state.setLanguage);
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  const login = useAuthStore((state) => state.login);
  const restoreSession = useAuthStore((state) => state.restoreSession);
  const storedBase = useAuthStore((state) => state.apiBase);
  const storedKey = useAuthStore((state) => state.managementKey);
  const storedRememberPassword = useAuthStore((state) => state.rememberPassword);
  const setUsageServiceConfig = useUsageServiceStore((state) => state.setUsageServiceConfig);

  const [apiBase, setApiBase] = useState('');
  const [managementKey, setManagementKey] = useState('');
  const [showCustomBase, setShowCustomBase] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [requestMonitoringEnabled, setRequestMonitoringEnabled] = useState(true);
  const [pollIntervalMs, setPollIntervalMs] = useState('500');
  const [loading, setLoading] = useState(false);
  const [autoLoading, setAutoLoading] = useState(true);
  const [autoLoginSuccess, setAutoLoginSuccess] = useState(false);
  const [error, setError] = useState('');
  const [usageServiceMode, setUsageServiceMode] = useState(false);
  const [usageSetupStep, setUsageSetupStep] = useState<UsageSetupStep>('connection');

  const detectedBase = useMemo(() => detectApiBaseFromLocation(), []);
  const usageSetupSteps = useMemo<UsageSetupStep[]>(
    () => [
      'connection',
      'auth',
      'monitoring',
      ...(requestMonitoringEnabled ? (['polling'] as UsageSetupStep[]) : []),
      'review',
    ],
    [requestMonitoringEnabled]
  );
  const usageSetupStepIndex = Math.max(0, usageSetupSteps.indexOf(usageSetupStep));
  const usageSetupIsFirstStep = usageSetupStepIndex <= 0;
  const usageSetupIsLastStep = usageSetupStep === 'review';
  const usageSetupStepLabels = useMemo<Record<UsageSetupStep, string>>(
    () => ({
      connection: t('login.step_connection'),
      auth: t('login.step_auth'),
      monitoring: t('login.step_monitoring'),
      polling: t('login.step_polling'),
      review: t('login.step_review'),
    }),
    [t]
  );
  const languageOptions = useMemo(
    () =>
      LANGUAGE_ORDER.map((lang) => ({
        value: lang,
        label: t(LANGUAGE_LABEL_KEYS[lang])
      })),
    [t]
  );
  const handleLanguageChange = useCallback(
    (selectedLanguage: string) => {
      if (!isSupportedLanguage(selectedLanguage)) {
        return;
      }
      setLanguage(selectedLanguage);
    },
    [setLanguage]
  );

  useEffect(() => {
    const init = async () => {
      try {
        let detectedUsageService = false;
        try {
          const info = await usageServiceApi.getInfo(detectedBase);
          detectedUsageService = isUsageServiceId(info.service);
          setUsageServiceMode(detectedUsageService);
        } catch {
          detectedUsageService = false;
        }

        const autoLoggedIn = await restoreSession();
        if (detectedUsageService) {
          setUsageServiceConfig({ enabled: true, serviceBase: detectedBase });
        }
        if (autoLoggedIn) {
          setAutoLoginSuccess(true);
          // 延迟跳转，让用户看到成功动画
          setTimeout(() => {
            const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
            navigate(redirect, { replace: true });
          }, 1500);
        } else {
          const lastCPAForUsageService =
            localStorage.getItem(USAGE_SERVICE_LAST_CPA_BASE_KEY) ||
            localStorage.getItem(LEGACY_USAGE_SERVICE_LAST_CPA_BASE_KEY) ||
            '';
          setApiBase(
            detectedUsageService
              ? lastCPAForUsageService
              : storedBase || detectedBase
          );
          if (detectedUsageService) {
            setShowCustomBase(true);
          }
          setManagementKey(storedKey || '');
          setRememberPassword(storedRememberPassword || Boolean(storedKey));
        }
      } finally {
        if (!autoLoginSuccess) {
          setAutoLoading(false);
        }
      }
    };

    init();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!usageSetupSteps.includes(usageSetupStep)) {
      setUsageSetupStep('review');
    }
  }, [usageSetupStep, usageSetupSteps]);

  const validateUsageSetupStep = useCallback(
    (step: UsageSetupStep) => {
      if (step === 'connection' && !apiBase.trim()) {
        setError(t('login.cpa_address_required'));
        return false;
      }
      if (step === 'auth' && !managementKey.trim()) {
        setError(t('login.error_required'));
        return false;
      }
      if (step === 'polling') {
        const parsedPollIntervalMs = Number(pollIntervalMs);
        if (
          !/^\d+$/.test(pollIntervalMs.trim()) ||
          !Number.isFinite(parsedPollIntervalMs) ||
          parsedPollIntervalMs <= 0
        ) {
          setError(t('login.poll_interval_invalid'));
          return false;
        }
      }
      setError('');
      return true;
    },
    [apiBase, managementKey, pollIntervalMs, t]
  );

  const handleUsageSetupNext = useCallback(() => {
    if (!validateUsageSetupStep(usageSetupStep)) return;
    const currentIndex = usageSetupSteps.indexOf(usageSetupStep);
    const nextStep = usageSetupSteps[Math.min(currentIndex + 1, usageSetupSteps.length - 1)];
    setUsageSetupStep(nextStep);
  }, [usageSetupStep, usageSetupSteps, validateUsageSetupStep]);

  const handleUsageSetupBack = useCallback(() => {
    setError('');
    const currentIndex = usageSetupSteps.indexOf(usageSetupStep);
    const previousStep = usageSetupSteps[Math.max(currentIndex - 1, 0)];
    setUsageSetupStep(previousStep);
  }, [usageSetupStep, usageSetupSteps]);

  const handleSubmit = useCallback(async () => {
    if (usageServiceMode && !usageSetupIsLastStep) {
      handleUsageSetupNext();
      return;
    }

    if (!managementKey.trim()) {
      setError(t('login.error_required'));
      return;
    }

    const baseToUse = apiBase ? normalizeApiBase(apiBase) : detectedBase;
    if (usageServiceMode && !apiBase.trim()) {
      setError(t('login.cpa_address_required'));
      return;
    }
    const parsedPollIntervalMs = Number(pollIntervalMs);
    if (
      usageServiceMode &&
      requestMonitoringEnabled &&
      (!/^\d+$/.test(pollIntervalMs.trim()) || !Number.isFinite(parsedPollIntervalMs) || parsedPollIntervalMs <= 0)
    ) {
      setError(t('login.poll_interval_invalid'));
      return;
    }

    setLoading(true);
    setError('');
    try {
      if (usageServiceMode) {
        await usageServiceApi.setup(detectedBase, {
          cpaBaseUrl: baseToUse,
          managementKey: managementKey.trim(),
          pollIntervalMs: requestMonitoringEnabled ? parsedPollIntervalMs : undefined,
          ensureUsageStatisticsEnabled: requestMonitoringEnabled,
          requestMonitoringEnabled,
        });
        setUsageServiceConfig({ enabled: true, serviceBase: detectedBase });
        localStorage.setItem(USAGE_SERVICE_LAST_CPA_BASE_KEY, baseToUse);
      }
      await login({
        apiBase: usageServiceMode ? detectedBase : baseToUse,
        managementKey: managementKey.trim(),
        rememberPassword
      });
      showNotification(t('common.connected_status'), 'success');
      navigate('/', { replace: true });
    } catch (err: unknown) {
      const message = getLocalizedErrorMessage(err, t);
      setError(message);
      showNotification(`${t('notification.login_failed')}: ${message}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [
    apiBase,
    detectedBase,
    handleUsageSetupNext,
    login,
    managementKey,
    navigate,
    pollIntervalMs,
    requestMonitoringEnabled,
    rememberPassword,
    showNotification,
    setUsageServiceConfig,
    t,
    usageServiceMode,
    usageSetupIsLastStep,
  ]);

  const handleSubmitKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Enter' && !loading) {
        event.preventDefault();
        handleSubmit();
      }
    },
    [loading, handleSubmit]
  );

  if (isAuthenticated && !autoLoading && !autoLoginSuccess) {
    const redirect = (location.state as RedirectState | null)?.from?.pathname || '/';
    return <Navigate to={redirect} replace />;
  }

  // 显示启动动画（自动登录中或自动登录成功）
  const showSplash = autoLoading || autoLoginSuccess;

  return (
    <div className={styles.container}>
      {/* 左侧品牌展示区 */}
      <div className={styles.brandPanel}>
        <div className={styles.brandContent}>
          <span className={styles.brandWord}>CLI</span>
          <span className={styles.brandWord}>PROXY</span>
          <span className={styles.brandWord}>API</span>
        </div>
      </div>

      {/* 右侧功能交互区 */}
      <div className={styles.formPanel}>
        {showSplash ? (
          /* 启动动画 */
          <div className={styles.splashContent}>
            <img src={INLINE_LOGO_JPEG} alt="CPAMC" className={styles.splashLogo} />
            <h1 className={styles.splashTitle}>{t('splash.title')}</h1>
            <p className={styles.splashSubtitle}>{t('splash.subtitle')}</p>
            <div className={styles.splashLoader}>
              <div className={styles.splashLoaderBar} />
            </div>
          </div>
        ) : (
          /* 登录表单 */
          <div
            className={`${styles.formContent} ${
              usageServiceMode ? styles.setupFormContent : ''
            }`}
          >
            {/* Logo */}
            {!usageServiceMode && <img src={INLINE_LOGO_JPEG} alt="Logo" className={styles.logo} />}

            {/* 登录表单卡片 */}
            <div
              className={`${styles.loginCard} ${usageServiceMode ? styles.setupCard : ''}`}
            >
              {usageServiceMode ? (
                <div className={styles.setupHeader}>
                  <div className={styles.setupLanguage}>
                    <Select
                      className={styles.languageSelect}
                      value={language}
                      options={languageOptions}
                      onChange={handleLanguageChange}
                      fullWidth={false}
                      ariaLabel={t('language.switch')}
                    />
                  </div>
                  <img src={INLINE_LOGO_JPEG} alt="Logo" className={styles.setupLogo} />
                  <h1>CPA Manager</h1>
                  <p>{t('login.setup_title')}</p>
                </div>
              ) : (
                <div className={styles.loginHeader}>
                  <div className={styles.titleRow}>
                    <div className={styles.title}>{t('title.login')}</div>
                    <Select
                      className={styles.languageSelect}
                      value={language}
                      options={languageOptions}
                      onChange={handleLanguageChange}
                      fullWidth={false}
                      ariaLabel={t('language.switch')}
                    />
                  </div>
                  <div className={styles.subtitle}>{t('login.subtitle')}</div>
                </div>
              )}

              {usageServiceMode && (
                <div className={styles.setupFlow}>
                  <div className={styles.stepper} aria-label={t('login.setup_steps')}>
                    {usageSetupSteps.map((step, index) => {
                      const isActive = index === usageSetupStepIndex;
                      const isDone = index < usageSetupStepIndex;
                      return (
                        <div
                          key={step}
                          className={`${styles.stepItem} ${isActive ? styles.stepItemActive : ''} ${
                            isDone ? styles.stepItemDone : ''
                          }`}
                          aria-current={isActive ? 'step' : undefined}
                        >
                          <span className={styles.stepIndex}>
                            {isDone ? <IconCheck size={18} /> : index + 1}
                          </span>
                          <span className={styles.stepLabel}>{usageSetupStepLabels[step]}</span>
                        </div>
                      );
                    })}
                  </div>

                  <div className={styles.stepPanel}>
                    <div className={styles.stepHeader}>
                      <span className={styles.stepEyebrow}>
                        {t('login.step_count', {
                          current: usageSetupStepIndex + 1,
                          total: usageSetupSteps.length,
                        })}
                      </span>
                      <h2>{usageSetupStepLabels[usageSetupStep]}</h2>
                    </div>

                    {usageSetupStep === 'connection' && (
                      <div className={styles.stepFields}>
                        <div className={styles.connectionBox}>
                          <div className={styles.connectionIcon}>
                            <IconInfo size={18} />
                          </div>
                          <div className={styles.connectionCopy}>
                            <div className={styles.label}>
                              {t('login.usage_service_address')}
                            </div>
                            <div className={styles.value}>{detectedBase}</div>
                            <div className={styles.hint}>
                              {t('login.usage_service_mode_hint')}
                            </div>
                          </div>
                        </div>
                        <Input
                          autoFocus
                          label={t('login.cpa_connection_label')}
                          placeholder={t('login.cpa_connection_placeholder')}
                          value={apiBase}
                          onChange={(e) => setApiBase(e.target.value)}
                          onKeyDown={handleSubmitKeyDown}
                          hint={t('login.cpa_connection_hint')}
                        />
                      </div>
                    )}

                    {usageSetupStep === 'auth' && (
                      <div className={styles.stepFields}>
                        <div className={styles.authFieldBox}>
                          <Input
                            autoFocus
                            label={t('login.management_key_label')}
                            placeholder={t('login.management_key_placeholder')}
                            type={showKey ? 'text' : 'password'}
                            value={managementKey}
                            onChange={(e) => setManagementKey(e.target.value)}
                            onKeyDown={handleSubmitKeyDown}
                          />
                          <div className={styles.toggleAdvanced}>
                            <SelectionCheckbox
                              checked={rememberPassword}
                              onChange={setRememberPassword}
                              ariaLabel={t('login.remember_password_label')}
                              label={t('login.remember_password_label')}
                              labelClassName={styles.toggleLabel}
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {usageSetupStep === 'monitoring' && (
                      <div className={styles.stepFields}>
                        <div className={styles.optionBox}>
                          <SelectionCheckbox
                            checked={requestMonitoringEnabled}
                            onChange={setRequestMonitoringEnabled}
                            ariaLabel={t('login.request_monitoring_enabled')}
                            label={t('login.request_monitoring_enabled')}
                            labelClassName={styles.toggleLabel}
                          />
                          <p>
                            {requestMonitoringEnabled
                              ? t('login.request_monitoring_enabled_hint')
                              : t('login.request_monitoring_disabled_hint')}
                          </p>
                        </div>
                      </div>
                    )}

                    {usageSetupStep === 'polling' && (
                      <div className={styles.stepFields}>
                        <Input
                          autoFocus
                          label={t('login.poll_interval_label')}
                          type="number"
                          min="1"
                          placeholder="500"
                          value={pollIntervalMs}
                          onChange={(e) => setPollIntervalMs(e.target.value)}
                          onKeyDown={handleSubmitKeyDown}
                          hint={t('login.poll_interval_hint')}
                        />
                      </div>
                    )}

                    {usageSetupStep === 'review' && (
                      <div className={styles.reviewGrid}>
                        <div>
                          <span className={styles.reviewIcon}>
                            <IconInfo size={18} />
                          </span>
                          <span>{t('login.cpa_connection_label')}</span>
                          <strong>{apiBase || '-'}</strong>
                        </div>
                        <div>
                          <span className={styles.reviewIcon}>
                            <IconKey size={18} />
                          </span>
                          <span>{t('login.management_key_label')}</span>
                          <strong>{managementKey ? '••••••••••••' : '-'}</strong>
                        </div>
                        <div>
                          <span className={styles.reviewIcon}>
                            <IconEye size={18} />
                          </span>
                          <span>{t('login.request_monitoring_enabled')}</span>
                          <strong>
                            {requestMonitoringEnabled
                              ? t('common.enabled')
                              : t('common.disabled')}
                          </strong>
                        </div>
                        {requestMonitoringEnabled && (
                          <div>
                            <span className={styles.reviewIcon}>
                              <IconTimer size={18} />
                            </span>
                            <span>{t('login.poll_interval_label')}</span>
                            <strong>{pollIntervalMs}</strong>
                          </div>
                        )}
                        <div>
                          <span className={styles.reviewIcon}>
                            <IconShield size={18} />
                          </span>
                          <span>{t('login.remember_password_label')}</span>
                          <strong>
                            {rememberPassword
                              ? t('common.enabled')
                              : t('common.disabled')}
                          </strong>
                        </div>
                      </div>
                    )}
                  </div>

                  {error && <div className={styles.errorBox}>{error}</div>}

                  <div className={styles.stepActions}>
                    <Button
                      variant="secondary"
                      className={styles.setupBackButton}
                      onClick={handleUsageSetupBack}
                      disabled={usageSetupIsFirstStep || loading}
                    >
                      {t('common.previous')}
                    </Button>
                    {usageSetupIsLastStep ? (
                      <Button className={styles.setupNextButton} onClick={handleSubmit} loading={loading}>
                        {loading ? t('login.submitting') : t('login.submit_button')}
                      </Button>
                    ) : (
                      <Button className={styles.setupNextButton} onClick={handleUsageSetupNext} disabled={loading}>
                        {t('common.next')}
                      </Button>
                    )}
                  </div>
                </div>
              )}

              {!usageServiceMode && (
                <>
                  <div className={styles.connectionBox}>
                    <div className={styles.label}>{t('login.connection_current')}</div>
                    <div className={styles.value}>{apiBase || detectedBase}</div>
                    <div className={styles.hint}>{t('login.connection_auto_hint')}</div>
                  </div>

                  <div className={styles.toggleAdvanced}>
                    <SelectionCheckbox
                      checked={showCustomBase}
                      onChange={setShowCustomBase}
                      ariaLabel={t('login.custom_connection_label')}
                      label={t('login.custom_connection_label')}
                      labelClassName={styles.toggleLabel}
                    />
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
                            ? t('login.hide_key')
                            : t('login.show_key')
                        }
                        title={
                          showKey
                            ? t('login.hide_key')
                            : t('login.show_key')
                        }
                      >
                        {showKey ? <IconEyeOff size={16} /> : <IconEye size={16} />}
                      </button>
                    }
                  />

                  <div className={styles.toggleAdvanced}>
                    <SelectionCheckbox
                      checked={rememberPassword}
                      onChange={setRememberPassword}
                      ariaLabel={t('login.remember_password_label')}
                      label={t('login.remember_password_label')}
                      labelClassName={styles.toggleLabel}
                    />
                  </div>

                  <Button fullWidth onClick={handleSubmit} loading={loading}>
                    {loading ? t('login.submitting') : t('login.submit_button')}
                  </Button>

                  {error && <div className={styles.errorBox}>{error}</div>}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
