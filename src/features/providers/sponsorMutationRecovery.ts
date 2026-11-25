import { guardConfigConnection } from '@/services/api/configValue';

export class SponsorPartialMutationError extends Error {
  readonly cause: unknown;

  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause ?? 'Sponsor mutation failed'));
    this.name = 'SponsorPartialMutationError';
    this.cause = cause;
  }
}

export const isSponsorPartialMutationError = (
  error: unknown
): error is SponsorPartialMutationError => error instanceof SponsorPartialMutationError;

export async function runSponsorMutationWithRecovery<T>(
  action: (assertConnection: () => void) => Promise<T>,
  refresh: () => Promise<unknown>
): Promise<T> {
  const assertConnection = guardConfigConnection();
  try {
    return await action(assertConnection);
  } catch (error: unknown) {
    assertConnection();
    try {
      await refresh();
    } catch {
      // Preserve the original mutation error; refresh is best-effort recovery.
    }
    throw new SponsorPartialMutationError(error);
  }
}
