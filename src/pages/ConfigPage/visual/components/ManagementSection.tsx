import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import styles from '../../../ConfigPage.module.scss';
import type { VisualSectionProps } from './sectionTypes';

export function ManagementSection({ t, values, setValues, disabled }: VisualSectionProps) {
  return (
    <div className={styles.visualSection}>
      <div className={styles.sectionTitle}>
        {t('config_management.visual_group.management', {
          defaultValue: 'Management API',
        })}
      </div>
      <ToggleSwitch
        size="sm"
        label={t('config_management.field.rm_allow_remote.label', {
          defaultValue: 'Allow remote management',
        })}
        checked={values.rmAllowRemote}
        disabled={disabled}
        onChange={(value) => setValues((prev) => ({ ...prev, rmAllowRemote: value }))}
      />
      <div className="hint">
        {t('config_management.field.rm_allow_remote.help', { defaultValue: '' })}
      </div>
      <Input
        label={t('config_management.field.rm_secret_key.label', {
          defaultValue: 'Management key',
        })}
        hint={t('config_management.field.rm_secret_key.help', { defaultValue: '' })}
        placeholder={t('config_management.field.rm_secret_key.placeholder', { defaultValue: '' })}
        value={values.rmSecretKey}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, rmSecretKey: e.target.value }))}
      />
      <ToggleSwitch
        size="sm"
        label={t('config_management.field.rm_disable_panel.label', {
          defaultValue: 'Disable control panel',
        })}
        checked={values.rmDisableControlPanel}
        disabled={disabled}
        onChange={(value) => setValues((prev) => ({ ...prev, rmDisableControlPanel: value }))}
      />
      <div className="hint">
        {t('config_management.field.rm_disable_panel.help', { defaultValue: '' })}
      </div>
      <Input
        label={t('config_management.field.rm_panel_repo.label', {
          defaultValue: 'Panel GitHub repository',
        })}
        hint={t('config_management.field.rm_panel_repo.help', { defaultValue: '' })}
        placeholder={t('config_management.field.rm_panel_repo.placeholder', { defaultValue: '' })}
        value={values.rmPanelRepo}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, rmPanelRepo: e.target.value }))}
      />
    </div>
  );
}
