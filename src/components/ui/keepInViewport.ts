import { VIEWPORT_MARGIN } from './selectPosition';

/**
 * Horizontal shift (px) for a popover spanning [left, left + width] that CSS
 * aligns to one edge of its anchor [anchorLeft, anchorRight]. The popover must
 * stay `margin` px inside [rangeMin, rangeMax], except that lining up with its
 * anchor is always allowed. A popover that does not fit first flips to the
 * other edge of the anchor, so it stays aligned with its trigger. If neither
 * edge fits, it moves the least distance that keeps it inside, or onto the
 * left bound when it is too wide.
 */
export function popoverShift(
  left: number,
  width: number,
  anchorLeft: number,
  anchorRight: number,
  rangeMin: number,
  rangeMax: number,
  margin: number
): number {
  const min = Math.min(rangeMin + margin, anchorLeft);
  const max = Math.max(rangeMax - margin, anchorRight);
  const overflow = (start: number) => Math.max(0, min - start) + Math.max(0, start + width - max);
  if (overflow(left) === 0) return 0;
  const flipped = anchorLeft + anchorRight - left - width;
  if (overflow(flipped) === 0) return flipped - left;
  const start = overflow(flipped) < overflow(left) ? flipped : left;
  return Math.min(Math.max(start, min), Math.max(min, max - width)) - left;
}

/**
 * Visible horizontal range for an element: the viewport, narrowed by each
 * ancestor that clips its overflow.
 */
function visibleRange(element: HTMLElement): [number, number] {
  let min = 0;
  let max = document.documentElement.clientWidth;
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    if (getComputedStyle(node).overflowX === 'visible') continue;
    const left = node.getBoundingClientRect().left + node.clientLeft;
    min = Math.max(min, left);
    max = Math.min(max, left + node.clientWidth);
  }
  return [min, max];
}

/**
 * Callback ref for a popover that CSS anchors to one side of its trigger. The
 * popover's offset parent is the trigger's wrapper. When the anchored side
 * would push the popover out of view, it flips to the other side of the
 * trigger, and repeats on resize.
 */
export function keepInViewport(element: HTMLElement | null): (() => void) | void {
  if (!element) return;
  const place = () => {
    const parent = element.offsetParent;
    if (!parent) return;
    // Measure layout boxes, not the popover's getBoundingClientRect(): entry
    // animations scale the popover, which would skew its measured edges.
    const anchorLeft = parent.getBoundingClientRect().left + parent.clientLeft;
    const left = anchorLeft + element.offsetLeft;
    const [min, max] = visibleRange(element);
    const shift = popoverShift(
      left,
      element.offsetWidth,
      anchorLeft,
      anchorLeft + parent.clientWidth,
      min,
      max,
      VIEWPORT_MARGIN
    );
    element.style.translate = shift ? `${shift}px 0` : '';
  };
  place();
  window.addEventListener('resize', place);
  return () => window.removeEventListener('resize', place);
}
