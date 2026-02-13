import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import type { AuthFileItem } from '@/types';
import styles from '@/pages/AuthFilesPage.module.scss';

export type AuthFileDetailModalProps = {
  open: boolean;
  file: AuthFileItem | null;
  onClose: () => void;
  onCopyText: (text: string) => void;
};

export function AuthFileDetailModal({ open, file, onClose, onCopyText }: AuthFileDetailModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={file?.name || t('auth_files.title_section')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.close')}
          </Button>
          <Button
            onClick={() => {
              if (!file) return;
              const text = JSON.stringify(file, null, 2);
              onCopyText(text);
            }}
          >
            {t('common.copy')}
          </Button>
        </>
      }
    >
      {file && (
        <div className={styles.detailContent}>
          <pre className={styles.jsonContent}>{JSON.stringify(file, null, 2)}</pre>
        </div>
      )}
    </Modal>
  );
}

