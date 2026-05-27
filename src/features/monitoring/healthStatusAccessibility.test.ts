import { describe, expect, it } from 'vitest';
import {
  buildMonitoringStatusBlockAriaLabel,
  getNextMonitoringStatusBlockIndex,
} from './healthStatusAccessibility';

describe('getNextMonitoringStatusBlockIndex', () => {
  it('moves focus within bounds for arrow and boundary keys', () => {
    expect(getNextMonitoringStatusBlockIndex(5, 'ArrowLeft', 20)).toBe(4);
    expect(getNextMonitoringStatusBlockIndex(5, 'ArrowRight', 20)).toBe(6);
    expect(getNextMonitoringStatusBlockIndex(5, 'Home', 20)).toBe(0);
    expect(getNextMonitoringStatusBlockIndex(5, 'End', 20)).toBe(19);
  });

  it('clamps focus at the beginning and end of the status bar', () => {
    expect(getNextMonitoringStatusBlockIndex(0, 'ArrowLeft', 20)).toBe(0);
    expect(getNextMonitoringStatusBlockIndex(19, 'ArrowRight', 20)).toBe(19);
  });

  it('returns null for unsupported keys or empty status bars', () => {
    expect(getNextMonitoringStatusBlockIndex(3, 'PageDown', 20)).toBeNull();
    expect(getNextMonitoringStatusBlockIndex(0, 'ArrowRight', 0)).toBeNull();
  });
});

describe('buildMonitoringStatusBlockAriaLabel', () => {
  const copy = {
    successLabel: 'Success',
    failureLabel: 'Failure',
    noRequestsLabel: 'No requests',
    successRateLabel: 'Success Rate',
  };

  it('describes a populated bucket with counts and success rate', () => {
    expect(
      buildMonitoringStatusBlockAriaLabel({
        detail: {
          success: 3,
          failure: 1,
          rate: 0.75,
        },
        timeRangeLabel: '5/10 10:00 AM - 11:00 AM',
        successRateValue: '75%',
        copy,
      })
    ).toBe('5/10 10:00 AM - 11:00 AM, Success 3, Failure 1, Success Rate 75%');
  });

  it('describes idle buckets as having no requests', () => {
    expect(
      buildMonitoringStatusBlockAriaLabel({
        detail: {
          success: 0,
          failure: 0,
          rate: -1,
        },
        timeRangeLabel: '5/10 11:00 AM - 12:00 PM',
        successRateValue: '0%',
        copy,
      })
    ).toBe('5/10 11:00 AM - 12:00 PM, No requests');
  });
});
