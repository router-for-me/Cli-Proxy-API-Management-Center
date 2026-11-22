import { useId, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { FieldLabel } from '@/components/ui/FieldLabel';
import { IconFileText, IconLoader2, IconUpload } from '@/components/ui/icons';
import type { KiroImportState } from '../hooks/useKiroImport';
import { DialogTitle, type DialogHeading } from './OAuthFlowDialog';
import dialogStyles from './OAuthFlowDialog.module.scss';
import styles from './KiroImportDialog.module.scss';

export interface KiroImportDialogProps {
  open: boolean;
  heading: DialogHeading;
  kiro: KiroImportState;
  onPickFile: (file: File | undefined) => void;
  onRawJsonChange: (value: string) => void;
  onModeChange: (mode: 'file' | 'text') => void;
  onImport: () => void;
  onImportAnother: () => void;
  onViewAuthFiles: () => void;
  onClose: () => void;
}

export function KiroImportDialog({
  open,
  heading,
  kiro,
  onPickFile,
  onRawJsonChange,
  onModeChange,
  onImport,
  onImportAnother,
  onViewAuthFiles,
  onClose,
}: KiroImportDialogProps) {
  const { t } = useTranslation();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileHintId = useId();
  const [dragging, setDragging] = useState(false);
  const result = kiro.result;

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    setDragging(false);
    onPickFile(event.dataTransfer.files?.[0]);
  };

  const resultRows = result
    ? [
        { key: 'result_id', value: result.id },
        { key: 'result_label', value: result.label },
        { key: 'result_email', value: result.email },
        { key: 'result_file', value: result.authFile },
      ].filter((row): row is { key: string; value: string } => Boolean(row.value))
    : [];

  const canSubmit = kiro.mode === 'file' ? Boolean(kiro.file) : Boolean(kiro.rawJson.trim());

  return (
    <Modal
      open={open}
      onClose={onClose}
      width={500}
      className={dialogStyles.dialog}
      title={<DialogTitle {...heading} />}
    >
      <div className={dialogStyles.view} key={result ? 'result' : 'form'}>
        {result ? (
          <div className={dialogStyles.result} role="status">
            <svg className={dialogStyles.successMark} viewBox="0 0 52 52" aria-hidden="true">
              <circle className={dialogStyles.successRing} cx="26" cy="26" r="24" />
              <path className={dialogStyles.successCheck} d="M16 27l7 7 14-15" />
            </svg>
            <div className={dialogStyles.resultTitle}>{t('kiro_import.result_title')}</div>
            {resultRows.length > 0 && (
              <dl className={styles.facts}>
                {resultRows.map((row) => (
                  <div className={styles.fact} key={row.key}>
                    <dt>{t(`kiro_import.${row.key}`)}</dt>
                    <dd>{row.value}</dd>
                  </div>
                ))}
              </dl>
            )}
            <div className={dialogStyles.resultActions}>
              <button type="button" className={dialogStyles.secondary} onClick={onViewAuthFiles}>
                {t('auth_login.view_auth_files')}
              </button>
              <button type="button" className={dialogStyles.primary} onClick={onImportAnother}>
                {t('kiro_import.import_another')}
              </button>
            </div>
          </div>
        ) : (
          <div className={dialogStyles.stack}>
            <div className={styles.tabs} role="tablist">
              <button
                type="button"
                role="tab"
                className={styles.tab}
                data-active={kiro.mode === 'file'}
                onClick={() => onModeChange('file')}
              >
                {t('kiro_import.tab_file')}
              </button>
              <button
                type="button"
                role="tab"
                className={styles.tab}
                data-active={kiro.mode === 'text'}
                onClick={() => onModeChange('text')}
              >
                {t('kiro_import.tab_text')}
              </button>
            </div>

            {kiro.mode === 'file' ? (
              <div className={styles.field}>
                <FieldLabel
                  label={t('kiro_import.file_label')}
                  hint={t('kiro_import.file_hint')}
                  hintId={fileHintId}
                  className={styles.labelRow}
                  labelClassName={styles.label}
                />
                <button
                  type="button"
                  className={styles.dropZone}
                  data-dragging={dragging}
                  data-filled={Boolean(kiro.file)}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={handleDrop}
                  aria-describedby={fileHintId}
                >
                  <span className={styles.dropGlyph} aria-hidden="true">
                    {kiro.file ? <IconFileText size={18} /> : <IconUpload size={18} />}
                  </span>
                  <span className={styles.dropText}>
                    <span className={kiro.file ? styles.fileName : styles.dropTitle}>
                      {kiro.file ? kiro.file.name : t('kiro_import.drop_hint')}
                    </span>
                    {kiro.file && (
                      <span className={styles.dropHint}>{t('kiro_import.choose_file')}</span>
                    )}
                  </span>
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={(event) => {
                    onPickFile(event.target.files?.[0]);
                    event.target.value = '';
                  }}
                />
              </div>
            ) : (
              <div className={styles.field}>
                <FieldLabel
                  label={t('kiro_import.text_label')}
                  hint={t('kiro_import.file_hint')}
                  className={styles.labelRow}
                  labelClassName={styles.label}
                />
                <textarea
                  className={styles.textarea}
                  value={kiro.rawJson}
                  onChange={(e) => onRawJsonChange(e.target.value)}
                  placeholder={t('kiro_import.text_placeholder')}
                  rows={5}
                  spellCheck={false}
                />
              </div>
            )}

            {kiro.error && (
              <div className={dialogStyles.alert} role="alert">
                {kiro.error}
              </div>
            )}

            <div>
              <button
                type="button"
                className={dialogStyles.primary}
                onClick={onImport}
                disabled={!canSubmit || kiro.loading}
              >
                {kiro.loading && (
                  <IconLoader2 size={14} className={dialogStyles.spinning} aria-hidden="true" />
                )}
                {t('kiro_import.import_button')}
              </button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
