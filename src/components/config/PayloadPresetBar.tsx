/**
 * PayloadPresetBar – toolbar for saving / switching / deleting payload presets.
 */

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import type { SelectOption } from '@/components/ui/Select';
import type { VisualConfigValues } from '@/types/visualConfig';
import { usePayloadPresets } from '@/hooks/usePayloadPresets';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import styles from './VisualConfigEditor.module.scss';

interface PayloadPresetBarProps {
  disabled?: boolean;
  values: VisualConfigValues;
  onChange: (partial: Partial<VisualConfigValues>) => void;
}

export function PayloadPresetBar({ disabled, values, onChange }: PayloadPresetBarProps) {
  const { t } = useTranslation();
  const { presets, savePreset, applyPreset, deletePreset, presetExists } = usePayloadPresets();
  const isMobile = useMediaQuery('(max-width: 768px)');

  const [selectedId, setSelectedId] = useState<string>('');
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [overwriteModalOpen, setOverwriteModalOpen] = useState(false);

  const selectOptions: SelectOption[] = useMemo(
    () => presets.map((p) => ({ value: p.id, label: p.name })),
    [presets],
  );

  const handleSave = useCallback(() => {
    const trimmed = presetName.trim();
    if (!trimmed) return;

    if (presetExists(trimmed)) {
      setOverwriteModalOpen(true);
      return;
    }

    savePreset(trimmed, values);
    setPresetName('');
    setSaveModalOpen(false);
  }, [presetName, presetExists, savePreset, values]);

  const handleOverwriteConfirm = useCallback(() => {
    const trimmed = presetName.trim();
    if (!trimmed) return;
    savePreset(trimmed, values);
    setOverwriteModalOpen(false);
    setPresetName('');
    setSaveModalOpen(false);
  }, [presetName, savePreset, values]);

  const handleApply = useCallback(() => {
    if (!selectedId) return;
    const rules = applyPreset(selectedId);
    if (!rules) return;
    onChange(rules);
  }, [selectedId, applyPreset, onChange]);

  const handleDelete = useCallback(() => {
    if (!confirmDeleteId) return;
    deletePreset(confirmDeleteId);
    if (selectedId === confirmDeleteId) {
      setSelectedId('');
    }
    setConfirmDeleteId(null);
  }, [confirmDeleteId, deletePreset, selectedId]);

  const selectedPreset = useMemo(
    () => presets.find((p) => p.id === selectedId),
    [presets, selectedId],
  );

  if (presets.length === 0 && !saveModalOpen) {
    return (
      <div className={styles.payloadPresetBar}>
        <span className={styles.payloadPresetBarLabel}>
          {t('config_management.visual.sections.payload.preset_title')}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => setSaveModalOpen(true)}
        >
          {t('config_management.visual.sections.payload.preset_save')}
        </Button>
      </div>
    );
  }

  return (
    <div className={styles.payloadPresetBar}>
      <span className={styles.payloadPresetBarLabel}>
        {t('config_management.visual.sections.payload.preset_title')}
      </span>
      <div className={styles.payloadPresetBarActions}>
        <div className={styles.payloadPresetBarSelect}>
          <Select
            value={selectedId}
            options={selectOptions}
            onChange={setSelectedId}
            placeholder={t('config_management.visual.sections.payload.preset_select_placeholder')}
            disabled={disabled || presets.length === 0}
            size="sm"
            fullWidth
          />
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !selectedId}
          onClick={handleApply}
        >
          {t('config_management.visual.sections.payload.preset_apply')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled || !selectedId}
          onClick={() => setConfirmDeleteId(selectedId)}
        >
          {t('config_management.visual.sections.payload.preset_delete')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => {
            setPresetName('');
            setSaveModalOpen(true);
          }}
        >
          {t('config_management.visual.sections.payload.preset_save')}
        </Button>
      </div>

      {/* Save preset modal */}
      <Modal
        open={saveModalOpen}
        title={t('config_management.visual.sections.payload.preset_save')}
        onClose={() => setSaveModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setSaveModalOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={!presetName.trim()}
              onClick={handleSave}
            >
              {t('common.save', 'Save')}
            </Button>
          </>
        }
        width={isMobile ? '95%' : 420}
      >
        <Input
          label={t('config_management.visual.sections.payload.preset_name_label')}
          placeholder={t('config_management.visual.sections.payload.preset_name_placeholder')}
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
          autoFocus
        />
      </Modal>

      {/* Overwrite confirmation modal */}
      <Modal
        open={overwriteModalOpen}
        title={t('config_management.visual.sections.payload.preset_overwrite')}
        onClose={() => setOverwriteModalOpen(false)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setOverwriteModalOpen(false)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="primary" size="sm" onClick={handleOverwriteConfirm}>
              {t('common.confirm', 'Confirm')}
            </Button>
          </>
        }
        width={isMobile ? '95%' : 400}
      >
        <p>{t('config_management.visual.sections.payload.preset_overwrite')}</p>
      </Modal>

      {/* Delete confirmation modal */}
      <Modal
        open={confirmDeleteId !== null}
        title={t('config_management.visual.sections.payload.preset_delete')}
        onClose={() => setConfirmDeleteId(null)}
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setConfirmDeleteId(null)}>
              {t('common.cancel', 'Cancel')}
            </Button>
            <Button variant="danger" size="sm" onClick={handleDelete}>
              {t('common.confirm', 'Confirm')}
            </Button>
          </>
        }
        width={isMobile ? '95%' : 400}
      >
        <p>
          {t(
            'config_management.visual.sections.payload.preset_confirm_delete',
            selectedPreset
              ? { name: selectedPreset.name }
              : { name: '' },
          )}
        </p>
      </Modal>
    </div>
  );
}
