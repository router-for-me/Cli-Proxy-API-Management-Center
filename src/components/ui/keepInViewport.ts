import { VIEWPORT_MARGIN } from './selectPosition';

/**
 * Horizontal shift (px) that moves a box spanning [left, right] inside
 * [minLeft, maxRight]. A box wider than that range keeps its left edge on
 * minLeft.
 */
export function horizontalShiftIntoView(
  left: number,
  right: number,
  minLeft: number,
  maxRight: number
): number {
  if (left < minLeft) return minLeft - left;
  if (right > maxRight) return Math.max(maxRight - right, minLeft - left);
  return 0;
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
 * Callback ref for a popover that CSS anchors to one side of its trigger.
 * When the trigger sits near the opposite screen edge, that anchor pushes the
 * popover off screen. This shifts it back and repeats on resize.
 */
export function keepInViewport(element: HTMLElement | null): (() => void) | void {
  if (!element) return;
  const place = () => {
    // Measure the layout box, not getBoundingClientRect(): entry animations
    // scale the popover, which would skew its measured edges.
    const parent = element.offsetParent;
    if (!parent) return;
    const left = parent.getBoundingClientRect().left + parent.clientLeft + element.offsetLeft;
    const [min, max] = visibleRange(element);
    const shift = horizontalShiftIntoView(
      left,
      left + element.offsetWidth,
      min + VIEWPORT_MARGIN,
      max - VIEWPORT_MARGIN
    );
    element.style.translate = shift ? `${shift}px 0` : '';
  };
  place();
  window.addEventListener('resize', place);
  return () => window.removeEventListener('resize', place);
}
