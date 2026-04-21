import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { authFilesApi } from '@/services/api';
import { oauthApi, type OAuthProvider } from '@/services/api/oauth';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
import { MAX_AUTH_FILE_SIZE } from '@/utils/constants';
import { formatFileSize } from '@/utils/format';
import { resolveGeminiCliProjectId } from '@/utils/quota/resolvers';
import {
  applyCodexAuthFileWebsockets,
  normalizeExcludedModels,
  parseDisableCoolingValue,
  parseExcludedModelsText,
  parsePriorityValue,
  readCodexAuthFileWebsockets,
} from '@/features/authFiles/constants';

type AuthFileHeaders = Record<string, string>;
type AuthFileHeadersErrorKey =
  | 'auth_files.headers_invalid_json'
  | 'auth_files.headers_invalid_object'
  | 'auth_files.headers_invalid_value';
type RefreshConfig = {
  provider: OAuthProvider;
  providerI18nPrefix: string;
};
type RefreshCallbackStatus = 'success' | 'error' | null;

const AUTH_FILE_REFRESH_CONFIG: Record<string, RefreshConfig> = {
  anthropic: { provider: 'anthropic', providerI18nPrefix: 'anthropic' },
  antigravity: { provider: 'antigravity', providerI18nPrefix: 'antigravity' },
  claude: { provider: 'anthropic', providerI18nPrefix: 'anthropic' },
  codex: { provider: 'codex', providerI18nPrefix: 'codex' },
  'gemini-cli': { provider: 'gemini-cli', providerI18nPrefix: 'gemini_cli' },
  kimi: { provider: 'kimi', providerI18nPrefix: 'kimi' },
  qwen: { provider: 'qwen', providerI18nPrefix: 'qwen' },
};

const REFRESH_CALLBACK_SUPPORTED = new Set<OAuthProvider>([
  'anthropic',
  'antigravity',
  'codex',
  'gemini-cli',
]);

export type PrefixProxyEditorField =
  | 'prefix'
  | 'proxyUrl'
  | 'priority'
  | 'excludedModelsText'
  | 'disableCooling'
  | 'userAgent'
  | 'websockets'
  | 'note'
  | 'headersText';

export type PrefixProxyEditorFieldValue = string | boolean;

export type PrefixProxyEditorRefreshStatus = 'idle' | 'starting' | 'waiting' | 'success' | 'error';

export type PrefixProxyEditorRefreshState = {
  supported: boolean;
  provider: OAuthProvider | null;
  providerI18nPrefix: string;
  projectId: string;
  url: string;
  authState: string;
  status: PrefixProxyEditorRefreshStatus;
  error: string | null;
  callbackUrl: string;
  callbackSubmitting: boolean;
  callbackStatus: RefreshCallbackStatus;
  callbackError: string | null;
};

export type PrefixProxyEditorState = {
  file: AuthFileItem;
  fileName: string;
  fileInfoText: string;
  isCodexFile: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  originalText: string;
  rawText: string;
  json: Record<string, unknown> | null;
  prefix: string;
  proxyUrl: string;
  priority: string;
  excludedModelsText: string;
  disableCooling: string;
  userAgent: string;
  websockets: boolean;
  note: string;
  noteTouched: boolean;
  headersText: string;
  headersTouched: boolean;
  headersError: string | null;
  refresh: PrefixProxyEditorRefreshState;
};

export type UseAuthFilesPrefixProxyEditorOptions = {
  disableControls: boolean;
  loadFiles: () => Promise<void>;
  loadKeyStats: () => Promise<void>;
};

