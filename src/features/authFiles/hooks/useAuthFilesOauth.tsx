import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { authFilesApi } from '@/services/api';
import { useNotificationStore } from '@/stores';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import type { AuthFileModelItem } from '@/features/authFiles/constants';
import { normalizeProviderKey } from '@/features/authFiles/constants';

type UnsupportedError = 'unsupported' | null;
type ViewMode = 'diagram' | 'list';

export type UseAuthFilesOauthResult = {
  excluded: Record<string, string[]>;
  excludedError: UnsupportedError;
  modelAlias: Record<string, OAuthModelAliasEntry[]>;
  modelAliasError: UnsupportedError;
  allProviderModels: Record<string, AuthFileModelItem[]>;
  providerList: string[];
  loadExcluded: () => Promise<void>;
  loadModelAlias: () => Promise<void>;
  deleteExcluded: (provider: string) => void;
  deleteModelAlias: (provider: string) => void;
  handleMappingUpdate: (provider: string, sourceModel: string, newAlias: string) => Promise<void>;
  handleDeleteLink: (provider: string, sourceModel: string, alias: string) => void;
  handleToggleFork: (
    provider: string,
    sourceModel: string,
    alias: string,
    fork: boolean
  ) => Promise<void>;
  handleRenameAlias: (oldAlias: string, newAlias: string) => Promise<void>;
  handleDeleteAlias: (aliasName: string) => void;
};

export type UseAuthFilesOauthOptions = {
  viewMode: ViewMode;
  files: AuthFileItem[];
};

