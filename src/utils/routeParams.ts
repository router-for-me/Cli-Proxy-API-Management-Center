const ROUTE_INDEX_PATTERN = /^(0|[1-9]\d*)$/;

export function parseRouteIndexParam(value: string | undefined): number | null {
  // Route indexes must be canonical digits only; parseInt would accept values like "1abc"
  // and could route a malformed URL to a real provider entry.
  if (!value || !ROUTE_INDEX_PATTERN.test(value)) return null;

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
