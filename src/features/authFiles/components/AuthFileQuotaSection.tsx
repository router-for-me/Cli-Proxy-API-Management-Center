import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import {
  ANTIGRAVITY_CONFIG,
  CLAUDE_CONFIG,
  CODEX_CONFIG,
  DEEPSEEK_CONFIG,
  GEMINI_CLI_CONFIG,
  KIMI_CONFIG,
  OLLAMA_CONFIG
} from '@/components/quota';
import { useNotificationStore, useQuotaStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { getStatusFromError } from '@/utils/quota';
import {
  isRuntimeOnlyAuthFile,
  resolveQuotaErrorMessage,
  type QuotaProviderType
} from '@/features/authFiles/constants';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import styles from '@/pages/AuthFilesPage.module.scss';

type QuotaState = { status?: string; error?: string; errorStatus?: number } | undefined;

const getQuotaConfig = (type: QuotaProviderType) => {
  if (type === 'antigravity') return ANTIGRAVITY_CONFIG;
  if (type === 'claude') return CLAUDE_CONFIG;
  if (type === 'codex') return CODEX_CONFIG;
  if (type === 'kimi') return KIMI_CONFIG;
  if (type === 'ollama') return OLLAMA_CONFIG;
  if (type === 'deepseek') return DEEPSEEK_CONFIG;
  return GEMINI_CLI_CONFIG;
};

export type AuthFileQuotaSectionProps = {
  file: AuthFileItem;
  quotaType: QuotaProviderType;
  disableControls: boolean;
};

export function AuthFileQuotaSection(props: AuthFileQuotaSectionProps) {
  const { file, quotaType, disableControls } = props;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const quota = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.antigravityQuota[file.name] as QuotaState;
    if (quotaType === 'claude') return state.claudeQuota[file.name] as QuotaState;
    if (quotaType === 'codex') return state.codexQuota[file.name] as QuotaState;
    if (quotaType === 'kimi') return state.kimiQuota[file.name] as QuotaState;
    if (quotaType === 'ollama') return state.ollamaQuota[file.name] as QuotaState;
    if (quotaType === 'deepseek') return state.deepseekQuota[file.name] as QuotaState;
    return state.geminiCliQuota[file.name] as QuotaState;
  });

  const updateQuotaState = useQuotaStore((state) => {
    if (quotaType === 'antigravity') return state.setAntigravityQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'claude') return state.setClaudeQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'codex') return state.setCodexQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'kimi') return state.setKimiQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'ollama') return state.setOllamaQuota as unknown as (updater: unknown) => void;
    if (quotaType === 'deepseek') return state.setDeepSeekQuota as unknown as (updater: unknown) => void;
    return state.setGeminiCliQuota as unknown as (updater: unknown) => void;
  });

  // For providers whose backend already attaches a fresh balance to the
  // auth-files list response (ollama / deepseek), seed the store on mount so
  // the user sees the data immediately — no manual refresh required.
  // The seed is a one-shot per (file, quotaType) pair: it only fires when the
  // store still has nothing for this file. After the first seed, normal
  // user-driven refresh takes over.
  const seededKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (quota !== undefined) return;
    const config = getQuotaConfig(quotaType) as unknown as {
      extractInitialState?: (file: AuthFileItem) => unknown;
    };
    if (typeof config.extractInitialState !== 'function') return;
    const seedKey = `${quotaType}::${file.name}`;
    if (seededKeyRef.current === seedKey) return;
    const seed = config.extractInitialState(file);
    if (!seed) return;
    seededKeyRef.current = seedKey;
    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [file.name]: seed
    }));
  }, [file, quota, quotaType, updateQuotaState]);

  const refreshQuotaForFile = useCallback(async () => {
    if (disableControls) return;
    if (isRuntimeOnlyAuthFile(file)) return;
    if (file.disabled) return;
    if (quota?.status === 'loading') return;

    const config = getQuotaConfig(quotaType) as unknown as {
      i18nPrefix: string;
      fetchQuota: (file: AuthFileItem, t: TFunction) => Promise<unknown>;
      buildLoadingState: () => unknown;
      buildSuccessState: (data: unknown) => unknown;
      buildErrorState: (message: string, status?: number) => unknown;
      renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => unknown;
    };

    updateQuotaState((prev: Record<string, unknown>) => ({
      ...prev,
      [file.name]: config.buildLoadingState()
    }));

    try {
      const data = await config.fetchQuota(file, t);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: config.buildSuccessState(data)
      }));
      showNotification(t('auth_files.quota_refresh_success', { name: file.name }), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('common.unknown_error');
      const status = getStatusFromError(err);
      updateQuotaState((prev: Record<string, unknown>) => ({
        ...prev,
        [file.name]: config.buildErrorState(message, status)
      }));
      showNotification(t('auth_files.quota_refresh_failed', { name: file.name, message }), 'error');
    }
  }, [disableControls, file, quota?.status, quotaType, showNotification, t, updateQuotaState]);

  const config = getQuotaConfig(quotaType) as unknown as {
    i18nPrefix: string;
    renderQuotaItems: (quota: unknown, t: TFunction, helpers: unknown) => ReactNode;
  };

  const quotaStatus = quota?.status ?? 'idle';
  const canRefreshQuota = !disableControls && !file.disabled;
  const quotaErrorMessage = resolveQuotaErrorMessage(
    t,
    quota?.errorStatus,
    quota?.error || t('common.unknown_error')
  );

  return (
    <div className={styles.quotaSection}>
      {quotaStatus === 'loading' ? (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.loading`)}</div>
      ) : quotaStatus === 'idle' ? (
        <button
          type="button"
          className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
          onClick={() => void refreshQuotaForFile()}
          disabled={!canRefreshQuota}
        >
          {t(`${config.i18nPrefix}.idle`)}
        </button>
      ) : quotaStatus === 'error' ? (
        <div className={styles.quotaError}>
          {t(`${config.i18nPrefix}.load_failed`, {
            message: quotaErrorMessage
          })}
        </div>
      ) : quota ? (
        <>
          {config.renderQuotaItems(quota, t, { styles, QuotaProgressBar })}
          {quotaStatus === 'success' && canRefreshQuota && (
            <button
              type="button"
              className={`${styles.quotaMessage} ${styles.quotaMessageAction}`}
              onClick={() => void refreshQuotaForFile()}
            >
              {t('auth_files.quota_refresh_action', { defaultValue: '刷新' })}
            </button>
          )}
        </>
      ) : (
        <div className={styles.quotaMessage}>{t(`${config.i18nPrefix}.idle`)}</div>
      )}
    </div>
  );
}
