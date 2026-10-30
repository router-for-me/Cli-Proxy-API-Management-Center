/**
 * 登录页左侧点阵场的纯逻辑。
 *
 * 行为按参考视频逐帧测量复刻：
 * - 点阵是一张约 2 格/秒向左漂移、同时自身形变的噪声"星云"，场值决定点亮概率；
 * - 每个点按自己的节拍重新掷骰，云团内外的点持续亮/灭交替
 *   （实测每帧约 3% 切换，1 秒后点亮状态仅约 45% 重合）；
 * - 稳态亮度只有两档：暗（约 88%）与中（密集核心，约 12%），切换是瞬时的；
 *   白色高亮只出现在雷达波入场的闪光里，随后逐级回落。
 *
 * 网格以右下角为锚点排布，窗口尺寸变化时右下角（标题所在处）的图案保持稳定。
 */

export interface DotGrid {
  width: number;
  height: number;
  pitch: number;
  dotSize: number;
  columns: number;
  rows: number;
  /** 每个格子的左上角坐标 */
  xs: Float32Array;
  ys: Float32Array;
  /** 以右下角为原点的格子坐标（列向左递增、行向上递增） */
  cols: Int32Array;
  rowsIndex: Int32Array;
  /** 雷达波揭示时刻（秒） */
  revealAt: Float32Array;
  /** 每个点独立的闪烁节拍周期与相位 */
  period: Float32Array;
  phase: Float32Array;
  /** 雷达波全部落定所需时长（秒） */
  introDuration: number;
}

export interface DotGridOptions {
  pitch?: number;
  seed?: number;
}

/** 视频中整屏高度约 84 行点阵；按面板高度换算点距，并限制在可读范围内 */
export const ROWS_PER_HEIGHT = 84;
export const MIN_PITCH = 9;
export const MAX_PITCH = 14;
/** 点径 / 点距，视频约 8 / 12.9 */
export const DOT_RATIO = 0.62;

/** 两档稳态亮度（透明度），取自视频灰度：≈55 / ≈120（白点 ≈240 仅见于入场闪光） */
export const TONE_DIM = 0.22;
export const TONE_MID = 0.47;

/** 星云整体向左漂移速度（格/秒），视频约 2 格/秒 */
export const DRIFT_SPEED = 2;

/** 雷达波从右下角扫到最远角所用时间 */
export const WAVE_DURATION = 0.72;
export const WAVE_JITTER = 0.1;
export const FLASH_RISE = 0.05;
export const FLASH_SETTLE = 0.33;
const FLASH_BOOST = 0.45;

const DEFAULT_SEED = 0x0b17;
/** 场值对比度拉伸倍数 */
const FIELD_CONTRAST = 2.2;
/**
 * 点亮概率曲线：场值在 [DENSITY_LOW, DENSITY_HIGH] 间平滑升到 DENSITY_MAX。
 * 视频里云团内部也是"抖动"的——点亮的点周围平均只有约一半邻居亮着。
 */
