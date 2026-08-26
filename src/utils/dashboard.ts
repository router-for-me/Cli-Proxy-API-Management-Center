export function getDashboardModelsStatValue(
  count: number,
  loading: boolean,
  error: string | null
): number | '-' {
  return loading || error ? '-' : count;
}
