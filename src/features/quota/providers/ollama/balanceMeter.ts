/** Remaining included credits, not historical usage or purchased-credit capacity. */
export function includedRemainingPercent(
  balance: number | null | undefined,
  allowance: number | null | undefined
): number | null {
  if (
    typeof balance !== 'number' ||
    typeof allowance !== 'number' ||
    !Number.isFinite(balance) ||
    !Number.isFinite(allowance) ||
    allowance <= 0
  )
    return null;
  return Math.min(100, Math.max(0, (balance / allowance) * 100));
}
