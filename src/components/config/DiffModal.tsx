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
  current: DiffSide;
  modified: DiffSide;
};

type LineRange = {
  start: number;
  end: number;
};

type DiffSideLine = {
  lineNumber: number;
  text: string;
  changed: boolean;
};

type DiffSide = {
  changedRangeLabel: string;
  contextRangeLabel: string;
  lines: DiffSideLine[];
};

const DIFF_CONTEXT_LINES = 2;

const clampPos = (doc: Text, pos: number) => Math.max(0, Math.min(pos, doc.length));

const getLineRangeLabel = (range: LineRange): string => {
  return range.start === range.end ? String(range.start) : `${range.start}-${range.end}`;
};

const getChangedLineRange = (doc: Text, from: number, to: number): LineRange => {
  const start = clampPos(doc, from);
  const end = clampPos(doc, to);
  if (start === end) {
    const linePos = Math.min(start, doc.length);
    const anchorLine = doc.lineAt(linePos).number;
    return { start: anchorLine, end: anchorLine };
  }
  const startLine = doc.lineAt(start).number;
  const endLine = doc.lineAt(Math.max(start, end - 1)).number;
  return { start: startLine, end: endLine };
};

const expandContextRange = (doc: Text, range: LineRange): LineRange => ({
  start: Math.max(1, range.start - DIFF_CONTEXT_LINES),
  end: Math.min(doc.lines, range.end + DIFF_CONTEXT_LINES)
});

const buildSideLines = (doc: Text, contextRange: LineRange, changedRange: LineRange): DiffSideLine[] => {
  const lines: DiffSideLine[] = [];
  for (let lineNumber = contextRange.start; lineNumber <= contextRange.end; lineNumber += 1) {
    lines.push({
      lineNumber,
      text: doc.line(lineNumber).text,
      changed: lineNumber >= changedRange.start && lineNumber <= changedRange.end
    });
  }
  return lines;
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

    return chunks.map((chunk, index) => {
      const currentChangedRange = getChangedLineRange(currentDoc, chunk.fromA, chunk.toA);
      const modifiedChangedRange = getChangedLineRange(modifiedDoc, chunk.fromB, chunk.toB);
      const currentContextRange = expandContextRange(currentDoc, currentChangedRange);
      const modifiedContextRange = expandContextRange(modifiedDoc, modifiedChangedRange);

      return {
        id: `${index}-${chunk.fromA}-${chunk.toA}-${chunk.fromB}-${chunk.toB}`,
        current: {
          changedRangeLabel: getLineRangeLabel(currentChangedRange),
          contextRangeLabel: getLineRangeLabel(currentContextRange),
          lines: buildSideLines(currentDoc, currentContextRange, currentChangedRange)
        },
        modified: {
          changedRangeLabel: getLineRangeLabel(modifiedChangedRange),
          contextRangeLabel: getLineRangeLabel(modifiedContextRange),
          lines: buildSideLines(modifiedDoc, modifiedContextRange, modifiedChangedRange)
        }
      };
    });
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
                      <span className={styles.lineMeta}>
                        <span className={styles.lineRange}>L{card.current.changedRangeLabel}</span>
                        <span className={styles.contextRange}>
                          ±{DIFF_CONTEXT_LINES}: L{card.current.contextRangeLabel}
                        </span>
                      </span>
                    </header>
                    <div className={styles.codeList}>
                      {card.current.lines.map((line) => (
                        <div
                          key={`${card.id}-a-${line.lineNumber}`}
                          className={`${styles.codeLine} ${line.changed ? styles.codeLineChanged : ''}`}
                        >
                          <span className={styles.codeLineNumber}>{line.lineNumber}</span>
                          <code className={styles.codeLineText}>{line.text || ' '}</code>
                        </div>
                      ))}
                    </div>
                  </section>
                  <section className={styles.diffColumn}>
                    <header className={styles.diffColumnHeader}>
                      <span>{t('config_management.diff.modified')}</span>
                      <span className={styles.lineMeta}>
                        <span className={styles.lineRange}>L{card.modified.changedRangeLabel}</span>
                        <span className={styles.contextRange}>
                          ±{DIFF_CONTEXT_LINES}: L{card.modified.contextRangeLabel}
                        </span>
                      </span>
                    </header>
                    <div className={styles.codeList}>
                      {card.modified.lines.map((line) => (
                        <div
                          key={`${card.id}-b-${line.lineNumber}`}
                          className={`${styles.codeLine} ${line.changed ? styles.codeLineChanged : ''}`}
                        >
                          <span className={styles.codeLineNumber}>{line.lineNumber}</span>
                          <code className={styles.codeLineText}>{line.text || ' '}</code>
                        </div>
                      ))}
                    </div>
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
