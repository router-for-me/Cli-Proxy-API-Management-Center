import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem } from '@/types';
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
};

export type UseAuthFilesPrefixProxyEditorOptions = {
  disableControls: boolean;
  applyLocalFilePatch: (name: string, patch: Partial<AuthFileItem>) => void;
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
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizeAuthFileKind = (value: unknown) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const resolveIsCodexFile = (file: AuthFileItem): boolean => {
  const normalizedType = normalizeAuthFileKind(file.type);
  const normalizedProvider = normalizeAuthFileKind(file.provider);
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

const readHeadersFromJson = (value: unknown): AuthFileHeaders => {
  if (!isRecordObject(value)) {
    return {};
  }

  return Object.entries(value).reduce<AuthFileHeaders>((result, [key, item]) => {
    if (typeof item !== 'string') {
      return result;
    }
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      return result;
    }
    result[normalizedKey] = item;
    return result;
  }, {});
};

const areStringArraysEqual = (left: string[], right: string[]): boolean => {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((value, index) => value === right[index]);
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
  const derivedHeaders = json.headers !== undefined ? JSON.stringify(json.headers, null, 2) : '';
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

const buildPrefixProxyPatchPayload = (
  editor: PrefixProxyEditorState,
  resolveHeadersError: (key: AuthFileHeadersErrorKey) => string
) => {
  const payload: Parameters<typeof authFilesApi.patchFields>[0] = {
    name: editor.fileName,
  };
  const source = editor.json ?? {};
  const sourcePriority = parsePriorityValue(source.priority);
  const nextPriority = parsePriorityValue(editor.priority);

  if (editor.prefix !== (typeof source.prefix === 'string' ? source.prefix : '')) {
    payload.prefix = editor.prefix;
  }
  if (editor.proxyUrl !== (typeof source.proxy_url === 'string' ? source.proxy_url : '')) {
    payload.proxy_url = editor.proxyUrl;
  }
  if (nextPriority !== sourcePriority) {
    payload.priority = nextPriority ?? null;
  }

  const sourceExcludedModels = normalizeExcludedModels(source.excluded_models);
  const nextExcludedModels = parseExcludedModelsText(editor.excludedModelsText);
  if (!areStringArraysEqual(sourceExcludedModels, nextExcludedModels)) {
    payload.excluded_models = nextExcludedModels;
  }

  const sourceDisableCooling = parseDisableCoolingValue(source.disable_cooling);
  const nextDisableCooling = parseDisableCoolingValue(editor.disableCooling);
  if (sourceDisableCooling !== nextDisableCooling) {
    payload.disable_cooling = nextDisableCooling ?? null;
  }

  const sourceUserAgent =
    typeof source.user_agent === 'string'
      ? source.user_agent.trim()
      : typeof source['user-agent'] === 'string'
        ? source['user-agent'].trim()
        : '';
  if (editor.userAgent !== sourceUserAgent) {
    payload.user_agent = editor.userAgent;
  }

  if (editor.isCodexFile) {
    const sourceWebsockets = readCodexAuthFileWebsockets(source);
    if (editor.websockets !== sourceWebsockets) {
      payload.websockets = editor.websockets;
    }
  }

  if (editor.noteTouched) {
    const sourceNote = typeof source.note === 'string' ? source.note : '';
    if (editor.note !== sourceNote) {
      payload.note = editor.note;
    }
  }

  if (editor.headersTouched) {
    const { value: nextHeaders, errorKey } = parseHeadersText(editor.headersText);
    if (errorKey) {
      throw new Error(resolveHeadersError(errorKey));
    }

    const sourceHeaders = readHeadersFromJson(source.headers);
    const headerPatch: AuthFileHeaders = {};
    const normalizedNextHeaders = nextHeaders ?? {};

    Object.entries(normalizedNextHeaders).forEach(([key, value]) => {
      if (sourceHeaders[key] !== value) {
        headerPatch[key] = value;
      }
    });

    Object.keys(sourceHeaders).forEach((key) => {
      if (!(key in normalizedNextHeaders)) {
        headerPatch[key] = '';
      }
    });

    if (Object.keys(headerPatch).length > 0) {
      payload.headers = headerPatch;
    }
  }

  return payload;
};

const buildLocalPatchedAuthFile = (
  editor: PrefixProxyEditorState,
  remoteFile?: AuthFileItem
): Partial<AuthFileItem> => {
  const nextTimestamp =
    remoteFile?.modtime ??
    remoteFile?.updated_at ??
    remoteFile?.modified ??
    new Date().toISOString();
  const parsedModified = Date.parse(String(nextTimestamp));

  return {
    ...remoteFile,
    prefix: editor.prefix,
    proxy_url: editor.proxyUrl,
    priority: parsePriorityValue(editor.priority),
    note: editor.note.trim(),
    user_agent: editor.userAgent.trim(),
    excluded_models: parseExcludedModelsText(editor.excludedModelsText),
    disable_cooling: parseDisableCoolingValue(editor.disableCooling),
    websockets: editor.isCodexFile ? editor.websockets : remoteFile?.websockets,
    modtime: nextTimestamp,
    updated_at: remoteFile?.updated_at ?? nextTimestamp,
    modified:
      typeof remoteFile?.modified === 'number'
        ? remoteFile.modified
        : Number.isNaN(parsedModified)
          ? Date.now()
          : parsedModified,
  };
};

export function useAuthFilesPrefixProxyEditor(
  options: UseAuthFilesPrefixProxyEditorOptions
): UseAuthFilesPrefixProxyEditorResult {
  const { disableControls, applyLocalFilePatch } = options;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null);
  const prefixProxyEditorRef = useRef<PrefixProxyEditorState | null>(null);

  useEffect(() => {
    prefixProxyEditorRef.current = prefixProxyEditor;
  }, [prefixProxyEditor]);

  const hasBlockingValidationError = Boolean(
    prefixProxyEditor?.headersTouched && prefixProxyEditor.headersError
  );
  const prefixProxyUpdatedText = useMemo(
    () =>
      prefixProxyEditor?.json && !hasBlockingValidationError
        ? buildPrefixProxyUpdatedText(prefixProxyEditor, (key) => t(key))
        : '',
    [hasBlockingValidationError, prefixProxyEditor, t]
  );
  const prefixProxyDirty = useMemo(
    () =>
      Boolean(prefixProxyEditor?.json) &&
      Boolean(prefixProxyEditor?.originalText) &&
      (prefixProxyUpdatedText === '' || prefixProxyUpdatedText !== prefixProxyEditor?.originalText),
    [prefixProxyEditor, prefixProxyUpdatedText]
  );

  const openPrefixProxyEditor = useCallback(
    async (file: AuthFileItem) => {
      const name = file.name;

      if (disableControls) return;
      if (prefixProxyEditorRef.current?.fileName === name) {
        setPrefixProxyEditor(null);
        return;
      }

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
    [disableControls, showNotification, t]
  );

  const closePrefixProxyEditor = useCallback(() => {
    setPrefixProxyEditor(null);
  }, []);

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

    let payload: Parameters<typeof authFilesApi.patchFields>[0];
    try {
      payload = buildPrefixProxyPatchPayload(current, (key) => t(key));
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : 'Invalid format';
      showNotification(errorMessage, 'error');
      return;
    }

    if (Object.keys(payload).length === 1) {
      setPrefixProxyEditor(null);
      return;
    }

    const { fileName } = current;
    setPrefixProxyEditor((prev) => {
      if (!prev || prev.fileName !== fileName) return prev;
      return { ...prev, saving: true };
    });

    try {
      const response = await authFilesApi.patchFields(payload);
      applyLocalFilePatch(fileName, buildLocalPatchedAuthFile(current, response.file));
      setPrefixProxyEditor(null);
      showNotification(t('auth_files.prefix_proxy_saved_success', { name: fileName }), 'success');
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== fileName) return prev;
        return { ...prev, saving: false };
      });
    }
  }, [applyLocalFilePatch, prefixProxyDirty, showNotification, t]);

  return {
    prefixProxyEditor,
    prefixProxyUpdatedText,
    prefixProxyDirty,
    openPrefixProxyEditor,
    closePrefixProxyEditor,
    handlePrefixProxyChange,
    handlePrefixProxySave,
  };
}
