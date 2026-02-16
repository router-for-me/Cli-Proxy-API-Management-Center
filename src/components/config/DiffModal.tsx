import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from '@codemirror/state';
import { Chunk } from '@codemirror/merge';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import styles from './DiffModal.module.scss';

type DiffModalProps = {
  open: boolean;
  original: string;
  modified: string;
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
};

type DiffChunkCard = {
  id: string;
  currentLines: string;
  modifiedLines: string;
  currentText: string;
  modifiedText: string;
};

const clampPos = (doc: Text, pos: number) => Math.max(0, Math.min(pos, doc.length));

const getLineRangeLabel = (doc: Text, from: number, to: number): string => {
  const start = clampPos(doc, from);
  const end = clampPos(doc, to);
  if (start === end) {
    const linePos = Math.min(start, doc.length);
    return String(doc.lineAt(linePos).number);
  }
  const startLine = doc.lineAt(start).number;
  const endLine = doc.lineAt(Math.max(start, end - 1)).number;
  return startLine === endLine ? String(startLine) : `${startLine}-${endLine}`;
};

const getChunkText = (doc: Text, from: number, to: number): string => {
  const start = clampPos(doc, from);
  const end = clampPos(doc, to);
  if (start >= end) return '';
  return doc.sliceString(start, end).trimEnd();
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

  const diffCards = useMemo<DiffChunkCard[]>(() => {
    const currentDoc = Text.of(original.split('\n'));
    const modifiedDoc = Text.of(modified.split('\n'));
    const chunks = Chunk.build(currentDoc, modifiedDoc);

    return chunks.map((chunk, index) => ({
      id: `${index}-${chunk.fromA}-${chunk.toA}-${chunk.fromB}-${chunk.toB}`,
      currentLines: getLineRangeLabel(currentDoc, chunk.fromA, chunk.toA),
      modifiedLines: getLineRangeLabel(modifiedDoc, chunk.fromB, chunk.toB),
      currentText: getChunkText(currentDoc, chunk.fromA, chunk.toA),
      modifiedText: getChunkText(modifiedDoc, chunk.fromB, chunk.toB)
    }));
  }, [modified, original]);

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
        {diffCards.length === 0 ? (
          <div className={styles.emptyState}>{t('config_management.diff.no_changes')}</div>
        ) : (
          <div className={styles.diffList}>
            {diffCards.map((card, index) => (
              <article key={card.id} className={styles.diffCard}>
                <div className={styles.diffCardHeader}>#{index + 1}</div>
                <div className={styles.diffColumns}>
                  <section className={styles.diffColumn}>
                    <header className={styles.diffColumnHeader}>
                      <span>{t('config_management.diff.current')}</span>
                      <span className={styles.lineRange}>L{card.currentLines}</span>
                    </header>
                    <pre className={styles.codeBlock}>{card.currentText || '-'}</pre>
                  </section>
                  <section className={styles.diffColumn}>
                    <header className={styles.diffColumnHeader}>
                      <span>{t('config_management.diff.modified')}</span>
                      <span className={styles.lineRange}>L{card.modifiedLines}</span>
                    </header>
                    <pre className={styles.codeBlock}>{card.modifiedText || '-'}</pre>
                  </section>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
