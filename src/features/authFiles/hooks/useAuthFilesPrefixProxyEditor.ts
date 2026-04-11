import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import type { AuthFileItem } from '@/types';
import { useNotificationStore } from '@/stores';
import { formatFileSize } from '@/utils/format';
import { MAX_AUTH_FILE_SIZE } from '@/utils/constants';
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
  | 'websockets'
  | 'note'
  | 'headersText';

export type PrefixProxyEditorFieldValue = string | boolean;

export type PrefixProxyEditorState = {
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
  websockets: boolean;
  note: string;
  noteTouched: boolean;
  headersText: string;
  headersTouched: boolean;
  headersError: string | null;
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
};

const isRecordObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

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

export function useAuthFilesPrefixProxyEditor(
  options: UseAuthFilesPrefixProxyEditorOptions
): UseAuthFilesPrefixProxyEditorResult {
  const { disableControls, loadFiles, loadKeyStats } = options;
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);

  const [prefixProxyEditor, setPrefixProxyEditor] = useState<PrefixProxyEditorState | null>(null);

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

  const closePrefixProxyEditor = () => {
    setPrefixProxyEditor(null);
  };

  const openPrefixProxyEditor = async (file: AuthFileItem) => {
    const name = file.name;
    const normalizedType = String(file.type ?? '')
      .trim()
      .toLowerCase();
    const normalizedProvider = String(file.provider ?? '')
      .trim()
      .toLowerCase();
    const isCodexFile = normalizedType === 'codex' || normalizedProvider === 'codex';

    if (disableControls) return;
    if (prefixProxyEditor?.fileName === name) {
      setPrefixProxyEditor(null);
      return;
    }

    setPrefixProxyEditor({
      fileName: name,
      fileInfoText: JSON.stringify(file, null, 2),
      isCodexFile,
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
      websockets: false,
      note: '',
      noteTouched: false,
      headersText: '',
      headersTouched: false,
      headersError: null,
    });

    try {
      const rawText = await authFilesApi.downloadText(name);
      const trimmed = rawText.trim();

      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed) as unknown;
      } catch {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            loading: false,
            error: t('auth_files.prefix_proxy_invalid_json'),
            rawText: trimmed,
            originalText: trimmed,
          };
        });
        return;
      }

      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setPrefixProxyEditor((prev) => {
          if (!prev || prev.fileName !== name) return prev;
          return {
            ...prev,
            loading: false,
            error: t('auth_files.prefix_proxy_invalid_json'),
            rawText: trimmed,
            originalText: trimmed,
          };
        });
        return;
      }

      const json = { ...(parsed as Record<string, unknown>) };
      if (isCodexFile) {
        const normalizedWebsockets = readCodexAuthFileWebsockets(json);
        delete json.websocket;
        json.websockets = normalizedWebsockets;
      }
      const originalText = JSON.stringify(json);
      const prefix = typeof json.prefix === 'string' ? json.prefix : '';
      const proxyUrl = typeof json.proxy_url === 'string' ? json.proxy_url : '';
      const priority = parsePriorityValue(json.priority);
      const excludedModels = normalizeExcludedModels(json.excluded_models);
      const disableCoolingValue = parseDisableCoolingValue(json.disable_cooling);
      const websocketsValue = readCodexAuthFileWebsockets(json);
      const note = typeof json.note === 'string' ? json.note : '';
      const headers = json.headers;
      let headersText = '';
      let headersError: string | null = null;
      if (headers !== undefined) {
        headersText = JSON.stringify(headers, null, 2);
        const { errorKey } = parseHeadersText(headersText);
        headersError = errorKey ? t(errorKey) : null;
      }

      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return {
          ...prev,
          loading: false,
          originalText,
          rawText: originalText,
          json,
          prefix,
          proxyUrl,
          priority: priority !== undefined ? String(priority) : '',
          excludedModelsText: excludedModels.join('\n'),
          disableCooling:
            disableCoolingValue === undefined ? '' : disableCoolingValue ? 'true' : 'false',
          websockets: websocketsValue,
          note,
          noteTouched: false,
          headersText,
          headersTouched: false,
          headersError,
          error: null,
        };
      });
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : t('notification.download_failed');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, loading: false, error: errorMessage, rawText: '' };
      });
      showNotification(`${t('notification.download_failed')}: ${errorMessage}`, 'error');
    }
  };

  const handlePrefixProxyChange = (
    field: PrefixProxyEditorField,
    value: PrefixProxyEditorFieldValue
  ) => {
    setPrefixProxyEditor((prev) => {
      if (!prev) return prev;
      if (field === 'prefix') return { ...prev, prefix: String(value) };
      if (field === 'proxyUrl') return { ...prev, proxyUrl: String(value) };
      if (field === 'priority') return { ...prev, priority: String(value) };
      if (field === 'excludedModelsText') return { ...prev, excludedModelsText: String(value) };
      if (field === 'disableCooling') return { ...prev, disableCooling: String(value) };
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
  };

  const handlePrefixProxySave = async () => {
    if (!prefixProxyEditor?.json) return;
    if (!prefixProxyDirty) return;

    const name = prefixProxyEditor.fileName;
    let payload = '';
    try {
      payload = buildPrefixProxyUpdatedText(prefixProxyEditor, (key) => t(key));
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

    setPrefixProxyEditor((prev) => {
      if (!prev || prev.fileName !== name) return prev;
      return { ...prev, saving: true };
    });

    try {
      await authFilesApi.saveText(name, payload);
      showNotification(t('auth_files.prefix_proxy_saved_success', { name }), 'success');
      await loadFiles();
      await loadKeyStats();
      setPrefixProxyEditor(null);
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.upload_failed')}: ${errorMessage}`, 'error');
      setPrefixProxyEditor((prev) => {
        if (!prev || prev.fileName !== name) return prev;
        return { ...prev, saving: false };
      });
    }
  };

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
