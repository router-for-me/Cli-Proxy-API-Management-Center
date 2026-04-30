import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { logsApi } from '@/services/api/logs';
import { downloadBlob } from '@/utils/download';
import styles from './RequestEventDetailModal.module.scss';

const SECTION_HEADER_REGEX = /^=== (.+?) ===\s*$/gm;
const RENDER_BODY_CAP = 1024 * 1024;

interface ParsedSection {
  title: string;
  body: string;
  truncated: boolean;
  rawLength: number;
}

interface RequestEventDetailModalProps {
  requestId: string | null;
  onClose: () => void;
}

const extractErrorStatus = (value: unknown): number | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const status = (value as { status?: unknown }).status;
  return typeof status === 'number' ? status : undefined;
};

const extractErrorMessage = (value: unknown): string => {
  if (value instanceof Error) return value.message;
  if (typeof value === 'object' && value !== null) {
    const msg = (value as { message?: unknown }).message;
    if (typeof msg === 'string' && msg) return msg;
  }
  return String(value);
};

const parseSections = (text: string): ParsedSection[] => {
  if (!text) return [];

  const matches: { title: string; start: number; end: number }[] = [];
  SECTION_HEADER_REGEX.lastIndex = 0;
  for (
    let match = SECTION_HEADER_REGEX.exec(text);
    match !== null;
    match = SECTION_HEADER_REGEX.exec(text)
  ) {
    matches.push({
      title: match[1].trim(),
      start: match.index,
      end: match.index + match[0].length,
    });
  }

  if (matches.length === 0) {
    const trimmed = text.replace(/^\n+|\n+$/g, '');
    if (!trimmed) return [];
    const truncated = trimmed.length > RENDER_BODY_CAP;
    return [
      {
        title: 'LOG',
        body: truncated ? trimmed.slice(0, RENDER_BODY_CAP) : trimmed,
        truncated,
        rawLength: trimmed.length,
      },
    ];
  }

  const sections: ParsedSection[] = [];

  if (matches[0].start > 0) {
    const preamble = text.slice(0, matches[0].start).replace(/^\n+|\n+$/g, '');
    if (preamble) {
      const truncated = preamble.length > RENDER_BODY_CAP;
      sections.push({
        title: 'LOG',
        body: truncated ? preamble.slice(0, RENDER_BODY_CAP) : preamble,
        truncated,
        rawLength: preamble.length,
      });
    }
  }

  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const bodyStart = current.end;
    const bodyEnd = next ? next.start : text.length;
    const rawBody = text.slice(bodyStart, bodyEnd).replace(/^\n+|\n+$/g, '');
    const truncated = rawBody.length > RENDER_BODY_CAP;
    const body = truncated ? rawBody.slice(0, RENDER_BODY_CAP) : rawBody;
    sections.push({
      title: current.title,
      body,
      truncated,
      rawLength: rawBody.length,
    });
  }
  return sections;
};

type BodyRenderKind = 'json' | 'sse' | 'text' | 'empty';

const SSE_LINE_REGEX = /^(data:|event:|id:|retry:)/m;

const detectBodyKind = (body: string): BodyRenderKind => {
  const trimmed = body.trim();
  if (!trimmed) return 'empty';
  const firstChar = trimmed[0];
  if (firstChar === '{' || firstChar === '[') {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // fall through
    }
  }
  if (SSE_LINE_REGEX.test(trimmed)) {
    return 'sse';
  }
  return 'text';
};

const TITLE_TO_KIND_HINT: Record<string, BodyRenderKind | undefined> = {
  HEADERS: 'text',
};

const renderJsonBody = (body: string): string => {
  try {
    const parsed = JSON.parse(body.trim());
    return JSON.stringify(parsed, null, 2);
  } catch {
    return body;
  }
};

