import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { LoadingSpinner } from '@/components/ui/LoadingSpinner';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { AutocompleteInput } from '@/components/ui/AutocompleteInput';
import { EmptyState } from '@/components/ui/EmptyState';
import { IconInfo, IconX } from '@/components/ui/icons';
import { SecondaryScreenShell } from '@/components/common/SecondaryScreenShell';
import { useEdgeSwipeBack } from '@/hooks/useEdgeSwipeBack';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { useAuthStore, useNotificationStore } from '@/stores';
import { authFilesApi } from '@/services/api';
import {
  buildOAuthProviderOptions,
  getTypeLabel,
  normalizeProviderKey,
} from '@/features/authFiles/constants';
import { getStringSetSignature, isOAuthEditorDirty } from '@/features/authFiles/oauthEditorState';
import {
  getCustomOAuthExcludedRules,
  getEffectiveOAuthExcludedRules,
  hasOAuthExcludedRule,
  normalizeOAuthExcludedRules,
  updateOAuthExcludedRule,
} from '@/features/authFiles/oauthExcludedRules';
import type { AuthFileItem, OAuthModelAliasEntry } from '@/types';
import styles from './AuthFilesOAuthExcludedEditPage.module.scss';

type AuthFileModelItem = { id: string; display_name?: string; type?: string; owned_by?: string };

type LocationState = { fromAuthFiles?: boolean } | null;

export function AuthFilesOAuthExcludedEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { showConfirmation, showNotification } = useNotificationStore();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disableControls = connectionStatus !== 'connected';

  const [searchParams, setSearchParams] = useSearchParams();
  const providerFromParams = searchParams.get('provider') ?? '';
  const [initialProviderKey] = useState(() => normalizeProviderKey(providerFromParams));

  const [provider, setProvider] = useState(providerFromParams);
  const [files, setFiles] = useState<AuthFileItem[]>([]);
  const [excluded, setExcluded] = useState<Record<string, string[]>>({});
  const [modelAlias, setModelAlias] = useState<Record<string, OAuthModelAliasEntry[]>>({});
  const [initialLoading, setInitialLoading] = useState(true);
  const [excludedUnsupported, setExcludedUnsupported] = useState(false);

  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set());
  const [modelsList, setModelsList] = useState<AuthFileModelItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<'unsupported' | null>(null);
  const [customRule, setCustomRule] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setProvider(providerFromParams);
  }, [providerFromParams]);

  const providerOptions = useMemo(() => {
    const extraProviders = new Set<string>();
    Object.keys(excluded).forEach((value) => extraProviders.add(value));
    Object.keys(modelAlias).forEach((value) => extraProviders.add(value));
    files.forEach((file) => {
      if (typeof file.type === 'string') {
        extraProviders.add(file.type);
      }
      if (typeof file.provider === 'string') {
        extraProviders.add(file.provider);
      }
    });

    return buildOAuthProviderOptions(extraProviders);
  }, [excluded, files, modelAlias]);

  const resolvedProviderKey = useMemo(() => normalizeProviderKey(provider), [provider]);
  const isEditing = useMemo(() => {
    if (!resolvedProviderKey) return false;
    return Object.prototype.hasOwnProperty.call(excluded, resolvedProviderKey);
  }, [excluded, resolvedProviderKey]);
  const baselineModelsSignature = useMemo(
    () => getStringSetSignature(normalizeOAuthExcludedRules(excluded[resolvedProviderKey] ?? [])),
    [excluded, resolvedProviderKey]
  );
  const effectiveRules = useMemo(
    () => getEffectiveOAuthExcludedRules(selectedModels, customRule),
    [customRule, selectedModels]
  );
  const effectiveRulesSignature = useMemo(
    () => getStringSetSignature(effectiveRules),
    [effectiveRules]
  );
  const contentDirty = baselineModelsSignature !== effectiveRulesSignature;
  const customRules = useMemo(
    () =>
      getCustomOAuthExcludedRules(
        selectedModels,
        modelsList.map((model) => model.id)
      ),
    [modelsList, selectedModels]
  );
  const isDirty = isOAuthEditorDirty(
    initialProviderKey,
    provider,
    baselineModelsSignature,
    effectiveRulesSignature
  );
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.leave'),
      cancelText: t('common.stay'),
    }),
    [t]
  );
  const { allowNextNavigation, allowNavigationTo } = useUnsavedChangesGuard({
    shouldBlock: isDirty,
    dialog: unsavedChangesDialog,
  });

  const title = useMemo(() => {
    if (isEditing) {
      return t('oauth_excluded.edit_title', { provider: provider.trim() || resolvedProviderKey });
    }
    return t('oauth_excluded.add_title');
  }, [isEditing, provider, resolvedProviderKey, t]);

  const handleBack = useCallback(() => {
    const state = location.state as LocationState;
    if (state?.fromAuthFiles) {
      navigate(-1);
      return;
    }
    navigate('/auth-files', { replace: true });
  }, [location.state, navigate]);

  const swipeRef = useEdgeSwipeBack({ onBack: handleBack });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        handleBack();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setInitialLoading(true);
      setExcludedUnsupported(false);
      try {
        const [filesResult, excludedResult, aliasResult] = await Promise.allSettled([
          authFilesApi.list(),
          authFilesApi.getOauthExcludedModels(),
          authFilesApi.getOauthModelAlias(),
        ]);

        if (cancelled) return;

        if (filesResult.status === 'fulfilled') {
          setFiles(filesResult.value?.files ?? []);
        }

        if (aliasResult.status === 'fulfilled') {
          setModelAlias(aliasResult.value ?? {});
        }

        if (excludedResult.status === 'fulfilled') {
          setExcluded(excludedResult.value ?? {});
          return;
        }

        const err = excludedResult.status === 'rejected' ? excludedResult.reason : null;
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;

        if (status === 404) {
          setExcludedUnsupported(true);
          return;
        }
      } finally {
        if (!cancelled) {
          setInitialLoading(false);
        }
      }
    };

    load().catch(() => {
      if (!cancelled) {
        setInitialLoading(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!resolvedProviderKey) {
      setSelectedModels(new Set());
      return;
    }
    const existing = excluded[resolvedProviderKey] ?? [];
    setSelectedModels(new Set(normalizeOAuthExcludedRules(existing)));
    setCustomRule('');
  }, [excluded, resolvedProviderKey]);

  useEffect(() => {
    if (!resolvedProviderKey || excludedUnsupported) {
      setModelsList([]);
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    let cancelled = false;
    setModelsList([]);
    setModelsLoading(true);
    setModelsError(null);

    authFilesApi
      .getModelDefinitions(resolvedProviderKey)
      .then((models) => {
        if (cancelled) return;
        setModelsList(models);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;

        if (status === 400 || status === 404) {
          setModelsList([]);
          setModelsError('unsupported');
          return;
        }

        const errorMessage = err instanceof Error ? err.message : '';
        showNotification(`${t('notification.load_failed')}: ${errorMessage}`, 'error');
      })
      .finally(() => {
        if (cancelled) return;
        setModelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [excludedUnsupported, resolvedProviderKey, showNotification, t]);

  const applyProviderChange = useCallback(
    (value: string) => {
      setProvider(value);
      const next = new URLSearchParams(searchParams);
      const trimmed = value.trim();
      if (trimmed) {
        next.set('provider', trimmed);
      } else {
        next.delete('provider');
      }
      const nextSearch = next.toString();
      allowNavigationTo(
        `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}${location.hash}`
      );
      setSearchParams(next, { replace: true });
    },
    [allowNavigationTo, location.hash, location.pathname, searchParams, setSearchParams]
  );

  const updateProvider = useCallback(
    (value: string) => {
      if (!contentDirty || normalizeProviderKey(value) === resolvedProviderKey) {
        applyProviderChange(value);
        return;
      }
      showConfirmation({
        ...unsavedChangesDialog,
        variant: 'danger',
        onConfirm: () => applyProviderChange(value),
      });
    },
    [applyProviderChange, contentDirty, resolvedProviderKey, showConfirmation, unsavedChangesDialog]
  );

  const toggleModel = useCallback((modelId: string, checked: boolean) => {
    setSelectedModels((prev) => new Set(updateOAuthExcludedRule(prev, modelId, checked)));
  }, []);

  const handleAddCustomRule = useCallback(() => {
    if (!customRule.trim()) return;
    setSelectedModels(new Set(effectiveRules));
    setCustomRule('');
  }, [customRule, effectiveRules]);

  const handleSave = useCallback(async () => {
    const normalizedProvider = normalizeProviderKey(provider);
    if (!normalizedProvider) {
      showNotification(t('oauth_excluded.provider_required'), 'error');
      return;
    }

    const models = effectiveRules;
    setSaving(true);
    try {
      if (models.length) {
        await authFilesApi.saveOauthExcludedModels(normalizedProvider, models);
      } else if (isEditing) {
        await authFilesApi.deleteOauthExcludedEntry(normalizedProvider);
      }
      showNotification(t('oauth_excluded.save_success'), 'success');
      allowNextNavigation();
      handleBack();
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : '';
      showNotification(`${t('oauth_excluded.save_failed')}: ${errorMessage}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [allowNextNavigation, effectiveRules, handleBack, isEditing, provider, showNotification, t]);

  const canSave = !disableControls && !saving && !excludedUnsupported;

  return (
    <SecondaryScreenShell
      ref={swipeRef}
      title={title}
      onBack={handleBack}
      backLabel={t('common.back')}
      backAriaLabel={t('common.back')}
      contentClassName={styles.pageContent}
      rightAction={
        <Button size="sm" onClick={handleSave} loading={saving} disabled={!canSave}>
          {t('oauth_excluded.save')}
        </Button>
      }
      isLoading={initialLoading}
      loadingLabel={t('common.loading')}
    >
      {excludedUnsupported ? (
        <Card>
          <EmptyState
            title={t('oauth_excluded.upgrade_required_title')}
            description={t('oauth_excluded.upgrade_required_desc')}
          />
        </Card>
      ) : (
        <>
          <Card className={styles.settingsCard}>
            <div className={styles.settingsHeader}>
              <div className={styles.settingsHeaderTitle}>
                <IconInfo size={16} />
                <span>{t('oauth_excluded.title')}</span>
              </div>
              <div className={styles.settingsHeaderHint}>{t('oauth_excluded.description')}</div>
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.settingsRow}>
                <div className={styles.settingsInfo}>
                  <div className={styles.settingsLabel}>{t('oauth_excluded.provider_label')}</div>
                  <div className={styles.settingsDesc}>{t('oauth_excluded.provider_hint')}</div>
                </div>
                <div className={styles.settingsControl}>
                  <AutocompleteInput
                    id="oauth-excluded-provider"
                    placeholder={t('oauth_excluded.provider_placeholder')}
                    value={provider}
                    onChange={updateProvider}
                    options={providerOptions}
                    disabled={disableControls || saving}
                    wrapperStyle={{ marginBottom: 0 }}
                  />
                </div>
              </div>

              {providerOptions.length > 0 && (
                <div className={styles.tagList}>
                  {providerOptions.map((option) => {
                    const isActive =
                      normalizeProviderKey(provider) === normalizeProviderKey(option);
                    return (
                      <button
                        key={option}
                        type="button"
                        className={`${styles.tag} ${isActive ? styles.tagActive : ''}`}
                        onClick={() => updateProvider(option)}
                        disabled={disableControls || saving}
                      >
                        {getTypeLabel(t, option)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </Card>

          <Card className={styles.settingsCard}>
            <div className={styles.settingsHeader}>
              <div className={styles.settingsHeaderTitle}>{t('oauth_excluded.models_label')}</div>
              {resolvedProviderKey && (
                <div className={styles.modelsHint}>
                  {modelsLoading ? (
                    <>
                      <LoadingSpinner size={14} />
                      <span>{t('oauth_excluded.models_loading')}</span>
                    </>
                  ) : modelsError === 'unsupported' ? (
                    <span>{t('oauth_excluded.models_unsupported')}</span>
                  ) : modelsList.length > 0 ? (
                    <span>{t('oauth_excluded.models_loaded', { count: modelsList.length })}</span>
                  ) : (
                    <span>{t('oauth_excluded.no_models_available')}</span>
                  )}
                </div>
              )}
            </div>

            <div className={styles.customRuleSection}>
              <div className={styles.customRuleHeader}>
                <label className={styles.settingsLabel} htmlFor="oauth-excluded-custom-rule">
                  {t('oauth_excluded.custom_rule_label')}
                </label>
                <div className={styles.settingsDesc}>{t('oauth_excluded.custom_rule_hint')}</div>
              </div>
              <div className={styles.customRuleRow}>
                <input
                  id="oauth-excluded-custom-rule"
                  className={`input ${styles.customRuleInput}`}
                  value={customRule}
                  onChange={(event) => setCustomRule(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleAddCustomRule();
                    }
                  }}
                  placeholder={t('oauth_excluded.custom_rule_placeholder')}
                  disabled={!resolvedProviderKey || disableControls || saving}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={handleAddCustomRule}
                  disabled={!resolvedProviderKey || !customRule.trim() || disableControls || saving}
                >
                  {t('oauth_excluded.custom_rule_add')}
                </Button>
              </div>

              {customRules.length > 0 && (
                <div className={styles.customRuleList}>
                  <div className={styles.customRuleListLabel}>
                    {t('oauth_excluded.custom_rules_label')}
                  </div>
                  <div className={styles.customRuleChips}>
                    {customRules.map((rule) => (
                      <span key={rule.toLowerCase()} className={styles.customRuleChip}>
                        <span>{rule}</span>
                        <button
                          type="button"
                          className={styles.customRuleRemove}
                          onClick={() => toggleModel(rule, false)}
                          disabled={disableControls || saving}
                          aria-label={t('oauth_excluded.custom_rule_remove', { rule })}
                        >
                          <IconX size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {modelsLoading ? (
              <div className={styles.loadingModels}>
                <LoadingSpinner size={16} />
                <span>{t('common.loading')}</span>
              </div>
            ) : modelsList.length > 0 ? (
              <div className={styles.modelList}>
                {modelsList.map((model) => {
                  const checked = hasOAuthExcludedRule(selectedModels, model.id);
                  return (
                    <SelectionCheckbox
                      key={model.id}
                      checked={checked}
                      disabled={disableControls || saving}
                      onChange={(value) => toggleModel(model.id, value)}
                      className={styles.modelItem}
                      labelClassName={styles.modelText}
                      label={
                        <>
                          <span className={styles.modelId}>{model.id}</span>
                          {model.display_name && model.display_name !== model.id && (
                            <span className={styles.modelDisplayName}>{model.display_name}</span>
                          )}
                        </>
                      }
                    />
                  );
                })}
              </div>
            ) : resolvedProviderKey ? (
              <div className={styles.emptyModels}>
                {modelsError === 'unsupported'
                  ? t('oauth_excluded.models_unsupported')
                  : t('oauth_excluded.no_models_available')}
              </div>
            ) : (
              <div className={styles.emptyModels}>{t('oauth_excluded.provider_required')}</div>
            )}
          </Card>
        </>
      )}
    </SecondaryScreenShell>
  );
}
