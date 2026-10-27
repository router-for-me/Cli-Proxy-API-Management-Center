/**
 * Display formatting for the pool forecast. Dates use the browser's time zone
 * and the active UI language through Intl.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const dateFormatter = (locale: string, options: Intl.DateTimeFormatOptions) => {
  const key = `${locale}|${JSON.stringify(options)}`;
  let formatter = formatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, options);
    formatterCache.set(key, formatter);
  }
  return formatter;
};

export const formatPoolPercent = (value: number): string => `${Math.round(value)}%`;

export const formatJump = (value: number): string => `+${Math.round(value)}%`;

export const formatRate = (value: number): string => {
  const digits = value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)}%/h`;
};

/** "Tue 10:00 AM" */
export const formatWeekdayTime = (t: number, locale: string): string =>
  dateFormatter(locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(t);

/** "Nov 9" */
export const formatMonthDay = (t: number, locale: string): string =>
  dateFormatter(locale, { month: 'short', day: 'numeric' }).format(t);

/** "Nov 9, 4:40 PM" */
export const formatMonthDayTime = (t: number, locale: string): string =>
  dateFormatter(locale, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(t);

/** "Fri 23": weekday first in every locale, so ticks scan the same way. */
export const formatDayTick = (t: number, locale: string): string =>
  `${dateFormatter(locale, { weekday: 'short' }).format(t)} ${dateFormatter(locale, { day: 'numeric' }).format(t)}`;

/** Weekday + time within the coming week, a calendar date beyond it. */
export const formatUpcoming = (t: number, now: number, locale: string): string =>
  t - now < 7 * DAY_MS ? formatWeekdayTime(t, locale) : formatMonthDayTime(t, locale);

/** "2d 18h", "15h 49m", "12m" */
export const formatDuration = (ms: number): string => {
  const totalMinutes = Math.max(0, Math.round(ms / 60000));
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

/** Capacity weights as typed, without trailing zeros: 2.5, 1, 0.75. */
export const formatWeight = (weight: number): string =>
  Number.isInteger(weight) ? String(weight) : String(Number(weight.toFixed(2)));
