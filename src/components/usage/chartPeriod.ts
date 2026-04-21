export const getAdaptiveChartPeriod = (hourWindowHours?: number): 'hour' | 'day' => {
  if (!hourWindowHours) {
    return 'day';
  }

  return hourWindowHours <= 24 ? 'hour' : 'day';
};
