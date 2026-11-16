import {
  AnthropicResetGrantError,
  anthropicResetGrantClaimBlocker,
  type claimClaudeResetGrant,
  type readClaudeOrganization,
  type readClaudeResetGrants,
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
/** Every caller binds these to one source session (resetGrantScope.ts). */
export interface ResetGrantDependencies {
  revision: () => number;
  readStatus: typeof readClaudeResetGrants;
  readOrganization: typeof readClaudeOrganization;
  claim: typeof claimClaudeResetGrant;
  now: () => number;
  requestId: () => string;
}

/** Tab-memory journal: survives dialog/card unmounts, never crosses connections.
 * No automatic retry. Expired ambiguous operations stay blocked until session end.
 * This is not a cross-tab or durable backend spending ledger.
 */
export type ResetGrantJournal = { operations: Map<string, Operation>; busy: Set<string> };
export const createResetGrantJournal = (): ResetGrantJournal => ({
  operations: new Map(),
  busy: new Set(),
});

export function createResetGrantOperations(
  deps: ResetGrantDependencies,
  { operations, busy } = createResetGrantJournal()
) {
  let revision = deps.revision();
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
          const now = deps.now();
          const reason = anthropicResetGrantClaimBlocker(status, grantId, now);
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
        let code: Awaited<ReturnType<typeof deps.claim>>;
        try {
          code = await deps.claim(authIndex, organization, grantId, operation.requestId);
        } catch (error) {
          // Refused before it was sent: a first attempt leaves nothing to retry. A retry keeps
          // its operation, since the earlier send may still have spent.
          if (error instanceof ResetGrantPreflightError && !wasRetry) operations.delete(key);
          throw error;
        }
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
