import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { configApi } from '@/services/api/config';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type {
  CodexFailureConfig,
  CodexInstructionsConfig,
  CodexInstructionsMode,
} from '@/types';
import styles from './CodexInstructionsPage.module.scss';

const LazyMarkdownSourceEditor = lazy(() => import('@/components/config/MarkdownSourceEditor'));

type CodexConfigTab = 'error_handling' | 'instructions';

/** Public Codex-X example instruction templates (list + raw content). */
const CODEX_X_EXAMPLES_API =
  'https://api.github.com/repos/yynxxxxx/Codex-X/contents/examples?ref=main';
const CODEX_X_EXAMPLES_REPO_URL = 'https://github.com/yynxxxxx/Codex-X/tree/main/examples';

type InstructionTemplate = {
  name: string;
  downloadUrl: string;
};

const DEFAULT_INSTRUCTIONS: CodexInstructionsConfig = {
  enabled: false,
  mode: 'prepend',
  content: '',
  file: '',
  models: ['gpt-5.5', 'gpt-5*'],
  oauthOnly: true,
  requireAuthAllow: true,
  reserveMarkedAuths: false,
  usePrefixSuffix: true,
  requestMarkers: {
    prefixes: ['private/'],
    suffixes: ['-private'],
  },
};

const DEFAULT_FAILURE: CodexFailureConfig = {
  autoDisableAuthFailures: true,
  authFailureDisableAfter: 1,
  usageLimitDisableAfter: 3,
  usageLimitCooldownFallbackHours: 1,
};

function parseModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeInstructions(config: CodexInstructionsConfig): CodexInstructionsConfig {
  return {
    ...config,
    mode: config.mode || 'prepend',
    content: config.content ?? '',
    file: config.file ?? '',
    models: config.models.map((model) => model.trim()).filter(Boolean),
    oauthOnly: config.oauthOnly !== false,
    requireAuthAllow: config.requireAuthAllow !== false,
    reserveMarkedAuths: Boolean(config.reserveMarkedAuths),
    usePrefixSuffix: config.usePrefixSuffix !== false,
    requestMarkers: {
      prefixes: (config.requestMarkers?.prefixes ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
      suffixes: (config.requestMarkers?.suffixes ?? [])
        .map((value) => value.trim())
        .filter(Boolean),
    },
  };
}

function normalizeFailure(config: CodexFailureConfig): CodexFailureConfig {
  return {
    autoDisableAuthFailures: config.autoDisableAuthFailures !== false,
    authFailureDisableAfter: Math.max(0, Math.floor(config.authFailureDisableAfter || 0)),
    usageLimitDisableAfter: Math.max(0, Math.floor(config.usageLimitDisableAfter || 0)),
    usageLimitCooldownFallbackHours: Math.max(
      0,
      Math.floor(config.usageLimitCooldownFallbackHours || 0)
    ),
  };
}

function sameInstructions(a: CodexInstructionsConfig, b: CodexInstructionsConfig): boolean {
  return JSON.stringify(normalizeInstructions(a)) === JSON.stringify(normalizeInstructions(b));
}

function sameFailure(a: CodexFailureConfig, b: CodexFailureConfig): boolean {
  return JSON.stringify(normalizeFailure(a)) === JSON.stringify(normalizeFailure(b));
}

export function CodexInstructionsPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);

  const [activeTab, setActiveTab] = useState<CodexConfigTab>('error_handling');

  // --- Error handling state ---
  const [failureDraft, setFailureDraft] = useState<CodexFailureConfig>(DEFAULT_FAILURE);
  const [failureSaved, setFailureSaved] = useState<CodexFailureConfig>(DEFAULT_FAILURE);
  const [failureLoading, setFailureLoading] = useState(true);
  const [failureSaving, setFailureSaving] = useState(false);
  const [failureError, setFailureError] = useState('');

  // --- Instructions state ---
  const [instrDraft, setInstrDraft] = useState<CodexInstructionsConfig>(DEFAULT_INSTRUCTIONS);
  const [instrSaved, setInstrSaved] = useState<CodexInstructionsConfig>(DEFAULT_INSTRUCTIONS);
  const [modelsInput, setModelsInput] = useState(DEFAULT_INSTRUCTIONS.models.join('\n'));
  const [prefixMarkersInput, setPrefixMarkersInput] = useState(
    DEFAULT_INSTRUCTIONS.requestMarkers.prefixes.join('\n')
  );
  const [suffixMarkersInput, setSuffixMarkersInput] = useState(
    DEFAULT_INSTRUCTIONS.requestMarkers.suffixes.join('\n')
  );
  const [instrLoading, setInstrLoading] = useState(true);
  const [instrSaving, setInstrSaving] = useState(false);
  const [instrError, setInstrError] = useState('');

  // Template import is draft-only: never calls save APIs.
  const [templates, setTemplates] = useState<InstructionTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState('');
  const [selectedTemplate, setSelectedTemplate] = useState('');
  const [importingTemplate, setImportingTemplate] = useState(false);

  const failureDisabled =
    connectionStatus !== 'connected' || failureLoading || failureSaving;
  const failureDirty = !sameFailure(failureDraft, failureSaved);
  const failureStatusClass = failureError
    ? styles.error
    : failureDirty
      ? styles.modified
      : styles.saved;
  const failureStatusText = failureError
    ? t('codex_config.failure.status_load_failed')
    : failureLoading
      ? t('codex_config.failure.status_loading')
      : failureSaving
        ? t('codex_config.failure.status_saving')
        : failureDirty
          ? t('codex_config.failure.status_dirty')
          : t('codex_config.failure.status_loaded');

  const effectiveInstrDraft = useMemo(
    () => ({
      ...instrDraft,
      models: parseModels(modelsInput),
      requestMarkers: {
        prefixes: parseModels(prefixMarkersInput),
        suffixes: parseModels(suffixMarkersInput),
      },
    }),
    [instrDraft, modelsInput, prefixMarkersInput, suffixMarkersInput]
  );
  const instrDisabled = connectionStatus !== 'connected' || instrLoading || instrSaving;
  const instrDirty = !sameInstructions(effectiveInstrDraft, instrSaved);
  const modelChips =
    effectiveInstrDraft.models.length > 0
      ? effectiveInstrDraft.models
      : DEFAULT_INSTRUCTIONS.models;
  const instrStatusClass = instrError
    ? styles.error
    : instrDirty
      ? styles.modified
      : styles.saved;
  const instrStatusText = instrError
    ? t('codex_instructions.status_load_failed')
    : instrLoading
      ? t('codex_instructions.status_loading')
      : instrSaving
        ? t('codex_instructions.status_saving')
        : instrDirty
          ? t('codex_instructions.status_dirty')
          : t('codex_instructions.status_loaded');

  const modeOptions = useMemo(
    () => [
      { value: 'prepend', label: t('codex_instructions.mode_prepend') },
      { value: 'append', label: t('codex_instructions.mode_append') },
      { value: 'replace', label: t('codex_instructions.mode_replace') },
    ],
    [t]
  );

  const templateOptions = useMemo(
    () => [
      {
        value: '',
        label: templatesLoading
          ? t('codex_instructions.template_loading')
          : t('codex_instructions.template_placeholder'),
      },
      ...templates.map((item) => ({ value: item.name, label: item.name })),
    ],
    [t, templates, templatesLoading]
  );

  const activeDirty = activeTab === 'error_handling' ? failureDirty : instrDirty;
  const unsavedChangesDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );

  useUnsavedChangesGuard({
    shouldBlock: failureDirty || instrDirty,
    dialog: unsavedChangesDialog,
  });

  const loadFailure = useCallback(async () => {
    setFailureLoading(true);
    setFailureError('');
    try {
      const next = normalizeFailure(await configApi.getCodexFailureConfig());
      setFailureDraft(next);
      setFailureSaved(next);
    } catch (err: unknown) {
      setFailureError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setFailureLoading(false);
    }
  }, [t]);

  const applyLoadedInstructions = useCallback((config: CodexInstructionsConfig) => {
    const nextConfig = normalizeInstructions(config);
    setInstrDraft(nextConfig);
    setInstrSaved(nextConfig);
    setModelsInput(nextConfig.models.join('\n'));
    setPrefixMarkersInput(nextConfig.requestMarkers.prefixes.join('\n'));
    setSuffixMarkersInput(nextConfig.requestMarkers.suffixes.join('\n'));
  }, []);

  const loadInstructions = useCallback(async () => {
    setInstrLoading(true);
    setInstrError('');
    try {
      const config = await configApi.getCodexInstructions();
      applyLoadedInstructions(config);
    } catch (err: unknown) {
      setInstrError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setInstrLoading(false);
    }
  }, [applyLoadedInstructions, t]);

  useEffect(() => {
    void loadFailure();
    void loadInstructions();
  }, [loadFailure, loadInstructions]);

  const loadTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    setTemplatesError('');
    try {
      const response = await fetch(CODEX_X_EXAMPLES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) {
        throw new Error(`GitHub API ${response.status}`);
      }
      const payload = (await response.json()) as Array<{
        name?: string;
        type?: string;
        download_url?: string | null;
      }>;
      const list = payload
        .filter(
          (entry) =>
            entry.type === 'file' &&
            typeof entry.name === 'string' &&
            entry.name.toLowerCase().endsWith('.md') &&
            typeof entry.download_url === 'string' &&
            entry.download_url.length > 0
        )
        .map((entry) => ({
          name: entry.name as string,
          downloadUrl: entry.download_url as string,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setTemplates(list);
    } catch (err: unknown) {
      setTemplates([]);
      setTemplatesError(err instanceof Error ? err.message : t('notification.refresh_failed'));
    } finally {
      setTemplatesLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const updateFailure = useCallback((patch: Partial<CodexFailureConfig>) => {
    setFailureDraft((current) => ({ ...current, ...patch }));
  }, []);

  const updateInstrDraft = useCallback((patch: Partial<CodexInstructionsConfig>) => {
    setInstrDraft((current) => ({ ...current, ...patch }));
  }, []);

  const handleImportTemplate = useCallback(async () => {
    if (!selectedTemplate) {
      showNotification(t('codex_instructions.template_required'), 'error');
      return;
    }
    const match = templates.find((item) => item.name === selectedTemplate);
    if (!match) {
      showNotification(t('codex_instructions.template_missing'), 'error');
      return;
    }

    setImportingTemplate(true);
    try {
      const response = await fetch(match.downloadUrl);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const content = await response.text();
      // Draft only — leave instrSaved untouched so leaving without Save discards.
      updateInstrDraft({ content });
      showNotification(t('codex_instructions.template_import_draft', { name: match.name }), 'info');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('codex_instructions.template_import_failed')}: ${message}`, 'error');
    } finally {
      setImportingTemplate(false);
    }
  }, [selectedTemplate, showNotification, t, templates, updateInstrDraft]);

  const updateFailureNumber = (
    key:
      | 'authFailureDisableAfter'
      | 'usageLimitDisableAfter'
      | 'usageLimitCooldownFallbackHours',
    value: string
  ) => {
    const parsed = Number.parseInt(value, 10);
    updateFailure({ [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });
  };

  const handleTabChange = useCallback(
    (next: CodexConfigTab) => {
      if (next === activeTab) return;
      if (activeDirty) {
        showConfirmation({
          title: t('common.unsaved_changes_title'),
          message: t('codex_config.tab_switch_dirty_message'),
          confirmText: t('common.confirm'),
          cancelText: t('common.cancel'),
          variant: 'danger',
          onConfirm: async () => {
            setActiveTab(next);
          },
        });
        return;
      }
      setActiveTab(next);
    },
    [activeDirty, activeTab, showConfirmation, t]
  );

  const handleFailureReload = useCallback(() => {
    if (!failureDirty) {
      void loadFailure();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('codex_config.failure.reload_confirm_message'),
      confirmText: t('codex_config.failure.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await loadFailure();
      },
    });
  }, [failureDirty, loadFailure, showConfirmation, t]);

  const handleFailureSave = useCallback(async () => {
    const next = normalizeFailure(failureDraft);
    setFailureSaving(true);
    try {
      await configApi.updateCodexFailureConfig(next);
      setFailureDraft(next);
      setFailureSaved(next);
      showNotification(t('codex_config.failure.save_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setFailureSaving(false);
    }
  }, [failureDraft, showNotification, t]);

  const handleInstrReload = useCallback(() => {
    if (!instrDirty) {
      void loadInstructions();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('codex_instructions.reload_confirm_message'),
      confirmText: t('codex_instructions.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => {
        await loadInstructions();
      },
    });
  }, [instrDirty, loadInstructions, showConfirmation, t]);

  const handleInstrSave = useCallback(async () => {
    const nextConfig = normalizeInstructions(effectiveInstrDraft);
    if (nextConfig.models.length === 0) {
      showNotification(t('codex_instructions.models_required'), 'error');
      return;
    }

    setInstrSaving(true);
    try {
      await configApi.updateCodexInstructions(nextConfig);
      applyLoadedInstructions(nextConfig);
      showNotification(t('codex_instructions.save_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setInstrSaving(false);
    }
  }, [applyLoadedInstructions, effectiveInstrDraft, showNotification, t]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.tabBar} role="tablist" aria-label={t('codex_config.title')}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'error_handling'}
            className={`${styles.tabItem} ${activeTab === 'error_handling' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('error_handling')}
          >
            {t('codex_config.tabs.error_handling')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'instructions'}
            className={`${styles.tabItem} ${activeTab === 'instructions' ? styles.tabActive : ''}`}
            onClick={() => handleTabChange('instructions')}
          >
            {t('codex_config.tabs.instructions')}
          </button>
        </div>
        <div className={styles.headerActions}>
          {activeTab === 'error_handling' ? (
            <>
              <span className={`${styles.statusBadge} ${failureStatusClass}`}>
                {failureStatusText}
              </span>
              <Button
                variant="secondary"
                onClick={handleFailureReload}
                disabled={failureLoading || failureSaving}
              >
                <IconRefreshCw size={16} />
                {t('codex_config.failure.reload')}
              </Button>
              <Button
                onClick={handleFailureSave}
                disabled={failureDisabled || !failureDirty}
                loading={failureSaving}
              >
                {t('codex_config.failure.save')}
              </Button>
            </>
          ) : (
            <>
              <span className={`${styles.statusBadge} ${instrStatusClass}`}>{instrStatusText}</span>
              <Button
                variant="secondary"
                onClick={handleInstrReload}
                disabled={instrLoading || instrSaving}
              >
                <IconRefreshCw size={16} />
                {t('codex_instructions.reload')}
              </Button>
              <Button
                onClick={handleInstrSave}
                disabled={instrDisabled || !instrDirty}
                loading={instrSaving}
              >
                {t('codex_instructions.save')}
              </Button>
            </>
          )}
        </div>
      </div>

      {activeTab === 'error_handling' && (
        <div role="tabpanel" aria-label={t('codex_config.tabs.error_handling')}>
          {failureError && <div className="error-box">{failureError}</div>}

          <div
            className={styles.policyStrip}
            aria-label={t('codex_config.failure.policy_summary')}
          >
            <span>{t('codex_config.failure.policy_runtime')}</span>
            <span>
              {t('codex_config.failure.policy_auth', {
                count: failureDraft.authFailureDisableAfter,
                enabled: failureDraft.autoDisableAuthFailures,
              })}
            </span>
            <span>
              {t('codex_config.failure.policy_usage_limit', {
                count: failureDraft.usageLimitDisableAfter,
                hours: failureDraft.usageLimitCooldownFallbackHours,
              })}
            </span>
            <span>{t('codex_config.failure.policy_rate_limit')}</span>
          </div>

          <section
            className={styles.failureSettings}
            aria-label={t('codex_config.failure.settings_title')}
          >
            <div className={styles.settingCard}>
              <div className={styles.settingHeader}>
                <div>
                  <h2>{t('codex_config.failure.auto_disable_label')}</h2>
                  <p className={styles.settingHint}>
                    {t('codex_config.failure.auto_disable_hint')}
                  </p>
                </div>
                <ToggleSwitch
                  checked={failureDraft.autoDisableAuthFailures}
                  onChange={(autoDisableAuthFailures) => updateFailure({ autoDisableAuthFailures })}
                  disabled={failureDisabled}
                  ariaLabel={t('codex_config.failure.auto_disable_label')}
                />
              </div>
              <div className={styles.reasonNote}>{t('codex_config.failure.reason_note')}</div>
              <div
                className={`${styles.counterField} ${
                  !failureDraft.autoDisableAuthFailures ? styles.dependentDisabled : ''
                }`}
              >
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t('codex_config.failure.auth_disable_after')}
                  value={String(failureDraft.authFailureDisableAfter)}
                  onChange={(event) =>
                    updateFailureNumber('authFailureDisableAfter', event.target.value)
                  }
                  disabled={failureDisabled || !failureDraft.autoDisableAuthFailures}
                />
                <p className={styles.fieldHint}>
                  {t('codex_config.failure.auth_disable_after_hint')}
                </p>
              </div>
            </div>

            <div className={styles.cooldownGrid}>
              <div className={styles.settingCard}>
                <h2>{t('codex_config.failure.usage_limit_label')}</h2>
                <p className={styles.settingHint}>{t('codex_config.failure.usage_limit_hint')}</p>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t('codex_config.failure.disable_after')}
                  value={String(failureDraft.usageLimitDisableAfter)}
                  onChange={(event) =>
                    updateFailureNumber('usageLimitDisableAfter', event.target.value)
                  }
                  disabled={failureDisabled}
                />
                <p className={styles.fieldHint}>{t('codex_config.failure.disable_after_hint')}</p>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  label={t('codex_config.failure.fallback_hours')}
                  value={String(failureDraft.usageLimitCooldownFallbackHours)}
                  onChange={(event) =>
                    updateFailureNumber('usageLimitCooldownFallbackHours', event.target.value)
                  }
                  disabled={failureDisabled}
                />
                <p className={styles.fieldHint}>{t('codex_config.failure.fallback_hours_hint')}</p>
              </div>
              <div className={styles.settingCard}>
                <h2>{t('codex_config.failure.rate_limit_label')}</h2>
                <p className={styles.settingHint}>{t('codex_config.failure.rate_limit_hint')}</p>
                <div className={styles.reasonNote}>
                  {t('codex_config.failure.rate_limit_note')}
                </div>
              </div>
            </div>
          </section>
        </div>
      )}

      {activeTab === 'instructions' && (
        <div role="tabpanel" aria-label={t('codex_config.tabs.instructions')}>
          {instrError && <div className="error-box">{instrError}</div>}

          <div className={styles.workspace}>
            <section
              className={styles.settingsPanel}
              aria-label={t('codex_instructions.settings_title')}
            >
              <div className={styles.settingCard}>
                <div className={styles.settingHeader}>
                  <h2>{t('codex_instructions.settings_title')}</h2>
                  <ToggleSwitch
                    checked={instrDraft.enabled}
                    onChange={(enabled) => updateInstrDraft({ enabled })}
                    disabled={instrDisabled}
                    ariaLabel={t('codex_instructions.enabled')}
                  />
                </div>
                <p className={styles.settingHint}>{t('codex_instructions.enabled_hint')}</p>
              </div>

              <label className={styles.fieldGroup}>
                <span>{t('codex_instructions.mode_label')}</span>
                <Select
                  value={instrDraft.mode}
                  options={modeOptions}
                  onChange={(mode) => updateInstrDraft({ mode: mode as CodexInstructionsMode })}
                  disabled={instrDisabled}
                  ariaLabel={t('codex_instructions.mode_label')}
                />
                <small>{t('codex_instructions.mode_hint')}</small>
              </label>

              <div className={styles.fieldGroup}>
                <ToggleSwitch
                  checked={instrDraft.oauthOnly}
                  onChange={(oauthOnly) => updateInstrDraft({ oauthOnly })}
                  disabled={instrDisabled}
                  label={t('codex_instructions.oauth_only')}
                />
                <small>{t('codex_instructions.oauth_only_hint')}</small>
              </div>

              <div className={styles.fieldGroup}>
                <ToggleSwitch
                  checked={instrDraft.requireAuthAllow}
                  onChange={(requireAuthAllow) => updateInstrDraft({ requireAuthAllow })}
                  disabled={instrDisabled}
                  label={t('codex_instructions.require_auth_allow')}
                />
                <small>{t('codex_instructions.require_auth_allow_hint')}</small>
              </div>

              <div className={styles.fieldGroup}>
                <ToggleSwitch
                  checked={instrDraft.reserveMarkedAuths}
                  onChange={(reserveMarkedAuths) => updateInstrDraft({ reserveMarkedAuths })}
                  disabled={instrDisabled}
                  label={t('codex_instructions.reserve_marked_auths')}
                />
                <small>{t('codex_instructions.reserve_marked_auths_hint')}</small>
              </div>

              <div className={styles.fieldGroup}>
                <ToggleSwitch
                  checked={instrDraft.usePrefixSuffix}
                  onChange={(usePrefixSuffix) => updateInstrDraft({ usePrefixSuffix })}
                  disabled={instrDisabled}
                  label={t('codex_instructions.use_prefix_suffix')}
                />
                <small>{t('codex_instructions.use_prefix_suffix_hint')}</small>
              </div>

              {instrDraft.usePrefixSuffix && (
                <>
                  <label className={styles.fieldGroup}>
                    <span>{t('codex_instructions.prefix_markers_label')}</span>
                    <textarea
                      className={styles.modelsTextarea}
                      value={prefixMarkersInput}
                      onChange={(event) => setPrefixMarkersInput(event.target.value)}
                      disabled={instrDisabled}
                      rows={3}
                      placeholder="private/"
                    />
                    <small>{t('codex_instructions.prefix_markers_hint')}</small>
                  </label>

                  <label className={styles.fieldGroup}>
                    <span>{t('codex_instructions.suffix_markers_label')}</span>
                    <textarea
                      className={styles.modelsTextarea}
                      value={suffixMarkersInput}
                      onChange={(event) => setSuffixMarkersInput(event.target.value)}
                      disabled={instrDisabled}
                      rows={3}
                      placeholder="-private"
                    />
                    <small>{t('codex_instructions.suffix_markers_hint')}</small>
                  </label>
                </>
              )}

              <label className={styles.fieldGroup}>
                <span>{t('codex_instructions.models_label')}</span>
                <textarea
                  className={styles.modelsTextarea}
                  value={modelsInput}
                  onChange={(event) => setModelsInput(event.target.value)}
                  disabled={instrDisabled}
                  rows={4}
                  placeholder="gpt-5.5\ngpt-5*"
                />
                <small>{t('codex_instructions.models_hint')}</small>
              </label>

              <div className={styles.modelChips} aria-label={t('codex_instructions.models_preview')}>
                {modelChips.map((model) => (
                  <span key={model}>{model}</span>
                ))}
              </div>

              <Input
                label={t('codex_instructions.file_label')}
                value={instrDraft.file}
                onChange={(event) => updateInstrDraft({ file: event.target.value })}
                disabled={instrDisabled}
                placeholder="/home/me/codex-instructions.md"
                hint={t('codex_instructions.file_hint')}
              />
            </section>

            <section
              className={styles.editorPanel}
              aria-label={t('codex_instructions.editor_title')}
            >
              <div className={styles.editorHeader}>
                <div>
                  <h2>{t('codex_instructions.editor_title')}</h2>
                  <p>{t('codex_instructions.editor_hint')}</p>
                </div>
                <span className={styles.fileBadge}>instructions.md</span>
              </div>

              <div className={styles.templateImportBar}>
                <div className={styles.templateImportMain}>
                  <Select
                    className={styles.templateSelect}
                    value={selectedTemplate}
                    options={templateOptions}
                    onChange={setSelectedTemplate}
                    disabled={instrDisabled || templatesLoading || importingTemplate}
                    ariaLabel={t('codex_instructions.template_label')}
                    size="sm"
                    fullWidth
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void handleImportTemplate()}
                    disabled={
                      instrDisabled ||
                      importingTemplate ||
                      templatesLoading ||
                      !selectedTemplate ||
                      templates.length === 0
                    }
                    loading={importingTemplate}
                  >
                    {t('codex_instructions.template_import')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadTemplates()}
                    disabled={templatesLoading || importingTemplate}
                    aria-label={t('codex_instructions.template_refresh')}
                  >
                    <IconRefreshCw size={16} />
                  </Button>
                </div>
                <p className={styles.templateImportHint}>
                  {templatesError
                    ? t('codex_instructions.template_list_failed', { error: templatesError })
                    : t('codex_instructions.template_hint')}{' '}
                  <a
                    href={CODEX_X_EXAMPLES_REPO_URL}
                    target="_blank"
                    rel="noreferrer"
                    className={styles.templateLink}
                  >
                    Codex-X examples
                  </a>
                </p>
              </div>

              <div className={styles.editorWrapper}>
                <Suspense fallback={null}>
                  <LazyMarkdownSourceEditor
                    editorRef={editorRef}
                    value={instrDraft.content}
                    onChange={(content) => updateInstrDraft({ content })}
                    theme={resolvedTheme}
                    editable={!instrDisabled}
                    placeholder={t('codex_instructions.editor_placeholder')}
                  />
                </Suspense>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
