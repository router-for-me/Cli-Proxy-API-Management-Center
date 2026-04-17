let authRecoveryDepth = 0;

export const isAuthRecoveryActive = (): boolean => authRecoveryDepth > 0;

export async function runWithAuthRecovery<T>(task: () => Promise<T>): Promise<T> {
  authRecoveryDepth += 1;

  try {
    return await task();
  } finally {
    authRecoveryDepth = Math.max(0, authRecoveryDepth - 1);
  }
}