export type UseAuthFilesPrefixProxyEditorResult = {
  prefixProxyEditor: PrefixProxyEditorState | null;
  prefixProxyUpdatedText: string;
  prefixProxyDirty: boolean;
  openPrefixProxyEditor: (file: AuthFileItem) => Promise<void>;
  closePrefixProxyEditor: () => void;
  handlePrefixProxyChange: (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => void;
  handlePrefixProxySave: () => Promise<void>;
  handleRefreshToken: () => Promise<void>;
  handleRefreshCallbackUrlChange: (value: string) => void;
  handleRefreshCallbackSubmit: () => Promise<void>;
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getErrorStatus = (error: unknown): number | undefined => {
  if (!isRecordObject(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
};

const getAuthLoginKey = (providerI18nPrefix: string, suffix: string) =>
  `auth_login.${providerI18nPrefix}_${suffix}`;

const normalizeRefreshKey = (value: unknown) => String(value ?? '').trim().toLowerCase();

const resolveRefreshConfig = (file: AuthFileItem): RefreshConfig | null => {
  const candidates = [file.provider, file.type];

  for (const candidate of candidates) {
    const config = AUTH_FILE_REFRESH_CONFIG[normalizeRefreshKey(candidate)];
    if (config) return config;
  }

  return null;
};

const buildRefreshState = (
  file: AuthFileItem,
  previous?: PrefixProxyEditorRefreshState
): PrefixProxyEditorRefreshState => {
  const config = resolveRefreshConfig(file);
  const projectId =
    previous?.projectId ??
    (config?.provider === 'gemini-cli' ? resolveGeminiCliProjectId(file) ?? '' : '');

  return {
    supported: Boolean(config),
    provider: config?.provider ?? null,
    providerI18nPrefix: config?.providerI18nPrefix ?? '',
    projectId,
    url: previous?.url ?? '',
    authState: previous?.authState ?? '',
    status: previous?.status ?? 'idle',
    error: previous?.error ?? null,
    callbackUrl: previous?.callbackUrl ?? '',
    callbackSubmitting: previous?.callbackSubmitting ?? false,
    callbackStatus: previous?.callbackStatus ?? null,
    callbackError: previous?.callbackError ?? null,
  };
};

const resolveIsCodexFile = (file: AuthFileItem): boolean => {
  const normalizedType = normalizeRefreshKey(file.type);
  const normalizedProvider = normalizeRefreshKey(file.provider);
  return normalizedType === 'codex' || normalizedProvider === 'codex';
};

const createEditorState = (file: AuthFileItem): PrefixProxyEditorState => ({
  file,
  fileName: file.name,
  fileInfoText: JSON.stringify(file, null, 2),
  isCodexFile: resolveIsCodexFile(file),
  loading: true,
  saving: false,
  error: null,
  originalText: '',
  rawText: '',
  json: null,
  prefix: '',
  proxyUrl: '',
  priority: '',
  excludedModelsText: '',
  disableCooling: '',
  userAgent: '',
  websockets: false,
  note: '',
  noteTouched: false,
  headersText: '',
  headersTouched: false,
  headersError: null,
  refresh: buildRefreshState(file),
});

export const extractAuthFileAccessToken = (metadata: Record<string, unknown> | null): string => {
  if (!metadata) return '';

  const topLevelCandidates = [metadata.accessToken, metadata.access_token];
  for (const candidate of topLevelCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  const tokenValue = metadata.token;
  if (typeof tokenValue === 'string' && tokenValue.trim()) {
    return tokenValue.trim();
  }
  if (!isRecordObject(tokenValue)) {
    return '';
  }

  const nestedCandidates = [tokenValue.accessToken, tokenValue.access_token];
  for (const candidate of nestedCandidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate.trim();
    }
  }

  return '';
};

export const isPrefixProxyRefreshCallbackSupported = (
  refresh: PrefixProxyEditorRefreshState
): boolean => Boolean(refresh.provider && REFRESH_CALLBACK_SUPPORTED.has(refresh.provider));

const validateHeadersValue = (value: unknown): AuthFileHeadersErrorKey | null => {
  if (!isRecordObject(value)) {
    return 'auth_files.headers_invalid_object';
  }
  return Object.values(value).every((item) => typeof item === 'string')
    ? null
    : 'auth_files.headers_invalid_value';
};

const parseHeadersText = (
  text: string
): { value: AuthFileHeaders | null; errorKey: AuthFileHeadersErrorKey | null } => {
  const trimmed = text.trim();
  if (!trimmed) {
    return { value: null, errorKey: null };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    return { value: null, errorKey: 'auth_files.headers_invalid_json' };
  }

  const errorKey = validateHeadersValue(parsed);
  if (errorKey) {
    return { value: null, errorKey };
  }

  return { value: parsed as AuthFileHeaders, errorKey: null };
};

const buildPrefixProxyUpdatedText = (
  editor: PrefixProxyEditorState | null,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string
): string => {
  if (!editor?.json) return editor?.rawText ?? '';

  const next: Record<string, unknown> = { ...editor.json };
  if ('prefix' in next || editor.prefix.trim()) {
    next.prefix = editor.prefix;
  }
  if ('proxy_url' in next || editor.proxyUrl.trim()) {
    next.proxy_url = editor.proxyUrl;
  }

  const parsedPriority = parsePriorityValue(editor.priority);
  if (parsedPriority !== undefined) {
    next.priority = parsedPriority;
  } else if ('priority' in next) {
    delete next.priority;
  }

  const excludedModels = parseExcludedModelsText(editor.excludedModelsText);
  if (excludedModels.length > 0) {
    next.excluded_models = excludedModels;
  } else if ('excluded_models' in next) {
    delete next.excluded_models;
  }

  const parsedDisableCooling = parseDisableCoolingValue(editor.disableCooling);
  if (parsedDisableCooling !== undefined) {
    next.disable_cooling = parsedDisableCooling;
  } else if ('disable_cooling' in next) {
    delete next.disable_cooling;
  }

  const trimmedUserAgent = editor.userAgent.trim();
  if (trimmedUserAgent) {
    next.user_agent = trimmedUserAgent;
    delete next['user-agent'];
  } else {
    delete next.user_agent;
    delete next['user-agent'];
  }

  if (editor.noteTouched) {
    const noteValue = editor.note.trim();
    if (noteValue) {
      next.note = editor.note;
    } else if ('note' in next) {
      delete next.note;
    }
  }

  if (editor.headersTouched) {
    const { value: parsedHeaders, errorKey } = parseHeadersText(editor.headersText);
    if (errorKey) {
      throw new Error(resolveHeadersError(errorKey));
    }
    if (parsedHeaders) {
      next.headers = parsedHeaders;
    } else {
      delete next.headers;
    }
  }

  return JSON.stringify(
    editor.isCodexFile ? applyCodexAuthFileWebsockets(next, editor.websockets) : next
  );
};

const buildLoadedPrefixProxyEditorState = (
  file: AuthFileItem,
  rawText: string,
  t: TFunction,
  previous?: PrefixProxyEditorState | null
): PrefixProxyEditorState => {
  const base = createEditorState(file);
  base.loading = false;
  base.saving = previous?.saving ?? false;
  base.refresh = buildRefreshState(file, previous?.refresh);

  const trimmed = rawText.trim();
  let parsed: unknown;

  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    return {
      ...base,
      error: t('auth_files.prefix_proxy_invalid_json'),
      rawText: trimmed,
      originalText: trimmed,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      ...base,
      error: t('auth_files.prefix_proxy_invalid_json'),
      rawText: trimmed,
      originalText: trimmed,
    };
  }

  const json = { ...(parsed as Record<string, unknown>) };
  if (base.isCodexFile) {
    const normalizedWebsockets = readCodexAuthFileWebsockets(json);
    delete json.websocket;
    json.websockets = normalizedWebsockets;
  }

  const originalText = JSON.stringify(json);
  const derivedPriority = parsePriorityValue(json.priority);
  const derivedHeaders =
    json.headers !== undefined ? JSON.stringify(json.headers, null, 2) : '';
  const derivedHeadersError = derivedHeaders
    ? (() => {
        const { errorKey } = parseHeadersText(derivedHeaders);
        return errorKey ? t(errorKey) : null;
      })()
    : null;
  const derivedState = {
    prefix: typeof json.prefix === 'string' ? json.prefix : '',
    proxyUrl: typeof json.proxy_url === 'string' ? json.proxy_url : '',
    priority: derivedPriority !== undefined ? String(derivedPriority) : '',
    excludedModelsText: normalizeExcludedModels(json.excluded_models).join('\n'),
    disableCooling:
      parseDisableCoolingValue(json.disable_cooling) === undefined
        ? ''
        : parseDisableCoolingValue(json.disable_cooling)
          ? 'true'
          : 'false',
    userAgent:
      typeof json.user_agent === 'string'
        ? json.user_agent.trim()
        : typeof json['user-agent'] === 'string'
          ? json['user-agent'].trim()
          : '',
    websockets: readCodexAuthFileWebsockets(json),
    note: typeof json.note === 'string' ? json.note : '',
    noteTouched: false,
    headersText: derivedHeaders,
    headersTouched: false,
    headersError: derivedHeadersError,
  };

  if (!previous || previous.fileName !== file.name) {
    return {
      ...base,
      originalText,
      rawText: originalText,
      json,
      ...derivedState,
    };
  }

  return {
    ...base,
    originalText,
    rawText: originalText,
    json,
    prefix: previous.prefix,
    proxyUrl: previous.proxyUrl,
    priority: previous.priority,
    excludedModelsText: previous.excludedModelsText,
    disableCooling: previous.disableCooling,
    userAgent: previous.userAgent,
    websockets: previous.websockets,
    note: previous.note,
    noteTouched: previous.noteTouched,
    headersText: previous.headersText,
    headersTouched: previous.headersTouched,
    headersError: previous.headersTouched ? previous.headersError : derivedHeadersError,
  };
};

const buildNotificationMessage = (prefix: string, detail: string) =>
  detail ? `${prefix} ${detail}` : prefix;

export function useAuthFilesPrefixProxyEditor(
  options: UseAuthFilesPrefixProxyEditorOptions
): UseAuthFilesPrefixProxyEditorResult {
  const { disableControls, loadFiles, loadKeyStats } = options;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null);
  const prefixProxyEditorRef = useRef<PrefixProxyEditorState | null>(null);
  const refreshTimerRef = useRef<number | null>(null);

  useEffect(() => {
    prefixProxyEditorRef.current = prefixProxyEditor;
  }, [prefixProxyEditor]);

  const clearRefreshPolling = useCallback(() => {
    if (refreshTimerRef.current === null) return;
    window.clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = null;
  }, []);

  useEffect(() => () => clearRefreshPolling(), [clearRefreshPolling]);

  const setRefreshState = useCallback(
    (fileName: string, updater: Partial<PrefixProxyEditorRefreshState>) => {
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== fileName) return prev;
        return { ...prev, refresh: { ...prev.refresh, ...updater } };
      });
    },
    []
  );

  const hasBlockingValidationError = Boolean(
    prefixProxyEditor?.headersTouched && prefixProxyEditor.headersError
  );
  const prefixProxyUpdatedText =
    prefixProxyEditor?.json && !hasBlockingValidationError
      ? buildPrefixProxyUpdatedText(prefixProxyEditor, (key) => t(key))
      : '';
  const prefixProxyDirty =
    Boolean(prefixProxyEditor?.json) &&
    Boolean(prefixProxyEditor?.originalText) &&
    (prefixProxyUpdatedText === '' || prefixProxyUpdatedText !== prefixProxyEditor?.originalText);

  const openPrefixProxyEditor = useCallback(
    async (file: AuthFileItem) => {
      const name = file.name;

      if (disableControls) return;
      if (prefixProxyEditorRef.current?.fileName === name) {
        clearRefreshPolling();
        setPrefixProxyEditor(null);
        return;
      }

      clearRefreshPolling();
      setPrefixProxyEditor(createEditorState(file));

      try {
        const rawText = await authFilesApi.downloadText(name);
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return buildLoadedPrefixProxyEditorState(file, rawText, t);
        });
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : t('notification.download_failed');
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return { ...prev, loading: false, error: errorMessage, rawText: '' };
        });
        showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
      }
    },
    [clearRefreshPolling, disableControls, showNotification, t]
  );

  const closePrefixProxyEditor = useCallback(() => {
    clearRefreshPolling();
    setPrefixProxyEditor(null);
  }, [clearRefreshPolling]);

  const handlePrefixProxyChange = useCallback(
    (field: PrefixProxyEditorField, value: PrefixProxyEditorFieldValue) => {
      setPrefixProxyEditor((prev) => {
        if (!prev) return prev;
        if (field === 'prefix') return { ...prev, prefix: String(value) };
        if (field === 'proxyUrl') return { ...prev, proxyUrl: String(value) };
        if (field === 'priority') return { ...prev, priority: String(value) };
        if (field === 'excludedModelsText') {
          return { ...prev, excludedModelsText: String(value) };
        }
        if (field === 'disableCooling') return { ...prev, disableCooling: String(value) };
        if (field === 'userAgent') return { ...prev, userAgent: String(value) };
        if (field === 'note') return { ...prev, note: String(value), noteTouched: true };
        if (field === 'headersText') {
          const headersText = String(value);
          const { errorKey } = parseHeadersText(headersText);
          return {
            ...prev,
            headersText,
            headersTouched: true,
            headersError: errorKey ? t(errorKey) : null,
          };
        }
        return { ...prev, websockets: Boolean(value) };
      });
    },
    [t]
  );

  const handlePrefixProxySave = useCallback(async () => {
    const current = prefixProxyEditorRef.current;
    if (!current?.json || !prefixProxyDirty) return;

    let payload = '';
    try {
      payload = buildPrefixProxyUpdatedText(current, (key) => t(key));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid format';
      showNotification(errorMessage, 'error');
      return;
    }

    const fileSize = new Blob([payload]).size;
    if (fileSize > MAX_AUTH_FILE_SIZE) {
      showNotification(
        t('auth_files.upload_error_size', { maxSize: formatFileSize(MAX_AUTH_FILE_SIZE) }),
        'error'
      );
      return;
    }

    const { fileName } = current;
    setPrefixProxyEditor((prev) => {
      if (!prev || prev.fileName !== fileName) return prev;
      return { ...prev, saving: true };
    });

    try {
      await authFilesApi.saveText(fileName, payload);
      showNotification(t('auth_files.prefix_proxy_saved_success', { name: fileName }), 'success');
      await loadFiles();
      await loadKeyStats();
      clearRefreshPolling();
      setPrefixProxyEditor(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== fileName) return prev;
        return { ...prev, saving: false };
      });
    }
  }, [clearRefreshPolling, loadFiles, loadKeyStats, prefixProxyDirty, showNotification, t]);

  const handleRefreshSuccess = useCallback(
    async (fileName: string, providerI18nPrefix: string) => {
      const current = prefixProxyEditorRef.current;

      try {
        if (current?.fileName === fileName) {
          const rawText = await authFilesApi.downloadText(fileName);
          setPrefixProxyEditor((prev) => {
            if (!prev || prev.fileName !== fileName) return prev;
            let preserveEdits = false;
            try {
              preserveEdits =
                buildPrefixProxyUpdatedText(prev, (key) => t(key)) !== prev.originalText;
            } catch {
              preserveEdits = true;
            }
            const next = buildLoadedPrefixProxyEditorState(
              prev.file,
              rawText,
              t,
              preserveEdits ? prev : undefined
            );
            return {
              ...next,
              refresh: {
                ...next.refresh,
                status: 'success',
                error: null,
                callbackSubmitting: false,
              },
            };
          });
        }

        void Promise.all([loadFiles(), loadKeyStats()]).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : t('notification.refresh_failed');
          showNotification(
            t('auth_files.refresh_token_reload_failed', { message }),
            'error'
          );
        });
        showNotification(t(getAuthLoginKey(providerI18nPrefix, 'oauth_status_success')), 'success');
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('notification.download_failed');
        setRefreshState(fileName, {
          status: 'error',
          error: message,
          callbackSubmitting: false,
        });
        showNotification(t('auth_files.refresh_token_reload_failed', { message }), 'error');
      }
    },
    [loadFiles, loadKeyStats, setRefreshState, showNotification, t]
  );

  const startRefreshPolling = useCallback(
    (fileName: string, providerI18nPrefix: string, authState: string) => {
      clearRefreshPolling();
      let inFlight = false;

      refreshTimerRef.current = window.setInterval(async () => {
        if (inFlight) return;
        inFlight = true;

        try {
          const response = await oauthApi.getAuthStatus(authState);
          if (response.status === 'wait') {
            return;
          }

          clearRefreshPolling();
          if (response.status === 'ok') {
            await handleRefreshSuccess(fileName, providerI18nPrefix);
            return;
          }

          const detail = response.error ?? '';
          setRefreshState(fileName, {
            status: 'error',
            error: detail,
            callbackSubmitting: false,
          });
          showNotification(
            buildNotificationMessage(
              t(getAuthLoginKey(providerI18nPrefix, 'oauth_status_error')),
              detail
            ),
            'error'
          );
        } catch (err: unknown) {
          const detail = err instanceof Error ? err.message : t('notification.refresh_failed');
          clearRefreshPolling();
          setRefreshState(fileName, {
            status: 'error',
            error: detail,
            callbackSubmitting: false,
          });
          showNotification(
            buildNotificationMessage(
              t(getAuthLoginKey(providerI18nPrefix, 'oauth_polling_error')),
              detail
            ),
            'error'
          );
        } finally {
          inFlight = false;
        }
      }, 3000);
    },
    [clearRefreshPolling, handleRefreshSuccess, setRefreshState, showNotification, t]
  );

  const handleRefreshToken = useCallback(async () => {
    const current = prefixProxyEditorRef.current;
    if (!current) return;

    const { fileName, refresh } = current;
    if (!refresh.supported || !refresh.provider || !refresh.providerI18nPrefix) return;

    setRefreshState(fileName, {
      status: 'starting',
      error: null,
      url: '',
      authState: '',
      callbackUrl: '',
      callbackSubmitting: false,
      callbackStatus: null,
      callbackError: null,
    });

    try {
      const options =
        refresh.provider === 'gemini-cli' && refresh.projectId.trim()
          ? { projectId: refresh.projectId.trim() }
          : undefined;
      const response = await oauthApi.startAuth(refresh.provider, options);
      if (!response.state) {
        throw new Error(t('auth_login.missing_state'));
      }

      setRefreshState(fileName, {
        status: 'waiting',
        error: null,
        url: response.url,
        authState: response.state,
        callbackStatus: null,
        callbackError: null,
      });
      startRefreshPolling(fileName, refresh.providerI18nPrefix, response.state);
    } catch (err: unknown) {
      const detail = err instanceof Error ? err.message : t('notification.refresh_failed');
      clearRefreshPolling();
      setRefreshState(fileName, {
        status: 'error',
        error: detail,
        callbackSubmitting: false,
      });
      showNotification(
        buildNotificationMessage(
          t(getAuthLoginKey(refresh.providerI18nPrefix, 'oauth_start_error')),
          detail
        ),
        'error'
      );
    }
  }, [clearRefreshPolling, setRefreshState, showNotification, startRefreshPolling, t]);

  const handleRefreshCallbackUrlChange = useCallback((value: string) => {
    setPrefixProxyEditor((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        refresh: {
          ...prev.refresh,
          callbackUrl: value,
          callbackStatus: null,
          callbackError: null,
        },
      };
    });
  }, []);

  const handleRefreshCallbackSubmit = useCallback(async () => {
    const current = prefixProxyEditorRef.current;
    if (!current) return;

    const { fileName, refresh } = current;
    if (!isPrefixProxyRefreshCallbackSupported(refresh) || !refresh.provider) return;

    const redirectUrl = refresh.callbackUrl.trim();
    if (!redirectUrl) {
      showNotification(t('auth_login.oauth_callback_required'), 'warning');
      return;
    }

    setRefreshState(fileName, {
      callbackSubmitting: true,
      callbackStatus: null,
      callbackError: null,
    });

    try {
      await oauthApi.submitCallback(refresh.provider, redirectUrl);
      setRefreshState(fileName, {
        callbackSubmitting: false,
        callbackStatus: 'success',
        callbackError: null,
      });
      showNotification(t('auth_login.oauth_callback_success'), 'success');
    } catch (err: unknown) {
      const status = getErrorStatus(err);
      const detail =
        status === 404
          ? t('auth_login.oauth_callback_upgrade_hint')
          : err instanceof Error
            ? err.message
            : t('notification.refresh_failed');
      setRefreshState(fileName, {
        callbackSubmitting: false,
        callbackStatus: 'error',
        callbackError: detail,
      });
      showNotification(buildNotificationMessage(t('auth_login.oauth_callback_error'), detail), 'error');
    }
  }, [setRefreshState, showNotification, t]);

  return {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
    handleRefreshToken,
    handleRefreshCallbackUrlChange,
    handleRefreshCallbackSubmit,
  };
}
