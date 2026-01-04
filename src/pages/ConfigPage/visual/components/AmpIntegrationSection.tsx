import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import styles from '../../../ConfigPage.module.scss';
import { makeClientId } from '../types';
import type { VisualSectionProps } from './sectionTypes';

export function AmpIntegrationSection({ t, values, setValues, disabled }: VisualSectionProps) {
  return (
    <div className={styles.visualSectionWide}>
      <div className={styles.sectionTitle}>
        {t('config_management.visual_group.amp', { defaultValue: 'Amp Integration' })}
      </div>
      <Input
        label={t('config_management.field.amp_upstream_url.label', {
          defaultValue: 'Upstream URL',
        })}
        hint={t('config_management.field.amp_upstream_url.help', { defaultValue: '' })}
        placeholder={t('config_management.field.amp_upstream_url.placeholder', {
          defaultValue: '',
        })}
        value={values.ampUpstreamUrl}
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, ampUpstreamUrl: e.target.value }))}
      />
      <Input
        label={t('config_management.field.amp_upstream_api_key.label', {
          defaultValue: 'Upstream API key',
        })}
        hint={t('config_management.field.amp_upstream_api_key.help', {
          defaultValue: '',
        })}
        placeholder={t('config_management.field.amp_upstream_api_key.placeholder', {
          defaultValue: '',
        })}
        value={values.ampUpstreamApiKey}
        type="password"
        disabled={disabled}
        onChange={(e) => setValues((prev) => ({ ...prev, ampUpstreamApiKey: e.target.value }))}
      />
      <div className={styles.inlineGrid}>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={values.ampRestrictManagementToLocalhost}
              disabled={disabled}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  ampRestrictManagementToLocalhost: e.target.checked,
                }))
              }
            />
            <span>
              {t('config_management.field.amp_restrict_mgmt_to_localhost.label', {
                defaultValue: 'Restrict management to localhost',
              })}
            </span>
          </label>
          <div className="hint">
            {t('config_management.field.amp_restrict_mgmt_to_localhost.help', {
              defaultValue: '',
            })}
          </div>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label className={styles.checkboxRow}>
            <input
              type="checkbox"
              checked={values.ampForceModelMappings}
              disabled={disabled}
              onChange={(e) =>
                setValues((prev) => ({
                  ...prev,
                  ampForceModelMappings: e.target.checked,
                }))
              }
            />
            <span>
              {t('config_management.field.amp_force_model_mappings.label', {
                defaultValue: 'Force model mappings',
              })}
            </span>
          </label>
          <div className="hint">
            {t('config_management.field.amp_force_model_mappings.help', {
              defaultValue: '',
            })}
          </div>
        </div>
      </div>

      <div className={styles.mappingSection}>
        <label>
          {t('config_management.field.amp_model_mappings.label', {
            defaultValue: 'Model mappings',
          })}
        </label>
        <div className={styles.mappingList}>
          {(values.ampModelMappings || []).map((entry, index) => (
            <div key={entry.id} className={styles.mappingRow}>
              <input
                className="input"
                placeholder={t('config_management.field.amp_model_mappings_from.placeholder', {
                  defaultValue: 'from',
                })}
                value={entry.from}
                disabled={disabled}
                onChange={(e) => {
                  const value = e.target.value;
                  setValues((prev) => ({
                    ...prev,
                    ampModelMappings: (prev.ampModelMappings || []).map((m, i) =>
                      i === index ? { ...m, from: value } : m
                    ),
                  }));
                }}
              />
              <span className={styles.mappingArrow}>→</span>
              <input
                className="input"
                placeholder={t('config_management.field.amp_model_mappings_to.placeholder', {
                  defaultValue: 'to',
                })}
                value={entry.to}
                disabled={disabled}
                onChange={(e) => {
                  const value = e.target.value;
                  setValues((prev) => ({
                    ...prev,
                    ampModelMappings: (prev.ampModelMappings || []).map((m, i) =>
                      i === index ? { ...m, to: value } : m
                    ),
                  }));
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setValues((prev) => ({
                    ...prev,
                    ampModelMappings: (prev.ampModelMappings || []).filter((_, i) => i !== index),
                  }));
                }}
                disabled={disabled}
              >
                {t('config_management.action.remove', { defaultValue: 'Remove' })}
              </Button>
            </div>
          ))}
        </div>
        <div className={styles.mappingActions}>
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              setValues((prev) => ({
                ...prev,
                ampModelMappings: [...(prev.ampModelMappings || []), { id: makeClientId(), from: '', to: '' }],
              }))
            }
            disabled={disabled}
          >
            {t('config_management.action.add_mapping', { defaultValue: 'Add mapping' })}
          </Button>
        </div>
        <div className="hint">
          {t('config_management.field.amp_model_mappings.help', { defaultValue: '' })}
        </div>
      </div>
    </div>
  );
}
