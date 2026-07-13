import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconFileText, IconRefreshCw } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { configApi } from '@/services/api/config';
import { useAuthStore, useNotificationStore, useThemeStore } from '@/stores';
import type { CodexInstructionsConfig, CodexInstructionsMode } from '@/types';
import styles from './CodexInstructionsPage.module.scss';

const LazyMarkdownSourceEditor = lazy(() => import('@/components/config/MarkdownSourceEditor'));

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

function parseModels(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeForCompare(config: CodexInstructionsConfig): CodexInstructionsConfig {
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

function sameConfig(a: CodexInstructionsConfig, b: CodexInstructionsConfig): boolean {
  return JSON.stringify(normalizeForCompare(a)) === JSON.stringify(normalizeForCompare(b));
}

export function CodexInstructionsPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const editorRef = useRef<ReactCodeMirrorRef | null>(null);

  const [draft, setDraft] = useState<CodexInstructionsConfig>(DEFAULT_INSTRUCTIONS);
  const [saved, setSaved] = useState<CodexInstructionsConfig>(DEFAULT_INSTRUCTIONS);
  const [modelsInput, setModelsInput] = useState(DEFAULT_INSTRUCTIONS.models.join('\n'));
  const [prefixMarkersInput, setPrefixMarkersInput] = useState(
    DEFAULT_INSTRUCTIONS.requestMarkers.prefixes.join('\n')
  );
  const [suffixMarkersInput, setSuffixMarkersInput] = useState(
    DEFAULT_INSTRUCTIONS.requestMarkers.suffixes.join('\n')
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const disableControls = connectionStatus !== 'connected' || loading || saving;
  const effectiveDraft = useMemo(
    () => ({
      ...draft,
      models: parseModels(modelsInput),
      requestMarkers: {
        prefixes: parseModels(prefixMarkersInput),
        suffixes: parseModels(suffixMarkersInput),
      },
    }),
    [draft, modelsInput, prefixMarkersInput, suffixMarkersInput]
  );
  const dirty = !sameConfig(effectiveDraft, saved);
  const modelChips =
    effectiveDraft.models.length > 0 ? effectiveDraft.models : DEFAULT_INSTRUCTIONS.models;
  const statusClass = error ? styles.error : dirty ? styles.modified : styles.saved;
  const statusText = error
    ? t('codex_instructions.status_load_failed')
    : loading
      ? t('codex_instructions.status_loading')
      : saving
        ? t('codex_instructions.status_saving')
        : dirty
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
    shouldBlock: dirty,
    dialog: unsavedChangesDialog,
  });

  const applyLoadedConfig = useCallback((config: CodexInstructionsConfig) => {
    const nextConfig = normalizeForCompare(config);
    setDraft(nextConfig);
    setSaved(nextConfig);
    setModelsInput(nextConfig.models.join('\n'));
    setPrefixMarkersInput(nextConfig.requestMarkers.prefixes.join('\n'));
    setSuffixMarkersInput(nextConfig.requestMarkers.suffixes.join('\n'));
  }, []);

  const loadInstructions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const config = await configApi.getCodexInstructions();
      applyLoadedConfig(config);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('notification.refresh_failed');
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [applyLoadedConfig, t]);

  useEffect(() => {
    void loadInstructions();
  }, [loadInstructions]);

  const updateDraft = useCallback((patch: Partial<CodexInstructionsConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const handleReload = useCallback(() => {
    if (!dirty) {
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
  }, [dirty, loadInstructions, showConfirmation, t]);

  const handleSave = useCallback(async () => {
    const nextConfig = normalizeForCompare(effectiveDraft);
    if (nextConfig.models.length === 0) {
      showNotification(t('codex_instructions.models_required'), 'error');
      return;
    }

    setSaving(true);
    try {
      await configApi.updateCodexInstructions(nextConfig);
      applyLoadedConfig(nextConfig);
      showNotification(t('codex_instructions.save_success'), 'success');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [applyLoadedConfig, effectiveDraft, showNotification, t]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div className={styles.pageHeaderCopy}>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              <IconFileText size={20} />
            </span>
            <h1 className={styles.pageTitle}>{t('codex_instructions.title')}</h1>
          </div>
          <p className={styles.description}>{t('codex_instructions.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.statusBadge} ${statusClass}`}>{statusText}</span>
          <Button variant="secondary" onClick={handleReload} disabled={loading || saving}>
            <IconRefreshCw size={16} />
            {t('codex_instructions.reload')}
          </Button>
          <Button onClick={handleSave} disabled={disableControls || !dirty} loading={saving}>
            {t('codex_instructions.save')}
          </Button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className={styles.workspace}>
        <section
          className={styles.settingsPanel}
          aria-label={t('codex_instructions.settings_title')}
        >
          <div className={styles.settingCard}>
            <div className={styles.settingHeader}>
              <h2>{t('codex_instructions.settings_title')}</h2>
              <ToggleSwitch
                checked={draft.enabled}
                onChange={(enabled) => updateDraft({ enabled })}
                disabled={disableControls}
                ariaLabel={t('codex_instructions.enabled')}
              />
            </div>
            <p className={styles.settingHint}>{t('codex_instructions.enabled_hint')}</p>
          </div>

          <label className={styles.fieldGroup}>
            <span>{t('codex_instructions.mode_label')}</span>
            <Select
              value={draft.mode}
              options={modeOptions}
              onChange={(mode) => updateDraft({ mode: mode as CodexInstructionsMode })}
              disabled={disableControls}
              ariaLabel={t('codex_instructions.mode_label')}
            />
            <small>{t('codex_instructions.mode_hint')}</small>
          </label>

          <div className={styles.fieldGroup}>
            <ToggleSwitch
              checked={draft.oauthOnly}
              onChange={(oauthOnly) => updateDraft({ oauthOnly })}
              disabled={disableControls}
              label={t('codex_instructions.oauth_only')}
            />
            <small>{t('codex_instructions.oauth_only_hint')}</small>
          </div>

          <div className={styles.fieldGroup}>
            <ToggleSwitch
              checked={draft.requireAuthAllow}
              onChange={(requireAuthAllow) => updateDraft({ requireAuthAllow })}
              disabled={disableControls}
              label={t('codex_instructions.require_auth_allow')}
            />
            <small>{t('codex_instructions.require_auth_allow_hint')}</small>
          </div>

          <div className={styles.fieldGroup}>
            <ToggleSwitch
              checked={draft.reserveMarkedAuths}
              onChange={(reserveMarkedAuths) => updateDraft({ reserveMarkedAuths })}
              disabled={disableControls}
              label={t('codex_instructions.reserve_marked_auths')}
            />
            <small>{t('codex_instructions.reserve_marked_auths_hint')}</small>
          </div>

          <div className={styles.fieldGroup}>
            <ToggleSwitch
              checked={draft.usePrefixSuffix}
              onChange={(usePrefixSuffix) => updateDraft({ usePrefixSuffix })}
              disabled={disableControls}
              label={t('codex_instructions.use_prefix_suffix')}
            />
            <small>{t('codex_instructions.use_prefix_suffix_hint')}</small>
          </div>

          {draft.usePrefixSuffix && (
            <>
              <label className={styles.fieldGroup}>
                <span>{t('codex_instructions.prefix_markers_label')}</span>
                <textarea
                  className={styles.modelsTextarea}
                  value={prefixMarkersInput}
                  onChange={(event) => setPrefixMarkersInput(event.target.value)}
                  disabled={disableControls}
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
                  disabled={disableControls}
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
              disabled={disableControls}
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
            value={draft.file}
            onChange={(event) => updateDraft({ file: event.target.value })}
            disabled={disableControls}
            placeholder="/home/me/codex-instructions.md"
            hint={t('codex_instructions.file_hint')}
          />
        </section>

        <section className={styles.editorPanel} aria-label={t('codex_instructions.editor_title')}>
          <div className={styles.editorHeader}>
            <div>
              <h2>{t('codex_instructions.editor_title')}</h2>
              <p>{t('codex_instructions.editor_hint')}</p>
            </div>
            <span className={styles.fileBadge}>instructions.md</span>
          </div>

          <div className={styles.editorWrapper}>
            <Suspense fallback={null}>
              <LazyMarkdownSourceEditor
                editorRef={editorRef}
                value={draft.content}
                onChange={(content) => updateDraft({ content })}
                theme={resolvedTheme}
                editable={!disableControls}
                placeholder={t('codex_instructions.editor_placeholder')}
              />
            </Suspense>
          </div>
        </section>
      </div>
    </div>
  );
}
