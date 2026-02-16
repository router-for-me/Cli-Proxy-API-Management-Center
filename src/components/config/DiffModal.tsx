import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { yaml } from '@codemirror/lang-yaml';
import { MergeView } from '@codemirror/merge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { useThemeStore } from '@/stores';
import styles from './DiffModal.module.scss';

type DiffModalProps = {
  open: boolean;
  original: string;
  modified: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

export function DiffModal({
  open,
  original,
  modified,
  onConfirm,
  onCancel,
  loading = false
}: DiffModalProps) {
  const { t } = useTranslation();
  const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
  const mergeContainerRef = useRef<HTMLDivElement>(null);
  const mergeViewRef = useRef<MergeView | null>(null);

  useEffect(() => {
    if (!open || !mergeContainerRef.current) return;

    const mountEl = mergeContainerRef.current;
    mountEl.innerHTML = '';

    const commonExtensions = [
      yaml(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping,
      EditorView.theme(
        {
          '&': { height: '100%' },
          '.cm-scroller': {
            fontFamily: "'Consolas', 'Monaco', 'Menlo', monospace"
          }
        },
        { dark: resolvedTheme === 'dark' }
      )
    ];

    const view = new MergeView({
      parent: mountEl,
      a: { doc: original, extensions: commonExtensions },
      b: { doc: modified, extensions: commonExtensions },
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true
    });
    mergeViewRef.current = view;

    return () => {
      view.destroy();
      if (mergeViewRef.current === view) {
        mergeViewRef.current = null;
      }
      mountEl.innerHTML = '';
    };
  }, [modified, open, original, resolvedTheme]);

  return (
    <Modal
      open={open}
      title={t('config_management.diff.title')}
      onClose={onCancel}
      width="min(1200px, 90vw)"
      className={styles.diffModal}
      closeDisabled={loading}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={loading}>
            {t('common.cancel')}
          </Button>
          <Button onClick={onConfirm} loading={loading} disabled={loading}>
            {t('config_management.diff.confirm')}
          </Button>
        </>
      }
    >
      <div className={styles.content}>
        <div className={styles.columnLabels}>
          <span>{t('config_management.diff.current')}</span>
          <span>{t('config_management.diff.modified')}</span>
        </div>
        <div className={styles.mergeRoot} ref={mergeContainerRef} />
      </div>
    </Modal>
  );
}
