import { Input } from '@/components/ui/Input';
import styles from '../../../ConfigPage.module.scss';
import type { VisualSectionProps } from './sectionTypes';

export function AuthSection({ t, values, setValues, disabled }: VisualSectionProps) {
  return (
    <div className={styles.visualSection}>
      <div className={styles.sectionTitle}>
        {t('config_management.visual_group.auth', { defaultValue: 'Authentication' })}
      </div>
      <Input
        label={t('config_management.field.auth_dir.label', { defaultValue: 'Auth directory' })}
        hint={t('config_management.field.auth_dir.help', { defaultValue: '' })}
        placeholder={t('config_management.field.auth_dir.placeholder', { defaultValue: '' })}
        value={values.authDir}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, authDir: e.target.value }))}
      />
      <div className="form-group">
        <label>{t('config_management.field.api_keys.label', { defaultValue: 'API keys' })}</label>
        <textarea
          value={values.apiKeysText}
          placeholder={t('config_management.field.api_keys.placeholder', { defaultValue: '' })}
          disabled={disabled}
          onChange={(e) => setValues((prev) => ({ ...prev, apiKeysText: e.target.value }))}
          className={styles.textarea}
          spellCheck={false}
        />
        <div className="hint">{t('config_management.field.api_keys.help', { defaultValue: '' })}</div>
      </div>
    </div>
  );
}
