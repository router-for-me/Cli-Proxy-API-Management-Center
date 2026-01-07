import { Button } from '@/components/ui/Button';
import styles from '../../../ConfigPage.module.scss';
import { makeClientId } from '../types';
import type { PayloadParamValueType, PayloadRule } from '../types';
import type { VisualSectionProps } from './sectionTypes';

const VALUE_TYPE_OPTIONS: { value: PayloadParamValueType; label: string }[] = [
  { value: 'string', label: 'String' },
  { value: 'number', label: 'Number' },
  { value: 'boolean', label: 'Boolean' },
  { value: 'json', label: 'JSON' },
];

const PROTOCOL_OPTIONS = [
  { value: '', label: '(any)' },
  { value: 'openai', label: 'OpenAI' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
];

function createEmptyRule(): PayloadRule {
  return {
    id: makeClientId(),
    models: [{ id: makeClientId(), name: '', protocol: undefined }],
    params: [{ id: makeClientId(), path: '', valueType: 'string', value: '' }],
  };
}

type RuleListProps = {
  title: string;
  rules: PayloadRule[];
  disabled: boolean;
  t: VisualSectionProps['t'];
  onUpdate: (rules: PayloadRule[]) => void;
};

function RuleList({ title, rules, disabled, t, onUpdate }: RuleListProps) {
  const addRule = () => {
    onUpdate([...rules, createEmptyRule()]);
  };

  const removeRule = (index: number) => {
    onUpdate(rules.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, updated: PayloadRule) => {
    onUpdate(rules.map((r, i) => (i === index ? updated : r)));
  };

  return (
    <div className={styles.payloadRuleList}>
      <div className={styles.payloadRuleListHeader}>
        <span className={styles.payloadRuleListTitle}>{title}</span>
        <Button variant="secondary" size="sm" onClick={addRule} disabled={disabled}>
          {t('config_management.action.add_rule', { defaultValue: 'Add rule' })}
        </Button>
      </div>

      {rules.length === 0 && (
        <div className={styles.payloadEmptyHint}>
          {t('config_management.payload.no_rules', { defaultValue: 'No rules configured' })}
        </div>
      )}

      {rules.map((rule, ruleIndex) => (
        <div key={rule.id} className={styles.payloadRuleCard}>
          <div className={styles.payloadRuleCardHeader}>
            <span>
              {t('config_management.payload.rule_label', { defaultValue: 'Rule' })} #{ruleIndex + 1}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeRule(ruleIndex)}
              disabled={disabled}
            >
              {t('config_management.action.remove', { defaultValue: 'Remove' })}
            </Button>
          </div>

          {/* Models */}
          <div className={styles.payloadSubSection}>
            <div className={styles.payloadSubSectionHeader}>
              <span>{t('config_management.payload.models_label', { defaultValue: 'Models' })}</span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const updated = {
                    ...rule,
                    models: [...rule.models, { id: makeClientId(), name: '', protocol: undefined }],
                  };
                  updateRule(ruleIndex, updated);
                }}
                disabled={disabled}
              >
                {t('config_management.action.add_model', { defaultValue: 'Add model' })}
              </Button>
            </div>
            {rule.models.map((model, modelIndex) => (
              <div key={model.id} className={styles.payloadModelRow}>
                <input
                  className="input"
                  placeholder={t('config_management.payload.model_name_placeholder', {
                    defaultValue: 'model name (supports wildcards)',
                  })}
                  value={model.name}
                  disabled={disabled}
                  onChange={(e) => {
                    const updated = {
                      ...rule,
                      models: rule.models.map((m, i) =>
                        i === modelIndex ? { ...m, name: e.target.value } : m
                      ),
                    };
                    updateRule(ruleIndex, updated);
                  }}
                />
                <select
                  className="input"
                  value={model.protocol || ''}
                  disabled={disabled}
                  onChange={(e) => {
                    const val = e.target.value as '' | 'openai' | 'gemini' | 'claude' | 'codex';
                    const updated = {
                      ...rule,
                      models: rule.models.map((m, i) =>
                        i === modelIndex ? { ...m, protocol: val || undefined } : m
                      ),
                    };
                    updateRule(ruleIndex, updated);
                  }}
                >
                  {PROTOCOL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const updated = {
                      ...rule,
                      models: rule.models.filter((_, i) => i !== modelIndex),
                    };
                    updateRule(ruleIndex, updated);
                  }}
                  disabled={disabled || rule.models.length <= 1}
                >
                  {t('config_management.action.remove', { defaultValue: 'Remove' })}
                </Button>
              </div>
            ))}
          </div>

          {/* Params */}
          <div className={styles.payloadSubSection}>
            <div className={styles.payloadSubSectionHeader}>
              <span>
                {t('config_management.payload.params_label', { defaultValue: 'Parameters' })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  const updated = {
                    ...rule,
                    params: [
                      ...rule.params,
                      {
                        id: makeClientId(),
                        path: '',
                        valueType: 'string' as PayloadParamValueType,
                        value: '',
                      },
                    ],
                  };
                  updateRule(ruleIndex, updated);
                }}
                disabled={disabled}
              >
                {t('config_management.action.add_param', { defaultValue: 'Add param' })}
              </Button>
            </div>
            {rule.params.map((param, paramIndex) => (
              <div key={param.id} className={styles.payloadParamRow}>
                <input
                  className="input"
                  placeholder={t('config_management.payload.param_path_placeholder', {
                    defaultValue: 'JSON path (e.g. generationConfig.maxTokens)',
                  })}
                  value={param.path}
                  disabled={disabled}
                  onChange={(e) => {
                    const updated = {
                      ...rule,
                      params: rule.params.map((p, i) =>
                        i === paramIndex ? { ...p, path: e.target.value } : p
                      ),
                    };
                    updateRule(ruleIndex, updated);
                  }}
                />
                <select
                  className="input"
                  value={param.valueType}
                  disabled={disabled}
                  onChange={(e) => {
                    const updated = {
                      ...rule,
                      params: rule.params.map((p, i) =>
                        i === paramIndex
                          ? { ...p, valueType: e.target.value as PayloadParamValueType }
                          : p
                      ),
                    };
                    updateRule(ruleIndex, updated);
                  }}
                >
                  {VALUE_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                {param.valueType === 'boolean' ? (
                  <select
                    className="input"
                    value={param.value}
                    disabled={disabled}
                    onChange={(e) => {
                      const updated = {
                        ...rule,
                        params: rule.params.map((p, i) =>
                          i === paramIndex ? { ...p, value: e.target.value } : p
                        ),
                      };
                      updateRule(ruleIndex, updated);
                    }}
                  >
                    <option value="true">true</option>
                    <option value="false">false</option>
                  </select>
                ) : (
                  <input
                    className="input"
                    placeholder={
                      param.valueType === 'json'
                        ? t('config_management.payload.param_value_json_placeholder', {
                            defaultValue: 'JSON value',
                          })
                        : t('config_management.payload.param_value_placeholder', {
                            defaultValue: 'value',
                          })
                    }
                    value={param.value}
                    disabled={disabled}
                    onChange={(e) => {
                      const updated = {
                        ...rule,
                        params: rule.params.map((p, i) =>
                          i === paramIndex ? { ...p, value: e.target.value } : p
                        ),
                      };
                      updateRule(ruleIndex, updated);
                    }}
                  />
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    const updated = {
                      ...rule,
                      params: rule.params.filter((_, i) => i !== paramIndex),
                    };
                    updateRule(ruleIndex, updated);
                  }}
                  disabled={disabled || rule.params.length <= 1}
                >
                  {t('config_management.action.remove', { defaultValue: 'Remove' })}
                </Button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PayloadSection({ t, values, setValues, disabled }: VisualSectionProps) {
  return (
    <div className={styles.visualSectionWide}>
      <div className={styles.sectionTitle}>
        {t('config_management.visual_group.payload', { defaultValue: 'Payload Configuration' })}
      </div>
      <div className="hint" style={{ marginBottom: 16 }}>
        {t('config_management.payload.description', {
          defaultValue:
            'Configure default and override payload parameters for specific models. Default rules only set parameters when missing; override rules always apply.',
        })}
      </div>

      <RuleList
        title={t('config_management.payload.default_rules_title', {
          defaultValue: 'Default Rules',
        })}
        rules={values.payloadDefaultRules || []}
        disabled={disabled}
        t={t}
        onUpdate={(rules) => setValues((prev) => ({ ...prev, payloadDefaultRules: rules }))}
      />

      <RuleList
        title={t('config_management.payload.override_rules_title', {
          defaultValue: 'Override Rules',
        })}
        rules={values.payloadOverrideRules || []}
        disabled={disabled}
        t={t}
        onUpdate={(rules) => setValues((prev) => ({ ...prev, payloadOverrideRules: rules }))}
      />
    </div>
  );
}
