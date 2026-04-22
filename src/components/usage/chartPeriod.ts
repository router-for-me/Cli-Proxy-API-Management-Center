export const getAdaptiveChartPeriod = (hourWindowHours?: number): 'hour' | 'day' => {
  if (!hourWindowHours) {
    return 'day';
  }

  return hourWindowHours <= 24 ? 'hour' : 'day';
};

export const getAdaptiveAnalysisChartPeriod = (
  hourWindowHours?: number
): 'hour' | 'day' => {
  if (!hourWindowHours) {
    return 'day';
  }

  return hourWindowHours <= 7 * 24 ? 'hour' : 'day';
};
