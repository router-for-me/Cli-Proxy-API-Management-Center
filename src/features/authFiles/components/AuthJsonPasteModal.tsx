import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import type { AuthJsonInputType } from '@/features/authFiles/sessionAuthConverter';
import styles from './AuthJsonPasteModal.module.scss';

type AuthJsonPasteModalProps = {
  open: boolean;
  saving: boolean;
  disabled?: boolean;
  onClose: () => void;
  onSave: (type: AuthJsonInputType, fileName: string, jsonText: string) => Promise<void>;
};

const DEFAULT_FILE_NAME = 'codex-account.json';
const INVALID_BASE_FILE_NAME_PATTERN = /[\\/:*?"<>|]/;
const FORBIDDEN_INVISIBLE_CODE_POINTS = new Set([
  0x200b,
  0x200c,
  0x200d,
  0x200e,
  0x200f,
  0x202a,
  0x202b,
  0x202c,
  0x202d,
  0x202e,
  0x2060,
  0x2066,
  0x2067,
  0x2068,
  0x2069,
  0xfeff,
]);
const WINDOWS_RESERVED_BASE_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

const isValidBaseJsonFileName = (value: string) => {
  const lowerValue = value.toLowerCase();
  const baseName = value.slice(0, -'.json'.length);
  const windowsDeviceName = baseName.split('.')[0]?.toLowerCase() ?? '';

  return (
    lowerValue.endsWith('.json') &&
    baseName !== '' &&
    baseName.trim() === baseName &&
    !baseName.startsWith('.') &&
    !baseName.endsWith('.') &&
    !WINDOWS_RESERVED_BASE_NAMES.has(windowsDeviceName) &&
    !INVALID_BASE_FILE_NAME_PATTERN.test(value) &&
    !Array.from(value).some((char) => {
      const codePoint = char.codePointAt(0);
      return (
        codePoint === undefined ||
        codePoint < 32 ||
        FORBIDDEN_INVISIBLE_CODE_POINTS.has(codePoint)
      );
    })
  );
};

export function AuthJsonPasteModal({
  open,
  saving,
  disabled = false,
  onClose,
  onSave,
}: AuthJsonPasteModalProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<AuthJsonInputType>('session');
  const [fileName, setFileName] = useState(DEFAULT_FILE_NAME);
  const [jsonText, setJsonText] = useState('');
  const [error, setError] = useState('');

  const resetForm = () => {
    setType('session');
    setFileName(DEFAULT_FILE_NAME);
    setJsonText('');
    setError('');
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  const options = useMemo(
    () => [
      { value: 'cpa', label: t('auth_files.paste_type_cpa') },
      { value: 'session', label: t('auth_files.paste_type_session') },
    ],
    [t]
  );

  const handleSave = async () => {
    if (saving || disabled) return;

    const trimmedName = fileName.trim();
    if (!trimmedName) {
      setError(t('auth_files.paste_error_file_name'));
      return;
    }
    if (!isValidBaseJsonFileName(trimmedName)) {
      setError(t('auth_files.paste_error_file_name_invalid'));
      return;
    }
    if (!jsonText.trim()) {
      setError(t('auth_files.paste_error_json_required'));
      return;
    }

    setError('');
    try {
      await onSave(type, trimmedName, jsonText);
      resetForm();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('notification.save_failed'));
    }
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={t('auth_files.paste_title')}
      width={640}
      closeDisabled={saving}
      footer={
        <>
          <Button variant="secondary" onClick={handleClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button onClick={handleSave} loading={saving} disabled={disabled}>
            {t('auth_files.paste_save_button')}
          </Button>
        </>
      }
    >
      <div className={styles.authJsonPasteModal}>
        {error && <div className={styles.prefixProxyError}>{error}</div>}
        <div className={styles.formGroup}>
          <label>{t('auth_files.paste_type_label')}</label>
          <Select
            value={type}
            options={options}
            onChange={(value) => setType(value as AuthJsonInputType)}
            ariaLabel={t('auth_files.paste_type_label')}
            disabled={saving || disabled}
          />
        </div>
        <Input
          label={t('auth_files.paste_file_name_label')}
          value={fileName}
          onChange={(event) => setFileName(event.target.value)}
          disabled={saving || disabled}
          placeholder={DEFAULT_FILE_NAME}
        />
        <div className={styles.formGroup}>
          <label htmlFor="auth-json-paste-content">{t('auth_files.paste_json_label')}</label>
          <textarea
            id="auth-json-paste-content"
            className={styles.authJsonPasteTextarea}
            value={jsonText}
            onChange={(event) => setJsonText(event.target.value)}
            disabled={saving || disabled}
            spellCheck={false}
            placeholder={t(
              type === 'session'
                ? 'auth_files.paste_session_placeholder'
                : 'auth_files.paste_cpa_placeholder'
            )}
          />
        </div>
        <p className={styles.authJsonPasteHint}>
          {t(type === 'session' ? 'auth_files.paste_session_hint' : 'auth_files.paste_cpa_hint')}
        </p>
      </div>
    </Modal>
  );
}