export function useAuthFilesOauth(options: UseAuthFilesOauthOptions): UseAuthFilesOauthResult {
  const { viewMode, files } = options;
  const { t } = useTranslation();
  const { showNotification } = useNotificationStore();

  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [excludedError, setExcludedError] = useState<UnsupportedError>(null);
  const [modelAlias, setModelAlias] = useState<Record<string, OAuthModelAliasEntry[]>>({});
  const [modelAliasError, setModelAliasError] = useState<UnsupportedError>(null);
  const [allProviderModels, setAllProviderModels] = useState<Record<string, AuthFileModelItem[]>>(
    {}
  );

  const excludedUnsupportedRef = useRef(false);
  const mappingsUnsupportedRef = useRef(false);

  const providerList = useMemo(() => {
    const providers = new Set<string>();

    Object.keys(modelAlias).forEach((provider) => {
      const key = provider.trim().toLowerCase();
      if (key) providers.add(key);
    });

    files.forEach((file) => {
      if (typeof file.type === 'string') {
        const key = file.type.trim().toLowerCase();
        if (key) providers.add(key);
      }
      if (typeof file.provider === 'string') {
        const key = file.provider.trim().toLowerCase();
        if (key) providers.add(key);
      }
    });
    return Array.from(providers);
  }, [files, modelAlias]);

  useEffect(() => {
    if (viewMode !== 'diagram') return;

    let cancelled = false;

    const loadAllModels = async () => {
      if (providerList.length === 0) {
        if (!cancelled) setAllProviderModels({});
        return;
      }

      const results = await Promise.all(
        providerList.map(async (provider) => {
          try {
            const models = await authFilesApi.getModelDefinitions(provider);
            return { provider, models };
          } catch {
            return { provider, models: [] as AuthFileModelItem[] };
          }
        })
      );

      if (cancelled) return;

      const nextModels: Record<string, AuthFileModelItem[]> = {};
      results.forEach(({ provider, models }) => {
        if (models.length > 0) {
          nextModels[provider] = models;
        }
      });

      setAllProviderModels(nextModels);
    };

    void loadAllModels();

    return () => {
      cancelled = true;
    };
  }, [providerList, viewMode]);

  const loadExcluded = useCallback(async () => {
    try {
      const res = await authFilesApi.getOauthExcludedModels();
      excludedUnsupportedRef.current = false;
      setExcluded(res || {});
      setExcludedError(null);
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setExcluded({});
        setExcludedError('unsupported');
        if (!excludedUnsupportedRef.current) {
          excludedUnsupportedRef.current = true;
          showNotification(t('oauth_excluded.upgrade_required'), 'warning');
        }
        return;
      }
      // 静默失败
    }
  }, [showNotification, t]);

  const loadModelAlias = useCallback(async () => {
    try {
      const res = await authFilesApi.getOauthModelAlias();
      mappingsUnsupportedRef.current = false;
      setModelAlias(res || {});
      setModelAliasError(null);
    } catch (err: unknown) {
      const status =
        typeof err === 'object' && err !== null && 'status' in err
          ? (err as { status?: unknown }).status
          : undefined;

      if (status === 404) {
        setModelAlias({});
        setModelAliasError('unsupported');
        if (!mappingsUnsupportedRef.current) {
          mappingsUnsupportedRef.current = true;
          showNotification(t('oauth_model_alias.upgrade_required'), 'warning');
        }
        return;
      }
      // 静默失败
    }
  }, [showNotification, t]);

  const deleteExcluded = useCallback(
    (provider: string) => {
      const runDeleteExcluded = async () => {
        const providerKey = normalizeProviderKey(provider);
        if (!providerKey) {
          showNotification(t('oauth_excluded.provider_required'), 'error');
          return;
        }
        try {
          await authFilesApi.deleteOauthExcludedEntry(providerKey);
          await loadExcluded();
          showNotification(t('oauth_excluded.delete_success'), 'success');
        } catch (err: unknown) {
          try {
            const current = await authFilesApi.getOauthExcludedModels();
            const next: Record<string, string[]> = {};
            Object.entries(current).forEach(([key, models]) => {
              if (normalizeProviderKey(key) === providerKey) return;
              next[key] = models;
            });
            await authFilesApi.replaceOauthExcludedModels(next);
            await loadExcluded();
            showNotification(t('oauth_excluded.delete_success'), 'success');
          } catch (fallbackErr: unknown) {
            const errorMessage =
              fallbackErr instanceof Error
                ? fallbackErr.message
                : err instanceof Error
                  ? err.message
                  : '';
            showNotification(`${t('oauth_excluded.delete_failed')}: ${errorMessage}`, 'error');
          }
        }
      };

      void runDeleteExcluded();
    },
    [loadExcluded, showNotification, t]
  );

  const deleteModelAlias = useCallback(
    (provider: string) => {
      const runDeleteModelAlias = async () => {
        try {
          await authFilesApi.deleteOauthModelAlias(provider);
          await loadModelAlias();
          showNotification(t('oauth_model_alias.delete_success'), 'success');
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : '';
          showNotification(`${t('oauth_model_alias.delete_failed')}: ${errorMessage}`, 'error');
        }
      };

      void runDeleteModelAlias();
    },
    [loadModelAlias, showNotification, t]
  );

  const handleMappingUpdate = useCallback(
    async (provider: string, sourceModel: string, newAlias: string) => {
      if (!provider || !sourceModel || !newAlias) return;
      const normalizedProvider = normalizeProviderKey(provider);
      if (!normalizedProvider) return;

      const providerKey = Object.keys(modelAlias).find(
        (key) => normalizeProviderKey(key) === normalizedProvider
      );
      const currentMappings = (providerKey ? modelAlias[providerKey] : null) ?? [];

      const nameTrim = sourceModel.trim();
      const aliasTrim = newAlias.trim();
      const nameKey = nameTrim.toLowerCase();
      const aliasKey = aliasTrim.toLowerCase();

      if (
        currentMappings.some(
          (m) =>
            (m.name ?? '').trim().toLowerCase() === nameKey &&
            (m.alias ?? '').trim().toLowerCase() === aliasKey
        )
      ) {
        return;
      }

      const nextMappings: OAuthModelAliasEntry[] = [
        ...currentMappings,
        { name: nameTrim, alias: aliasTrim, fork: true }
      ];

      try {
        await authFilesApi.saveOauthModelAlias(normalizedProvider, nextMappings);
        await loadModelAlias();
        showNotification(t('oauth_model_alias.save_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
      }
    },
    [loadModelAlias, modelAlias, showNotification, t]
  );

  const handleDeleteLink = useCallback(
    (provider: string, sourceModel: string, alias: string) => {
      const nameTrim = sourceModel.trim();
      const aliasTrim = alias.trim();
      if (!provider || !nameTrim || !aliasTrim) return;

      const runDeleteLink = async () => {
        const normalizedProvider = normalizeProviderKey(provider);
        const providerKey = Object.keys(modelAlias).find(
          (key) => normalizeProviderKey(key) === normalizedProvider
        );
        const currentMappings = (providerKey ? modelAlias[providerKey] : null) ?? [];
        const nameKey = nameTrim.toLowerCase();
        const aliasKey = aliasTrim.toLowerCase();
        const nextMappings = currentMappings.filter(
          (m) =>
            (m.name ?? '').trim().toLowerCase() !== nameKey ||
            (m.alias ?? '').trim().toLowerCase() !== aliasKey
        );
        if (nextMappings.length === currentMappings.length) return;

        try {
          if (nextMappings.length === 0) {
            await authFilesApi.deleteOauthModelAlias(normalizedProvider);
          } else {
            await authFilesApi.saveOauthModelAlias(normalizedProvider, nextMappings);
          }
          await loadModelAlias();
          showNotification(t('oauth_model_alias.save_success'), 'success');
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : '';
          showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
        }
      };

      void runDeleteLink();
    },
    [loadModelAlias, modelAlias, showNotification, t]
  );

  const handleToggleFork = useCallback(
    async (provider: string, sourceModel: string, alias: string, fork: boolean) => {
      const normalizedProvider = normalizeProviderKey(provider);
      if (!normalizedProvider) return;

      const providerKey = Object.keys(modelAlias).find(
        (key) => normalizeProviderKey(key) === normalizedProvider
      );
      const currentMappings = (providerKey ? modelAlias[providerKey] : null) ?? [];
      const nameKey = sourceModel.trim().toLowerCase();
      const aliasKey = alias.trim().toLowerCase();
      let changed = false;

      const nextMappings = currentMappings.map((m) => {
        const mName = (m.name ?? '').trim().toLowerCase();
        const mAlias = (m.alias ?? '').trim().toLowerCase();
        if (mName === nameKey && mAlias === aliasKey) {
          changed = true;
          return fork ? { ...m, fork: true } : { name: m.name, alias: m.alias };
        }
        return m;
      });

      if (!changed) return;

      try {
        await authFilesApi.saveOauthModelAlias(normalizedProvider, nextMappings);
        await loadModelAlias();
        showNotification(t('oauth_model_alias.save_success'), 'success');
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('oauth_model_alias.save_failed')}: ${errorMessage}`, 'error');
      }
    },
    [loadModelAlias, modelAlias, showNotification, t]
  );

  const handleRenameAlias = useCallback(
    async (oldAlias: string, newAlias: string) => {
      const oldTrim = oldAlias.trim();
      const newTrim = newAlias.trim();
      if (!oldTrim || !newTrim || oldTrim === newTrim) return;

      const oldKey = oldTrim.toLowerCase();
      const providersToUpdate = Object.entries(modelAlias).filter(([_, mappings]) =>
        mappings.some((m) => (m.alias ?? '').trim().toLowerCase() === oldKey)
      );

      if (providersToUpdate.length === 0) return;

      let hadFailure = false;
      let failureMessage = '';

      try {
        const results = await Promise.allSettled(
          providersToUpdate.map(([provider, mappings]) => {
            const nextMappings = mappings.map((m) =>
              (m.alias ?? '').trim().toLowerCase() === oldKey ? { ...m, alias: newTrim } : m
            );
            return authFilesApi.saveOauthModelAlias(provider, nextMappings);
          })
        );

        const failures = results.filter(
          (result): result is PromiseRejectedResult => result.status === 'rejected'
        );

        if (failures.length > 0) {
          hadFailure = true;
          const reason = failures[0].reason;
          failureMessage = reason instanceof Error ? reason.message : String(reason ?? '');
        }
      } finally {
        await loadModelAlias();
      }

      if (hadFailure) {
        showNotification(
          failureMessage
            ? `${t('oauth_model_alias.save_failed')}: ${failureMessage}`
            : t('oauth_model_alias.save_failed'),
          'error'
        );
      } else {
        showNotification(t('oauth_model_alias.save_success'), 'success');
      }
    },
    [loadModelAlias, modelAlias, showNotification, t]
  );

  const handleDeleteAlias = useCallback(
    (aliasName: string) => {
      const aliasTrim = aliasName.trim();
      if (!aliasTrim) return;
      const aliasKey = aliasTrim.toLowerCase();
      const providersToUpdate = Object.entries(modelAlias).filter(([_, mappings]) =>
        mappings.some((m) => (m.alias ?? '').trim().toLowerCase() === aliasKey)
      );

      if (providersToUpdate.length === 0) return;

      const runDeleteAlias = async () => {
        let hadFailure = false;
        let failureMessage = '';

        try {
          const results = await Promise.allSettled(
            providersToUpdate.map(([provider, mappings]) => {
              const nextMappings = mappings.filter(
                (m) => (m.alias ?? '').trim().toLowerCase() !== aliasKey
              );
              if (nextMappings.length === 0) {
                return authFilesApi.deleteOauthModelAlias(provider);
              }
              return authFilesApi.saveOauthModelAlias(provider, nextMappings);
            })
          );

          const failures = results.filter(
            (result): result is PromiseRejectedResult => result.status === 'rejected'
          );

          if (failures.length > 0) {
            hadFailure = true;
            const reason = failures[0].reason;
            failureMessage = reason instanceof Error ? reason.message : String(reason ?? '');
          }
        } finally {
          await loadModelAlias();
        }

        if (hadFailure) {
          showNotification(
            failureMessage
              ? `${t('oauth_model_alias.delete_failed')}: ${failureMessage}`
              : t('oauth_model_alias.delete_failed'),
            'error'
          );
        } else {
          showNotification(t('oauth_model_alias.delete_success'), 'success');
        }
      };

      void runDeleteAlias();
    },
    [loadModelAlias, modelAlias, showNotification, t]
  );

  return {
    excluded,
    excludedError,
    modelAlias,
    modelAliasError,
    allProviderModels,
    providerList,
    loadExcluded,
    loadModelAlias,
    deleteExcluded,
    deleteModelAlias,
    handleMappingUpdate,
    handleDeleteLink,
    handleToggleFork,
    handleRenameAlias,
    handleDeleteAlias
  };
}
