/** Empty values inherit the configured default. Numeric offsets are not Go IANA locations. */
export function isValidTimezone(value: string): boolean {
  const timezone = value.trim();
  if (!timezone) return true;
  if (/^[+-]/.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
