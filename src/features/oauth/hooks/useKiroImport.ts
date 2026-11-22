import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotificationStore } from '@/stores';
import { kiroApi, type KiroImportResponse } from '@/services/api/kiro';
import { getErrorMessage } from '@/utils/helpers';
import { notifyAuthFilesChanged } from '@/features/authFiles/authFilesEvents';

export interface KiroImportResult {
  id?: string;
  label?: string;
  email?: string;
  authFile?: string;
}

export interface KiroImportState {
  file?: File;
  rawJson: string;
  mode: 'file' | 'text';
  loading: boolean;
  error?: string;
  result?: KiroImportResult;
}

const isJsonFile = (file: File) => file.name.toLowerCase().endsWith('.json');

export function useKiroImport(options: {
  isFocused: () => boolean;
  onCredentialAdded: () => void;
}) {
  const { isFocused, onCredentialAdded } = options;
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();
  const [kiro, setKiro] = useState<KiroImportState>({
    rawJson: '',
    mode: 'file',
    loading: false,
  });

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    if (!isJsonFile(file)) {
      setKiro((prev) => ({ ...prev, error: t('kiro_import.file_required') }));
      return;
    }
    setKiro((prev) => ({ ...prev, file, mode: 'file', error: undefined, result: undefined }));
  };

  const setRawJson = (rawJson: string) =>
    setKiro((prev) => ({ ...prev, rawJson, mode: 'text', error: undefined, result: undefined }));

  const setMode = (mode: 'file' | 'text') =>
    setKiro((prev) => ({ ...prev, mode, error: undefined }));

  const importCredential = async () => {
    const payload = kiro.mode === 'file' ? kiro.file : kiro.rawJson.trim();
    if (!payload) {
      const errKey =
        kiro.mode === 'file' ? 'kiro_import.file_required' : 'kiro_import.text_required';
      setKiro((prev) => ({ ...prev, error: t(errKey) }));
      return;
    }

    setKiro((prev) => ({ ...prev, loading: true, error: undefined, result: undefined }));
    try {
      const res: KiroImportResponse = await kiroApi.importCredential(payload);
      const result: KiroImportResult = {
        id: res.id,
        label: res.label,
        email: res.email,
        authFile: res['auth-file'] ?? res.auth_file,
      };
      setKiro((prev) => ({ ...prev, loading: false, result }));
      notifyAuthFilesChanged();
      onCredentialAdded();
      if (!isFocused()) showNotification(t('kiro_import.success'), 'success');
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      setKiro((prev) => ({
        ...prev,
        loading: false,
        error: message || t('notification.upload_failed'),
      }));
      if (!isFocused()) {
        showNotification(
          message
            ? `${t('notification.upload_failed')}: ${message}`
            : t('notification.upload_failed'),
          'error'
        );
      }
    }
  };

  const resetForAnother = () =>
    setKiro({
      rawJson: '',
      mode: 'file',
      loading: false,
    });

  return { kiro, pickFile, setRawJson, setMode, importCredential, resetForAnother };
}
