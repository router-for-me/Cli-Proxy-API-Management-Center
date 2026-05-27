import type { StatusBlockDetail } from '@/utils/recentRequests';

type StatusBlockAriaCopy = {
  successLabel: string;
  failureLabel: string;
  noRequestsLabel: string;
  successRateLabel: string;
};

type StatusBlockAriaLabelOptions = {
  detail: Pick<StatusBlockDetail, 'success' | 'failure' | 'rate'>;
  timeRangeLabel: string;
  successRateValue: string;
  copy: StatusBlockAriaCopy;
};

export const getNextMonitoringStatusBlockIndex = (
  currentIndex: number,
  key: string,
  total: number
) => {
  if (total <= 0) return null;

  switch (key) {
    case 'ArrowLeft':
      return Math.max(0, currentIndex - 1);
    case 'ArrowRight':
      return Math.min(total - 1, currentIndex + 1);
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    default:
      return null;
  }
};

export const buildMonitoringStatusBlockAriaLabel = ({
  detail,
  timeRangeLabel,
  successRateValue,
  copy,
}: StatusBlockAriaLabelOptions) => {
  const total = detail.success + detail.failure;
  if (detail.rate === -1 || total <= 0) {
    return `${timeRangeLabel}, ${copy.noRequestsLabel}`;
  }

  return [
    timeRangeLabel,
    `${copy.successLabel} ${detail.success}`,
    `${copy.failureLabel} ${detail.failure}`,
    `${copy.successRateLabel} ${successRateValue}`,
  ].join(', ');
};
