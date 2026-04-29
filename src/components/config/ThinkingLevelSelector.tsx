import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { SelectionCheckbox } from '@/components/ui/SelectionCheckbox';
import { Button } from '@/components/ui/Button';
import styles from './ThinkingLevelSelector.module.scss';

const LEVEL_OPTIONS = [
  { key: 'low', labelKey: 'config_management.codex_thinking_levels.low' },
  { key: 'medium', labelKey: 'config_management.codex_thinking_levels.medium' },
  { key: 'high', labelKey: 'config_management.codex_thinking_levels.high' },
  { key: 'xhigh', labelKey: 'config_management.codex_thinking_levels.xhigh' },
] as const;

interface ThinkingLevelSelectorProps {
  open: boolean;
  selected: string[];
  onClose: () => void;
  onApply: (levels: string[]) => void;
}

export function ThinkingLevelSelector({ open, selected, onClose, onApply }: ThinkingLevelSelectorProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<string[]>(selected);

  const toggleLevel = (key: string) => {
    setDraft(prev =>
      prev.includes(key) ? prev.filter(l => l !== key) : [...prev, key]
    );
  };

  const handleApply = () => {
    onApply(draft);
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('config_management.codex_thinking_levels.select_title')}
      width={420}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={handleApply} disabled={draft.length === 0}>{t('common.confirm')}</Button>
        </>
      }
    >
      <div className={styles.levelList}>
        {LEVEL_OPTIONS.map(opt => (
          <SelectionCheckbox
            key={opt.key}
            checked={draft.includes(opt.key)}
            onChange={() => toggleLevel(opt.key)}
            label={t(opt.labelKey)}
          />
        ))}
      </div>
    </Modal>
  );
}
