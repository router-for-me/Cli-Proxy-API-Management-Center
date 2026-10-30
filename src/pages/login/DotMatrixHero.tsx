import { useEffect, useRef } from 'react';
import { prefersReducedMotion } from '@/hooks/motion';
import {
  TONE_DIM,
  TONE_MID,
  applyReveal,
  createDotGrid,
  sampleDotTargets,
  type DotGrid,
} from './dotMatrixField';
import styles from './DotMatrixHero.module.scss';

const DOT_COLOR = '#e2e8f0';
/** 品牌标语：按设计要求在所有语言下统一使用英文，不走 i18n */
export const HERO_TITLE = 'Welcome to CLI Proxy API.';
const FRAME_INTERVAL_MS = 1000 / 30;
/** 减少动效模式下展示的固定时刻（秒），避开入场阶段 */
const STATIC_TIME = 4;

function paintIntro(
  context: CanvasRenderingContext2D,
  grid: DotGrid,
  targets: Float32Array,
  elapsed: number
) {
  context.clearRect(0, 0, grid.width, grid.height);
  context.fillStyle = DOT_COLOR;
  const { dotSize } = grid;
  for (let i = 0; i < targets.length; i += 1) {
    const alpha = applyReveal(targets[i], grid.revealAt[i], elapsed);
    if (alpha <= 0) continue;
    context.globalAlpha = alpha;
    context.fillRect(grid.xs[i], grid.ys[i], dotSize, dotSize);
  }
  context.globalAlpha = 1;
}

/** 稳态只有两档亮度：按档位分两遍绘制，避免逐点切换 globalAlpha */
function paintSteady(context: CanvasRenderingContext2D, grid: DotGrid, targets: Float32Array) {
  context.clearRect(0, 0, grid.width, grid.height);
  context.fillStyle = DOT_COLOR;
  const { dotSize } = grid;
  const dim = Math.fround(TONE_DIM);
  const mid = Math.fround(TONE_MID);
  for (const tone of [dim, mid]) {
    context.globalAlpha = tone;
    for (let i = 0; i < targets.length; i += 1) {
      if (targets[i] === tone) context.fillRect(grid.xs[i], grid.ys[i], dotSize, dotSize);
    }
  }
  context.globalAlpha = 1;
}

export function DotMatrixHero() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    const reduced = prefersReducedMotion();
    let grid: DotGrid = createDotGrid(0, 0);
    let targets = new Float32Array(0);
    let frameId = 0;
    let running = false;
    let visible = true;
    let startTime: number | null = null;
    let lastPaint = -Infinity;
    let clock = 0;

    const render = (time: number, intro: boolean) => {
      sampleDotTargets(grid, time, targets);
      if (intro) paintIntro(context, grid, targets, time);
      else paintSteady(context, grid, targets);
    };

    const tick = (now: number) => {
      frameId = requestAnimationFrame(tick);
      if (now - lastPaint < FRAME_INTERVAL_MS) return;
      lastPaint = now;
      if (startTime === null) startTime = now - clock * 1000;
      clock = (now - startTime) / 1000;
      render(clock, clock < grid.introDuration);
    };

    const start = () => {
      if (running || reduced || !visible || document.hidden || targets.length === 0) return;
      running = true;
      // 暂停后恢复时从暂停处的时钟继续，避免星云跳变
      startTime = null;
      frameId = requestAnimationFrame(tick);
    };

    const stop = () => {
      running = false;
      cancelAnimationFrame(frameId);
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      grid = createDotGrid(rect.width, rect.height);
      targets = new Float32Array(grid.columns * grid.rows);
      if (reduced) {
        render(STATIC_TIME, false);
      } else {
        // 重设画布会清空内容，立即补画当前帧，避免尺寸变化时闪黑
        render(clock, clock < grid.introDuration);
        start();
      }
    };

    const handleVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    resize();

    const resizeObserver =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize);
    resizeObserver?.observe(canvas);

    const intersectionObserver =
      typeof IntersectionObserver === 'undefined'
        ? null
        : new IntersectionObserver(([entry]) => {
            visible = entry?.isIntersecting ?? true;
            if (visible) start();
            else stop();
          });
    intersectionObserver?.observe(canvas);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      stop();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

  return (
    <div className={styles.hero}>
      <canvas ref={canvasRef} className={styles.canvas} aria-hidden="true" />
      <p className={styles.title} lang="en">
        {HERO_TITLE}
      </p>
    </div>
  );
}
