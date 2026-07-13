import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { IconRefreshCw, IconShield } from '@/components/ui/icons';
import { useUnsavedChangesGuard } from '@/hooks/useUnsavedChangesGuard';
import { configApi } from '@/services/api/config';
import { useAuthStore, useNotificationStore } from '@/stores';
import type { XAIConfig } from '@/types';
import styles from './XAIConfigPage.module.scss';

const DEFAULT_XAI_CONFIG: XAIConfig = {
  autoDisablePermissionDenied: true,
  otherForbiddenCooldownHours: 6,
  freeUsageExhaustedCooldownHours: 24,
};

function normalizeConfig(config: XAIConfig): XAIConfig {
  return {
    autoDisablePermissionDenied: config.autoDisablePermissionDenied !== false,
    otherForbiddenCooldownHours: Math.max(0, Math.floor(config.otherForbiddenCooldownHours || 0)),
    freeUsageExhaustedCooldownHours: Math.max(
      0,
      Math.floor(config.freeUsageExhaustedCooldownHours || 0)
    ),
  };
}

function sameConfig(left: XAIConfig, right: XAIConfig): boolean {
  return JSON.stringify(normalizeConfig(left)) === JSON.stringify(normalizeConfig(right));
}

export function XAIConfigPage() {
  const { t } = useTranslation();
  const connectionStatus = useAuthStore((state) => state.connectionStatus);
  const showNotification = useNotificationStore((state) => state.showNotification);
  const showConfirmation = useNotificationStore((state) => state.showConfirmation);
  const [draft, setDraft] = useState<XAIConfig>(DEFAULT_XAI_CONFIG);
  const [saved, setSaved] = useState<XAIConfig>(DEFAULT_XAI_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const disabled = connectionStatus !== 'connected' || loading || saving;
  const dirty = !sameConfig(draft, saved);
  const statusText = error
    ? t('xai_config.status_load_failed')
    : loading
      ? t('xai_config.status_loading')
      : saving
        ? t('xai_config.status_saving')
        : dirty
          ? t('xai_config.status_dirty')
          : t('xai_config.status_loaded');
  const statusClass = error ? styles.error : dirty ? styles.modified : styles.saved;

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = normalizeConfig(await configApi.getXAIConfig());
      setDraft(next);
      setSaved(next);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : t('notification.refresh_failed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((patch: Partial<XAIConfig>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  const unsavedDialog = useMemo(
    () => ({
      title: t('common.unsaved_changes_title'),
      message: t('common.unsaved_changes_message'),
      confirmText: t('common.confirm'),
      cancelText: t('common.cancel'),
    }),
    [t]
  );
  useUnsavedChangesGuard({ shouldBlock: dirty, dialog: unsavedDialog });

  const reload = useCallback(() => {
    if (!dirty) {
      void load();
      return;
    }
    showConfirmation({
      title: t('common.unsaved_changes_title'),
      message: t('xai_config.reload_confirm_message'),
      confirmText: t('xai_config.reload'),
      cancelText: t('common.cancel'),
      variant: 'danger',
      onConfirm: async () => load(),
    });
  }, [dirty, load, showConfirmation, t]);

  const save = useCallback(async () => {
    const next = normalizeConfig(draft);
    setSaving(true);
    try {
      await configApi.updateXAIConfig(next);
      setDraft(next);
      setSaved(next);
      showNotification(t('xai_config.save_success'), 'success');
    } catch (saveError: unknown) {
      const message = saveError instanceof Error ? saveError.message : '';
      showNotification(`${t('notification.save_failed')}: ${message}`, 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, showNotification, t]);

  const updateHours = (
    key: 'otherForbiddenCooldownHours' | 'freeUsageExhaustedCooldownHours',
    value: string
  ) => {
    const parsed = Number.parseInt(value, 10);
    update({ [key]: Number.isFinite(parsed) ? Math.max(0, parsed) : 0 });
  };

  return (
    <div className={styles.container}>
      <div className={styles.pageHeader}>
        <div>
          <div className={styles.titleRow}>
            <span className={styles.titleIcon} aria-hidden="true">
              <IconShield size={20} />
            </span>
            <h1>{t('xai_config.title')}</h1>
          </div>
          <p>{t('xai_config.description')}</p>
        </div>
        <div className={styles.headerActions}>
          <span className={`${styles.statusBadge} ${statusClass}`}>{statusText}</span>
          <Button variant="secondary" onClick={reload} disabled={loading || saving}>
            <IconRefreshCw size={16} />
            {t('xai_config.reload')}
          </Button>
          <Button onClick={save} disabled={disabled || !dirty} loading={saving}>
            {t('xai_config.save')}
          </Button>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className={styles.policyStrip} aria-label={t('xai_config.policy_summary')}>
        <span>{t('xai_config.policy_permission')}</span>
        <span>
          {t('xai_config.policy_forbidden', { hours: draft.otherForbiddenCooldownHours })}
        </span>
        <span>
          {t('xai_config.policy_free_usage', { hours: draft.freeUsageExhaustedCooldownHours })}
        </span>
      </div>

      <section className={styles.settings} aria-label={t('xai_config.settings_title')}>
        <div className={styles.settingCard}>
          <div className={styles.settingHeader}>
            <div>
              <h2>{t('xai_config.auto_disable_label')}</h2>
              <p>{t('xai_config.auto_disable_hint')}</p>
            </div>
            <ToggleSwitch
              checked={draft.autoDisablePermissionDenied}
              onChange={(autoDisablePermissionDenied) => update({ autoDisablePermissionDenied })}
              disabled={disabled}
              ariaLabel={t('xai_config.auto_disable_label')}
            />
          </div>
          <div className={styles.reasonNote}>{t('xai_config.reason_note')}</div>
        </div>

        <div className={styles.cooldownGrid}>
          <div className={styles.settingCard}>
            <h2>{t('xai_config.other_403_label')}</h2>
            <p>{t('xai_config.other_403_hint')}</p>
            <Input
              type="number"
              min="0"
              step="1"
              label={t('xai_config.cooldown_hours')}
              value={String(draft.otherForbiddenCooldownHours)}
              onChange={(event) => updateHours('otherForbiddenCooldownHours', event.target.value)}
              disabled={disabled}
            />
          </div>
          <div className={styles.settingCard}>
            <h2>{t('xai_config.free_usage_label')}</h2>
            <p>{t('xai_config.free_usage_hint')}</p>
            <Input
              type="number"
              min="0"
              step="1"
              label={t('xai_config.cooldown_hours')}
              value={String(draft.freeUsageExhaustedCooldownHours)}
              onChange={(event) =>
                updateHours('freeUsageExhaustedCooldownHours', event.target.value)
              }
              disabled={disabled}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
