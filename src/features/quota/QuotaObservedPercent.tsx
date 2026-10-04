import {
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { IconRefreshCw } from '@/components/ui/icons';
import { createSharedClock } from '@/utils/time/sharedClock';
import { observationAge } from './observationFormat';
import { AuthFileObservation } from './authFileObservation';
import styles from './QuotaObservedPercent.module.scss';

const secondsClock = createSharedClock({
  intervalMs: 1000,
  setTimer: (tick, ms) =>
    setInterval(() => {
      if (!document.hidden) tick();
    }, ms),
});
const noSubscribe = () => () => {};
const frozen = Date.now();
const serverSnapshot = () => frozen;

/** The native percentage remains unchanged; only an Auth Files host adds an age. */
export function QuotaObservedPercent({
  className,
  children,
}: {
  className: string;
  children: ReactNode;
}) {
  const observation = useContext(AuthFileObservation);
  const { t } = useTranslation();
  const validCapture = Number.isFinite(Date.parse(observation?.capturedAt ?? ''));
  const now = useSyncExternalStore(
    validCapture ? secondsClock.subscribe : noSubscribe,
    secondsClock.getSnapshot,
    serverSnapshot
  );
  const age = observationAge(observation?.capturedAt, now);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const anchor = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open || !anchor.current) return;
    const button = anchor.current;
    const place = () => {
      const bounds = button.getBoundingClientRect();
      const height = popup.current?.getBoundingClientRect().height ?? 110;
      setPosition({
        left: Math.max(8, Math.min(bounds.left, window.innerWidth - 288)),
        top:
          bounds.bottom + height + 14 <= window.innerHeight
            ? bounds.bottom + 6
            : Math.max(8, bounds.top - height - 6),
      });
    };
    const outside = (event: PointerEvent) => {
      if (!button.contains(event.target as Node)) setOpen(false);
    };
    place();
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  const content = age
    ? [
        `${t('quota_updated.updated')}: ${age.timestamp}`,
        age.relative,
        `${t('quota_updated.source')}: ${t('quota_updated.provider_query')}`,
        ...(age.stale ? [t('quota_updated.stale')] : []),
      ].join('\n')
    : '';
  if (!age) return <span className={className}>{children}</span>;
  return (
    <>
      <span className={styles.remaining}>
        <span className={className}>{children}</span>
        {age && (
          <button
            ref={anchor}
            type="button"
            className={styles.age}
            data-quota-updated="true"
            data-stale={age.stale || undefined}
            aria-label={`${t('quota_updated.updated')}: ${age.relative}`}
            aria-expanded={open}
            aria-describedby={open ? id : undefined}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => setOpen(false)}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(true)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation();
                setOpen(false);
              }
            }}
          >
            <IconRefreshCw size={11} aria-hidden="true" />
            <span>{age.compact}</span>
          </button>
        )}
      </span>
      {open &&
        age &&
        createPortal(
          <span ref={popup} id={id} role="tooltip" className={styles.tooltip} style={position}>
            {content}
          </span>,
          document.body
        )}
    </>
  );
}
