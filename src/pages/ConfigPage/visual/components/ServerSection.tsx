import { Input } from '@/components/ui/Input';
import styles from '../../../ConfigPage.module.scss';
import type { VisualSectionProps } from './sectionTypes';

export function ServerSection({ t, values, setValues, disabled }: VisualSectionProps) {
  return (
    <div className={styles.visualSection}>
      <div className={styles.sectionTitle}>
        {t('config_management.visual_group.server', { defaultValue: 'Server' })}
      </div>
      <Input
        label={t('config_management.field.host.label', { defaultValue: 'Host' })}
        hint={t('config_management.field.host.help', { defaultValue: '' })}
        placeholder={t('config_management.field.host.placeholder', { defaultValue: '' })}
        value={values.host}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, host: e.target.value }))}
      />
      <Input
        label={t('config_management.field.port.label', { defaultValue: 'Port' })}
        hint={t('config_management.field.port.help', { defaultValue: '' })}
        placeholder={t('config_management.field.port.placeholder', { defaultValue: '' })}
        value={values.port}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, port: e.target.value }))}
      />
    </div>
  );
}
