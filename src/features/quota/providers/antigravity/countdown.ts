/**
 * Antigravity 倒计时文案的基础计算。
 *
 * 时长的取整、缺省与已到期三种回落只在这里定义一次：行尾的"X 后刷新"与
 * 被压制行的"恢复时长"读的是同一条规则，分开写必然会漂移。
 */

import type { TFunction } from 'i18next';

export type AntigravityCountdown =
  | { kind: 'unknown' }
  | { kind: 'elapsed' }
  | { kind: 'countdown'; deltaMs: number };

/**
 * 把 ISO 重置时刻折算成倒计时状态。
 *
 * `unknown` 覆盖两种不可渲染的情况：字段缺失与无法解析的字符串 —— 两者都
 * 不该拼出"…后刷新"这种带时长的句子。
 */
export const resolveAntigravityCountdown = (
  resetTime: string | undefined,
  nowMs: number
): AntigravityCountdown => {
  if (!resetTime) return { kind: 'unknown' };
  const resetMs = new Date(resetTime).getTime();
  if (Number.isNaN(resetMs)) return { kind: 'unknown' };
  const deltaMs = resetMs - nowMs;
  return deltaMs <= 0 ? { kind: 'elapsed' } : { kind: 'countdown', deltaMs };
};

/** 时长文案：向上取整到分钟，至少 1 分钟。 */
export const formatAntigravityDuration = (t: TFunction, deltaMs: number): string => {
  const totalMinutes = Math.max(1, Math.ceil(deltaMs / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return t('antigravity_quota.duration_day_hour', {
      days,
      hours,
    });
  }
  if (hours > 0) {
    return t('antigravity_quota.duration_hour_minute', {
      hours,
      minutes,
    });
  }
  if (minutes > 0) {
    return t('antigravity_quota.duration_minute', {
      minutes,
    });
  }
  return t('antigravity_quota.duration_less_than_minute');
};

const MINUTE_MS = 60_000;

/**
 * 返回下一个可见倒计时文案发生变化的等待时间。
 *
 * 文案以向上取整的分钟展示，所以按最近的分钟边界唤醒即可；已经到期或
 * 无效的时间不再创建定时器。
 */
export function getNextAntigravityCountdownUpdateDelay(
  resetTimestamps: readonly number[],
  nowMs: number
): number | null {
  let nextDelay: number | null = null;

  resetTimestamps.forEach((resetMs) => {
    if (!Number.isFinite(resetMs)) return;
    const deltaMs = resetMs - nowMs;
    if (deltaMs <= 0) return;

    const remainder = deltaMs % MINUTE_MS;
    const delay = Math.max(1, Math.ceil(remainder === 0 ? MINUTE_MS : remainder));
    nextDelay = nextDelay === null ? delay : Math.min(nextDelay, delay);
  });

  return nextDelay;
}
