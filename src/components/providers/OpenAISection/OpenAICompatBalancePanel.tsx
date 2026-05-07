import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { ApiKeyEntry, OpenAIProviderConfig } from '@/types';
import { QuotaProgressBar } from '@/features/authFiles/components/QuotaProgressBar';
import { getStatusFromError } from '@/utils/quota';
import { resolveQuotaErrorMessage } from '@/features/authFiles/constants';
import authFileStyles from '@/pages/AuthFilesPage.module.scss';
import {
  ANYROUTER_PANEL_CONFIG,
  DEEPSEEK_PANEL_CONFIG,
  OLLAMA_PANEL_CONFIG,
  XIAOMI_PANEL_CONFIG,
  type OpenAICompatPanelConfig,
} from './openAICompatBalanceConfigs';
import { useOpenAICompatRefreshBus } from './openAICompatRefreshBus';

export type ProviderKind = 'ollama' | 'deepseek' | 'xiaomi' | 'anyrouter';

type PanelState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string; errorStatus?: number }
  | { status: 'success'; data: unknown };

const pickHeader = (
  bag: Record<string, string> | undefined,
  name: string
): string => {
  if (!bag) return '';
  const target = name.toLowerCase();
  for (const [k, v] of Object.entries(bag)) {
    if (k.toLowerCase() === target && typeof v === 'string') return v;
  }
  return '';
};

const buildRefreshParams = (
  kind: ProviderKind,
  provider: OpenAIProviderConfig,
  entry: ApiKeyEntry
) => {
  const cookie =
    pickHeader(entry.headers, 'Cookie') || pickHeader(provider.headers, 'Cookie');
  const newApiUser =
    pickHeader(entry.headers, 'new-api-user') ||
    pickHeader(provider.headers, 'new-api-user');
  const baseUrl = (provider.baseUrl || '').trim();
  switch (kind) {
    case 'ollama':
      return {
        provider: 'ollama' as const,
        baseUrl,
        apiKey: (entry.apiKey || '').trim(),
        cookie,
      };
    case 'deepseek':
      return {
        provider: 'deepseek' as const,
        baseUrl,
        balanceToken: (entry.balanceToken || '').trim(),
        cookie,
      };
    case 'xiaomi':
      return {
        provider: 'xiaomi' as const,
        baseUrl,
        cookie,
      };
    case 'anyrouter':
      return {
        provider: 'anyrouter' as const,
        baseUrl,
        cookie,
        newApiUser,
      };
  }
};

const PANEL_CONFIGS: Record<ProviderKind, OpenAICompatPanelConfig<unknown, unknown>> = {
  ollama: OLLAMA_PANEL_CONFIG,
  deepseek: DEEPSEEK_PANEL_CONFIG,
  xiaomi: XIAOMI_PANEL_CONFIG as unknown as OpenAICompatPanelConfig<unknown, unknown>,
  anyrouter: ANYROUTER_PANEL_CONFIG as unknown as OpenAICompatPanelConfig<unknown, unknown>,
};

export interface OpenAICompatBalancePanelProps {
  provider: OpenAIProviderConfig;
  entry: ApiKeyEntry;
  entryIndex: number;
  kind: ProviderKind;
  disabled: boolean;
}

export function OpenAICompatBalancePanel({
  provider,
  entry,
  entryIndex,
  kind,
  disabled,
}: OpenAICompatBalancePanelProps) {
  const providerDisabled = provider.disabled === true;
  // When the provider is disabled, also disable the panel's interactive
  // controls and skip bus registration so "refresh all" only hits active providers.
  const effectiveDisabled = providerDisabled || disabled;

  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const bus = useOpenAICompatRefreshBus();
  const config = PANEL_CONFIGS[kind];
  const i18nPrefix = config.i18nPrefix;

  const [state, setState] = useState<PanelState>({ status: 'idle' });
  // Reset to idle when underlying credentials change so we don't display stale
  // results after the user edits the entry.
  const credSigRef = useRef<string>('');
  useEffect(() => {
    const sig = JSON.stringify(buildRefreshParams(kind, provider, entry));
    if (credSigRef.current && credSigRef.current !== sig) {
      setState({ status: 'idle' });
    }
    credSigRef.current = sig;
  }, [kind, provider, entry]);

  // Live ref so the bus-registered callback always uses the freshest state
  // check. Without this, the callback closes over the initial state.status.
  const stateStatusRef = useRef(state.status);
  useEffect(() => {
    stateStatusRef.current = state.status;
  }, [state.status]);

  const refresh = useCallback(async () => {
    if (effectiveDisabled) return;
    if (stateStatusRef.current === 'loading') return;
    setState({ status: 'loading' });
    try {
      const params = buildRefreshParams(kind, provider, entry);
      const response = await authFilesApi.refreshOpenAICompatBalance(params);
      if (!response?.balance) {
        throw new Error(t(`${i18nPrefix}.empty`));
      }
      const data = config.buildSuccessState(response.balance);
      setState({ status: 'success', data });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : t('common.unknown_error');
      const errorStatus = getStatusFromError(err);
      setState({ status: 'error', message, errorStatus });
      showNotification(
        t(`${i18nPrefix}.refresh_failed`, { message }),
        'error'
      );
    }
  }, [config, effectiveDisabled, entry, i18nPrefix, kind, provider, showNotification, t]);

  // Subscribe to the section's "refresh all" bus.
  // Skip registration when the provider is disabled so refreshAll
  // only iterates over active providers.
  useEffect(() => {
    if (!bus) return;
    if (providerDisabled) return;
    const id = `${(provider.name || '').toLowerCase()}|${(provider.baseUrl || '').trim()}|${entry.authIndex || ''}|${(entry.apiKey || '').trim()}|${entryIndex}`;
    return bus.register(id, refresh);
  }, [bus, refresh, provider, entry, entryIndex, providerDisabled]);

  const errorText =
    state.status === 'error'
      ? resolveQuotaErrorMessage(t, state.errorStatus, state.message || t('common.unknown_error'))
      : '';

  return (
    <div className={authFileStyles.quotaSection} style={{ flexBasis: '100%' }}>
      {state.status === 'loading' ? (
        <div className={authFileStyles.quotaMessage}>{t(`${i18nPrefix}.loading`)}</div>
      ) : state.status === 'idle' ? (
        <button
          type="button"
          className={`${authFileStyles.quotaMessage} ${authFileStyles.quotaMessageAction}`}
          onClick={() => void refresh()}
          disabled={effectiveDisabled}
        >
          {t(`${i18nPrefix}.idle`)}
        </button>
      ) : state.status === 'error' ? (
        <>
          <div className={authFileStyles.quotaError}>
            {t(`${i18nPrefix}.load_failed`, { message: errorText })}
          </div>
          {!effectiveDisabled && (
            <button
              type="button"
              className={`${authFileStyles.quotaMessage} ${authFileStyles.quotaMessageAction}`}
              onClick={() => void refresh()}
            >
              {t('auth_files.quota_refresh_action', { defaultValue: '刷新' })}
            </button>
          )}
        </>
      ) : (
        <>
          {config.renderQuotaItems(state.data, t, {
            styles: authFileStyles,
            QuotaProgressBar,
          })}
          {!effectiveDisabled && (
            <button
              type="button"
              className={`${authFileStyles.quotaMessage} ${authFileStyles.quotaMessageAction}`}
              onClick={() => void refresh()}
            >
              {t('auth_files.quota_refresh_action', { defaultValue: '刷新' })}
            </button>
          )}
        </>
      )}
    </div>
  );
}
