/**
 * Type guard: checks if a value is a non-null object (record).
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

/**
 * Extract a human-readable error message from an unknown error value.
 * Handles Error instances, plain strings, and objects with a `message` property.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (isRecord(err) && typeof err.message === 'string') return err.message;
  return '';
}
