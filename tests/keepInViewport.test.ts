import { describe, expect, test } from 'bun:test';
import { horizontalShiftIntoView } from '../src/components/ui/keepInViewport';

describe('horizontalShiftIntoView', () => {
  test('leaves a popover that fits alone', () => {
    expect(horizontalShiftIntoView(67, 283, 24, 336)).toBe(0);
  });

  test('moves a popover that starts off the left edge back to the left bound', () => {
    expect(horizontalShiftIntoView(-42, 178, 24, 336)).toBe(66);
  });

  test('moves a popover that ends off the right edge back to the right bound', () => {
    expect(horizontalShiftIntoView(200, 420, 24, 366)).toBe(-54);
  });

  test('keeps the left edge visible when the popover is wider than the bounds', () => {
    expect(horizontalShiftIntoView(100, 500, 24, 296)).toBe(-76);
  });
});
