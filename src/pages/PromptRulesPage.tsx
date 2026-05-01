/**
 * Prompt Rules management page.
 *
 * Lists configured prompt-rules and provides add/edit/delete via the
 * /v0/management/prompt-rules backend API. Rules are applied pre-translation by
 * the proxy to system prompts and last-natural-language user messages.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useHeaderRefresh } from '@/hooks/useHeaderRefresh';
import { useAuthStore, useNotificationStore } from '@/stores';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { EmptyState } from '@/components/ui/EmptyState';
import { Select } from '@/components/ui/Select';
import {
  promptRulesApi,
  PROMPT_RULE_SOURCE_FORMATS,
  type PromptRule,
  type PromptRuleAction,
  type PromptRulePosition,
  type PromptRuleTarget,
} from '@/services/api/promptRules';
import styles from './PromptRulesPage.module.scss';

const EMPTY_RULE: PromptRule = {
  name: '',
  enabled: true,
  models: [],
  target: 'system',
  action: 'inject',
  content: '',
  marker: '',
  position: 'append',
  pattern: '',
};

interface EditorState {
  open: boolean;
  rule: PromptRule;
  originalName: string | null; // null = creating; non-null = editing existing rule
  saving: boolean;
  error: string;
}

const cloneRule = (r: PromptRule): PromptRule => ({
  ...r,
  models: (r.models ?? []).map((m) => ({ ...m })),
});

const validateRegex = (pattern: string): string => {
  if (!pattern) return '';
  try {
    // JS regex validation is advisory; Go RE2 is the source of truth on the
    // backend. Subtle differences (e.g., backreferences, lookaround) may pass
    // here and fail server-side.
    new RegExp(pattern);
    return '';
  } catch (err) {
    return err instanceof Error ? err.message : 'invalid regex';
  }
};

export function PromptRulesPage() {
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const disabled = connectionStatus !== 'connected';

  const [rules, setRules] = useState<PromptRule[]>([]);
  // loading=true on first mount so we don't flash an empty state before the
  // initial fetch starts (Codex post-impl review).
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editor, setEditor] = useState<EditorState>({
    open: false,
    rule: cloneRule(EMPTY_RULE),
    originalName: null,
    saving: false,
    error: '',
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await promptRulesApi.list();
      setRules(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('prompt_rules.load_failed');
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useHeaderRefresh(load);
  useEffect(() => {
    load().catch(() => {
      // surfaced via state.error
    });
  }, [load]);

  const openCreate = useCallback(() => {
    setEditor({
      open: true,
      rule: cloneRule(EMPTY_RULE),
      originalName: null,
      saving: false,
      error: '',
    });
  }, []);

  const openEdit = useCallback((rule: PromptRule) => {
    setEditor({
      open: true,
      rule: cloneRule(rule),
      originalName: rule.name,
      saving: false,
      error: '',
    });
  }, []);

  const closeEditor = useCallback(() => {
    setEditor((prev) => ({ ...prev, open: false }));
  }, []);

  const updateRuleField = useCallback(<K extends keyof PromptRule>(key: K, value: PromptRule[K]) => {
    setEditor((prev) => ({
      ...prev,
      rule: { ...prev.rule, [key]: value },
      error: '',
    }));
  }, []);

  const addModelEntry = useCallback(() => {
    setEditor((prev) => ({
      ...prev,
      rule: {
        ...prev.rule,
        models: [...(prev.rule.models ?? []), { name: '*', protocol: '' }],
      },
    }));
  }, []);

  const removeModelEntry = useCallback((idx: number) => {
    setEditor((prev) => ({
      ...prev,
      rule: {
        ...prev.rule,
        models: (prev.rule.models ?? []).filter((_, i) => i !== idx),
      },
    }));
  }, []);

  const updateModelEntry = useCallback((idx: number, key: 'name' | 'protocol', value: string) => {
    setEditor((prev) => {
      const models = (prev.rule.models ?? []).map((m, i) => (i === idx ? { ...m, [key]: value } : m));
      return { ...prev, rule: { ...prev.rule, models } };
    });
  }, []);

  const validateBeforeSave = useCallback(
    (rule: PromptRule): string => {
      if (!rule.name.trim()) return t('prompt_rules.error_name_required');
      if (rule.action === 'inject') {
        if (!rule.content?.trim()) return t('prompt_rules.error_content_required');
      } else {
        if (!rule.pattern?.trim()) return t('prompt_rules.error_pattern_required');
        const regexErr = validateRegex(rule.pattern);
        if (regexErr) return t('prompt_rules.error_pattern_invalid', { reason: regexErr });
      }
      return '';
    },
    [t],
  );

  const saveRule = useCallback(async () => {
    const localErr = validateBeforeSave(editor.rule);
    if (localErr) {
      setEditor((prev) => ({ ...prev, error: localErr }));
      return;
    }
    const trimmedName = editor.rule.name.trim();
    // Pre-check duplicate names so we don't lean on the backend to surface
    // them as 400s (Codex post-impl review).
    if (editor.originalName === null && rules.some((r) => r.name === trimmedName)) {
      setEditor((prev) => ({
        ...prev,
        error: t('prompt_rules.error_duplicate_name', { name: trimmedName }),
      }));
      return;
    }
    setEditor((prev) => ({ ...prev, saving: true, error: '' }));
    try {
      // Action-specific payload: omit fields that don't belong to the chosen
      // action so the persisted YAML stays clean.
      const baseRule: PromptRule = {
        name: trimmedName,
        enabled: editor.rule.enabled,
        target: editor.rule.target,
        action: editor.rule.action,
        models: (editor.rule.models ?? [])
          .map((m) => ({
            name: m.name.trim(),
            protocol: (m.protocol ?? '').trim(),
          }))
          .filter((m) => m.name.length > 0),
      };
      const cleanRule: PromptRule =
        editor.rule.action === 'inject'
          ? {
              ...baseRule,
              content: editor.rule.content ?? '',
              marker: editor.rule.marker ?? '',
              position: editor.rule.position ?? 'append',
            }
          : { ...baseRule, pattern: editor.rule.pattern ?? '' };
      if (editor.originalName === null) {
        await promptRulesApi.replace([...rules, cleanRule]);
      } else {
        const next = rules.map((r) => (r.name === editor.originalName ? cleanRule : r));
        await promptRulesApi.replace(next);
      }
      showNotification(t('prompt_rules.saved'), 'success');
      closeEditor();
      await load();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('prompt_rules.save_failed');
      setEditor((prev) => ({ ...prev, saving: false, error: msg }));
    }
  }, [editor, rules, showNotification, t, closeEditor, load, validateBeforeSave]);

  const toggleEnabled = useCallback(
    async (rule: PromptRule, nextEnabled: boolean) => {
      // Use PATCH-by-name so two simultaneous toggles can't overwrite each
      // other's PUT bodies (Codex post-impl review).
      try {
        await promptRulesApi.upsert({
          match: rule.name,
          value: { ...rule, enabled: nextEnabled },
        });
        setRules((prev) =>
          prev.map((r) => (r.name === rule.name ? { ...r, enabled: nextEnabled } : r)),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('prompt_rules.save_failed');
        showNotification(msg, 'error');
      }
    },
    [showNotification, t],
  );

  const deleteRule = useCallback(
    async (name: string) => {
      if (!window.confirm(t('prompt_rules.confirm_delete', { name }))) return;
      try {
        await promptRulesApi.deleteByName(name);
        showNotification(t('prompt_rules.deleted'), 'success');
        await load();
      } catch (err) {
        const msg = err instanceof Error ? err.message : t('prompt_rules.delete_failed');
        showNotification(msg, 'error');
      }
    },
    [t, showNotification, load],
  );

  const sortedRules = useMemo(() => [...rules].sort((a, b) => a.name.localeCompare(b.name)), [rules]);

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t('prompt_rules.title')}</h1>
        <p className={styles.description}>{t('prompt_rules.description')}</p>
      </div>

      <div className={styles.toolbar}>
        <Button variant="primary" onClick={openCreate} disabled={disabled || loading}>
          {t('prompt_rules.add_rule')}
        </Button>
      </div>

      {error && <div className={styles.errorBox}>{error}</div>}

      {sortedRules.length === 0 && !loading ? (
        <EmptyState
          title={t('prompt_rules.empty_title')}
          description={t('prompt_rules.empty_description')}
        />
      ) : (
        <div className={styles.cardGrid}>
          {sortedRules.map((rule) => (
            <div key={rule.name} className={styles.ruleCard}>
              <div className={styles.cardHeader}>
                <div className={styles.cardTitle}>{rule.name}</div>
                <div className={styles.chipRow}>
                  <span className={styles.chip}>{t(`prompt_rules.target_${rule.target}`)}</span>
                  <span
                    className={[
                      styles.chip,
                      rule.action === 'inject' ? styles.chipActionInject : styles.chipActionStrip,
                    ].join(' ')}
                  >
                    {t(`prompt_rules.action_${rule.action}`)}
                  </span>
                </div>
              </div>

              <div className={styles.cardBody}>
                {rule.action === 'inject' ? (
                  <>
                    <div className={styles.cardField}>
                      <span className={styles.cardFieldLabel}>{t('prompt_rules.field_marker')}</span>
                      <span className={styles.cardFieldValue}>{rule.marker || '—'}</span>
                    </div>
                    <div className={styles.cardField}>
                      <span className={styles.cardFieldLabel}>{t('prompt_rules.field_position')}</span>
                      <span className={styles.cardFieldValue}>
                        {(rule.marker ?? '').length > 0
                          ? t(`prompt_rules.position_${rule.position ?? 'append'}_marker`)
                          : t(`prompt_rules.position_${rule.position ?? 'append'}`)}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className={styles.cardField}>
                    <span className={styles.cardFieldLabel}>{t('prompt_rules.field_pattern')}</span>
                    <span className={styles.cardFieldValue}>{rule.pattern || '—'}</span>
                  </div>
                )}
                {rule.models && rule.models.length > 0 && (
                  <div className={styles.cardField}>
                    <span className={styles.cardFieldLabel}>{t('prompt_rules.field_models')}</span>
                    <span className={styles.cardFieldValue}>
                      {rule.models
                        .map((m) => `${m.name}${m.protocol ? `@${m.protocol}` : ''}`)
                        .join(', ')}
                    </span>
                  </div>
                )}
              </div>

              <div className={styles.cardActions}>
                <div className={styles.toggleWrap}>
                  <span id={`prompt-rule-toggle-label-${rule.name}`}>
                    {t('prompt_rules.field_enabled')}
                  </span>
                  <ToggleSwitch
                    checked={rule.enabled}
                    onChange={(next) => toggleEnabled(rule, next)}
                    disabled={disabled}
                    ariaLabel={t('prompt_rules.toggle_aria_label', {
                      name: rule.name,
                      defaultValue: `Toggle prompt rule ${rule.name}`,
                    })}
                  />
                </div>
                <Button variant="secondary" size="sm" onClick={() => openEdit(rule)} disabled={disabled}>
                  {t('common.edit')}
                </Button>
                <Button variant="danger" size="sm" onClick={() => deleteRule(rule.name)} disabled={disabled}>
                  {t('common.delete')}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={editor.open}
        onClose={editor.saving ? () => undefined : closeEditor}
        title={
          editor.originalName === null
            ? t('prompt_rules.modal_title_create')
            : t('prompt_rules.modal_title_edit')
        }
        footer={
          <div className={styles.modalFooter}>
            <Button variant="secondary" onClick={closeEditor} disabled={editor.saving}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" onClick={saveRule} loading={editor.saving} disabled={editor.saving}>
              {t('common.save')}
            </Button>
          </div>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formHeaderRow}>
            <Input
              label={t('prompt_rules.field_name')}
              value={editor.rule.name}
              onChange={(e) => updateRuleField('name', e.target.value)}
              disabled={editor.originalName !== null}
              hint={
                editor.originalName !== null
                  ? t('prompt_rules.field_name_hint_locked')
                  : t('prompt_rules.field_name_hint')
              }
            />
            <ToggleSwitch
              label={t('prompt_rules.field_enabled')}
              checked={editor.rule.enabled}
              onChange={(next) => updateRuleField('enabled', next)}
              ariaLabel={t('prompt_rules.field_enabled')}
            />
          </div>

          <div className={styles.field} role="radiogroup" aria-label={t('prompt_rules.field_target')}>
            <div className={styles.fieldLabel}>{t('prompt_rules.field_target')}</div>
            <div className={styles.radioGroup}>
              {(['system', 'user'] as PromptRuleTarget[]).map((t2) => (
                <label key={t2} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="target"
                    value={t2}
                    checked={editor.rule.target === t2}
                    onChange={() => updateRuleField('target', t2)}
                  />
                  {t(`prompt_rules.target_${t2}`)}
                </label>
              ))}
            </div>
            <div className={styles.fieldHint}>
              {editor.rule.target === 'user'
                ? t('prompt_rules.target_user_hint')
                : t('prompt_rules.target_system_hint')}
            </div>
          </div>

          <div className={styles.field} role="radiogroup" aria-label={t('prompt_rules.field_action')}>
            <div className={styles.fieldLabel}>{t('prompt_rules.field_action')}</div>
            <div className={styles.radioGroup}>
              {(['inject', 'strip'] as PromptRuleAction[]).map((a) => (
                <label key={a} className={styles.radioLabel}>
                  <input
                    type="radio"
                    name="action"
                    value={a}
                    checked={editor.rule.action === a}
                    onChange={() => updateRuleField('action', a)}
                  />
                  {t(`prompt_rules.action_${a}`)}
                </label>
              ))}
            </div>
          </div>

          {editor.rule.action === 'inject' ? (
            <>
              <div className={styles.field}>
                <label htmlFor="prompt-rule-content" className={styles.fieldLabel}>
                  {t('prompt_rules.field_content')}
                </label>
                <textarea
                  id="prompt-rule-content"
                  className={styles.textarea}
                  value={editor.rule.content ?? ''}
                  onChange={(e) => updateRuleField('content', e.target.value)}
                  placeholder={t('prompt_rules.field_content_placeholder')}
                />
                <div className={styles.fieldHint}>{t('prompt_rules.field_content_hint')}</div>
              </div>

              <div className={styles.field}>
                <Input
                  label={t('prompt_rules.field_marker')}
                  value={editor.rule.marker ?? ''}
                  onChange={(e) => updateRuleField('marker', e.target.value)}
                  hint={t('prompt_rules.field_marker_hint')}
                />
              </div>

              <div className={styles.field} role="radiogroup" aria-label={t('prompt_rules.field_position')}>
                <div className={styles.fieldLabel}>{t('prompt_rules.field_position')}</div>
                <div className={styles.radioGroup}>
                  {(['append', 'prepend'] as PromptRulePosition[]).map((p) => (
                    <label key={p} className={styles.radioLabel}>
                      <input
                        type="radio"
                        name="position"
                        value={p}
                        checked={editor.rule.position === p}
                        onChange={() => updateRuleField('position', p)}
                      />
                      {(editor.rule.marker ?? '').length > 0
                        ? t(`prompt_rules.position_${p}_marker`)
                        : t(`prompt_rules.position_${p}`)}
                    </label>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <div className={styles.field}>
              <label htmlFor="prompt-rule-pattern" className={styles.fieldLabel}>
                {t('prompt_rules.field_pattern')}
              </label>
              <textarea
                id="prompt-rule-pattern"
                className={styles.textarea}
                value={editor.rule.pattern ?? ''}
                onChange={(e) => updateRuleField('pattern', e.target.value)}
                placeholder={t('prompt_rules.field_pattern_placeholder', {
                  defaultValue: 'Pattern[^\\n]*\\n?',
                })}
                style={{ minHeight: 60 }}
              />
              <div className={styles.fieldHint}>{t('prompt_rules.field_pattern_hint')}</div>
              {editor.rule.pattern && validateRegex(editor.rule.pattern) ? (
                <div className={styles.fieldError}>
                  {t('prompt_rules.error_pattern_invalid', {
                    reason: validateRegex(editor.rule.pattern),
                  })}
                </div>
              ) : null}
            </div>
          )}

          <div className={styles.field}>
            <div className={styles.fieldLabel}>{t('prompt_rules.field_models')}</div>
            <div className={styles.fieldHint}>{t('prompt_rules.field_models_hint')}</div>
            <div className={styles.modelEntries}>
              {(editor.rule.models ?? []).map((m, i) => (
                <div key={i} className={styles.modelEntry}>
                  <Input
                    placeholder="*"
                    value={m.name}
                    onChange={(e) => updateModelEntry(i, 'name', e.target.value)}
                  />
                  <Select
                    value={m.protocol ?? ''}
                    onChange={(value) => updateModelEntry(i, 'protocol', value)}
                    options={PROMPT_RULE_SOURCE_FORMATS.map((sf) => ({
                      value: sf.value,
                      label: sf.label,
                    }))}
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeModelEntry(i)}>
                    {t('common.delete')}
                  </Button>
                </div>
              ))}
              <Button variant="secondary" size="sm" onClick={addModelEntry}>
                {t('prompt_rules.add_model_filter')}
              </Button>
            </div>
          </div>

          {editor.error && <div className={styles.fieldError}>{editor.error}</div>}
        </div>
      </Modal>
    </div>
  );
}
