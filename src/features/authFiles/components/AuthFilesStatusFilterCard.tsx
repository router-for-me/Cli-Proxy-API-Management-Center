import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useStatusFilterWebglFire } from '@/features/authFiles/hooks/useStatusFilterWebglFire';
import styles from './AuthFilesStatusFilterCard.module.scss';

export type AuthFilesStatusFilterOption = {
  value: string;
  label: string;
};

export type AuthFilesStatusFilterCardProps = {
  label: string;
  minLabel?: string;
  maxLabel?: string;
  value: string;
  options: AuthFilesStatusFilterOption[];
  onChange: (value: string) => void;
};

export function AuthFilesStatusFilterCard({
  label,
  minLabel,
  maxLabel,
  value,
  options,
  onChange,
}: AuthFilesStatusFilterCardProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const draggingRef = useRef(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevActiveRef = useRef(false);

  const activeIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const sliderValue = (activeIndex / Math.max(1, options.length - 1)) * 100;
  const isActive = activeIndex === options.length - 1;
  const isFull = sliderValue === 100;
  const currentOption = options[activeIndex] ?? options[0];

  useEffect(() => {
    if (prevActiveRef.current !== isActive) {
      // Trigger a one-off flip animation when the active state crosses the
      // threshold, mirroring the original EffortCard behavior.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsAnimating(true);
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        setIsAnimating(false);
        timerRef.current = null;
      }, 460);
      prevActiveRef.current = isActive;
    }
  }, [isActive]);

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    },
    []
  );

  useStatusFilterWebglFire(canvasRef, sliderValue / 100, isActive);

  const uid = useId().replace(/:/g, '');
  const clipId = `status-filter-card-${uid}`;
  const clipTrackId = `status-filter-track-${uid}`;

  const cardClip = useMemo(
    () => ({
      clipPath: `url(#${clipId})`,
    }),
    [clipId]
  );
  const trackClip = useMemo(
    () => ({
      clipPath: `url(#${clipTrackId})`,
    }),
    [clipTrackId]
  );

  const canvasMask = useMemo(() => {
    const p = Math.min(sliderValue + 2, 100);
    const gradient = `linear-gradient(to right, black 0%, black ${p}%, transparent ${p}%)`;
    return {
      maskImage: gradient,
      WebkitMaskImage: gradient,
    };
  }, [sliderValue]);
  const thumbStyle = useMemo(() => ({ left: `${sliderValue}%` }), [sliderValue]);

  const selectIndex = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(options.length - 1, nextIndex));
      const nextValue = options[clamped]?.value;
      if (nextValue && nextValue !== value) {
        onChange(nextValue);
      }
    },
    [onChange, options, value]
  );

  const selectFromPercent = useCallback(
    (raw: number) => {
      const step = 100 / Math.max(1, options.length - 1);
      const nextIndex = Math.max(
        0,
        Math.min(options.length - 1, Math.round(raw / step + 1e-9))
      );
      selectIndex(nextIndex);
    },
    [options.length, selectIndex]
  );

  const selectFromClientX = useCallback(
    (clientX: number) => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return;
      const raw = ((clientX - rect.left) / rect.width) * 100;
      selectFromPercent(Math.max(0, Math.min(100, raw)));
    },
    [selectFromPercent]
  );

  const handleTrackPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (options.length <= 1) return;
    event.preventDefault();
    draggingRef.current = true;
    setIsDragging(true);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    inputRef.current?.focus({ preventScroll: true });
    selectFromClientX(event.clientX);
  };

  const handleTrackPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    selectFromClientX(event.clientX);
  };

  const handleTrackPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    draggingRef.current = false;
    setIsDragging(false);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
  };

  const handleInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    selectFromPercent(Number(event.currentTarget.value));
  };

  const trackWrapperClass = [
    styles.trackWrapper,
    isActive ? styles.trackWrapperActive : '',
    isFull ? styles.trackWrapperFull : '',
    isDragging ? styles.trackWrapperDragging : '',
  ].join(' ');

  const statusClass = [
    styles.statusText,
    isActive ? styles.statusTextGlowing : '',
    isAnimating ? styles.statusTextAnimateUp : '',
  ].join(' ');

  return (
    <div className={styles.cardShadow}>
      <svg className={styles.squircleClip} xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <defs>
          <clipPath id={clipId} clipPathUnits="objectBoundingBox">
            <path d="M 0.053,0 C 0.029,0 0.012,0.008 0.005,0.02 C 0.002,0.028 0,0.038 0,0.053 L 0,0.947 C 0,0.962 0.002,0.972 0.005,0.98 C 0.012,0.992 0.029,1 0.053,1 L 0.947,1 C 0.971,1 0.988,0.992 0.995,0.98 C 0.998,0.972 1,0.962 1,0.947 L 1,0.053 C 1,0.038 0.998,0.028 0.995,0.02 C 0.988,0.008 0.971,0 0.947,0 Z" />
          </clipPath>
          <clipPath id={clipTrackId} clipPathUnits="objectBoundingBox">
            <path d="M 0.033,0 C 0.018,0 0.007,0.012 0.003,0.035 C 0.001,0.055 0,0.1 0,0.15 L 0,0.85 C 0,0.9 0.001,0.945 0.003,0.965 C 0.007,0.988 0.018,1 0.033,1 L 0.967,1 C 0.982,1 0.993,0.988 0.997,0.965 C 0.999,0.945 1,0.9 1,0.85 L 1,0.15 C 1,0.1 0.999,0.055 0.997,0.035 C 0.993,0.012 0.982,0 0.967,0 Z" />
          </clipPath>
        </defs>
      </svg>

      <div className={styles.card} style={cardClip}>
        <div className={styles.header}>
          <div className={styles.headerLeft}>
            <span className={styles.labelText}>{label}</span>
            <span className={statusClass}>{currentOption.label}</span>
          </div>
        </div>

        <div className={styles.scaleLabels}>
          <span>{minLabel ?? options[0]?.label}</span>
          <span>{maxLabel ?? options[options.length - 1]?.label}</span>
        </div>

        <div
          className={trackWrapperClass}
          style={trackClip}
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerEnd}
          onPointerCancel={handleTrackPointerEnd}
        >
          <div className={styles.trackBg} />
          <div className={styles.dotsLayer}>
            {options.map((option, index) => {
              const stepCount = Math.max(1, options.length - 1);
              const left = `${(index / stepCount) * 100}%`;
              return (
                <span
                  key={option.value}
                  className={styles.dot}
                  style={{ left }}
                  aria-hidden="true"
                />
              );
            })}
          </div>
          <canvas
            ref={canvasRef}
            className={styles.fireCanvas}
            style={canvasMask}
            aria-hidden="true"
          />
          <input
            ref={inputRef}
            type="range"
            min={0}
            max={100}
            step="any"
            value={sliderValue}
            className={styles.slider}
            onChange={handleInput}
            aria-label={label}
            disabled={options.length <= 1}
          />
          <div className={styles.thumbLayer} aria-hidden="true">
            <span className={styles.thumb} style={thumbStyle} />
          </div>
        </div>
      </div>
    </div>
  );
}