const DENSITY_LOW = 0.38;
const DENSITY_HIGH = 0.9;
const DENSITY_MAX = 0.82;
/** 全场零星散点的概率 */
const SCATTER = 0.035;
/** 进入"中亮"档的场值（密集核心） */
const MID_THRESHOLD = 0.8;
/** 场值达到中亮阈值后，被分到中亮档的概率 */
const MID_CHANCE = 0.28;
/** 每个点闪烁节拍的周期范围（秒） */
const PERIOD_MIN = 1.2;
const PERIOD_MAX = 3.2;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
const smoothstep = (edge0: number, edge1: number, value: number) => {
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** 整数格点哈希，返回 [0, 1) */
export const hash2 = (ix: number, iy: number, seed: number): number => {
  let h = Math.imul(ix, 0x27d4eb2d) ^ Math.imul(iy, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
};

const valueNoise = (x: number, y: number, seed: number): number => {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);
  const top = a + (b - a) * sx;
  const bottom = c + (d - c) * sx;
  return top + (bottom - top) * sy;
};

/**
 * 时间 t 下格子 (col, row) 的星云场值，约在 [0, 1]。
 * 主层整体向左漂移；副层沿另一方向缓慢流动，两者叠加使云团在漂移中持续变形。
 */
export const fieldAt = (col: number, row: number, time: number, seed: number): number => {
  // col 以右侧为 0 向左递增，"内容向左移动" 即采样点向右（col 减小方向）回溯
  const x = col - DRIFT_SPEED * time;
  const primary =
    valueNoise(x / 11, row / 11, seed) * 0.62 + valueNoise(x / 5, row / 5, seed + 1) * 0.38;
  const secondary = valueNoise(x / 7 + time * 0.6, row / 7 - time * 0.8, seed + 2);
  // 叠加后分布集中在 0.5 附近，拉伸对比度让云团轮廓和暗区更分明
  return clamp((primary * 0.62 + secondary * 0.38 - 0.5) * FIELD_CONTRAST + 0.5, 0, 1);
};

export function pitchForHeight(height: number): number {
  return clamp(Math.round(height / ROWS_PER_HEIGHT), MIN_PITCH, MAX_PITCH);
}

export function createDotGrid(
  width: number,
  height: number,
  options: DotGridOptions = {}
): DotGrid {
  const seed = options.seed ?? DEFAULT_SEED;
  const valid = width > 0 && height > 0;
  const pitch = options.pitch ?? pitchForHeight(height);
  const dotSize = Math.max(2, Math.round(pitch * DOT_RATIO));
  const columns = valid ? Math.floor(width / pitch) + 1 : 0;
  const rows = valid ? Math.floor(height / pitch) + 1 : 0;
  const count = columns * rows;

  const grid: DotGrid = {
    width,
    height,
    pitch,
    dotSize,
    columns,
    rows,
    xs: new Float32Array(count),
    ys: new Float32Array(count),
    cols: new Int32Array(count),
    rowsIndex: new Int32Array(count),
    revealAt: new Float32Array(count),
    period: new Float32Array(count),
    phase: new Float32Array(count),
    introDuration: 0,
  };
  if (!valid) return grid;

  const diagonal = Math.hypot(width, height);
  const inset = (pitch - dotSize) / 2;
  let index = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      // 以右下角为原点向左上排布；最左/最上一圈允许部分出界以铺满边缘
      const x = width - (col + 1) * pitch + inset;
      const y = height - (row + 1) * pitch + inset;
      grid.xs[index] = x;
      grid.ys[index] = y;
      grid.cols[index] = col;
      grid.rowsIndex[index] = row;
      const distance = clamp(Math.hypot(width - x, height - y) / diagonal, 0, 1);
      const revealAt = WAVE_DURATION * distance + WAVE_JITTER * hash2(col, row, seed + 13);
      grid.revealAt[index] = revealAt;
      grid.period[index] = PERIOD_MIN + (PERIOD_MAX - PERIOD_MIN) * hash2(col, row, seed + 17);
      grid.phase[index] = hash2(col, row, seed + 19);
      grid.introDuration = Math.max(grid.introDuration, revealAt + FLASH_RISE + FLASH_SETTLE);
      index += 1;
    }
  }
  return grid;
}

/**
 * 计算时间 t 下每个格子的目标透明度（0 表示熄灭），写入 out。
 * 同一时刻结果确定，可用于测试与静态帧。
 */
export function sampleDotTargets(
  grid: DotGrid,
  time: number,
  out: Float32Array,
  seed = DEFAULT_SEED
) {
  const count = grid.columns * grid.rows;
  for (let i = 0; i < count; i += 1) {
    const col = grid.cols[i];
    const row = grid.rowsIndex[i];
    // 每个点在自己的节拍上重新掷骰：节拍之间状态保持不变，切换是瞬时的
    const epoch = Math.floor(time / grid.period[i] + grid.phase[i]);
    const roll = hash2(col * 131 + epoch, row, seed + 23);
    const field = fieldAt(col, row, time, seed);
    const probability = SCATTER + DENSITY_MAX * smoothstep(DENSITY_LOW, DENSITY_HIGH, field);

    if (roll >= probability) {
      out[i] = 0;
      continue;
    }
    const toneRoll = hash2(col * 131 + epoch, row, seed + 29);
    out[i] = field > MID_THRESHOLD && toneRoll < MID_CHANCE ? TONE_MID : TONE_DIM;
  }
}

/**
 * 叠加雷达波入场：揭示前不可见 → 迅速点亮到峰值 → 缓出回落到当前亮度。
 */
export function applyReveal(alpha: number, revealAt: number, elapsed: number): number {
  const local = elapsed - revealAt;
  if (local <= 0) return 0;
  if (alpha <= 0) return 0;
  const peak = Math.min(1, alpha + FLASH_BOOST);
  if (local < FLASH_RISE) return peak * (local / FLASH_RISE);
  const settle = (local - FLASH_RISE) / FLASH_SETTLE;
  if (settle >= 1) return alpha;
  return peak + (alpha - peak) * easeOutCubic(settle);
}
