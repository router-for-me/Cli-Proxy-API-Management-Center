import { describe, expect, test } from 'bun:test';
import { popoverShift } from '../src/components/ui/keepInViewport';

// Anchor (trigger wrapper) spans 40..140; the visible range is 0..360 with an 8px margin.
const anchor = [40, 140] as const;
const range = [0, 360, 8] as const;

describe('popoverShift', () => {
  test('leaves a popover that fits alone', () => {
    expect(popoverShift(40, 200, ...anchor, ...range)).toBe(0);
  });

  test('flips a right-aligned popover to the left edge of its trigger', () => {
    // Right-aligned: left = 140 - 220 = -80, off screen. Flipped: left = 40.
    expect(popoverShift(-80, 220, ...anchor, ...range)).toBe(120);
  });

  test('flips a left-aligned popover to the right edge of its trigger', () => {
    // Anchor near the right edge: 300..340. Left-aligned at 300 overflows 352.
    expect(popoverShift(300, 200, 300, 340, ...range)).toBe(-160);
  });

  test('moves the least distance when neither edge fits', () => {
    // 300 wide in a 344 wide range, anchor 150..200: both edges overflow.
    expect(popoverShift(150, 300, 150, 200, ...range)).toBe(352 - 300 - 150);
  });

  test('lines up with a trigger that sits inside the margin', () => {
    // Trigger at 2..60 is closer to the edge than the margin. Flipped to its
    // left edge, the popover lines up with it at 2 instead of stopping at 8.
    expect(popoverShift(-140, 200, 2, 60, ...range)).toBe(142);
  });

  test('keeps the left edge visible when the popover is wider than the range', () => {
    expect(popoverShift(100, 400, 100, 140, ...range)).toBe(8 - 100);
  });
});
