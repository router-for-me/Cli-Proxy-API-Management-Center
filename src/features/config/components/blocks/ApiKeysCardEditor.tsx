import { memo, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { useAuthStore, useNotificationStore } from '@/stores';
import { apiKeyNameFingerprint, readApiKeyNames, saveApiKeyName } from '../../apiKeyNames';
import { copyToClipboard } from '@/utils/clipboard';
import { makeClientId } from '@/types/visualConfig';
import { generateSecureApiKey } from '@/utils/apiKey';
import { maskApiKey } from '@/utils/format';
import { isValidApiKeyCharset } from '@/utils/validation';
import { ApiKeyStrengthMeter } from './ApiKeyStrengthMeter';
import { ApiKeyAccountPicker } from './ApiKeyAccountPicker';
import { usePolicyAccounts } from './usePolicyAccounts';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import type { ApiKeyLimits, ApiKeyPolicy } from '@/types/visualConfig';
import { ApiKeyPolicyFields, ExpiryBadgeText } from './ApiKeyPolicyFields';
import { useApiKeyPolicyUsage } from './useApiKeyPolicyUsage';
import {
  EMPTY_LIMITS,
  daysUntilExpiry,
  expiresAtToDateInput,
  hasLimits,
  isApiKeyPolicyEmpty,
  parseModelPatterns,
} from '../../apiKeyPolicies';
import styles from './Blocks.module.scss';

export interface ApiKeysCardEditorChange {
  apiKeysText?: string;
  apiKeyPolicies?: ApiKeyPolicy[];
}

interface ApiKeysCardEditorProps {
  value: string;
  policies: ApiKeyPolicy[];
  disabled?: boolean;
  onChange: (patch: ApiKeysCardEditorChange) => void;
}

export const ApiKeysCardEditor = memo(function ApiKeysCardEditor(props: ApiKeysCardEditorProps) {
  const apiBase = useAuthStore((state) => state.apiBase);
  return <ScopedApiKeysCardEditor key={apiBase} {...props} apiBase={apiBase} />;
});

function ScopedApiKeysCardEditor({
  value,
  policies,
  disabled,
  onChange,
  apiBase,
}: ApiKeysCardEditorProps & { apiBase: string }) {
  // Names saved by older panels live in browser storage; they remain a display fallback
  // and move into the server-side policy the next time the key is saved here.
  const [names, setNames] = useState(() => readApiKeyNames(apiBase));
  const [nameValue, setNameValue] = useState('');
  const [disabledValue, setDisabledValue] = useState(false);
  const [allowedAuthsValue, setAllowedAuthsValue] = useState<string[]>([]);
  const [expiresAtDate, setExpiresAtDate] = useState('');
  const [originalExpiresAt, setOriginalExpiresAt] = useState('');
  const [modelsText, setModelsText] = useState('');
  const [limitsValue, setLimitsValue] = useState<ApiKeyLimits>({ ...EMPTY_LIMITS });
  const policyByKey = useMemo(
    () => new Map(policies.map((policy) => [policy.key, policy])),
    [policies]
  );
  const { t } = useTranslation();
  const showNotification = useNotificationStore((state) => state.showNotification);
  const apiKeys = useMemo(
    () =>
      value
        .split('\n')
        .map((key) => key.trim())
        .filter(Boolean),
    [value]
  );
  const nameFingerprints = useMemo(
    () => apiKeys.map((key) => apiKeyNameFingerprint(apiBase, key)),
    [apiBase, apiKeys]
  );
  const [apiKeyIds, setApiKeyIds] = useState(() => apiKeys.map(() => makeClientId()));
  const renderApiKeyIds = useMemo(() => {
    if (apiKeyIds.length === apiKeys.length) return apiKeyIds;
    if (apiKeyIds.length > apiKeys.length) return apiKeyIds.slice(0, apiKeys.length);
    return [
      ...apiKeyIds,
      ...Array.from({ length: apiKeys.length - apiKeyIds.length }, () => makeClientId()),
    ];
  }, [apiKeyIds, apiKeys.length]);

  const apiKeyInputId = useId();
  const apiKeyHintId = `${apiKeyInputId}-hint`;
  const apiKeyErrorId = `${apiKeyInputId}-error`;
  const [modalOpen, setModalOpen] = useState(false);
  const [editingApiKeyId, setEditingApiKeyId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState('');
  const [formError, setFormError] = useState('');
  const policyAccounts = usePolicyAccounts(modalOpen);
  const policyUsage = useApiKeyPolicyUsage(modalOpen);

  const openAddModal = () => {
    setNameValue('');
    setDisabledValue(false);
    setAllowedAuthsValue([]);
    setExpiresAtDate('');
    setOriginalExpiresAt('');
    setModelsText('');
    setLimitsValue({ ...EMPTY_LIMITS });
    setEditingApiKeyId(null);
    setInputValue('');
    setFormError('');
    setModalOpen(true);
  };

  const openEditModal = (apiKeyId: string) => {
    const editingIndex = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    const latestNames = readApiKeyNames(apiBase);
    setNames(latestNames);
    const policy = policyByKey.get(apiKeys[editingIndex] ?? '');
    setNameValue(policy?.name || latestNames[nameFingerprints[editingIndex]] || '');
    setDisabledValue(policy?.disabled ?? false);
    setAllowedAuthsValue(policy?.allowedAuths ?? []);
    setExpiresAtDate(expiresAtToDateInput(policy?.expiresAt ?? ''));
    setOriginalExpiresAt(policy?.expiresAt ?? '');
    setModelsText((policy?.allowedModels ?? []).join('\n'));
    setLimitsValue({ ...EMPTY_LIMITS, ...(policy?.limits ?? {}) });
    setEditingApiKeyId(apiKeyId);
    setInputValue(apiKeys[editingIndex] ?? '');
    setFormError('');
    setModalOpen(true);
  };

  const closeModal = () => {
    setModalOpen(false);
    setInputValue('');
    setEditingApiKeyId(null);
    setFormError('');
  };

  const handleDelete = (apiKeyId: string) => {
    const index = renderApiKeyIds.findIndex((id) => id === apiKeyId);
    if (index < 0) return;
    const removed = apiKeys[index];
    setApiKeyIds(renderApiKeyIds.filter((id) => id !== apiKeyId));
    onChange({
      apiKeysText: apiKeys.filter((_, i) => i !== index).join('\n'),
      apiKeyPolicies: policies.filter((policy) => policy.key !== removed),
    });
  };

  const handleSave = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setFormError(t('config_management.visual.api_keys.error_empty'));
      return;
    }
    if (!isValidApiKeyCharset(trimmed)) {
      setFormError(t('config_management.visual.api_keys.error_invalid'));
      return;
    }

    const editingIndex = editingApiKeyId
      ? renderApiKeyIds.findIndex((id) => id === editingApiKeyId)
      : -1;
    const nextKeys =
      editingApiKeyId === null
        ? [...apiKeys, trimmed]
        : apiKeys.map((key, idx) => (idx === editingIndex ? trimmed : key));
    if (editingApiKeyId === null && apiKeys.includes(trimmed)) {
      setFormError(t('config_management.visual.api_keys.policy.error_duplicate'));
      return;
    }
    // Keep the browser copy in sync so older panels still show the label.
    saveApiKeyName(apiBase, trimmed, nameValue);
    setNames(readApiKeyNames(apiBase));
    // Retain old fingerprints: configuration edits can still be discarded or fail to save.
    if (editingApiKeyId === null) {
      setApiKeyIds([...renderApiKeyIds, makeClientId()]);
    }
    const previousKey = editingIndex >= 0 ? apiKeys[editingIndex] : undefined;
    // Keep a precise server timestamp unless the date itself was changed here.
    const expiresAt =
      expiresAtDate && expiresAtDate === expiresAtToDateInput(originalExpiresAt)
        ? originalExpiresAt
        : expiresAtDate;
    const nextPolicy: ApiKeyPolicy = {
      key: trimmed,
      name: nameValue.trim(),
      disabled: disabledValue,
      allowedAuths: allowedAuthsValue,
      allowedModels: parseModelPatterns(modelsText),
      expiresAt,
      limits: limitsValue,
    };
    const nextPolicies = [
      ...policies.filter((policy) => policy.key !== trimmed && policy.key !== previousKey),
      nextPolicy,
    ].filter((policy) => !isApiKeyPolicyEmpty(policy));
    const patch: ApiKeysCardEditorChange = {};
    if (nextKeys.join('\n') !== apiKeys.join('\n')) patch.apiKeysText = nextKeys.join('\n');
    if (JSON.stringify(nextPolicies) !== JSON.stringify(policies))
      patch.apiKeyPolicies = nextPolicies;
    if (patch.apiKeysText !== undefined || patch.apiKeyPolicies !== undefined) onChange(patch);
    closeModal();
  };

  const handleCopy = async (apiKey: string) => {
    const copied = await copyToClipboard(apiKey);
    showNotification(
      t(copied ? 'notification.link_copied' : 'notification.copy_failed'),
      copied ? 'success' : 'error'
    );
  };

  const handleGenerate = () => {
    setInputValue(generateSecureApiKey());
    setFormError('');
  };

  return (
    <div className={styles.apiKeys}>
      <div className={styles.apiKeysHeader}>
        <span className={styles.apiKeysTitle}>{t('config_management.visual.api_keys.label')}</span>
        <Button size="sm" onClick={openAddModal} disabled={disabled}>
          {t('config_management.visual.api_keys.add')}
        </Button>
      </div>

      {apiKeys.length === 0 ? (
        <div className={styles.emptyState}>{t('config_management.visual.api_keys.empty')}</div>
      ) : (
        <ol className={styles.apiKeyList}>
          {apiKeys.map((key, index) => {
            const policy = policyByKey.get(key);
            const expiryDays = policy ? daysUntilExpiry(policy.expiresAt) : null;
            return (
              <li key={renderApiKeyIds[index] ?? `${key}-${index}`} className={styles.apiKeyRow}>
                <span className={styles.apiKeyIndex}>#{index + 1}</span>
                <span className={styles.apiKeyMeta}>
                  <span className={styles.apiKeyName}>
                    {policy?.name ||
                      names[nameFingerprints[index]] ||
                      t('config_management.visual.api_keys.input_label')}
                  </span>
                  <span className={styles.apiKeyValue}>{maskApiKey(String(key || ''))}</span>
                  <span className={styles.policyBadge}>
                    {(policy?.allowedAuths.length ?? 0) > 0
                      ? t('config_management.visual.api_keys.policy.accounts_count', {
                          count: policy?.allowedAuths.length ?? 0,
                        })
                      : t('config_management.visual.api_keys.policy.all_accounts')}
                  </span>
                  {(policy?.allowedModels.length ?? 0) > 0 && (
                    <span className={styles.policyBadge}>
                      {t('config_management.visual.api_keys.policy.models_count', {
                        count: policy?.allowedModels.length ?? 0,
                      })}
                    </span>
                  )}
                  {policy && hasLimits(policy.limits) && (
                    <span className={styles.policyBadge}>
                      {t('config_management.visual.api_keys.policy.limited_badge')}
                    </span>
                  )}
                  {policy?.expiresAt && (
                    <span
                      className={`${styles.policyBadge} ${
                        expiryDays !== null && expiryDays < 0
                          ? styles.policyState_disabled
                          : expiryDays !== null && expiryDays <= 7
                            ? styles.policyState_cooldown
                            : ''
                      }`}
                    >
                      <ExpiryBadgeText expiresAt={policy.expiresAt} />
                    </span>
                  )}
                  {policy?.disabled && (
                    <span className={`${styles.policyBadge} ${styles.policyState_disabled}`}>
                      {t('config_management.visual.api_keys.policy.disabled_badge')}
                    </span>
                  )}
                </span>
                <span className={styles.apiKeyActions}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleCopy(key)}
                    disabled={disabled}
                  >
                    {t('common.copy')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openEditModal(renderApiKeyIds[index] ?? '')}
                    disabled={disabled}
                  >
                    {t('config_management.visual.common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={styles.apiKeyDelete}
                    onClick={() => handleDelete(renderApiKeyIds[index] ?? '')}
                    disabled={disabled}
                  >
                    {t('config_management.visual.common.delete')}
                  </Button>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <Modal
        open={modalOpen}
        onClose={closeModal}
        title={
          editingApiKeyId !== null
            ? t('config_management.visual.api_keys.edit_title')
            : t('config_management.visual.api_keys.add_title')
        }
        footer={
          <>
            <Button variant="secondary" onClick={closeModal} disabled={disabled}>
              {t('config_management.visual.common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={disabled}>
              {editingApiKeyId !== null
                ? t('config_management.visual.common.update')
                : t('config_management.visual.common.add')}
            </Button>
          </>
        }
      >
        {/* 两条说明都收进标签后的 InfoTip，并以视觉隐藏副本留给 aria-describedby。 */}
        <Input
          label={t('config_management.visual.api_keys.name_label')}
          hint={t('config_management.visual.api_keys.name_hint')}
          value={nameValue}
          onChange={(event) => setNameValue(event.target.value)}
          placeholder={t('config_management.visual.api_keys.name_placeholder')}
          disabled={disabled}
        />
        <div className="form-group">
          <FieldLabel
            htmlFor={apiKeyInputId}
            label={t('config_management.visual.api_keys.input_label')}
            hint={t('config_management.visual.api_keys.input_hint')}
            hintId={apiKeyHintId}
          />
          <div className={styles.apiKeyModalInputRow}>
            <input
              id={apiKeyInputId}
              className="input"
              placeholder={t('config_management.visual.api_keys.input_placeholder')}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              disabled={disabled}
              aria-describedby={formError ? `${apiKeyErrorId} ${apiKeyHintId}` : apiKeyHintId}
              aria-invalid={Boolean(formError)}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={handleGenerate}
              disabled={disabled}
            >
              {t('config_management.visual.api_keys.generate')}
            </Button>
          </div>
          <ApiKeyStrengthMeter value={inputValue} />
          {formError && (
            <div id={apiKeyErrorId} className="error-box">
              {formError}
            </div>
          )}
        </div>
        <div className="form-group">
          <ToggleSwitch
            checked={!disabledValue}
            onChange={(enabled) => setDisabledValue(!enabled)}
            disabled={disabled}
            label={t('config_management.visual.api_keys.policy.enabled_label')}
          />
          <div className="hint">{t('config_management.visual.api_keys.policy.enabled_hint')}</div>
        </div>
        <ApiKeyPolicyFields
          expiresAtDate={expiresAtDate}
          modelsText={modelsText}
          limits={limitsValue}
          usage={
            editingApiKeyId !== null
              ? policyUsage.get(
                  apiKeys[renderApiKeyIds.findIndex((id) => id === editingApiKeyId)] ?? ''
                )
              : undefined
          }
          disabled={disabled}
          onExpiresAtDateChange={setExpiresAtDate}
          onModelsTextChange={setModelsText}
          onLimitsChange={setLimitsValue}
        />
        <div className="form-group">
          <label>{t('config_management.visual.api_keys.policy.accounts_label')}</label>
          <ApiKeyAccountPicker
            accounts={policyAccounts.accounts}
            loading={policyAccounts.loading}
            error={policyAccounts.error}
            selected={allowedAuthsValue}
            disabled={disabled}
            onChange={setAllowedAuthsValue}
          />
        </div>
      </Modal>
    </div>
  );
}
