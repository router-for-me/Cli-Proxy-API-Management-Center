/**
 * Card layouts shared by card grids (quota cards, auth-file cards).
 *
 * - even: CSS grid; every card in a row is as tall as the row.
 * - stacked: cards packed into equal-width columns, so a short card leaves no gap.
 * - compact: stacked columns of narrower glance cards that expand on demand.
 */

export const CARD_LAYOUTS = ['even', 'stacked', 'compact'] as const;
export type CardLayout = (typeof CARD_LAYOUTS)[number];

export const DEFAULT_CARD_LAYOUT: CardLayout = 'even';

export const isCardLayout = (value: unknown): value is CardLayout =>
  typeof value === 'string' && (CARD_LAYOUTS as readonly string[]).includes(value);

/** Each page keeps its own choice in localStorage; unknown or unreadable values give the default. */
export const readCardLayout = (storageKey: string): CardLayout => {
  if (typeof window === 'undefined') return DEFAULT_CARD_LAYOUT;
  try {
    const stored = window.localStorage.getItem(storageKey);
    return isCardLayout(stored) ? stored : DEFAULT_CARD_LAYOUT;
  } catch {
    return DEFAULT_CARD_LAYOUT;
  }
};

export const writeCardLayout = (storageKey: string, layout: CardLayout) => {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey, layout);
  } catch {
    // ignore
  }
};

/** How many columns of at least `minWidth` fit in `width`, with `gap` between them. */
export const stackedColumnCount = (width: number, minWidth: number, gap: number): number =>
  Math.max(1, Math.floor((width + gap) / (minWidth + gap)));

export interface StackedPosition {
  column: number;
  top: number;
}

/**
 * Greedy packing: in order, each item goes to the column that is shortest so far (ties go to
 * the leftmost). `gap` is the space below each item. Returns each item's column and top offset,
 * and the packed height (the tallest column, without its last gap).
 */
export const packColumns = (
  heights: readonly number[],
  columnCount: number,
  gap = 0
): { positions: StackedPosition[]; height: number } => {
  const count = Math.max(1, Math.floor(columnCount));
  const totals = new Array<number>(count).fill(0);
  const positions = heights.map((height) => {
    let column = 0;
    for (let candidate = 1; candidate < count; candidate += 1) {
      if (totals[candidate] < totals[column]) column = candidate;
    }
    const top = totals[column];
    totals[column] += Math.max(0, height) + gap;
    return { column, top };
  });
  const tallest = Math.max(...totals);
  return { positions, height: tallest > 0 ? tallest - gap : 0 };
};
