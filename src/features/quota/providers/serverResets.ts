/**
 * Every reset a page spends goes through the quota history server (`POST /v1/resets/claim`,
 * server/quota/claims.ts): it records the claim, sends it once through the account's hub, clears
 * the hub's routing cooldown after a spent reset, and re-reads the account. Pages never send a
 * claim to the provider themselves.
 */
import {
  ANTHROPIC_RESET_RESULTS,
  AnthropicResetGrantUnknownOutcome,
  type AnthropicResetSettledCode,
} from '@/services/api/claudeResetGrants';
import type { createQuotaPoolApi, ResetClaimResponse } from '@/services/api/quotaPool';
import { isRecord } from '@/utils/helpers';
import {
  ResetGrantPreflightError,
  type ResetGrantFailureStage,
} from './claude/resetGrantOperations';

type PoolApi = Pick<ReturnType<typeof createQuotaPoolApi>, 'claimReset'>;

const STAGES: readonly ResetGrantFailureStage[] = [
  'organization',
  'status',
  'eligibility',
  'request_id',
  'operation',
];

/**
 * The server's answer, or why nothing was sent. A refusal (4xx, or 502 when the hub could not be
 * reached before sending) proves nothing was spent and becomes a preflight error; anything else
 * without an answer may have been sent, so it stays an unknown outcome the caller can retry.
 */
export async function claimResetOnServer(
  api: PoolApi,
  body: { accountId: string; clientRequestId: string; grantId?: string }
): Promise<ResetClaimResponse> {
  try {
    return await api.claimReset(body);
  } catch (error) {
    const status = isRecord(error) && typeof error.status === 'number' ? error.status : null;
    const details = isRecord(error) && isRecord(error.details) ? error.details : {};
    if (status !== null && ((status >= 400 && status < 500) || status === 502)) {
      const stage = STAGES.find((value) => value === details.stage) ?? 'operation';
      const reason = typeof details.reason === 'string' ? details.reason : 'refused';
      throw new ResetGrantPreflightError(stage, reason);
    }
    throw new AnthropicResetGrantUnknownOutcome();
  }
}

/** A Claude claim's code as the reset-grant journal expects it; `unknown` stays retryable. */
export function claudeClaimCode(outcome: string): AnthropicResetSettledCode {
  if (
    (ANTHROPIC_RESET_RESULTS as readonly string[]).includes(outcome) ||
    outcome === 'rate_limited' ||
    outcome === 'auth_error'
  )
    return outcome as AnthropicResetSettledCode;
  throw new AnthropicResetGrantUnknownOutcome();
}