const renderSseEvents = (body: string): string[] => {
  const blocks = body
    .split(/\n\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks : [body.trim()];
};

interface SectionPanelProps {
  section: ParsedSection;
  index: number;
  defaultExpanded: boolean;
}

const SectionPanel = ({ section, index, defaultExpanded }: SectionPanelProps) => {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const titleHint = TITLE_TO_KIND_HINT[section.title.toUpperCase()];
  const kind = useMemo(() => titleHint ?? detectBodyKind(section.body), [titleHint, section.body]);

  const bodyContent = useMemo(() => {
    if (kind === 'empty') {
      return <div className={styles.emptyBody}>{t('usage_stats.event_detail.empty_body')}</div>;
    }
    if (kind === 'json') {
      return <pre className={styles.bodyPre}>{renderJsonBody(section.body)}</pre>;
    }
    if (kind === 'sse') {
      const events = renderSseEvents(section.body);
      return (
        <div className={styles.sseList}>
          {events.map((event, eventIndex) => (
            <pre key={eventIndex} className={`${styles.bodyPre} ${styles.sseItem}`}>
              {event}
            </pre>
          ))}
        </div>
      );
    }
    return <pre className={styles.bodyPre}>{section.body}</pre>;
  }, [kind, section.body, t]);

  return (
    <section className={styles.section} aria-labelledby={`event-detail-section-${index}`}>
      <button
        type="button"
        className={styles.sectionHeader}
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        id={`event-detail-section-${index}`}
      >
        <span className={styles.sectionIndex}>{index + 1}</span>
        <span className={styles.sectionTitle}>{section.title}</span>
        <span className={styles.sectionKind}>{kind.toUpperCase()}</span>
        <span className={styles.sectionChevron} aria-hidden="true">
          {expanded ? '−' : '+'}
        </span>
      </button>
      {expanded && (
        <div className={styles.sectionBody}>
          {bodyContent}
          {section.truncated && (
            <div className={styles.truncationNotice}>
              {t('usage_stats.event_detail.section_truncated', {
                shown: RENDER_BODY_CAP,
                total: section.rawLength,
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
};

export function RequestEventDetailModal({ requestId, onClose }: RequestEventDetailModalProps) {
  const { t } = useTranslation();
  const open = Boolean(requestId);

  const [text, setText] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const loadLog = useCallback(async (id: string) => {
    setLoading(true);
    setErrorMessage(null);
    setMissing(false);
    setText('');
    try {
      const data = await logsApi.fetchRequestLogText(id);
      setText(data ?? '');
    } catch (err) {
      if (extractErrorStatus(err) === 404) {
        setMissing(true);
      } else {
        setErrorMessage(extractErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!requestId) {
      setText('');
      setErrorMessage(null);
      setMissing(false);
      return;
    }
    void loadLog(requestId);
  }, [loadLog, requestId]);

  const sections = useMemo(() => parseSections(text), [text]);

  const handleDownload = useCallback(async () => {
    if (!requestId) return;
    setDownloading(true);
    try {
      const response = await logsApi.downloadRequestLogById(requestId);
      const blob =
        response.data instanceof Blob ? response.data : new Blob([String(response.data)]);
      const filename = `request-log-${requestId}.log`;
      downloadBlob({ filename, blob });
    } catch (err) {
      setErrorMessage(extractErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  }, [requestId]);

  const handleRefresh = useCallback(() => {
    if (!requestId) return;
    void loadLog(requestId);
  }, [loadLog, requestId]);

  const renderContent = () => {
    if (loading) {
      return <div className={styles.statusLine}>{t('common.loading')}</div>;
    }
    if (missing) {
      return (
        <div className={styles.statusBlock}>
          <div className={styles.statusTitle}>{t('usage_stats.event_detail.not_found_title')}</div>
          <p className={styles.statusBody}>{t('usage_stats.event_detail.not_found_body')}</p>
        </div>
      );
    }
    if (errorMessage) {
      return (
        <div className={`${styles.statusBlock} ${styles.statusError}`}>
          <div className={styles.statusTitle}>{t('usage_stats.event_detail.error_title')}</div>
          <p className={styles.statusBody}>{errorMessage}</p>
        </div>
      );
    }
    if (!text || sections.length === 0) {
      return (
        <div className={styles.statusBlock}>
          <div className={styles.statusTitle}>{t('usage_stats.event_detail.empty_title')}</div>
          <p className={styles.statusBody}>{t('usage_stats.event_detail.empty_body_hint')}</p>
        </div>
      );
    }

    return (
      <div className={styles.sections}>
        <div className={styles.intro}>
          <span className={styles.introLabel}>
            {t('usage_stats.event_detail.request_id_label')}
          </span>
          <code className={styles.requestIdValue}>{requestId}</code>
          <span className={styles.sectionsCount}>
            {t('usage_stats.event_detail.sections_count', { count: sections.length })}
          </span>
        </div>
        {sections.map((section, index) => (
          <SectionPanel
            key={`${section.title}-${index}`}
            section={section}
            index={index}
            defaultExpanded={true}
          />
        ))}
      </div>
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('usage_stats.event_detail.title')}
      width={960}
      className={styles.modal}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={handleRefresh}
            disabled={!requestId || loading || downloading}
          >
            {t('common.refresh')}
          </Button>
          <Button
            variant="secondary"
            onClick={handleDownload}
            disabled={!requestId || downloading}
            loading={downloading}
          >
            {t('usage_stats.event_detail.download_raw')}
          </Button>
          <Button onClick={onClose} disabled={downloading}>
            {t('common.close')}
          </Button>
        </>
      }
    >
      {renderContent()}
    </Modal>
  );
}
