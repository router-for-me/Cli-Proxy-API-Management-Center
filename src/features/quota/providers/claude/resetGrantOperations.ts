import { apiClient } from '@/services/api/client';
import {
  AnthropicResetGrantError,
  anthropicResetGrantBlocker,
  claimClaudeResetGrant,
  readClaudeOrganization,
  readClaudeResetGrants,
  type AnthropicResetSettledCode,
} from '@/services/api/claudeResetGrants';

export type ResetGrantFailureStage =
  'organization' | 'status' | 'eligibility' | 'request_id' | 'operation';

/** Only locally generated codes are displayed; never expose raw upstream errors. */
export class ResetGrantPreflightError extends Error {
  constructor(
    readonly stage: ResetGrantFailureStage,
    readonly reason: string
  ) {
    super(`${stage}: ${reason}`);
  }
}

export function resetGrantFailureMessageKey(error: unknown) {
  return error instanceof ResetGrantPreflightError
    ? `claude_reset.failure_${error.stage}`
    : 'claude_reset.blocked';
}

async function readPreflight<T>(stage: 'organization' | 'status', read: () => Promise<T>) {
  try {
    return await read();
  } catch (error) {
    throw new ResetGrantPreflightError(
      stage,
      error instanceof AnthropicResetGrantError ? error.code : 'request_failed'
    );
  }
}

export const RETRY_WINDOW_MS = 10 * 60 * 1000;
type Operation = {
  grantId: string;
  organization: string;
  requestId: string;
  createdAt: number;
  code?: AnthropicResetSettledCode;
};
const defaultDependencies = {
  revision: () => apiClient.getConnectionRevision(),
  readStatus: readClaudeResetGrants,
  readOrganization: readClaudeOrganization,
  claim: claimClaudeResetGrant,
  now: () => Date.now(),
  requestId: () => crypto.randomUUID() as string,
};

/** Tab-memory journal: survives dialog/card unmounts, never crosses connections.
 * No automatic retry. Expired ambiguous operations stay blocked until session end.
 * This is not a cross-tab or durable backend spending ledger.
 */
export function createResetGrantOperations(deps = defaultDependencies) {
  let revision = deps.revision();
  const operations = new Map<string, Operation>();
  const busy = new Set<string>();
  const syncSession = () => {
    if (revision !== deps.revision()) {
      revision = deps.revision();
      operations.clear();
      busy.clear();
    }
    return revision;
  };
  return {
    inspect(key: string) {
      syncSession();
      return operations.get(key);
    },
    async run(key: string, authIndex: string, grantId: string) {
      const session = syncSession();
      const assertSession = () => {
        if (deps.revision() !== session) throw new ResetGrantPreflightError('operation', 'session');
      };
      if (busy.has(key)) throw new ResetGrantPreflightError('operation', 'busy');
      busy.add(key);
      try {
        let operation = operations.get(key);
        if (operation?.code) operation = undefined;
        if (
          operation &&
          (operation.grantId !== grantId || deps.now() - operation.createdAt >= RETRY_WINDOW_MS)
        )
          throw new ResetGrantPreflightError('operation', 'expired');
        const wasRetry = Boolean(operation);
        const organization = await readPreflight('organization', () =>
          deps.readOrganization(authIndex)
        );
        assertSession();
        if (operation && operation.organization !== organization)
          throw new ResetGrantPreflightError('operation', 'identity');
        if (!operation) {
          const status = await readPreflight('status', () => deps.readStatus(authIndex));
          assertSession();
          const grant = status.grants.find((item) => item.id === grantId);
          const now = deps.now();
          const blocker = anthropicResetGrantBlocker(status, grantId);
          const reason =
            blocker ??
            (!grant
              ? 'unknown_grant'
              : grant.startsAt && Date.parse(grant.startsAt) > now
                ? 'not_started'
                : grant.endsAt && Date.parse(grant.endsAt) <= now
                  ? 'grant_expired'
                  : status.cooldownUntil && Date.parse(status.cooldownUntil) > now
                    ? 'cooldown'
                    : null);
          if (reason) throw new ResetGrantPreflightError('eligibility', `blocked_${reason}`);
          let requestId: string;
          try {
            requestId = deps.requestId();
          } catch {
            throw new ResetGrantPreflightError('request_id', 'generation_failed');
          }
          operation = { grantId, organization, requestId, createdAt: now };
          operations.set(key, operation);
        }
        // Re-check immediately before dispatch; never send against a replacement connection.
        assertSession();
        if (wasRetry && deps.now() - operation.createdAt >= RETRY_WINDOW_MS) {
          throw new ResetGrantPreflightError('operation', 'expired');
        }
        const code = await deps.claim(authIndex, organization, grantId, operation.requestId);
        assertSession();
        // A refusal on a retry cannot prove that the earlier ambiguous POST did not spend.
        if (!wasRetry || code === 'reset' || code === 'already_used') operation.code = code;
        return { code, unresolved: !operation.code };
      } finally {
        if (deps.revision() === session) busy.delete(key);
      }
    },
  };
}

export const resetGrantOperations = createResetGrantOperations();
