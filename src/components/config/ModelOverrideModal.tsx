import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { ToggleSwitch } from '@/components/ui/ToggleSwitch';
import { Button } from '@/components/ui/Button';
import styles from './ModelOverrideModal.module.scss';

const LEVEL_OPTIONS = ['low', 'medium', 'high', 'xhigh'] as const;

interface ModelOverrideModalProps {
  open: boolean;
  codexModelIds: string[];
  globalLevels: string[];
  overrides: Record<string, string[]>;
  onClose: () => void;
  onApply: (overrides: Record<string, string[]>) => void;
}

export function ModelOverrideModal({
  open,
  codexModelIds,
  globalLevels,
  overrides,
  onClose,
  onApply,
}: ModelOverrideModalProps) {
  const { t } = useTranslation();

  // Draft state: for each model, whether it's customized, and what levels
  const [draftOverrides, setDraftOverrides] = useState<Record<string, string[]>>(overrides);

  const isModelCustomized = (modelId: string) => {
    return Object.prototype.hasOwnProperty.call(draftOverrides, modelId);
  };

  const getModelLevels = (modelId: string): string[] => {
    if (isModelCustomized(modelId)) {
      return draftOverrides[modelId] || [];
    }
    return globalLevels;
  };

  const toggleCustomize = (modelId: string) => {
    setDraftOverrides(prev => {
      const next = { ...prev };
      if (Object.prototype.hasOwnProperty.call(next, modelId)) {
        // Switch back to inherited
        delete next[modelId];
      } else {
        // Start customizing with current global levels as default
        next[modelId] = [...globalLevels];
      }
      return next;
    });
  };

  const toggleModelLevel = (modelId: string, level: string) => {
    if (!isModelCustomized(modelId)) return;
    setDraftOverrides(prev => {
      const current = prev[modelId] || [];
      const next = current.includes(level)
        ? current.filter(l => l !== level)
        : [...current, level];
      return { ...prev, [modelId]: next };
    });
  };

  const handleApply = () => {
    // Clean up: remove models whose overrides match global (no-op)
    const cleaned: Record<string, string[]> = {};
    for (const [modelId, levels] of Object.entries(draftOverrides)) {
      const sorted = [...levels].sort();
      const sortedGlobal = [...globalLevels].sort();
      if (
        sorted.length !== sortedGlobal.length ||
        sorted.some((l, i) => l !== sortedGlobal[i])
      ) {
        cleaned[modelId] = levels;
      }
    }
    onApply(cleaned);
    onClose();
  };

  const globalLevelsLabel = globalLevels
    .map(l => t(`config_management.codex_thinking_levels.${l}`))
    .join(' / ');

  if (codexModelIds.length === 0) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title={t('config_management.codex_thinking_model_overrides.select_title')}
        width={620}
        footer={
          <Button variant="secondary" onClick={onClose}>{t('common.close')}</Button>
        }
      >
        <div className={styles.emptyHint}>
          {t('config_management.codex_thinking_model_overrides.no_models')}
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('config_management.codex_thinking_model_overrides.select_title')}
      width={700}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleApply}>{t('common.confirm')}</Button>
        </>
      }
    >
      <div className={styles.container}>
        <div className={styles.globalHint}>
          {t('config_management.codex_thinking_model_overrides.global_levels_hint')}{globalLevelsLabel}
        </div>

        <div className={styles.table}>
          <div className={styles.tableHeader}>
            <span className={styles.colModel}>{t('config_management.codex_thinking_model_overrides.model')}</span>
            <span className={styles.colStatus}>{t('config_management.codex_thinking_model_overrides.status')}</span>
            <span className={styles.colLevels}>
              {LEVEL_OPTIONS.map(opt => (
                <span key={opt} className={styles.levelHeader}>
                  {t(`config_management.codex_thinking_levels.${opt}`)}
                </span>
              ))}
            </span>
          </div>

          {codexModelIds.map(modelId => {
            const customized = isModelCustomized(modelId);
            const levels = getModelLevels(modelId);

            return (
              <div key={modelId} className={styles.tableRow}>
                <span className={styles.colModel}>{modelId}</span>
                <span className={styles.colStatus}>
                  <ToggleSwitch
                    checked={customized}
                    onChange={() => toggleCustomize(modelId)}
                    ariaLabel={t(
                      customized
                        ? 'config_management.codex_thinking_model_overrides.customized'
                        : 'config_management.codex_thinking_model_overrides.inherited'
                    )}
                    label={t(
                      customized
                        ? 'config_management.codex_thinking_model_overrides.customized'
                        : 'config_management.codex_thinking_model_overrides.inherited'
                    )}
                    labelPosition="left"
                  />
                </span>
                <span className={styles.colLevels}>
                  {LEVEL_OPTIONS.map(opt => {
                    const checked = levels.includes(opt);
                    return (
                      <SelectionCheckbox
                        key={opt}
                        checked={checked}
                        onChange={() => toggleModelLevel(modelId, opt)}
                        disabled={!customized}
                        ariaLabel={t(`config_management.codex_thinking_levels.${opt}`)}
                      />
                    );
                  })}
                </span>
              </div>
            );
          })}
        </div>

        <div className={styles.apiHint}>
          {t('config_management.codex_thinking_model_overrides.api_hint')}
        </div>
      </div>
    </Modal>
  );
}
