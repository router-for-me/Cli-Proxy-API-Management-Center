import { Input } from '@/components/ui/Input';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import styles from '../../../ConfigPage.module.scss';
import type { VisualSectionProps } from './sectionTypes';

export function TlsSection({ t, values, setValues, disabled }: VisualSectionProps) {
  return (
    <div className={styles.visualSection}>
      <div className={styles.sectionTitle}>
        {t('config_management.visual_group.tls', { defaultValue: 'TLS (HTTPS)' })}
      </div>
      <ToggleSwitch
        size="sm"
        label={t('config_management.field.tls_enable.label', {
          defaultValue: 'Enable TLS (HTTPS)',
        })}
        checked={values.tlsEnable}
        disabled={disabled}
        onChange={(value) => setValues((prev) => ({ ...prev, tlsEnable: value }))}
      />
      <div className="hint">{t('config_management.field.tls_enable.help', { defaultValue: '' })}</div>
      <Input
        label={t('config_management.field.tls_cert.label', {
          defaultValue: 'TLS certificate path',
        })}
        hint={t('config_management.field.tls_cert.help', { defaultValue: '' })}
        placeholder={t('config_management.field.tls_cert.placeholder', { defaultValue: '' })}
        value={values.tlsCert}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, tlsCert: e.target.value }))}
      />
      <Input
        label={t('config_management.field.tls_key.label', {
          defaultValue: 'TLS key path',
        })}
        hint={t('config_management.field.tls_key.help', { defaultValue: '' })}
        placeholder={t('config_management.field.tls_key.placeholder', { defaultValue: '' })}
        value={values.tlsKey}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, tlsKey: e.target.value }))}
      />
    </div>
  );
}
